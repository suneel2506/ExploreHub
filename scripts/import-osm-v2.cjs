#!/usr/bin/env node
// =============================================================================
// ExploreHub — OSM Import Script v6 (Spatial Hierarchy)
// =============================================================================
// 
// CRITICAL FIX: Uses admin boundaries + spatial matching instead of addr:* tags.
// 
// ARCHITECTURE:
//   Pass 1 → Collect settlements, places, way refs, admin boundaries
//   Pass 2 → Resolve node coords for ways + admin centres
//   Phase 3 → Build hierarchy via spatial matching
//   Phase 4 → Verify hierarchy (STOP if counts wrong)
//   Phase 5 → Import places with spatial city matching
//   Phase 6 → Final verification
//
// USAGE:
//   node scripts/import-osm-v2.cjs                     Full import
//   node scripts/import-osm-v2.cjs --dry-run            Parse only, no DB writes
//   node scripts/import-osm-v2.cjs --limit 5000         Stop after N place inserts
//   node scripts/import-osm-v2.cjs --pass hierarchy     Only build hierarchy
//   node scripts/import-osm-v2.cjs --pass places        Only import places (hierarchy must exist)
//   node scripts/import-osm-v2.cjs --enrich-images      Fetch Wikipedia images after import
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

// ─── CLI flags ────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const LIMIT      = (() => { const i = args.indexOf('--limit');    return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })();
const PASS_ONLY  = (() => { const i = args.indexOf('--pass');     return i >= 0 ? args[i + 1] : null; })();
const ENRICH_IMG = args.includes('--enrich-images');
const BATCH_SIZE = 80;
const DELAY_MS   = 500;

// ─── API key ──────────────────────────────────────────────────────────────────
const useServiceKey = SERVICE_KEY && SERVICE_KEY !== 'your-service-role-key-here';
const API_KEY       = useServiceKey ? SERVICE_KEY : ANON_KEY;

if (!SUPABASE_URL || !API_KEY) {
  console.error('\n❌ SUPABASE_URL or API key missing in .env\n');
  process.exit(1);
}

// ─── HTTPS helpers ────────────────────────────────────────────────────────────
const httpsAgent = new https.Agent({ keepAlive: false, maxSockets: 2, timeout: 30000 });

