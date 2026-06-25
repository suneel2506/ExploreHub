#!/usr/bin/env node
// =============================================================================
// ExploreHub — OSM Import Script v5 (Hierarchical)
// =============================================================================
//
// PREREQUISITES (run ONCE in Supabase SQL Editor before this script):
//   supabase/migrations/005_hierarchical_schema.sql
//
// USAGE:
//   node scripts/import-osm-v2.cjs                     full import
//   node scripts/import-osm-v2.cjs --dry-run            parse + count, no DB writes
//   node scripts/import-osm-v2.cjs --limit 5000         stop after N place inserts
//   node scripts/import-osm-v2.cjs --category Temples   one category only
//   node scripts/import-osm-v2.cjs --pass hierarchy     import hierarchy only
//   node scripts/import-osm-v2.cjs --pass places        import places only (hierarchy must exist)
//   node scripts/import-osm-v2.cjs --enrich-images      fetch Wikipedia images after import
//
// After import finishes, drop temp policies in SQL Editor:
//   DROP POLICY "import_countries_anon" ON public.countries;
//   DROP POLICY "import_states_anon"    ON public.states;
//   DROP POLICY "import_districts_anon" ON public.districts;
//   DROP POLICY "import_cities_anon"    ON public.cities;
//   DROP POLICY "import_places_anon"    ON public.places;
//   DROP POLICY "import_places_update_anon" ON public.places;
//
// =============================================================================
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY;

// ─── HTTPS agent ──────────────────────────────────────────────────────────────
const httpsAgent = new https.Agent({ keepAlive: false, maxSockets: 2, timeout: 30000 });

// ─── CLI flags ────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const LIMIT      = (() => { const i = args.indexOf('--limit');    return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })();
const ONLY_CAT   = (() => { const i = args.indexOf('--category'); return i >= 0 ? args[i + 1] : null; })();
const PASS_ONLY  = (() => { const i = args.indexOf('--pass');     return i >= 0 ? args[i + 1] : null; })();
const ENRICH_IMG = args.includes('--enrich-images');
const BATCH_SIZE = 80;
const INTER_BATCH_DELAY_MS = 500;

// ─── API key ──────────────────────────────────────────────────────────────────
const useServiceKey = SERVICE_KEY && SERVICE_KEY !== 'your-service-role-key-here';
const API_KEY       = useServiceKey ? SERVICE_KEY : ANON_KEY;