function httpRequest(urlStr, method, payload, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : '';
    const url  = new URL(urlStr);
    const opts = {
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method,
      agent: httpsAgent, timeout: 30000,
      headers: { ...extraHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Connection': 'close' },
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
        else { try { resolve(JSON.parse(body)); } catch { resolve(body); } }
      });
    });
    req.on('timeout', () => req.destroy(new Error('SOCKET_TIMEOUT')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const supaHeaders = { 'apikey': API_KEY, 'Authorization': `Bearer ${API_KEY}` };

async function supaInsert(table, records, conflictCols) {
  const onConflict = conflictCols ? `?on_conflict=${conflictCols}` : '';
  return httpRequest(
    `${SUPABASE_URL}/rest/v1/${table}${onConflict}`, 'POST', records,
    { ...supaHeaders, 'Prefer': 'resolution=ignore-duplicates,return=representation' }
  );
}

async function supaInsertMinimal(table, records, conflictCols) {
  const onConflict = conflictCols ? `?on_conflict=${conflictCols}` : '';
  return httpRequest(
    `${SUPABASE_URL}/rest/v1/${table}${onConflict}`, 'POST', records,
    { ...supaHeaders, 'Prefer': 'resolution=ignore-duplicates,return=minimal' }
  );
}

async function supaGet(table, query) {
  return httpRequest(`${SUPABASE_URL}/rest/v1/${table}?${query}`, 'GET', null, supaHeaders);
}

async function withRetry(fn, label, max = 5) {
  for (let a = 1; a <= max; a++) {
    try { return await fn(); }
    catch (err) {
      if (err.message?.startsWith('HTTP 4')) { process.stderr.write(`\n  ❌ ${label}: ${err.message.slice(0,300)}\n`); return null; }
      if (a < max) { const w = Math.min(1000 * 2 ** (a - 1), 16000); process.stderr.write(`\n  ⚠️ ${label} attempt ${a}/${max}, retry in ${w/1000}s\n`); await sleep(w); }
      else { process.stderr.write(`\n  ❌ ${label} failed after ${max} attempts\n`); return null; }
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── OSM file ─────────────────────────────────────────────────────────────────
const PBF_FILE = ['india-260623.osm.pbf', 'india-latest.osm.pbf']
  .map(f => path.join(__dirname, '..', f)).find(fs.existsSync);
if (!PBF_FILE) { console.error('\n❌ OSM PBF file not found\n'); process.exit(1); }

// ─── Tag Helpers ──────────────────────────────────────────────────────────────
function str(v) { if (v == null) return null; const s = String(v).trim(); return s || null; }

function getName(tags) {
  return str(tags['name:en'] || tags.name || tags['name:hi'] || tags['name:ta'] || tags['name:te'] || tags['name:ml'] || tags['name:kn']);
}

function getDescription(tags) { const d = str(tags.description || tags.note); return d ? d.slice(0, 2000) : null; }
function getPlaceType(tags) { return str(tags.natural || tags.tourism || tags.historic || tags.leisure || tags.amenity || tags.place); }

function getWikiUrl(tags) {
  if (tags.wikipedia) {
    const parts = tags.wikipedia.split(':');
    if (parts.length >= 2) return `https://${parts[0]}.wikipedia.org/wiki/${encodeURIComponent(parts.slice(1).join(':').replace(/ /g, '_'))}`;
  }
  return null;
}

function getImageFromTags(tags) {
  if (tags.image && tags.image.startsWith('http')) return tags.image;
  if (tags.wikimedia_commons) {
    const file = tags.wikimedia_commons.replace(/^(File|Category):/, '');
    if (file) return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=400`;
  }
  return null;
}

// ─── Categories ───────────────────────────────────────────────────────────────
function categorize(tags) {
  if (tags.natural === 'waterfall')                                             return 'Waterfalls';
  if (tags.natural === 'beach' || tags.natural === 'bay' || tags.natural === 'cape') return 'Beaches';
  if (tags.natural === 'peak' || tags.natural === 'volcano' || tags.natural === 'ridge') return 'Mountains';
  if (tags.natural === 'lake' || tags.natural === 'water' || tags.natural === 'reservoir') return 'Lakes';
  if (tags.natural === 'forest')                                                return 'Forests';
  if (tags.natural === 'cave_entrance')                                         return 'Caves';
  if (tags.natural === 'hot_spring' || tags.natural === 'cliff')               return 'Attractions';
  if (tags.natural === 'island')                                                return 'Islands';
  if (tags.tourism === 'attraction' || tags.tourism === 'theme_park' || tags.tourism === 'artwork') return 'Attractions';
  if (tags.tourism === 'museum' || tags.tourism === 'gallery')                 return 'Museums';
  if (tags.tourism === 'viewpoint')                                             return 'Viewpoints';
  if (tags.tourism === 'zoo' || tags.tourism === 'aquarium')                   return 'Wildlife';
  if (tags.tourism === 'picnic_site')                                           return 'Parks';
  if (tags.leisure === 'nature_reserve')                                        return 'National Parks';
  if (tags.leisure === 'park' || tags.leisure === 'garden')                    return 'Parks';
  if (tags.leisure === 'water_park' || tags.leisure === 'stadium')             return 'Attractions';
  if (tags.leisure === 'bird_hide')                                             return 'Wildlife';
  if (tags.historic === 'castle' || tags.historic === 'fort')                  return 'Forts';
  if (tags.historic === 'monument' || tags.historic === 'ruins' || tags.historic === 'palace') return 'Historical';
  if (tags.historic === 'archaeological_site' || tags.historic === 'memorial') return 'Historical';
  if (tags.historic === 'temple')                                               return 'Temples';
  if (tags.historic === 'mosque')                                               return 'Mosques';
  if (tags.historic === 'church')                                               return 'Churches';
  if (tags.historic === 'lighthouse' || tags.historic === 'battleground')      return 'Historical';
  if (tags.historic === 'yes' || tags.historic === 'building')                 return 'Historical';
  if (tags.amenity === 'place_of_worship') {
    if (tags.religion === 'hindu' || tags.religion === 'jain')                 return 'Temples';
    if (tags.religion === 'buddhist')                                           return 'Monasteries';
    if (tags.religion === 'muslim')                                             return 'Mosques';
    if (tags.religion === 'christian')                                          return 'Churches';
    if (tags.religion === 'sikh')                                               return 'Gurudwaras';
    return 'Temples';
  }
  if (tags.waterway === 'dam')                                                  return 'Dams';
  if (tags.waterway === 'waterfall')                                            return 'Waterfalls';
  if (tags.boundary === 'national_park')                                        return 'National Parks';
  if (tags.boundary === 'protected_area')                                       return 'Wildlife';
  if (tags.man_made === 'bridge' && getName(tags))                             return 'Bridges';
  if (tags.man_made === 'lighthouse')                                           return 'Attractions';
  if (tags.aeroway === 'aerodrome' && getName(tags))                           return 'Airports';
  if (tags.railway === 'station' && getName(tags))                             return 'Railway Stations';
  return null;
}

function isRelevantPlace(tags) {
  const name = getName(tags);
  if (!name || name.length <= 2) return false;
  if (tags.tourism === 'information' || tags.tourism === 'hotel' || tags.tourism === 'guest_house') return false;
  if (tags.tourism === 'motel' || tags.tourism === 'hostel' || tags.tourism === 'camp_site') return false;
  if (tags.natural === 'tree' || tags.natural === 'scrub' || tags.natural === 'grassland') return false;
  if (tags.amenity === 'parking' || tags.amenity === 'bench' || tags.amenity === 'fuel') return false;
  if (tags.amenity === 'atm' || tags.amenity === 'bank' || tags.amenity === 'restaurant') return false;
  if (tags.amenity === 'cafe' || tags.amenity === 'hospital' || tags.amenity === 'school') return false;
  if (tags.amenity === 'pharmacy' || tags.amenity === 'bus_station' || tags.amenity === 'toilets') return false;
  if (tags.shop || tags.office) return false;
  if (tags.place === 'suburb' || tags.place === 'neighbourhood' || tags.place === 'locality') return false;
  if (tags.highway || tags.power || tags.landuse) return false;
  if (tags.railway && tags.railway !== 'station') return false;
  if (tags.building && !tags.historic && !tags.tourism && !tags.amenity) return false;
  return categorize(tags) !== null;
}

// ─── India State Centroids (for spatial matching) ─────────────────────────────
// Approximate geographic centres of all 36 states/UTs
const STATE_CENTROIDS = [
  { name: 'Andhra Pradesh',    lat: 15.9129, lon: 79.7400 },
  { name: 'Arunachal Pradesh', lat: 28.2180, lon: 94.7278 },
  { name: 'Assam',             lat: 26.2006, lon: 92.9376 },
  { name: 'Bihar',             lat: 25.0961, lon: 85.3131 },
  { name: 'Chhattisgarh',      lat: 21.2787, lon: 81.8661 },
  { name: 'Goa',               lat: 15.2993, lon: 74.1240 },
  { name: 'Gujarat',           lat: 22.2587, lon: 71.1924 },
  { name: 'Haryana',           lat: 29.0588, lon: 76.0856 },
  { name: 'Himachal Pradesh',  lat: 31.1048, lon: 77.1734 },
  { name: 'Jharkhand',         lat: 23.6102, lon: 85.2799 },
  { name: 'Karnataka',         lat: 15.3173, lon: 75.7139 },
  { name: 'Kerala',            lat: 10.8505, lon: 76.2711 },
  { name: 'Madhya Pradesh',    lat: 22.9734, lon: 78.6569 },
  { name: 'Maharashtra',       lat: 19.7515, lon: 75.7139 },
  { name: 'Manipur',           lat: 24.6637, lon: 93.9063 },
  { name: 'Meghalaya',         lat: 25.4670, lon: 91.3662 },
  { name: 'Mizoram',           lat: 23.1645, lon: 92.9376 },
  { name: 'Nagaland',          lat: 26.1584, lon: 94.5624 },
  { name: 'Odisha',            lat: 20.9517, lon: 85.0985 },
  { name: 'Punjab',            lat: 31.1471, lon: 75.3412 },
  { name: 'Rajasthan',         lat: 27.0238, lon: 74.2179 },
  { name: 'Sikkim',            lat: 27.5330, lon: 88.5122 },
  { name: 'Tamil Nadu',        lat: 11.1271, lon: 78.6569 },
  { name: 'Telangana',         lat: 18.1124, lon: 79.0193 },
  { name: 'Tripura',           lat: 23.9408, lon: 91.9882 },
  { name: 'Uttar Pradesh',     lat: 26.8467, lon: 80.9462 },
  { name: 'Uttarakhand',       lat: 30.0668, lon: 79.0193 },
  { name: 'West Bengal',       lat: 22.9868, lon: 87.8550 },
  // Union Territories
  { name: 'Andaman and Nicobar Islands', lat: 11.7401, lon: 92.6586 },
  { name: 'Chandigarh',        lat: 30.7333, lon: 76.7794 },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', lat: 20.1809, lon: 73.0169 },
  { name: 'Delhi',             lat: 28.7041, lon: 77.1025 },
  { name: 'Jammu and Kashmir', lat: 33.7782, lon: 76.5762 },
  { name: 'Ladakh',            lat: 34.1526, lon: 77.5771 },
  { name: 'Lakshadweep',       lat: 10.5667, lon: 72.6417 },
  { name: 'Puducherry',        lat: 11.9416, lon: 79.8083 },
];

// State name normalization map (OSM variants → canonical)
const STATE_ALIASES = {
  'orissa': 'Odisha',
  'uttaranchal': 'Uttarakhand',
  'pondicherry': 'Puducherry',
  'nct of delhi': 'Delhi',
  'new delhi': 'Delhi',
  'jammu & kashmir': 'Jammu and Kashmir',
  'andaman and nicobar': 'Andaman and Nicobar Islands',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
};

function normalizeStateName(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  // Direct match
  const direct = STATE_CENTROIDS.find(s => s.name.toLowerCase() === key);
  if (direct) return direct.name;
  // Alias
  if (STATE_ALIASES[key]) return STATE_ALIASES[key];
  // Fuzzy: check if key contains state name
  const partial = STATE_CENTROIDS.find(s => key.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(key));
  return partial ? partial.name : null;
}

// ─── Spatial helpers ──────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestState(lat, lon) {
  let best = null, bestDist = Infinity;
  for (const s of STATE_CENTROIDS) {
    const d = haversine(lat, lon, s.lat, s.lon);
    if (d < bestDist) { bestDist = d; best = s.name; }
  }
  return best;
}

// ─── Resolve state for a settlement ───────────────────────────────────────────
function resolveState(tags, lat, lon) {
  // Priority 1: is_in:state tag
  const isInState = str(tags['is_in:state'] || tags['is_in:state_code'] || tags['addr:state']);
  if (isInState) {
    const n = normalizeStateName(isInState);
    if (n) return n;
  }
  // Priority 2: Parse is_in tag (format: "City, District, State, Country" or "State, Country")
  const isIn = str(tags['is_in']);
  if (isIn) {
    const parts = isIn.split(',').map(s => s.trim());
    for (const part of parts) {
      const n = normalizeStateName(part);
      if (n) return n;
    }
  }
  // Priority 3: Spatial — nearest state centroid
  return findNearestState(lat, lon);
}

// ─── Resolve district name from tags ──────────────────────────────────────────
function resolveDistrictFromTags(tags) {
  return str(tags['addr:district'] || tags['is_in:district'] || tags['addr:county']);
}

// Parse is_in for district (second-to-last before state)
function resolveDistrictFromIsIn(tags) {
  const isIn = str(tags['is_in']);
  if (!isIn) return null;
  const parts = isIn.split(',').map(s => s.trim()).filter(Boolean);
  // Typical: "City, District, State, India" → district is parts[1] if parts.length >= 3
  if (parts.length >= 3) {
    const candidate = parts[parts.length - 3]; // e.g. in "A, B, TamilNadu, India" → B
    // Make sure it's not a state name
    if (!normalizeStateName(candidate)) return candidate;
  }
  if (parts.length >= 2) {
    const candidate = parts[0]; // fallback: first part
    if (!normalizeStateName(candidate)) return candidate;
  }
  return null;
}

// =============================================================================
// PASS 1: Collect Raw Data from PBF
// =============================================================================
// Collects: settlements, place nodes, way refs, admin boundary relations

async function pass1() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 PASS 1: Scanning PBF for settlements, places, ways, admin boundaries');
  console.log('═══════════════════════════════════════════════════\n');

  const parse   = require('osm-pbf-parser');
  const through = require('through2');

  const settlements  = [];      // { name, lat, lon, type, tags, osmId }
  const placeNodes   = [];      // { name, lat, lon, tags, osmId, category }
  const wayPlaces    = [];      // { name, tags, osmId, category, nodeRefs: number[] }
  const adminBounds  = [];      // { name, level, adminCentreNodeId, osmId }
  const neededNodeIds = new Set();

  let nodeCount = 0, wayCount = 0, relCount = 0;
  const startTime = Date.now();

  await new Promise((resolve, reject) => {
    fs.createReadStream(PBF_FILE)
      .pipe(parse())
      .pipe(through.obj(function (items, _enc, next) {
        for (const item of items) {
          // ─── NODES ──────────────────────────────────────
          if (item.type === 'node') {
            nodeCount++;
            if (nodeCount % 2000000 === 0) {
              const el = ((Date.now() - startTime) / 1000).toFixed(0);
              process.stdout.write(`\r  🔍 ${(nodeCount / 1e6).toFixed(1)}M nodes | ${settlements.length} settlements | ${placeNodes.length} places | ${el}s`);
            }
            if (item.lat == null || item.lon == null) continue;
            const tags = item.tags || {};
            const name = getName(tags);

            // Settlement?
            const placeTag = tags.place;
            if (placeTag && ['city', 'town', 'village', 'hamlet'].includes(placeTag) && name) {
              settlements.push({
                name, lat: item.lat, lon: item.lon,
                type: placeTag, tags, osmId: item.id,
              });
            }

            // Travel-relevant place?
            if (isRelevantPlace(tags)) {
              placeNodes.push({
                name, lat: item.lat, lon: item.lon,
                tags, osmId: item.id, category: categorize(tags),
              });
            }
          }

          // ─── WAYS ───────────────────────────────────────
          else if (item.type === 'way') {
            wayCount++;
            const tags = item.tags || {};
            if (isRelevantPlace(tags) && item.refs && item.refs.length > 0) {
              wayPlaces.push({
                name: getName(tags), tags, osmId: item.id,
                category: categorize(tags), nodeRefs: item.refs,
              });
              // We need coords for these nodes to compute centroids
              for (const ref of item.refs) neededNodeIds.add(ref);
            }
          }

          // ─── RELATIONS ──────────────────────────────────
          else if (item.type === 'relation') {
            relCount++;
            const tags = item.tags || {};

            // Admin boundaries
            if (tags.boundary === 'administrative' && tags.admin_level) {
              const level = parseInt(tags.admin_level, 10);
              const name  = getName(tags);
              if (name && [2, 4, 5, 6, 8].includes(level)) {
                let adminCentreId = null;
                if (item.members) {
                  // Find admin_centre or label member
                  const centre = item.members.find(m => m.role === 'admin_centre' || m.role === 'label');
                  if (centre) {
                    adminCentreId = centre.id;
                    neededNodeIds.add(centre.id);
                  }
                }
                adminBounds.push({ name, level, adminCentreNodeId: adminCentreId, osmId: item.id });
              }
            }

            // Travel-relevant relation (national parks, protected areas)
            if (isRelevantPlace(tags) && item.members) {
              // Get admin_centre or first node member for centroid
              const centre = item.members.find(m => m.role === 'admin_centre' || m.role === 'label');
              const firstNode = item.members.find(m => m.type === 'node');
              const centreId = centre?.id || firstNode?.id;
              if (centreId) {
                neededNodeIds.add(centreId);
                // Store as way-like place with single node ref
                wayPlaces.push({
                  name: getName(tags), tags, osmId: item.id,
                  category: categorize(tags), nodeRefs: [centreId],
                });
              }
            }
          }
        }
        next();
      }))
      .on('finish', resolve)
      .on('error', reject);
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n  ✅ Pass 1 complete in ${elapsed}s`);
  console.log(`     Nodes scanned:      ${nodeCount.toLocaleString()}`);
  console.log(`     Ways scanned:       ${wayCount.toLocaleString()}`);
  console.log(`     Relations scanned:  ${relCount.toLocaleString()}`);
  console.log(`     Settlements found:  ${settlements.length.toLocaleString()}`);
  console.log(`     Place nodes found:  ${placeNodes.length.toLocaleString()}`);
  console.log(`     Way/Rel places:     ${wayPlaces.length.toLocaleString()}`);
  console.log(`     Admin boundaries:   ${adminBounds.length}`);
  console.log(`     Node IDs to resolve: ${neededNodeIds.size.toLocaleString()}`);

  // Break down admin boundaries by level
  for (const level of [2, 4, 5, 6, 8]) {
    const count = adminBounds.filter(a => a.level === level).length;
    if (count > 0) console.log(`       admin_level=${level}: ${count}`);
  }

  return { settlements, placeNodes, wayPlaces, adminBounds, neededNodeIds };
}

// =============================================================================
// PASS 2: Resolve Node Coordinates
// =============================================================================

async function pass2(neededNodeIds) {
  if (neededNodeIds.size === 0) {
    console.log('\n  ℹ️  No node IDs to resolve (skipping Pass 2)');
    return new Map();
  }

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`📊 PASS 2: Resolving ${neededNodeIds.size.toLocaleString()} node coordinates`);
  console.log('═══════════════════════════════════════════════════\n');

  const parse   = require('osm-pbf-parser');
  const through = require('through2');

  const nodeCoords = new Map(); // nodeId → { lat, lon }
  let scanned = 0, resolved = 0;
  const startTime = Date.now();

  await new Promise((resolve, reject) => {
    fs.createReadStream(PBF_FILE)
      .pipe(parse())
      .pipe(through.obj(function (items, _enc, next) {
        for (const item of items) {
          // Only process nodes (stop at ways since nodes are first in PBF)
          if (item.type !== 'node') {
            // Once we see a non-node, check if we've resolved all
            if (resolved >= neededNodeIds.size) {
              this.destroy();
              resolve();
              return;
            }
            continue;
          }
          scanned++;
          if (neededNodeIds.has(item.id) && item.lat != null && item.lon != null) {
            nodeCoords.set(item.id, { lat: item.lat, lon: item.lon });
            resolved++;
          }
          if (scanned % 5000000 === 0) {
            process.stdout.write(`\r  🔍 Scanned ${(scanned/1e6).toFixed(1)}M nodes | Resolved ${resolved}/${neededNodeIds.size}`);
          }
        }
        next();
      }))
      .on('finish', resolve)
      .on('error', reject);
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  ✅ Pass 2 complete in ${elapsed}s — resolved ${resolved}/${neededNodeIds.size} nodes`);
  return nodeCoords;
}

// =============================================================================
// PHASE 3: Build Geographic Hierarchy
// =============================================================================

async function buildHierarchy(settlements, adminBounds, nodeCoords) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 PHASE 3: Building Geographic Hierarchy');
  console.log('═══════════════════════════════════════════════════\n');

  // ─── Step 1: Load states (from DB or mock for dry-run) ──────────────────────
  let stateMap = {}; // name → { id, country_id }

  if (DRY_RUN) {
    // Use hardcoded centroids as mock state data
    for (const s of STATE_CENTROIDS) {
      stateMap[s.name] = { id: `mock-${s.name}`, country_id: 'mock-india' };
    }
    console.log(`  ✅ ${Object.keys(stateMap).length} states (mock for dry-run)`);
  } else {
    const dbStates = await supaGet('states', 'select=id,name,country_id&limit=100');
    if (!Array.isArray(dbStates) || dbStates.length === 0) {
      console.error('  ❌ No states in database. Run 005_hierarchical_schema.sql first!');
      process.exit(1);
    }
    for (const s of dbStates) stateMap[s.name] = { id: s.id, country_id: s.country_id };
    console.log(`  ✅ ${Object.keys(stateMap).length} states loaded from database`);
  }

  // ─── Step 2: Resolve admin boundary centres ─────────────────────────────────
  const districtCentres = []; // { name, lat, lon, stateName }
  const cityCentres     = []; // { name, lat, lon, districtName, stateName }

  for (const ab of adminBounds) {
    if (!ab.adminCentreNodeId) continue;
    const coords = nodeCoords.get(ab.adminCentreNodeId);
    if (!coords) continue;

    const stateName = findNearestState(coords.lat, coords.lon);

    if (ab.level === 5 || ab.level === 6) {
      districtCentres.push({ name: ab.name, lat: coords.lat, lon: coords.lon, stateName });
    }
    if (ab.level === 8) {
      // City-level admin boundary — we'll use settlements for cities instead
      // but record for reference
      cityCentres.push({ name: ab.name, lat: coords.lat, lon: coords.lon, stateName });
    }
  }

  console.log(`  ✅ Resolved ${districtCentres.length} district centres from admin boundaries`);
  console.log(`  ✅ Resolved ${cityCentres.length} city-level admin centres`);

  // ─── Step 3: Assign each settlement to a STATE ──────────────────────────────
  console.log('\n  ⏳ Assigning settlements to states...');
  let matchedByTag = 0, matchedBySpatial = 0;

  for (const s of settlements) {
    // Try tag-based matching first
    const tagState = resolveState(s.tags, s.lat, s.lon);
    s.stateName = tagState;

    // Check if it came from tags or spatial
    const fromTag = str(s.tags['is_in:state'] || s.tags['is_in:state_code'] || s.tags['addr:state']);
    if (fromTag && normalizeStateName(fromTag)) matchedByTag++;
    else matchedBySpatial++;
  }

  console.log(`     By tags:    ${matchedByTag.toLocaleString()}`);
  console.log(`     By spatial: ${matchedBySpatial.toLocaleString()}`);

  // ─── Step 4: Assign each settlement to a DISTRICT ───────────────────────────
  console.log('\n  ⏳ Assigning settlements to districts...');

  // First pass: tag-based district assignment
  let distByTag = 0, distBySpatial = 0, distByDefault = 0;

  for (const s of settlements) {
    // Try tag-based
    let distName = resolveDistrictFromTags(s.tags) || resolveDistrictFromIsIn(s.tags);
    if (distName) {
      s.districtName = distName;
      distByTag++;
      continue;
    }

    // Spatial: find nearest admin boundary district centre in the same state
    if (districtCentres.length > 0) {
      let bestDist = Infinity, bestName = null;
      for (const dc of districtCentres) {
        if (dc.stateName !== s.stateName) continue;
        const d = haversine(s.lat, s.lon, dc.lat, dc.lon);
        if (d < bestDist) { bestDist = d; bestName = dc.name; }
      }
      if (bestName && bestDist < 200) { // 200km threshold
        s.districtName = bestName;
        distBySpatial++;
        continue;
      }
    }

    // Default: use a state-level default district
    s.districtName = 'General';
    distByDefault++;
  }

  console.log(`     By tags:    ${distByTag.toLocaleString()}`);
  console.log(`     By spatial: ${distBySpatial.toLocaleString()}`);
  console.log(`     Default:    ${distByDefault.toLocaleString()}`);

  // ─── Step 5: Group and count ────────────────────────────────────────────────
  const stateGroups = {}; // stateName → { districts: { districtName → settlements[] } }
  for (const s of settlements) {
    if (!s.stateName) continue;
    if (!stateGroups[s.stateName]) stateGroups[s.stateName] = {};
    const distName = s.districtName || 'General';
    if (!stateGroups[s.stateName][distName]) stateGroups[s.stateName][distName] = [];
    stateGroups[s.stateName][distName].push(s);
  }

  const totalDistricts = Object.values(stateGroups).reduce((sum, dists) => sum + Object.keys(dists).length, 0);
  const totalCities    = settlements.filter(s => s.stateName).length;

  console.log(`\n  📊 Hierarchy Summary:`);
  console.log(`     States:    ${Object.keys(stateGroups).length}`);
  console.log(`     Districts: ${totalDistricts}`);
  console.log(`     Cities:    ${totalCities.toLocaleString()}`);

  // Top 5 states by settlement count
  const topStates = Object.entries(stateGroups)
    .map(([name, dists]) => ({ name, count: Object.values(dists).reduce((s, arr) => s + arr.length, 0) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  console.log('\n  📈 Top 5 states by settlement count:');
  for (const ts of topStates) console.log(`     ${ts.name.padEnd(25)} ${ts.count.toLocaleString()}`);

  if (DRY_RUN) {
    console.log('\n  🏃 DRY RUN — skipping database writes');
    return { stateMap, stateGroups, districtIdMap: {}, cityIndex: [] };
  }

  // ─── Step 6: Insert into database ───────────────────────────────────────────
  console.log('\n  ⏳ Inserting hierarchy into database...');

  const districtIdMap = {}; // `${stateName}::${districtName}` → id
  const cityIdMap     = {}; // `${districtId}::${cityName}` → id
  const cityIndex     = []; // { id, lat, lon }

  let insertedDistricts = 0, insertedCities = 0, failedDistricts = 0, failedCities = 0;

  for (const [stateName, districts] of Object.entries(stateGroups)) {
    const stateData = stateMap[stateName];
    if (!stateData) {
      console.log(`     ⚠️  State not in DB: ${stateName}`);
      continue;
    }

    for (const [districtName, setts] of Object.entries(districts)) {
      // Insert district
      const distKey = `${stateName}::${districtName}`;
      if (!districtIdMap[distKey]) {
        const result = await withRetry(() => supaInsert('districts', [{
          name: districtName, state_id: stateData.id
        }], 'name,state_id'), `District ${districtName}`);

        if (Array.isArray(result) && result[0]) {
          districtIdMap[distKey] = result[0].id;
          insertedDistricts++;
        } else {
          // Fetch existing
          const existing = await supaGet('districts',
            `name=eq.${encodeURIComponent(districtName)}&state_id=eq.${stateData.id}&select=id&limit=1`);
          if (Array.isArray(existing) && existing[0]) {
            districtIdMap[distKey] = existing[0].id;
            insertedDistricts++;
          } else {
            failedDistricts++;
            continue;
          }
        }
      }

      const districtId = districtIdMap[distKey];
      if (!districtId) continue;

      // Insert cities in batches
      const cityBatches = [];
      for (let i = 0; i < setts.length; i += BATCH_SIZE) {
        cityBatches.push(setts.slice(i, i + BATCH_SIZE));
      }

      for (const batch of cityBatches) {
        const records = batch.map(s => ({
          name:        s.name,
          district_id: districtId,
          latitude:    s.lat,
          longitude:   s.lon,
          population:  s.tags.population ? parseInt(s.tags.population, 10) || null : null,
          place_type:  s.type,
          osm_id:      s.osmId,
        }));

        const result = await withRetry(() => supaInsertMinimal('cities', records, 'osm_id'), `Cities batch`);
        if (result !== null) {
          insertedCities += records.length;
          for (const r of records) {
            cityIndex.push({ lat: r.latitude, lon: r.longitude, districtId });
          }
        } else {
          failedCities += records.length;
        }
        await sleep(100);
      }
    }

    process.stdout.write(`\r  📍 ${stateName.padEnd(30)} ✅`);
  }

  // Reload city IDs from DB for spatial matching
  console.log('\n\n  ⏳ Loading city index from database...');
  const dbCities = await supaGet('cities', 'select=id,name,latitude,longitude,district_id&limit=250000');
  const fullCityIndex = [];
  if (Array.isArray(dbCities)) {
    for (const c of dbCities) {
      if (c.latitude && c.longitude) {
        fullCityIndex.push({ id: c.id, name: c.name, lat: c.latitude, lon: c.longitude, districtId: c.district_id });
      }
    }
  }

  console.log(`\n  ✅ Hierarchy inserted:`);
  console.log(`     Districts: ${insertedDistricts} (${failedDistricts} failed)`);
  console.log(`     Cities:    ${insertedCities.toLocaleString()} (${failedCities} failed)`);
  console.log(`     City index: ${fullCityIndex.length.toLocaleString()} with coordinates`);

  return { stateMap, stateGroups, districtIdMap, cityIndex: fullCityIndex };
}

// =============================================================================
// PHASE 4: Verify Hierarchy
// =============================================================================

async function verifyHierarchy() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 PHASE 4: Verifying Hierarchy');
  console.log('═══════════════════════════════════════════════════\n');

  if (DRY_RUN) {
    console.log('  ✅ Verification skipped (dry-run mode)');
    return true;
  }

  const states    = await supaGet('states', 'select=id&limit=1');
  const districts = await supaGet('districts', 'select=id&limit=1');
  const cities    = await supaGet('cities', 'select=id,latitude&limit=1');

  // Use HEAD request with count to get totals
  const stateCount    = await httpRequest(`${SUPABASE_URL}/rest/v1/states?select=id`, 'GET', null,
    { ...supaHeaders, 'Prefer': 'count=exact', 'Range': '0-0' }).catch(() => []);
  const districtCount = await httpRequest(`${SUPABASE_URL}/rest/v1/districts?select=id`, 'GET', null,
    { ...supaHeaders, 'Prefer': 'count=exact', 'Range': '0-0' }).catch(() => []);
  const cityCount     = await httpRequest(`${SUPABASE_URL}/rest/v1/cities?select=id`, 'GET', null,
    { ...supaHeaders, 'Prefer': 'count=exact', 'Range': '0-0' }).catch(() => []);

  // Get counts from arrays
  const sc = Array.isArray(stateCount) ? stateCount.length : 0;
  const dc = Array.isArray(districtCount) ? districtCount.length : 0;
  const cc = Array.isArray(cityCount) ? cityCount.length : 0;

  // For accurate counts, query with proper select
  const allStates    = await supaGet('states', 'select=name&limit=100');
  const allDistricts = await supaGet('districts', 'select=id&limit=50000');
  const allCities    = await supaGet('cities', 'select=id&latitude=not.is.null&limit=1');

  const sCount = Array.isArray(allStates)    ? allStates.length : 0;
  const dCount = Array.isArray(allDistricts) ? allDistricts.length : 0;

  // Get city count by checking with a larger limit
  const cityCheck = await supaGet('cities', 'select=id&limit=300000');
  const cCount = Array.isArray(cityCheck) ? cityCheck.length : 0;

  console.log(`  States:    ${sCount} ${sCount >= 36 ? '✅' : '❌ (expected >= 36)'}`);
  console.log(`  Districts: ${dCount} ${dCount >= 100 ? '✅' : '❌ (expected >= 100)'}`);
  console.log(`  Cities:    ${cCount.toLocaleString()} ${cCount >= 1000 ? '✅' : '⚠️ (expected >= 1000)'}`);

  if (sCount < 36) {
    console.error('\n  ❌ VERIFICATION FAILED — States count too low. Run migration 005 first.');
    if (!DRY_RUN) process.exit(1);
    return false;
  }

  if (dCount < 10) {
    console.error('\n  ❌ VERIFICATION FAILED — No districts found. Hierarchy import may have failed.');
    if (!DRY_RUN) process.exit(1);
    return false;
  }

  console.log('\n  ✅ Hierarchy verification passed');
  return true;
}

// =============================================================================
// PHASE 5: Import Places
// =============================================================================

async function importPlaces(placeNodes, wayPlaces, nodeCoords, cityIndex) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 PHASE 5: Importing Places');
  console.log('═══════════════════════════════════════════════════\n');

  if (cityIndex.length === 0) {
    console.error('  ❌ No cities with coordinates — cannot spatially match places');
    return;
  }

  // ─── Spatial city matcher ───────────────────────────────────────────────────
  function findNearestCity(lat, lon) {
    let best = null, bestDist = 75; // 75km max radius
    for (const c of cityIndex) {
      const d = haversine(lat, lon, c.lat, c.lon);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return best;
  }

  // ─── Compute way centroids ──────────────────────────────────────────────────
  const resolvedWayPlaces = [];
  for (const wp of wayPlaces) {
    if (!wp.nodeRefs || wp.nodeRefs.length === 0) continue;
    let sumLat = 0, sumLon = 0, count = 0;
    for (const ref of wp.nodeRefs) {
      const c = nodeCoords.get(ref);
      if (c) { sumLat += c.lat; sumLon += c.lon; count++; }
    }
    if (count > 0) {
      resolvedWayPlaces.push({
        ...wp,
        lat: sumLat / count,
        lon: sumLon / count,
      });
    }
  }

  console.log(`  📦 Place nodes:       ${placeNodes.length.toLocaleString()}`);
  console.log(`  📦 Way/Rel places:    ${resolvedWayPlaces.length.toLocaleString()} (of ${wayPlaces.length})`);
  console.log(`  🏙️ City index size:   ${cityIndex.length.toLocaleString()}`);

  // ─── Combine all places ────────────────────────────────────────────────────
  const allSources = [
    ...placeNodes.map(p => ({ name: p.name, lat: p.lat, lon: p.lon, tags: p.tags, osmId: p.osmId, category: p.category })),
    ...resolvedWayPlaces.map(p => ({ name: p.name, lat: p.lat, lon: p.lon, tags: p.tags, osmId: p.osmId, category: p.category })),
  ];

  // Deduplicate by osm_id
  const seenOsmIds = new Set();
  const deduplicated = [];
  for (const p of allSources) {
    if (seenOsmIds.has(p.osmId)) continue;
    seenOsmIds.add(p.osmId);
    deduplicated.push(p);
  }

  console.log(`  📦 After dedup:       ${deduplicated.length.toLocaleString()}`);

  // ─── Build place records with spatial city matching ─────────────────────────
  const PLACE_KEYS = ['name', 'description', 'city_id', 'category', 'place_type',
    'latitude', 'longitude', 'image_url', 'wiki_url', 'osm_id', 'source', 'metadata'];

  function normalizeRecord(raw) {
    const out = {};
    for (const key of PLACE_KEYS) {
      let v = raw[key];
      if (v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) v = null;
      out[key] = v;
    }
    return out;
  }

  let totalInserted = 0, totalFailed = 0, matchedToCity = 0, unmatchedCity = 0;
  let batchIndex = 0;
  const categoryCounts = {};
  const batch = [];
  const startTime = Date.now();

  function printProgress() {
    const el = Math.max(1, (Date.now() - startTime) / 1000).toFixed(0);
    process.stdout.write(
      `\r  ✅ ${String(totalInserted).padStart(8)} inserted | ⏱ ${el}s | 🏙️ ${matchedToCity} matched | ❌ ${unmatchedCity} no city`
    );
  }

  async function flushBatch() {
    if (batch.length === 0) return;
    const records = batch.splice(0, batch.length);
    batchIndex++;

    // Validate keys
    if (batchIndex === 1) {
      const expected = JSON.stringify([...PLACE_KEYS].sort());
      const actual   = JSON.stringify(Object.keys(records[0]).sort());
      if (actual !== expected) {
        console.error(`\n  ❌ Key mismatch!\n  Expected: ${expected}\n  Got:      ${actual}`);
        process.exit(1);
      }
      console.log(`  ✅ First batch key validation passed\n`);
    }

    if (DRY_RUN) {
      totalInserted += records.length;
    } else {
      const ok = await withRetry(() => supaInsertMinimal('places', records, 'osm_id'), `Batch ${batchIndex}`);
      if (ok !== null) totalInserted += records.length;
      else             totalFailed   += records.length;
      await sleep(DELAY_MS);
    }

    for (const r of records) {
      categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
    }
  }

  console.log('\n  ⏳ Building place records with spatial city matching...\n');

  for (let i = 0; i < deduplicated.length; i++) {
    if (totalInserted >= LIMIT) break;

    const p = deduplicated[i];
    if (!p.name || !p.category || !p.lat || !p.lon) continue;

    // Spatial match to nearest city
    const nearestCity = findNearestCity(p.lat, p.lon);
    const cityId = nearestCity ? nearestCity.id : null;
    if (cityId) matchedToCity++;
    else unmatchedCity++;

    // Build compact metadata
    const metaTags = {};
    let tagCount = 0;
    for (const [k, v] of Object.entries(p.tags)) {
      if (tagCount >= 10) break;
      if (/^name:[a-z]{2,4}$/.test(k) && k !== 'name:en') continue;
      metaTags[k] = v;
      tagCount++;
    }

    const record = normalizeRecord({
      name:        p.name.slice(0, 500),
      description: getDescription(p.tags),
      city_id:     cityId,
      category:    p.category,
      place_type:  getPlaceType(p.tags),
      latitude:    p.lat,
      longitude:   p.lon,
      image_url:   getImageFromTags(p.tags),
      wiki_url:    getWikiUrl(p.tags),
      osm_id:      p.osmId,
      source:      'OpenStreetMap',
      metadata:    { tags: metaTags },
    });

    batch.push(record);
    if (batch.length >= BATCH_SIZE) await flushBatch();
    if (i % 5000 === 0) printProgress();
  }

  await flushBatch();
  printProgress();

  // ─── Summary ────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n═══════════════════════════════════════════════════`);
  console.log(DRY_RUN ? '✅ Dry Run Complete!' : '✅ Place Import Complete!');
  console.log(`   Total processed: ${deduplicated.length.toLocaleString()}`);
  console.log(`   Inserted:        ${totalInserted.toLocaleString()}`);
  console.log(`   Matched to city: ${matchedToCity.toLocaleString()}`);
  console.log(`   No city match:   ${unmatchedCity.toLocaleString()}`);
  if (totalFailed > 0) console.log(`   ⚠️  Failed:       ${totalFailed.toLocaleString()}`);
  console.log(`   Time:            ${elapsed}s`);
  if (Object.keys(categoryCounts).length > 0) {
    console.log('\n   By Category:');
    Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .forEach(([cat, cnt]) => console.log(`     ${cat.padEnd(22)} ${cnt.toLocaleString()}`));
  }
  console.log('═══════════════════════════════════════════════════\n');
}

// =============================================================================
// PHASE 6: Image Enrichment
// =============================================================================

async function enrichImages() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🖼️  PHASE 6: Wikipedia Image Enrichment');
  console.log('═══════════════════════════════════════════════════\n');

  const places = await supaGet('places', 'select=id,name,wiki_url&image_url=is.null&limit=3000&order=name.asc');
  if (!Array.isArray(places) || places.length === 0) {
    console.log('  ✅ All places already have images');
    return;
  }

  console.log(`  📦 ${places.length} places need images\n`);
  let enriched = 0, noImage = 0;

  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    try {
      const res = await new Promise((resolve) => {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(place.name.replace(/ /g, '_'))}`;
        https.get(url, { timeout: 5000 }, (r) => {
          let b = ''; r.on('data', c => b += c);
          r.on('end', () => { if (r.statusCode === 200) { try { resolve(JSON.parse(b)); } catch { resolve(null); } } else resolve(null); });
        }).on('error', () => resolve(null));
      });

      if (res?.thumbnail?.source) {
        const imgUrl = res.thumbnail.source.replace(/\/\d+px-/, '/400px-');
        if (!DRY_RUN) {
          await httpRequest(`${SUPABASE_URL}/rest/v1/places?id=eq.${place.id}`, 'PATCH',
            { image_url: imgUrl }, { ...supaHeaders, 'Prefer': 'return=minimal' });
        }
        enriched++;
      } else { noImage++; }
    } catch { noImage++; }

    if ((i + 1) % 50 === 0) process.stdout.write(`\r  🖼️ ${enriched} enriched | ${noImage} no image | ${i + 1}/${places.length}`);
    await sleep(100);
  }

  console.log(`\n\n  ✅ Enriched ${enriched} | No image: ${noImage}`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('\n🗺️  ExploreHub — OSM Import v6 (Spatial Hierarchy)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📂 File:     ${path.basename(PBF_FILE)} (${(fs.statSync(PBF_FILE).size / 1e9).toFixed(2)} GB)`);
  console.log(`🔑 Auth:     ${useServiceKey ? '✅ Service Role' : '🔑 Anon Key'}`);
  console.log(`🗄️  Database: ${SUPABASE_URL}`);
  if (DRY_RUN)          console.log('🏃 Mode:     DRY RUN');
  if (LIMIT < Infinity) console.log(`🔢 Limit:    ${LIMIT} places`);
  if (PASS_ONLY)        console.log(`📊 Pass:     ${PASS_ONLY} only`);
  if (ENRICH_IMG)       console.log('🖼️  Mode:     Image enrichment');

  if (ENRICH_IMG) {
    await enrichImages();
    return;
  }

  if (!PASS_ONLY || PASS_ONLY === 'hierarchy') {
    // Pass 1: Collect raw data
    const { settlements, placeNodes, wayPlaces, adminBounds, neededNodeIds } = await pass1();

    // Pass 2: Resolve node coordinates for ways + admin centres
    const nodeCoords = await pass2(neededNodeIds);

    // Phase 3: Build hierarchy
    const { cityIndex } = await buildHierarchy(settlements, adminBounds, nodeCoords);

    // Phase 4: Verify
    const ok = await verifyHierarchy();

    if (PASS_ONLY === 'hierarchy') {
      console.log('\n  ✅ Hierarchy-only mode complete.');
      return;
    }

    if (!ok && !DRY_RUN) {
      console.error('\n  ❌ Hierarchy verification failed — STOPPING.');
      return;
    }

    // Phase 5: Import places
    await importPlaces(placeNodes, wayPlaces, nodeCoords, cityIndex);
  }

  if (PASS_ONLY === 'places') {
    // Load existing hierarchy
    console.log('\n  ⏳ Loading existing hierarchy for place import...');
    const dbCities = await supaGet('cities', 'select=id,name,latitude,longitude,district_id&limit=300000');
    const cityIndex = [];
    if (Array.isArray(dbCities)) {
      for (const c of dbCities) {
        if (c.latitude && c.longitude) cityIndex.push({ id: c.id, lat: c.latitude, lon: c.longitude, districtId: c.district_id });
      }
    }
    console.log(`  ✅ ${cityIndex.length.toLocaleString()} cities loaded\n`);

    if (cityIndex.length === 0) {
      console.error('  ❌ No cities found — run hierarchy import first!');
      return;
    }

    const ok = await verifyHierarchy();
    if (!ok) return;

    // Need to re-scan PBF for places
    const { placeNodes, wayPlaces, neededNodeIds } = await pass1();
    const nodeCoords = await pass2(neededNodeIds);
    await importPlaces(placeNodes, wayPlaces, nodeCoords, cityIndex);
  }

  console.log('\n🎉 Import complete! Open http://localhost:5173 and search for places.');
}

main().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1); });