if (!SUPABASE_URL || !API_KEY) {
  console.error('\n❌ SUPABASE_URL or API key missing in .env\n');
  process.exit(1);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function httpRequest(urlStr, method, payload, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : '';
    const url  = new URL(urlStr);

    const options = {
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname + url.search,
      method,
      agent:    httpsAgent,
      timeout:  30000,
      headers:  {
        ...extraHeaders,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Connection':     'close',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
        } else {
          try { resolve(JSON.parse(body)); } catch { resolve(body); }
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('SOCKET_TIMEOUT')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const supaHeaders = {
  'apikey':        API_KEY,
  'Authorization': `Bearer ${API_KEY}`,
};

function supabaseInsert(table, records) {
  return httpRequest(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=osm_id`,
    'POST',
    records,
    { ...supaHeaders, 'Prefer': 'resolution=ignore-duplicates,return=minimal' }
  );
}

function supabaseInsertNamed(table, records, conflictCol) {
  const conflictParam = conflictCol ? `?on_conflict=${conflictCol}` : '';
  return httpRequest(
    `${SUPABASE_URL}/rest/v1/${table}${conflictParam}`,
    'POST',
    records,
    { ...supaHeaders, 'Prefer': 'resolution=ignore-duplicates,return=representation' }
  );
}

function supabaseGet(table, query) {
  return httpRequest(
    `${SUPABASE_URL}/rest/v1/${table}?${query}`,
    'GET',
    null,
    { ...supaHeaders }
  );
}

// Retry wrapper
const RETRYABLE = new Set(['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'SOCKET_TIMEOUT', 'EAI_AGAIN']);

async function withRetry(fn, label, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg  = err.message || '';
      const code = err.code    || '';
      if (msg.startsWith('HTTP 4')) {
        process.stderr.write(`\n  ❌ ${label}: schema/auth error (NOT retrying)\n  ${msg.slice(0, 500)}\n`);
        return null;
      }
      if (attempt < maxRetries) {
        const wait = Math.min(1000 * Math.pow(2, attempt - 1), 16000);
        process.stderr.write(`\n  ⚠️  ${label} (attempt ${attempt}/${maxRetries}), retrying in ${wait / 1000}s… [${code || msg.slice(0, 60)}]\n`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        process.stderr.write(`\n  ❌ ${label} failed after ${maxRetries} attempts: ${msg.slice(0, 200)}\n`);
        return null;
      }
    }
  }
}

// ─── OSM file ─────────────────────────────────────────────────────────────────
const PBF_FILE = ['india-260623.osm.pbf', 'india-latest.osm.pbf']
  .map((f) => path.join(__dirname, '..', f))
  .find(fs.existsSync);

if (!PBF_FILE) {
  console.error('\n❌ OSM file not found. Expected india-260623.osm.pbf in project root.\n');
  process.exit(1);
}

// ─── Tag helpers ──────────────────────────────────────────────────────────────
function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function getName(tags) {
  return str(tags['name:en'] || tags.name || tags['name:hi'] ||
    tags['name:ta'] || tags['name:te'] || tags['name:ml'] || tags['name:kn']);
}

function getDescription(tags) {
  const d = str(tags.description || tags.note);
  return d ? d.slice(0, 2000) : null;
}

function getPlaceType(tags) {
  return str(tags.natural || tags.tourism || tags.historic || tags.leisure || tags.amenity || tags.place);
}

function getWikiUrl(tags) {
  if (tags.wikipedia) {
    const parts = tags.wikipedia.split(':');
    if (parts.length >= 2) {
      const lang = parts[0];
      const article = parts.slice(1).join(':');
      return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(article.replace(/ /g, '_'))}`;
    }
  }
  return null;
}

function getImageFromTags(tags) {
  // Direct image tag
  if (tags.image && (tags.image.startsWith('http://') || tags.image.startsWith('https://'))) {
    return tags.image;
  }
  // Wikimedia commons
  if (tags.wikimedia_commons) {
    const file = tags.wikimedia_commons.replace(/^File:/, '').replace(/^Category:/, '');
    if (file) {
      // Use Wikimedia thumbnail API
      const encoded = encodeURIComponent(file.replace(/ /g, '_'));
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=400`;
    }
  }
  return null;
}

// ─── Categories ───────────────────────────────────────────────────────────────
function categorize(tags) {
  // Natural features
  if (tags.natural === 'waterfall')                          return 'Waterfalls';
  if (tags.natural === 'beach')                              return 'Beaches';
  if (tags.natural === 'bay'  || tags.natural === 'cape')   return 'Beaches';
  if (tags.natural === 'peak' || tags.natural === 'volcano') return 'Mountains';
  if (tags.natural === 'ridge')                              return 'Mountains';
  if (tags.natural === 'lake' || tags.natural === 'water')  return 'Lakes';
  if (tags.natural === 'reservoir')                          return 'Lakes';
  if (tags.natural === 'forest')                             return 'Forests';
  if (tags.natural === 'cave_entrance')                      return 'Caves';
  if (tags.natural === 'hot_spring')                         return 'Attractions';
  if (tags.natural === 'cliff')                              return 'Viewpoints';
  if (tags.natural === 'island')                             return 'Islands';

  // Tourism
  if (tags.tourism === 'attraction')                         return 'Attractions';
  if (tags.tourism === 'museum')                             return 'Museums';
  if (tags.tourism === 'viewpoint')                          return 'Viewpoints';
  if (tags.tourism === 'zoo')                                return 'Wildlife';
  if (tags.tourism === 'aquarium')                           return 'Wildlife';
  if (tags.tourism === 'theme_park')                         return 'Attractions';
  if (tags.tourism === 'artwork')                            return 'Attractions';
  if (tags.tourism === 'gallery')                            return 'Museums';
  if (tags.tourism === 'picnic_site')                        return 'Parks';

  // Leisure
  if (tags.leisure === 'nature_reserve')                     return 'National Parks';
  if (tags.leisure === 'park')                               return 'Parks';
  if (tags.leisure === 'garden')                             return 'Parks';
  if (tags.leisure === 'water_park')                         return 'Attractions';
  if (tags.leisure === 'stadium')                            return 'Attractions';
  if (tags.leisure === 'bird_hide')                          return 'Wildlife';

  // Historic
  if (tags.historic === 'monument')                          return 'Historical';
  if (tags.historic === 'castle' || tags.historic === 'fort') return 'Forts';
  if (tags.historic === 'ruins')                             return 'Historical';
  if (tags.historic === 'palace')                            return 'Historical';
  if (tags.historic === 'archaeological_site')               return 'Historical';
  if (tags.historic === 'memorial')                          return 'Historical';
  if (tags.historic === 'temple')                            return 'Temples';
  if (tags.historic === 'mosque')                            return 'Mosques';
  if (tags.historic === 'church')                            return 'Churches';
  if (tags.historic === 'lighthouse')                        return 'Attractions';
  if (tags.historic === 'battleground')                      return 'Historical';
  if (tags.historic === 'yes')                               return 'Historical';
  if (tags.historic === 'boundary_stone')                    return 'Historical';
  if (tags.historic === 'building')                          return 'Historical';

  // Places of worship (by religion)
  if (tags.amenity === 'place_of_worship') {
    if (tags.religion === 'hindu')                           return 'Temples';
    if (tags.religion === 'buddhist')                        return 'Monasteries';
    if (tags.religion === 'muslim')                          return 'Mosques';
    if (tags.religion === 'christian')                       return 'Churches';
    if (tags.religion === 'sikh')                            return 'Gurudwaras';
    if (tags.religion === 'jain')                            return 'Temples';
    return 'Temples'; // Default for unspecified religion
  }

  // Water infrastructure
  if (tags.waterway === 'dam')                               return 'Dams';
  if (tags.waterway === 'waterfall')                         return 'Waterfalls';

  // Boundary (national park, protected area)
  if (tags.boundary === 'national_park')                     return 'National Parks';
  if (tags.boundary === 'protected_area')                    return 'Wildlife';

  // Settlements
  if (tags.place === 'city')                                 return 'Cities';
  if (tags.place === 'town')                                 return 'Cities';
  if (tags.place === 'village')                              return 'Villages';
  if (tags.place === 'hamlet')                               return 'Villages';

  // Man-made structures
  if (tags.man_made === 'bridge' && getName(tags))           return 'Bridges';
  if (tags.man_made === 'lighthouse')                        return 'Attractions';
  if (tags.man_made === 'tower' && tags.tourism)             return 'Attractions';

  return null;
}

function isRelevant(tags) {
  const name = getName(tags);
  if (!name) return false;
  if (name.length <= 2) return false;

  // Explicit exclusions
  if (tags.tourism   === 'information')    return false;
  if (tags.tourism   === 'hotel')          return false;
  if (tags.tourism   === 'guest_house')    return false;
  if (tags.tourism   === 'motel')          return false;
  if (tags.tourism   === 'hostel')         return false;
  if (tags.tourism   === 'camp_site')      return false;
  if (tags.natural   === 'tree')           return false;
  if (tags.natural   === 'scrub')          return false;
  if (tags.natural   === 'grassland')      return false;
  if (tags.amenity   === 'parking')        return false;
  if (tags.amenity   === 'bench')          return false;
  if (tags.amenity   === 'fuel')           return false;
  if (tags.amenity   === 'atm')            return false;
  if (tags.amenity   === 'bank')           return false;
  if (tags.amenity   === 'restaurant')     return false;
  if (tags.amenity   === 'cafe')           return false;
  if (tags.amenity   === 'hospital')       return false;
  if (tags.amenity   === 'school')         return false;
  if (tags.amenity   === 'college')        return false;
  if (tags.amenity   === 'pharmacy')       return false;
  if (tags.amenity   === 'bus_station')    return false;
  if (tags.amenity   === 'toilets')        return false;
  if (tags.shop)                           return false;
  if (tags.office)                         return false;
  if (tags.place     === 'suburb')         return false;
  if (tags.place     === 'neighbourhood') return false;
  if (tags.place     === 'locality')       return false;
  if (tags.place     === 'isolated_dwelling') return false;
  if (tags.highway)                        return false;
  if (tags.power)                          return false;
  if (tags.railway && tags.railway !== 'station') return false;
  if (tags.landuse)                        return false;
  if (tags.building && !tags.historic && !tags.tourism && !tags.amenity) return false;

  return categorize(tags) !== null;
}

// ─── State lookup helper ──────────────────────────────────────────────────────
// Maps OSM state name variants to our canonical state names
const STATE_NAME_MAP = {
  'andhra pradesh': 'Andhra Pradesh',
  'arunachal pradesh': 'Arunachal Pradesh',
  'assam': 'Assam',
  'bihar': 'Bihar',
  'chhattisgarh': 'Chhattisgarh',
  'goa': 'Goa',
  'gujarat': 'Gujarat',
  'haryana': 'Haryana',
  'himachal pradesh': 'Himachal Pradesh',
  'jharkhand': 'Jharkhand',
  'karnataka': 'Karnataka',
  'kerala': 'Kerala',
  'madhya pradesh': 'Madhya Pradesh',
  'maharashtra': 'Maharashtra',
  'manipur': 'Manipur',
  'meghalaya': 'Meghalaya',
  'mizoram': 'Mizoram',
  'nagaland': 'Nagaland',
  'odisha': 'Odisha', 'orissa': 'Odisha',
  'punjab': 'Punjab',
  'rajasthan': 'Rajasthan',
  'sikkim': 'Sikkim',
  'tamil nadu': 'Tamil Nadu',
  'telangana': 'Telangana',
  'tripura': 'Tripura',
  'uttar pradesh': 'Uttar Pradesh',
  'uttarakhand': 'Uttarakhand', 'uttaranchal': 'Uttarakhand',
  'west bengal': 'West Bengal',
  'andaman and nicobar islands': 'Andaman and Nicobar Islands',
  'andaman and nicobar': 'Andaman and Nicobar Islands',
  'chandigarh': 'Chandigarh',
  'dadra and nagar haveli and daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'delhi': 'Delhi', 'nct of delhi': 'Delhi', 'new delhi': 'Delhi',
  'jammu and kashmir': 'Jammu and Kashmir', 'jammu & kashmir': 'Jammu and Kashmir',
  'ladakh': 'Ladakh',
  'lakshadweep': 'Lakshadweep',
  'puducherry': 'Puducherry', 'pondicherry': 'Puducherry',
};

function normalizeStateName(rawName) {
  if (!rawName) return null;
  const key = rawName.toLowerCase().trim();
  return STATE_NAME_MAP[key] || null;
}

// ─── Hierarchy cache ──────────────────────────────────────────────────────────
// Loaded from DB after hierarchy seed, used for fast lookups during place import
let stateIdMap    = {};  // state_name → { id, country_id }
let districtIdMap = {};  // `${state_name}::${district_name}` → id
let cityIdMap     = {};  // `${district_name}::${city_name}` → id
let cityIndex     = [];  // [{ id, name, lat, lon, districtId }] for spatial matching

async function loadHierarchyCache() {
  console.log('\n📂 Loading hierarchy from database...');

  // Load states
  const states = await supabaseGet('states', 'select=id,name,country_id');
  if (Array.isArray(states)) {
    for (const s of states) {
      stateIdMap[s.name] = { id: s.id, country_id: s.country_id };
    }
    console.log(`   ✅ ${Object.keys(stateIdMap).length} states loaded`);
  }

  // Load districts
  const districts = await supabaseGet('districts', 'select=id,name,state_id&limit=5000');
  if (Array.isArray(districts)) {
    // Build reverse state lookup
    const stateById = {};
    for (const [name, data] of Object.entries(stateIdMap)) {
      stateById[data.id] = name;
    }
    for (const d of districts) {
      const stateName = stateById[d.state_id];
      if (stateName) {
        districtIdMap[`${stateName}::${d.name}`] = d.id;
      }
    }
    console.log(`   ✅ ${Object.keys(districtIdMap).length} districts loaded`);
  }

  // Load cities
  const cities = await supabaseGet('cities', 'select=id,name,district_id,latitude,longitude&limit=50000');
  if (Array.isArray(cities)) {
    // Build reverse district lookup
    const districtById = {};
    for (const [key, id] of Object.entries(districtIdMap)) {
      districtById[id] = key.split('::')[1]; // district_name
    }
    for (const c of cities) {
      const dName = districtById[c.district_id];
      if (dName) {
        cityIdMap[`${dName}::${c.name}`] = c.id;
      }
      if (c.latitude && c.longitude) {
        cityIndex.push({ id: c.id, name: c.name, lat: c.latitude, lon: c.longitude, districtId: c.district_id });
      }
    }
    console.log(`   ✅ ${Object.keys(cityIdMap).length} cities loaded`);
    console.log(`   ✅ ${cityIndex.length} cities with coordinates for spatial matching`);
  }
}

// ─── Spatial matching ─────────────────────────────────────────────────────────
// Haversine distance in km
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestCity(lat, lon, maxDistKm = 50) {
  let best = null;
  let bestDist = maxDistKm;

  for (const city of cityIndex) {
    const d = haversine(lat, lon, city.lat, city.lon);
    if (d < bestDist) {
      bestDist = d;
      best = city;
    }
  }
  return best;
}

// ─── District and City upsert helpers ─────────────────────────────────────────
const pendingDistricts = new Map(); // key → Promise<id>
const pendingCities    = new Map(); // key → Promise<id>

async function ensureDistrict(districtName, stateName) {
  if (!districtName || !stateName) return null;
  const stateData = stateIdMap[stateName];
  if (!stateData) return null;

  const key = `${stateName}::${districtName}`;
  if (districtIdMap[key]) return districtIdMap[key];
  if (pendingDistricts.has(key)) return pendingDistricts.get(key);

  const promise = (async () => {
    try {
      const result = await supabaseInsertNamed('districts', [{
        name:     districtName,
        state_id: stateData.id,
      }], 'name,state_id');
      if (Array.isArray(result) && result[0]) {
        districtIdMap[key] = result[0].id;
        return result[0].id;
      }
      // If conflict, fetch existing
      const existing = await supabaseGet('districts',
        `name=eq.${encodeURIComponent(districtName)}&state_id=eq.${stateData.id}&select=id&limit=1`);
      if (Array.isArray(existing) && existing[0]) {
        districtIdMap[key] = existing[0].id;
        return existing[0].id;
      }
    } catch (e) {
      // Probably conflict, try to fetch
      try {
        const existing = await supabaseGet('districts',
          `name=eq.${encodeURIComponent(districtName)}&state_id=eq.${stateData.id}&select=id&limit=1`);
        if (Array.isArray(existing) && existing[0]) {
          districtIdMap[key] = existing[0].id;
          return existing[0].id;
        }
      } catch {}
    }
    return null;
  })();

  pendingDistricts.set(key, promise);
  return promise;
}

async function ensureCity(cityName, districtId, lat, lon, placeType) {
  if (!cityName || !districtId) return null;

  // Check cache by districtId + name
  for (const [key, id] of Object.entries(cityIdMap)) {
    if (key.endsWith(`::${cityName}`)) {
      return id;
    }
  }

  const cacheKey = `${districtId}::${cityName}`;
  if (cityIdMap[cacheKey]) return cityIdMap[cacheKey];
  if (pendingCities.has(cacheKey)) return pendingCities.get(cacheKey);

  const promise = (async () => {
    try {
      const result = await supabaseInsertNamed('cities', [{
        name:        cityName,
        district_id: districtId,
        latitude:    lat || null,
        longitude:   lon || null,
        place_type:  placeType || null,
      }], 'name,district_id');
      if (Array.isArray(result) && result[0]) {
        cityIdMap[cacheKey] = result[0].id;
        if (lat && lon) {
          cityIndex.push({ id: result[0].id, name: cityName, lat, lon, districtId });
        }
        return result[0].id;
      }
      const existing = await supabaseGet('cities',
        `name=eq.${encodeURIComponent(cityName)}&district_id=eq.${districtId}&select=id&limit=1`);
      if (Array.isArray(existing) && existing[0]) {
        cityIdMap[cacheKey] = existing[0].id;
        return existing[0].id;
      }
    } catch (e) {
      try {
        const existing = await supabaseGet('cities',
          `name=eq.${encodeURIComponent(cityName)}&district_id=eq.${districtId}&select=id&limit=1`);
        if (Array.isArray(existing) && existing[0]) {
          cityIdMap[cacheKey] = existing[0].id;
          return existing[0].id;
        }
      } catch {}
    }
    return null;
  })();

  pendingCities.set(cacheKey, promise);
  return promise;
}

// ─── Place record builder ─────────────────────────────────────────────────────
const PLACE_KEYS = [
  'name', 'description', 'city_id', 'category', 'place_type',
  'latitude', 'longitude', 'image_url', 'wiki_url',
  'osm_id', 'source', 'metadata',
];

function normalizePlaceRecord(raw) {
  const out = {};
  for (const key of PLACE_KEYS) {
    let v = raw[key];
    if (v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) {
      v = null;
    }
    out[key] = (v !== undefined ? v : null);
  }
  return out;
}

function validateBatch(records, batchIdx) {
  const expected = JSON.stringify([...PLACE_KEYS].sort());
  let ok = true;
  for (let i = 0; i < records.length; i++) {
    const actual = JSON.stringify(Object.keys(records[i]).sort());
    if (actual !== expected) {
      if (ok) {
        console.error(`\n  ❌ Batch ${batchIdx} key mismatch (record ${i}):`);
        console.error(`     Expected: ${expected}`);
        console.error(`     Got:      ${actual}`);
      }
      ok = false;
    }
    for (const [k, v] of Object.entries(records[i])) {
      if (v === undefined) {
        console.error(`\n  ❌ Batch ${batchIdx} record[${i}].${k} is undefined`);
        ok = false;
      }
    }
  }
  return ok;
}

async function buildPlaceRecord(item, tags) {
  const name     = getName(tags);
  const category = categorize(tags);
  if (!name || !category) return null;
  if (ONLY_CAT && category !== ONLY_CAT) return null;

  // Skip settlements from place import — they go into cities table
  if (category === 'Cities' || category === 'Villages') return null;

  const lat = item.lat;
  const lon = item.lon;
  if (lat == null || lon == null) return null;

  // Resolve city_id
  let cityId = null;

  // Try OSM address tags first
  const rawState    = str(tags['addr:state'] || tags['is_in:state'] || tags['is_in:state_code']);
  const rawDistrict = str(tags['addr:district'] || tags['addr:county']);
  const rawCity     = str(tags['addr:city'] || tags['addr:town'] || tags['addr:village']);

  const stateName = normalizeStateName(rawState);

  if (stateName && rawDistrict && rawCity) {
    const districtId = await ensureDistrict(rawDistrict, stateName);
    if (districtId) {
      cityId = await ensureCity(rawCity, districtId, null, null, null);
    }
  }

  // Fallback: spatial lookup
  if (!cityId) {
    const nearest = findNearestCity(lat, lon, 50);
    if (nearest) {
      cityId = nearest.id;
    }
  }

  // Compact metadata
  const metaTags = {};
  let count = 0;
  for (const [k, v] of Object.entries(tags)) {
    if (count >= 12) break;
    if (/^name:[a-z]{2,4}$/.test(k) && k !== 'name:en') continue;
    metaTags[k] = v;
    count++;
  }

  const raw = {
    name:        name.slice(0, 500),
    description: getDescription(tags),
    city_id:     cityId,
    category,
    place_type:  getPlaceType(tags),
    latitude:    lat,
    longitude:   lon,
    image_url:   getImageFromTags(tags),
    wiki_url:    getWikiUrl(tags),
    osm_id:      item.id,
    source:      'OpenStreetMap',
    metadata:    { tags: metaTags },
  };

  return normalizePlaceRecord(raw);
}

// ─── Settlement collection (for hierarchy building) ───────────────────────────
const settlements = []; // { name, lat, lon, type, tags }

function collectSettlement(item) {
  const tags = item.tags || {};
  const name = getName(tags);
  if (!name) return;

  const type = tags.place;
  if (!['city', 'town', 'village'].includes(type)) return;
  if (item.lat == null || item.lon == null) return;

  settlements.push({
    name,
    lat:  item.lat,
    lon:  item.lon,
    type,
    state:    str(tags['addr:state'] || tags['is_in:state'] || tags['is_in:state_code']),
    district: str(tags['addr:district'] || tags['addr:county'] || tags['is_in:district']),
    population: tags.population ? parseInt(tags.population, 10) : null,
    osm_id: item.id,
  });
}

// ─── Phase 1: Import settlements into hierarchy ───────────────────────────────
async function importHierarchy() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 Phase 1: Building Geographic Hierarchy');
  console.log('═══════════════════════════════════════════════════\n');

  console.log('⏳ Pass 1: Scanning OSM for settlements...\n');

  const parse   = require('osm-pbf-parser');
  const through = require('through2');

  let nodesScanned = 0;

  await new Promise((resolve, reject) => {
    fs.createReadStream(PBF_FILE)
      .pipe(parse())
      .pipe(
        through.obj(function (items, _enc, next) {
          for (const item of items) {
            if (item.type !== 'node') continue;
            nodesScanned++;
            if (nodesScanned % 500000 === 0) {
              process.stdout.write(`\r  🔍 Scanned ${(nodesScanned / 1e6).toFixed(1)}M nodes, found ${settlements.length} settlements`);
            }
            if (item.lat == null || item.lon == null) continue;
            collectSettlement(item);
          }
          next();
        })
      )
      .on('finish', resolve)
      .on('error', reject);
  });

  console.log(`\n\n  ✅ Found ${settlements.length} settlements (${nodesScanned.toLocaleString()} nodes scanned)`);

  // Group by state
  const byState = {};
  let unmatched = 0;
  for (const s of settlements) {
    const stateName = normalizeStateName(s.state);
    if (!stateName) {
      unmatched++;
      continue;
    }
    if (!byState[stateName]) byState[stateName] = [];
    byState[stateName].push(s);
  }

  console.log(`  📍 Matched to states: ${settlements.length - unmatched} | Unmatched: ${unmatched}`);
  console.log(`\n⏳ Pass 2: Inserting districts and cities...\n`);

  if (DRY_RUN) {
    console.log('  🏃 DRY RUN — skipping DB writes');
    for (const [state, setts] of Object.entries(byState)) {
      const districts = [...new Set(setts.map(s => s.district).filter(Boolean))];
      console.log(`  ${state}: ${districts.length} districts, ${setts.length} settlements`);
    }
    return;
  }

  let totalDistricts = 0;
  let totalCities = 0;

  for (const [stateName, setts] of Object.entries(byState)) {
    const stateData = stateIdMap[stateName];
    if (!stateData) {
      console.log(`  ⚠️  State not in DB: ${stateName}`);
      continue;
    }

    // Group settlements by district
    const byDistrict = {};
    const noDistrict = [];
    for (const s of setts) {
      if (s.district) {
        if (!byDistrict[s.district]) byDistrict[s.district] = [];
        byDistrict[s.district].push(s);
      } else {
        noDistrict.push(s);
      }
    }

    // Insert districts
    for (const [districtName, dSetts] of Object.entries(byDistrict)) {
      const districtId = await ensureDistrict(districtName, stateName);
      if (!districtId) continue;
      totalDistricts++;

      // Insert cities in this district
      for (const s of dSetts) {
        const cityId = await ensureCity(s.name, districtId, s.lat, s.lon, s.type);
        if (cityId) totalCities++;
      }

      // Throttle
      await new Promise(r => setTimeout(r, 50));
    }

    // For settlements without district, create an "Unknown" district
    if (noDistrict.length > 0) {
      const districtId = await ensureDistrict('Other', stateName);
      if (districtId) {
        totalDistricts++;
        for (const s of noDistrict) {
          const cityId = await ensureCity(s.name, districtId, s.lat, s.lon, s.type);
          if (cityId) totalCities++;
        }
      }
    }

    process.stdout.write(`\r  ✅ ${stateName.padEnd(30)} — ${Object.keys(byDistrict).length} districts, ${setts.length} settlements`);
  }

  console.log(`\n\n  ✅ Hierarchy complete: ${totalDistricts} districts, ${totalCities} cities`);

  // Reload cache with newly inserted data
  await loadHierarchyCache();
}

// ─── Phase 2: Import places ──────────────────────────────────────────────────
async function importPlaces() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 Phase 2: Importing Places');
  console.log('═══════════════════════════════════════════════════\n');

  const parse   = require('osm-pbf-parser');
  const through = require('through2');

  let totalNodes    = 0;
  let totalRelevant = 0;
  let totalInserted = 0;
  let totalFailed   = 0;
  let batchIndex    = 0;
  let limitReached  = false;
  let firstBatch    = true;
  const categoryCounts = {};
  const batch          = [];
  const startTime      = Date.now();
  const seenOsmIds     = new Set();

  function printProgress() {
    const elapsed = Math.max(1, (Date.now() - startTime) / 1000).toFixed(0);
    const rate    = Math.round(totalNodes / elapsed);
    process.stdout.write(
      `\r  ✅ ${String(totalInserted).padStart(8)} inserted` +
      `  │  🔍 ${String(totalNodes).padStart(11)} scanned` +
      `  │  ⚡ ${String(rate).padStart(7)}/s` +
      `  │  ⏱  ${elapsed}s      `
    );
  }

  async function flushBatch() {
    if (batch.length === 0) return;
    const records = batch.splice(0, batch.length);
    batchIndex++;

    if (firstBatch) {
      firstBatch = false;
      console.log(`\n  📦 First batch: ${records.length} records`);
      console.log(`  📋 Keys:        ${JSON.stringify(Object.keys(records[0]))}`);
      const valid = validateBatch(records, batchIndex);
      if (!valid) {
        console.error('\n  ❌ Key validation failed — aborting.');
        process.exit(1);
      }
      console.log(`  ✅ Key validation passed\n`);
    }

    if (DRY_RUN) {
      totalInserted += records.length;
    } else {
      const ok = await withRetry(
        () => supabaseInsert('places', records),
        `Batch ${batchIndex}`
      );
      if (ok !== null) totalInserted += records.length;
      else             totalFailed   += records.length;
      await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
    }

    for (const r of records) {
      categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
    }
  }

  console.log('⏳ Streaming places from OSM...\n');

  await new Promise((resolve, reject) => {
    fs.createReadStream(PBF_FILE)
      .pipe(parse())
      .pipe(
        through.obj(async function (items, _enc, next) {
          for (const item of items) {
            if (item.type !== 'node') continue;
            if (item.lat == null || item.lon == null) continue;

            totalNodes++;
            if (limitReached) continue;

            const tags = item.tags || {};
            if (!isRelevant(tags)) continue;
            if (seenOsmIds.has(item.id)) continue;
            seenOsmIds.add(item.id);

            const record = await buildPlaceRecord(item, tags);
            if (!record) continue;

            totalRelevant++;
            batch.push(record);

            if (batch.length >= BATCH_SIZE) {
              await flushBatch();
            }

            if (totalInserted >= LIMIT && !limitReached) {
              limitReached = true;
              await flushBatch();
              break;
            }

            if (totalNodes % 100000 === 0) printProgress();
          }
          next();
        })
      )
      .on('finish', async () => {
        await flushBatch();
        resolve();
      })
      .on('error', reject);
  });

  printProgress();

  // Print summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n\n═══════════════════════════════════════════════════');
  console.log(DRY_RUN ? '✅ Dry Run Complete!' : '✅ Import Complete!');
  console.log(`   Nodes scanned:   ${totalNodes.toLocaleString()}`);
  console.log(`   Relevant places: ${totalRelevant.toLocaleString()}`);
  console.log(`   Inserted:        ${totalInserted.toLocaleString()}`);
  if (totalFailed > 0) console.log(`   ⚠️  Failed:       ${totalFailed.toLocaleString()}`);
  console.log(`   Time:            ${elapsed}s`);
  if (Object.keys(categoryCounts).length > 0) {
    console.log('\n   By Category:');
    Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .forEach(([cat, cnt]) => console.log(`     ${cat.padEnd(20)} ${cnt.toLocaleString()}`));
  }
  console.log('═══════════════════════════════════════════════════\n');

  if (!DRY_RUN && totalInserted > 0) {
    console.log('🎉 Next steps:');
    console.log('   1. Open http://localhost:5173 and search for Chennai, Ooty, etc.');
    console.log('   2. After verifying, drop the temp policies in SQL Editor.');
  }
}

// ─── Image enrichment ─────────────────────────────────────────────────────────
async function enrichImages() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🖼️  Image Enrichment — Fetching Wikipedia thumbnails');
  console.log('═══════════════════════════════════════════════════\n');

  // Fetch places without images
  const places = await supabaseGet('places',
    'select=id,name,wiki_url&image_url=is.null&limit=2000&order=name.asc');

  if (!Array.isArray(places) || places.length === 0) {
    console.log('  ✅ All places already have images (or no places found)');
    return;
  }

  console.log(`  📦 ${places.length} places need images\n`);

  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < places.length; i++) {
    const place = places[i];

    try {
      const res = await new Promise((resolve, reject) => {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(place.name.replace(/ /g, '_'))}`;
        https.get(url, { timeout: 5000 }, (res) => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => {
            if (res.statusCode === 200) {
              try { resolve(JSON.parse(body)); } catch { resolve(null); }
            } else { resolve(null); }
          });
        }).on('error', () => resolve(null));
      });

      if (res?.thumbnail?.source) {
        const imgUrl = res.thumbnail.source.replace(/\/\d+px-/, '/400px-');

        if (!DRY_RUN) {
          await httpRequest(
            `${SUPABASE_URL}/rest/v1/places?id=eq.${place.id}`,
            'PATCH',
            { image_url: imgUrl },
            { ...supaHeaders, 'Prefer': 'return=minimal' }
          );
        }
        enriched++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    if ((i + 1) % 50 === 0) {
      process.stdout.write(`\r  🖼️  ${enriched} enriched, ${failed} no image, ${i + 1}/${places.length} processed`);
    }

    // Rate limit: 100ms between requests
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\n  ✅ Enriched ${enriched} places with Wikipedia images`);
  console.log(`  ⚠️  ${failed} places had no Wikipedia image available`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🗺️  ExploreHub — OSM Import v5 (Hierarchical)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📂 File:     ${path.basename(PBF_FILE)} (${(fs.statSync(PBF_FILE).size / 1e9).toFixed(2)} GB)`);
  console.log(`🔑 Auth:     ${useServiceKey ? '✅ Service Role' : '🔑 Anon Key (migration 005 grants INSERT)'}`);
  console.log(`🗄️  Database: ${SUPABASE_URL}`);
  if (DRY_RUN)          console.log('🏃 Mode:     DRY RUN');
  if (LIMIT < Infinity) console.log(`🔢 Limit:    ${LIMIT} places`);
  if (ONLY_CAT)         console.log(`🏷️  Category: ${ONLY_CAT}`);
  if (PASS_ONLY)        console.log(`📊 Pass:     ${PASS_ONLY} only`);
  if (ENRICH_IMG)       console.log('🖼️  Mode:     Image enrichment');

  // Load existing hierarchy
  await loadHierarchyCache();

  if (ENRICH_IMG) {
    await enrichImages();
    return;
  }

  if (!PASS_ONLY || PASS_ONLY === 'hierarchy') {
    await importHierarchy();
  }

  if (!PASS_ONLY || PASS_ONLY === 'places') {
    await importPlaces();
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
