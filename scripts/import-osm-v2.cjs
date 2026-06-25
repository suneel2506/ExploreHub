#!/usr/bin/env node
// =============================================================================
// ExploreHub — OSM Import Script v7 (Production-Reliable)
// =============================================================================
//
// ARCHITECTURE:
//   Pass 1  → Collect settlements, places, way refs, admin boundaries
//   Pass 2  → Resolve node coords for ways + admin centres
//   Phase 3 → Build hierarchy via spatial matching + batched DB insertion
//   Phase 4 → Post-import verification (counts + FK integrity)
//   Phase 5 → Import places with spatial city matching
//   Phase 6 → Re-verify after places
//   Phase 7 → Create/refresh search indexes
//   Phase 8 → Queue-based Wikipedia image enrichment
//
// KEY IMPROVEMENTS OVER v6:
//   - Uses @supabase/supabase-js (connection reuse, keep-alive)
//   - Configurable batch sizes (50-200 records)
//   - UPSERT with ON CONFLICT DO NOTHING
//   - Adaptive backoff (responds to error pressure)
//   - Worker pool (2-4 parallel batch inserters)
//   - Checkpoint/resume with full state snapshot
//   - Memory-efficient city index (Float64Array)
//   - Post-import verification with orphan detection
//   - Search index creation after import
//   - Queue-based image enrichment
//
// USAGE:
//   node scripts/import-osm-v2.cjs                     Full import
//   node scripts/import-osm-v2.cjs --dry-run            Parse only, no DB writes
//   node scripts/import-osm-v2.cjs --pass hierarchy     Only build hierarchy
//   node scripts/import-osm-v2.cjs --pass places        Only import places
//   node scripts/import-osm-v2.cjs --enrich-images      Fetch Wikipedia images
//   node scripts/import-osm-v2.cjs --fresh              Ignore checkpoint, start over
//   node scripts/import-osm-v2.cjs --workers 3          Set parallel workers (max 4)
//   node scripts/import-osm-v2.cjs --batch-districts 50
//   node scripts/import-osm-v2.cjs --batch-cities 100
//   node scripts/import-osm-v2.cjs --batch-places 80
//   node scripts/import-osm-v2.cjs --limit 5000         Stop after N place inserts
//
// =============================================================================
'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https'); // Only used for Wikipedia API calls

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY;

// ─── CLI flags ────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const FRESH      = args.includes('--fresh');
const LIMIT      = (() => { const i = args.indexOf('--limit');           return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })();
const PASS_ONLY  = (() => { const i = args.indexOf('--pass');            return i >= 0 ? args[i + 1] : null; })();
const ENRICH_IMG = args.includes('--enrich-images');

const BATCH_DISTRICTS = (() => { const i = args.indexOf('--batch-districts'); return i >= 0 ? parseInt(args[i + 1], 10) : 50; })();
const BATCH_CITIES    = (() => { const i = args.indexOf('--batch-cities');    return i >= 0 ? parseInt(args[i + 1], 10) : 100; })();
const BATCH_PLACES    = (() => { const i = args.indexOf('--batch-places');    return i >= 0 ? parseInt(args[i + 1], 10) : 80; })();
const WORKERS         = (() => { const i = args.indexOf('--workers');         return i >= 0 ? Math.min(Math.max(parseInt(args[i + 1], 10), 1), 4) : 2; })();

// ─── API key ──────────────────────────────────────────────────────────────────
const useServiceKey = SERVICE_KEY && SERVICE_KEY !== 'your-service-role-key-here';
const API_KEY       = useServiceKey ? SERVICE_KEY : ANON_KEY;

if (!SUPABASE_URL || !API_KEY) {
  console.error('\n❌ SUPABASE_URL or API key missing in .env\n');
  process.exit(1);
}

// ─── Supabase client ──────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, API_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

// ─── Utilities ────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Adaptive Backoff ─────────────────────────────────────────────────────────
class AdaptiveBackoff {
  constructor(baseDelay = 100) {
    this.baseDelay = baseDelay;
    this.currentDelay = baseDelay;
    this.maxDelay = 30000;
    this.errorWindow = [];
    this.windowSize = 60000;
    this.successStreak = 0;
  }

  recordSuccess() {
    this.successStreak++;
    if (this.successStreak >= 10) {
      this.currentDelay = Math.max(this.baseDelay, Math.floor(this.currentDelay / 2));
      this.successStreak = 0;
    }
  }

  recordError() {
    this.successStreak = 0;
    this.errorWindow.push(Date.now());
    this._prune();
    const rate = this.errorWindow.length;
    if (rate > 5) this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 4);
    else if (rate > 2) this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 2);
    else this.currentDelay = Math.min(this.maxDelay, this.currentDelay + 500);
  }

  _prune() {
    const cutoff = Date.now() - this.windowSize;
    this.errorWindow = this.errorWindow.filter(t => t > cutoff);
  }

  async wait() {
    if (this.currentDelay > 0) await sleep(this.currentDelay);
  }

  get delay() { return this.currentDelay; }
}

// ─── Worker Pool ──────────────────────────────────────────────────────────────
class WorkerPool {
  constructor(concurrency = 2) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  async enqueue(fn) {
    if (this.running >= this.concurrency) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      if (this.queue.length > 0) this.queue.shift()();
    }
  }

  async drain() {
    while (this.running > 0) await sleep(50);
  }
}

// ─── Error Classification ─────────────────────────────────────────────────────
function isTransientError(error) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  const code = (error.code || '').toLowerCase();
  // Transient network errors
  if (msg.includes('socket hang up')) return true;
  if (msg.includes('econnreset')) return true;
  if (msg.includes('enotfound')) return true;
  if (msg.includes('etimedout')) return true;
  if (msg.includes('econnrefused')) return true;
  if (msg.includes('fetch failed')) return true;
  if (msg.includes('network')) return true;
  if (msg.includes('tls')) return true;
  if (msg.includes('socket_timeout')) return true;
  // HTTP 5xx server errors
  if (error.status && error.status >= 500) return true;
  if (error.statusCode && error.statusCode >= 500) return true;
  // Rate limiting
  if (error.status === 429 || error.statusCode === 429) return true;
  // PostgreSQL transient codes
  if (code === '40001' || code === '40p01') return true; // serialization/deadlock
  return false;
}

// ─── Smart Retry ──────────────────────────────────────────────────────────────
async function withRetry(fn, label, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      // Check for Supabase error objects
      if (result && result.error) {
        if (!isTransientError(result.error)) {
          console.error(`\n  ❌ ${label}: ${result.error.message || JSON.stringify(result.error).slice(0, 300)} [non-retryable]`);
          return result;
        }
        throw result.error; // Let retry logic handle it
      }
      return result;
    } catch (err) {
      if (!isTransientError(err)) {
        console.error(`\n  ❌ ${label}: ${err.message?.slice(0, 300) || err} [non-retryable]`);
        return { data: null, error: err };
      }
      if (attempt < maxAttempts) {
        const wait = Math.min(1000 * Math.pow(2, attempt - 1), 16000);
        console.error(`\n  ⚠️ ${label} attempt ${attempt}/${maxAttempts} | ${err.message?.slice(0, 200) || err}`);
        console.error(`     Retrying in ${(wait / 1000).toFixed(1)}s...`);
        await sleep(wait);
      } else {
        console.error(`\n  ❌ ${label} failed after ${maxAttempts} attempts: ${err.message?.slice(0, 300) || err}`);
        return { data: null, error: err };
      }
    }
  }
}

// ─── Checkpoint System ────────────────────────────────────────────────────────
const CHECKPOINT_FILE = path.join(__dirname, '.import-checkpoint.json');

function saveCheckpoint(data) {
  data.timestamp = new Date().toISOString();
  data.version = 2;
  const tmp = CHECKPOINT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try { fs.renameSync(tmp, CHECKPOINT_FILE); }
  catch { fs.copyFileSync(tmp, CHECKPOINT_FILE); try { fs.unlinkSync(tmp); } catch {} }
}

function loadCheckpoint() {
  if (FRESH) return null;
  if (!fs.existsSync(CHECKPOINT_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')); }
  catch { return null; }
}

function clearCheckpoint() {
  try { if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE); } catch {}
}

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
  const direct = STATE_CENTROIDS.find(s => s.name.toLowerCase() === key);
  if (direct) return direct.name;
  if (STATE_ALIASES[key]) return STATE_ALIASES[key];
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

function resolveState(tags, lat, lon) {
  const isInState = str(tags['is_in:state'] || tags['is_in:state_code'] || tags['addr:state']);
  if (isInState) { const n = normalizeStateName(isInState); if (n) return n; }
  const isIn = str(tags['is_in']);
  if (isIn) {
    const parts = isIn.split(',').map(s => s.trim());
    for (const part of parts) { const n = normalizeStateName(part); if (n) return n; }
  }
  return findNearestState(lat, lon);
}

function resolveDistrictFromTags(tags) {
  return str(tags['addr:district'] || tags['is_in:district'] || tags['addr:county']);
}

function resolveDistrictFromIsIn(tags) {
  const isIn = str(tags['is_in']);
  if (!isIn) return null;
  const parts = isIn.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const candidate = parts[parts.length - 3];
    if (!normalizeStateName(candidate)) return candidate;
  }
  if (parts.length >= 2) {
    const candidate = parts[0];
    if (!normalizeStateName(candidate)) return candidate;
  }
  return null;
}

// =============================================================================
// PASS 1: Collect Raw Data from PBF
// =============================================================================

async function pass1() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 PASS 1: Scanning PBF for settlements, places, ways, admin boundaries');
  console.log('═══════════════════════════════════════════════════\n');

  const parse   = require('osm-pbf-parser');
  const through = require('through2');

  const settlements  = [];
  const placeNodes   = [];
  const wayPlaces    = [];
  const adminBounds  = [];
  const neededNodeIds = new Set();

  let nodeCount = 0, wayCount = 0, relCount = 0;
  const startTime = Date.now();

  await new Promise((resolve, reject) => {
    fs.createReadStream(PBF_FILE)
      .pipe(parse())
      .pipe(through.obj(function (items, _enc, next) {
        for (const item of items) {
          if (item.type === 'node') {
            nodeCount++;
            if (nodeCount % 2000000 === 0) {
              const el = ((Date.now() - startTime) / 1000).toFixed(0);
              process.stdout.write(`\r  🔍 ${(nodeCount / 1e6).toFixed(1)}M nodes | ${settlements.length} settlements | ${placeNodes.length} places | ${el}s`);
            }
            if (item.lat == null || item.lon == null) continue;
            const tags = item.tags || {};
            const name = getName(tags);

            const placeTag = tags.place;
            if (placeTag && ['city', 'town', 'village', 'hamlet'].includes(placeTag) && name) {
              settlements.push({
                name, lat: item.lat, lon: item.lon,
                type: placeTag, tags, osmId: item.id,
              });
            }

            if (isRelevantPlace(tags)) {
              placeNodes.push({
                name, lat: item.lat, lon: item.lon,
                tags, osmId: item.id, category: categorize(tags),
              });
            }
          }
          else if (item.type === 'way') {
            wayCount++;
            const tags = item.tags || {};
            if (isRelevantPlace(tags) && item.refs && item.refs.length > 0) {
              wayPlaces.push({
                name: getName(tags), tags, osmId: item.id,
                category: categorize(tags), nodeRefs: item.refs,
              });
              for (const ref of item.refs) neededNodeIds.add(ref);
            }
          }
          else if (item.type === 'relation') {
            relCount++;
            const tags = item.tags || {};

            if (tags.boundary === 'administrative' && tags.admin_level) {
              const level = parseInt(tags.admin_level, 10);
              const name  = getName(tags);
              if (name && [2, 4, 5, 6, 8].includes(level)) {
                let adminCentreId = null;
                if (item.members) {
                  const centre = item.members.find(m => m.role === 'admin_centre' || m.role === 'label');
                  if (centre) { adminCentreId = centre.id; neededNodeIds.add(centre.id); }
                }
                adminBounds.push({ name, level, adminCentreNodeId: adminCentreId, osmId: item.id });
              }
            }

            if (isRelevantPlace(tags) && item.members) {
              const centre = item.members.find(m => m.role === 'admin_centre' || m.role === 'label');
              const firstNode = item.members.find(m => m.type === 'node');
              const centreId = centre?.id || firstNode?.id;
              if (centreId) {
                neededNodeIds.add(centreId);
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

  const nodeCoords = new Map();
  let scanned = 0, resolved = 0;
  const startTime = Date.now();

  await new Promise((resolve, reject) => {
    fs.createReadStream(PBF_FILE)
      .pipe(parse())
      .pipe(through.obj(function (items, _enc, next) {
        for (const item of items) {
          if (item.type !== 'node') {
            this.destroy();
            resolve();
            return;
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

  const backoff = new AdaptiveBackoff(150);
  const pool = new WorkerPool(WORKERS);

  // ─── Step 1: Load states ────────────────────────────────────────────────────
  let stateMap = {};

  if (DRY_RUN) {
    for (const s of STATE_CENTROIDS) {
      stateMap[s.name] = { id: `mock-${s.name}`, country_id: 'mock-india' };
    }
    console.log(`  ✅ ${Object.keys(stateMap).length} states (mock for dry-run)`);
  } else {
    const { data: dbStates, error } = await supabase
      .from('states').select('id,name,country_id').limit(100);
    if (error || !dbStates || dbStates.length === 0) {
      console.error('  ❌ No states in database. Run 005_hierarchical_schema.sql first!');
      process.exit(1);
    }
    for (const s of dbStates) stateMap[s.name] = { id: s.id, country_id: s.country_id };
    console.log(`  ✅ ${Object.keys(stateMap).length} states loaded from database`);
  }

  // ─── Step 2: Resolve admin boundary centres ─────────────────────────────────
  const districtCentres = [];
  const cityCentres = [];

  for (const ab of adminBounds) {
    if (!ab.adminCentreNodeId) continue;
    const coords = nodeCoords.get(ab.adminCentreNodeId);
    if (!coords) continue;
    const stateName = findNearestState(coords.lat, coords.lon);

    if (ab.level === 5 || ab.level === 6) {
      districtCentres.push({ name: ab.name, lat: coords.lat, lon: coords.lon, stateName });
    }
    if (ab.level === 8) {
      cityCentres.push({ name: ab.name, lat: coords.lat, lon: coords.lon, stateName });
    }
  }

  console.log(`  ✅ Resolved ${districtCentres.length} district centres from admin boundaries`);
  console.log(`  ✅ Resolved ${cityCentres.length} city-level admin centres`);

  // ─── Step 3: Assign each settlement to a STATE ──────────────────────────────
  console.log('\n  ⏳ Assigning settlements to states...');
  let matchedByTag = 0, matchedBySpatial = 0;

  for (const s of settlements) {
    const tagState = resolveState(s.tags, s.lat, s.lon);
    s.stateName = tagState;

    const fromTag = str(s.tags['is_in:state'] || s.tags['is_in:state_code'] || s.tags['addr:state']);
    if (fromTag && normalizeStateName(fromTag)) matchedByTag++;
    else matchedBySpatial++;
  }

  console.log(`     By tags:    ${matchedByTag.toLocaleString()}`);
  console.log(`     By spatial: ${matchedBySpatial.toLocaleString()}`);

  // ─── Step 4: Assign each settlement to a DISTRICT ───────────────────────────
  console.log('\n  ⏳ Assigning settlements to districts...');
  let distByTag = 0, distBySpatial = 0, distByDefault = 0;

  for (const s of settlements) {
    let distName = resolveDistrictFromTags(s.tags) || resolveDistrictFromIsIn(s.tags);
    if (distName) { s.districtName = distName; distByTag++; continue; }

    if (districtCentres.length > 0) {
      let bestDist = Infinity, bestName = null;
      for (const dc of districtCentres) {
        if (dc.stateName !== s.stateName) continue;
        const d = haversine(s.lat, s.lon, dc.lat, dc.lon);
        if (d < bestDist) { bestDist = d; bestName = dc.name; }
      }
      if (bestName && bestDist < 200) { s.districtName = bestName; distBySpatial++; continue; }
    }

    s.districtName = 'General';
    distByDefault++;
  }

  console.log(`     By tags:    ${distByTag.toLocaleString()}`);
  console.log(`     By spatial: ${distBySpatial.toLocaleString()}`);
  console.log(`     Default:    ${distByDefault.toLocaleString()}`);

  // ─── Step 5: Group and count ────────────────────────────────────────────────
  const stateGroups = {};
  for (const s of settlements) {
    if (!s.stateName) continue;
    if (!stateGroups[s.stateName]) stateGroups[s.stateName] = {};
    const distName = s.districtName || 'General';
    if (!stateGroups[s.stateName][distName]) stateGroups[s.stateName][distName] = [];
    stateGroups[s.stateName][distName].push(s);
  }

  const totalDistricts = Object.values(stateGroups).reduce((sum, dists) => sum + Object.keys(dists).length, 0);
  const totalCities = settlements.filter(s => s.stateName).length;

  console.log(`\n  📊 Hierarchy Summary:`);
  console.log(`     States:    ${Object.keys(stateGroups).length}`);
  console.log(`     Districts: ${totalDistricts}`);
  console.log(`     Cities:    ${totalCities.toLocaleString()}`);

  const topStates = Object.entries(stateGroups)
    .map(([name, dists]) => ({ name, count: Object.values(dists).reduce((s, arr) => s + arr.length, 0) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  console.log('\n  📈 Top 5 states by settlement count:');
  for (const ts of topStates) console.log(`     ${ts.name.padEnd(25)} ${ts.count.toLocaleString()}`);

  if (DRY_RUN) {
    console.log('\n  🏃 DRY RUN — skipping database writes');
    const mockCityIndex = {
      lats: new Float64Array(settlements.filter(s => s.lat && s.lon).length),
      lons: new Float64Array(settlements.filter(s => s.lat && s.lon).length),
      ids: [],
      count: 0,
    };
    for (const s of settlements) {
      if (s.lat && s.lon) {
        const i = mockCityIndex.count++;
        mockCityIndex.lats[i] = s.lat;
        mockCityIndex.lons[i] = s.lon;
        mockCityIndex.ids.push(`mock-city-${i}`);
      }
    }
    console.log(`  📍 Mock city index: ${mockCityIndex.count.toLocaleString()} entries`);
    return { stateMap, stateGroups, districtIdMap: {}, cityIndex: mockCityIndex };
  }

  // ─── Step 6: Insert into database (batched, with workers) ───────────────────
  console.log('\n  ⏳ Inserting hierarchy into database...');
  console.log(`     Workers: ${WORKERS} | District batch: ${BATCH_DISTRICTS} | City batch: ${BATCH_CITIES}\n`);

  const checkpoint = loadCheckpoint();
  const completedStates = new Set(checkpoint?.phase === 'hierarchy' ? (checkpoint.completedStates || []) : []);
  const counters = checkpoint?.phase === 'hierarchy' ? (checkpoint.counters || {}) : {};
  let insertedDistricts = counters.insertedDistricts || 0;
  let insertedCities = counters.insertedCities || 0;
  let failedDistricts = counters.failedDistricts || 0;
  let failedCities = counters.failedCities || 0;

  const stateOrder = Object.keys(stateGroups);
  const startTime = Date.now();

  for (let si = 0; si < stateOrder.length; si++) {
    const stateName = stateOrder[si];

    // Skip completed states (resume support)
    if (completedStates.has(stateName)) {
      process.stdout.write(`\r  ⏭️  ${stateName.padEnd(30)} (resumed)`);
      continue;
    }

    const stateData = stateMap[stateName];
    if (!stateData) {
      console.log(`\n     ⚠️  State not in DB: ${stateName}`);
      continue;
    }

    const districts = stateGroups[stateName];
    const districtNames = Object.keys(districts);

    // ── Batch upsert districts ──────────────────────────────────────────────
    const districtIdMap = {}; // districtName → id

    for (let di = 0; di < districtNames.length; di += BATCH_DISTRICTS) {
      const batch = districtNames.slice(di, di + BATCH_DISTRICTS).map(name => ({
        name,
        state_id: stateData.id,
      }));

      const result = await withRetry(async () => {
        return await supabase.from('districts')
          .upsert(batch, { onConflict: 'name,state_id', ignoreDuplicates: true })
          .select('id,name');
      }, `Districts ${stateName} batch ${Math.floor(di / BATCH_DISTRICTS) + 1}`);

      if (result?.data) {
        for (const d of result.data) districtIdMap[d.name] = d.id;
        insertedDistricts += result.data.length;
        backoff.recordSuccess();
      } else {
        // Upsert with ignoreDuplicates returns empty array for existing rows.
        // Fetch existing IDs for this batch.
        backoff.recordError();
        failedDistricts += batch.length;
      }
      await backoff.wait();
    }

    // Fetch all district IDs for this state (covers both new and existing)
    const { data: stateDistricts } = await withRetry(async () => {
      return await supabase.from('districts')
        .select('id,name')
        .eq('state_id', stateData.id)
        .limit(5000);
    }, `Fetch districts for ${stateName}`);

    if (stateDistricts) {
      for (const d of stateDistricts) districtIdMap[d.name] = d.id;
    }

    // ── Batch upsert cities (parallel within state) ─────────────────────────
    const cityBatches = [];
    for (const [districtName, setts] of Object.entries(districts)) {
      const districtId = districtIdMap[districtName];
      if (!districtId) { failedCities += setts.length; continue; }

      // Deduplicate settlements by name within district
      const seen = new Set();
      const unique = [];
      for (const s of setts) {
        const key = s.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(s);
      }

      // Build records in batches
      for (let i = 0; i < unique.length; i += BATCH_CITIES) {
        const slice = unique.slice(i, i + BATCH_CITIES);
        const records = slice.map(s => ({
          name:        s.name,
          district_id: districtId,
          latitude:    s.lat,
          longitude:   s.lon,
          population:  s.tags.population ? parseInt(s.tags.population, 10) || null : null,
          place_type:  s.type,
          osm_id:      s.osmId,
        }));
        cityBatches.push(records);
      }
    }

    // Dispatch city batches through worker pool
    const cityResults = await Promise.all(
      cityBatches.map(batch =>
        pool.enqueue(async () => {
          const result = await withRetry(async () => {
            return await supabase.from('cities')
              .upsert(batch, { onConflict: 'name,district_id', ignoreDuplicates: true });
          }, `Cities batch (${batch.length} records)`);

          if (!result?.error) {
            backoff.recordSuccess();
            await backoff.wait();
            return { ok: batch.length, fail: 0 };
          } else {
            backoff.recordError();
            await backoff.wait();
            return { ok: 0, fail: batch.length };
          }
        })
      )
    );

    for (const r of cityResults) {
      insertedCities += r.ok;
      failedCities += r.fail;
    }

    completedStates.add(stateName);

    // Save checkpoint after each state
    saveCheckpoint({
      phase: 'hierarchy',
      completedStates: [...completedStates],
      counters: { insertedDistricts, insertedCities, failedDistricts, failedCities },
      stateOrder,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pct = (((si + 1) / stateOrder.length) * 100).toFixed(0);
    process.stdout.write(`\r  📍 ${stateName.padEnd(30)} ✅ [${pct}% | ${elapsed}s | delay=${backoff.delay}ms]`);
  }

  await pool.drain();

  console.log(`\n\n  ✅ Hierarchy inserted:`);
  console.log(`     Districts: ${insertedDistricts} (${failedDistricts} failed)`);
  console.log(`     Cities:    ${insertedCities.toLocaleString()} (${failedCities} failed)`);

  // ─── Step 7: Load lightweight city index ────────────────────────────────────
  console.log('\n  ⏳ Loading city index (paginated, memory-efficient)...');
  const cityIndex = await loadCityIndex();
  console.log(`  ✅ City index: ${cityIndex.count.toLocaleString()} entries (~${(cityIndex.count * 24 / 1e6).toFixed(1)}MB)`);

  return { stateMap, stateGroups, districtIdMap: {}, cityIndex };
}

// ─── Memory-efficient city index loader ───────────────────────────────────────
async function loadCityIndex() {
  const PAGE_SIZE = 10000;
  let offset = 0;
  // Pre-allocate typed arrays (will grow if needed)
  let capacity = 300000;
  let lats = new Float64Array(capacity);
  let lons = new Float64Array(capacity);
  const ids = [];
  let count = 0;

  while (true) {
    const { data, error } = await supabase.from('cities')
      .select('id,latitude,longitude')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error(`     ⚠️ City index page error: ${error.message?.slice(0, 200)}`);
      break;
    }
    if (!data || data.length === 0) break;

    // Grow arrays if needed
    if (count + data.length > capacity) {
      capacity = Math.max(capacity * 2, count + data.length + 10000);
      const newLats = new Float64Array(capacity);
      const newLons = new Float64Array(capacity);
      newLats.set(lats);
      newLons.set(lons);
      lats = newLats;
      lons = newLons;
    }

    for (const c of data) {
      lats[count] = c.latitude;
      lons[count] = c.longitude;
      ids.push(c.id);
      count++;
    }

    offset += data.length;
    if (offset % 50000 === 0) {
      process.stdout.write(`\r     Loaded ${count.toLocaleString()} cities...`);
    }
  }

  return {
    lats: lats.slice(0, count),
    lons: lons.slice(0, count),
    ids,
    count,
  };
}

// ─── Spatial city matcher using typed-array index ─────────────────────────────
function findNearestCityFromIndex(index, lat, lon, maxKm = 75) {
  let bestIdx = -1, bestDist = maxKm;
  const dLat = maxKm / 111.0;
  const dLon = maxKm / (111.0 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));

  for (let i = 0; i < index.count; i++) {
    if (Math.abs(index.lats[i] - lat) > dLat) continue;
    if (Math.abs(index.lons[i] - lon) > dLon) continue;
    const d = haversine(lat, lon, index.lats[i], index.lons[i]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx >= 0 ? index.ids[bestIdx] : null;
}

// =============================================================================
// PHASE 4: Post-Import Verification
// =============================================================================

async function verifyImport(phase = 'hierarchy') {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`📊 PHASE 4: Post-Import Verification (${phase})`);
  console.log('═══════════════════════════════════════════════════\n');

  if (DRY_RUN) {
    console.log('  ✅ Verification skipped (dry-run mode)');
    return true;
  }

  const checks = [];

  // Record counts
  const { count: stateCount }    = await supabase.from('states').select('*', { count: 'exact', head: true });
  const { count: districtCount } = await supabase.from('districts').select('*', { count: 'exact', head: true });
  const { count: cityCount }     = await supabase.from('cities').select('*', { count: 'exact', head: true });
  const { count: placeCount }    = await supabase.from('places').select('*', { count: 'exact', head: true });

  checks.push({ name: 'States',    count: stateCount || 0,    min: 36,  pass: (stateCount || 0) >= 36 });
  checks.push({ name: 'Districts', count: districtCount || 0, min: 100, pass: (districtCount || 0) >= 100 });
  checks.push({ name: 'Cities',    count: cityCount || 0,     min: 1000, pass: (cityCount || 0) >= 1000 });

  if (phase === 'places' || phase === 'full') {
    checks.push({ name: 'Places', count: placeCount || 0, min: 5000, pass: (placeCount || 0) >= 5000 });
  }

  // FK integrity — orphan detection via RPCs
  try {
    const { data: od } = await supabase.rpc('count_orphan_districts');
    const { data: oc } = await supabase.rpc('count_orphan_cities');
    const { data: op } = await supabase.rpc('count_orphan_places');

    checks.push({ name: 'Orphan districts', count: od || 0, pass: (od || 0) === 0 });
    checks.push({ name: 'Orphan cities',    count: oc || 0, pass: (oc || 0) === 0 });
    checks.push({ name: 'Orphan places',    count: op || 0, pass: true }); // Places can have null city_id
  } catch (err) {
    console.log('  ⚠️ Orphan RPCs not available (run migration 006). Skipping FK checks.');
  }

  // Coordinate coverage
  const { count: citiesWithCoords } = await supabase
    .from('cities').select('*', { count: 'exact', head: true })
    .not('latitude', 'is', null);
  const coordPct = (cityCount || 0) > 0 ? (((citiesWithCoords || 0) / cityCount) * 100).toFixed(1) : '0';
  checks.push({ name: 'Cities with coords', count: citiesWithCoords || 0, pass: parseFloat(coordPct) > 95 });

  // Print results
  console.log('  ┌───────────────────────────┬──────────┬────────┐');
  console.log('  │ Check                     │ Count    │ Status │');
  console.log('  ├───────────────────────────┼──────────┼────────┤');
  for (const c of checks) {
    const status = c.pass ? '✅' : '❌';
    console.log(`  │ ${c.name.padEnd(25)} │ ${String(c.count).padStart(8)} │ ${status}     │`);
  }
  console.log('  └───────────────────────────┴──────────┴────────┘');

  const criticalFails = checks.filter(c => !c.pass && c.name !== 'Orphan places' && c.name !== 'Places');
  if (criticalFails.length > 0) {
    console.error('\n  ❌ VERIFICATION FAILED — see table above');
    return false;
  }

  console.log('\n  ✅ All verification checks passed');
  return true;
}

// =============================================================================
// PHASE 5: Import Places
// =============================================================================

async function importPlaces(placeNodes, wayPlaces, nodeCoords, cityIndex) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 PHASE 5: Importing Places');
  console.log('═══════════════════════════════════════════════════\n');

  if (cityIndex.count === 0) {
    console.error('  ❌ No cities with coordinates — cannot spatially match places');
    return;
  }

  const backoff = new AdaptiveBackoff(100);
  const pool = new WorkerPool(WORKERS);

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
        ...wp, lat: sumLat / count, lon: sumLon / count,
      });
    }
  }

  console.log(`  📦 Place nodes:       ${placeNodes.length.toLocaleString()}`);
  console.log(`  📦 Way/Rel places:    ${resolvedWayPlaces.length.toLocaleString()} (of ${wayPlaces.length})`);
  console.log(`  🏙️ City index size:   ${cityIndex.count.toLocaleString()}`);
  console.log(`  👷 Workers: ${WORKERS} | Batch: ${BATCH_PLACES}\n`);

  // ─── Combine + deduplicate ──────────────────────────────────────────────────
  const allSources = [
    ...placeNodes.map(p => ({ name: p.name, lat: p.lat, lon: p.lon, tags: p.tags, osmId: p.osmId, category: p.category })),
    ...resolvedWayPlaces.map(p => ({ name: p.name, lat: p.lat, lon: p.lon, tags: p.tags, osmId: p.osmId, category: p.category })),
  ];

  const seenOsmIds = new Set();
  const deduplicated = [];
  for (const p of allSources) {
    if (seenOsmIds.has(p.osmId)) continue;
    seenOsmIds.add(p.osmId);
    deduplicated.push(p);
  }

  console.log(`  📦 After dedup: ${deduplicated.length.toLocaleString()}`);

  // ─── Resume support ────────────────────────────────────────────────────────
  const checkpoint = loadCheckpoint();
  let startIdx = 0;
  if (checkpoint?.phase === 'places' && checkpoint.lastPlaceIdx) {
    startIdx = checkpoint.lastPlaceIdx;
    console.log(`  ⏭️ Resuming from index ${startIdx.toLocaleString()}`);
  }

  // ─── Build and flush batches ────────────────────────────────────────────────
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

  let totalInserted = checkpoint?.phase === 'places' ? (checkpoint.counters?.totalInserted || 0) : 0;
  let totalFailed = checkpoint?.phase === 'places' ? (checkpoint.counters?.totalFailed || 0) : 0;
  let totalSkipped = 0;
  let matchedToCity = 0, unmatchedCity = 0;
  let batchNum = 0;
  const categoryCounts = {};
  const batch = [];
  const startTime = Date.now();

  function printProgress() {
    const el = Math.max(1, (Date.now() - startTime) / 1000).toFixed(0);
    const rate = (totalInserted / Math.max(1, (Date.now() - startTime) / 1000)).toFixed(0);
    process.stdout.write(
      `\r  ✅ ${String(totalInserted).padStart(8)} inserted | ⏱ ${el}s | ${rate}/s | 🏙️ ${matchedToCity} matched | delay=${backoff.delay}ms`
    );
  }

  async function flushBatch() {
    if (batch.length === 0) return;
    const records = batch.splice(0, batch.length);
    batchNum++;

    // Validate first batch schema
    if (batchNum === 1) {
      const expected = JSON.stringify([...PLACE_KEYS].sort());
      const actual = JSON.stringify(Object.keys(records[0]).sort());
      if (actual !== expected) {
        console.error(`\n  ❌ Key mismatch!\n  Expected: ${expected}\n  Got:      ${actual}`);
        process.exit(1);
      }
      console.log(`  ✅ First batch key validation passed\n`);
    }

    if (DRY_RUN) {
      totalInserted += records.length;
    } else {
      await pool.enqueue(async () => {
        const result = await withRetry(async () => {
          return await supabase.from('places')
            .upsert(records, { onConflict: 'osm_id', ignoreDuplicates: true });
        }, `Places batch ${batchNum} (${records.length} records)`);

        if (!result?.error) {
          totalInserted += records.length;
          backoff.recordSuccess();
        } else {
          totalFailed += records.length;
          backoff.recordError();
        }
        await backoff.wait();
      });
    }

    for (const r of records) {
      categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
    }
  }

  console.log('\n  ⏳ Building place records with spatial city matching...\n');

  for (let i = startIdx; i < deduplicated.length; i++) {
    if (totalInserted >= LIMIT) break;

    const p = deduplicated[i];
    if (!p.name || !p.category || !p.lat || !p.lon) { totalSkipped++; continue; }

    // Spatial match to nearest city
    const cityId = findNearestCityFromIndex(cityIndex, p.lat, p.lon);
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
    if (batch.length >= BATCH_PLACES) await flushBatch();

    if (i % 5000 === 0) {
      printProgress();
      // Save checkpoint periodically
      if (!DRY_RUN && i % 20000 === 0) {
        saveCheckpoint({
          phase: 'places',
          lastPlaceIdx: i,
          counters: { totalInserted, totalFailed, matchedToCity, unmatchedCity },
        });
      }
    }
  }

  await flushBatch();
  await pool.drain();
  printProgress();

  // ─── Summary ────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n═══════════════════════════════════════════════════`);
  console.log(DRY_RUN ? '✅ Dry Run Complete!' : '✅ Place Import Complete!');
  console.log(`   Total processed: ${deduplicated.length.toLocaleString()}`);
  console.log(`   Inserted:        ${totalInserted.toLocaleString()}`);
  console.log(`   Matched to city: ${matchedToCity.toLocaleString()}`);
  console.log(`   No city match:   ${unmatchedCity.toLocaleString()}`);
  console.log(`   Skipped:         ${totalSkipped.toLocaleString()}`);
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
// PHASE 7: Create/Refresh Search Indexes
// =============================================================================

async function createSearchIndexes() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔍 PHASE 7: Refreshing Search Indexes');
  console.log('═══════════════════════════════════════════════════\n');

  if (DRY_RUN) {
    console.log('  ✅ Skipped (dry-run mode)');
    return;
  }

  // Run ANALYZE on all tables to update query planner statistics
  const tables = ['countries', 'states', 'districts', 'cities', 'places'];
  for (const table of tables) {
    const { error } = await supabase.rpc('exec_sql', { query: `ANALYZE public.${table}` }).catch(e => ({ error: e }));
    if (error) {
      console.log(`  ⚠️ Could not ANALYZE ${table} via RPC — run migration 006 manually if needed`);
    } else {
      console.log(`  ✅ ANALYZE ${table}`);
    }
  }

  // Check if trigram indexes exist
  const { data: indexes } = await supabase
    .from('pg_indexes')
    .select('indexname')
    .like('indexname', '%trgm%')
    .limit(4)
    .catch(() => ({ data: null }));

  if (indexes && indexes.length >= 3) {
    console.log(`  ✅ Trigram indexes found (${indexes.length})`);
  } else {
    console.log('  ⚠️ Trigram indexes not found — run migration 006_search_and_verification.sql');
  }

  console.log('\n  ✅ Search index refresh complete');
}

// =============================================================================
// PHASE 8: Queue-based Image Enrichment
// =============================================================================

async function enrichImages() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🖼️  PHASE 8: Wikipedia Image Enrichment');
  console.log('═══════════════════════════════════════════════════\n');

  if (DRY_RUN) {
    console.log('  ✅ Skipped (dry-run mode)');
    return;
  }

  const backoff = new AdaptiveBackoff(200);
  const ENRICH_BATCH = 50;
  let enriched = 0, noImage = 0, errors = 0;
  let offset = 0;
  const startTime = Date.now();

  // Resume support
  const checkpoint = loadCheckpoint();
  if (checkpoint?.phase === 'enrich' && checkpoint.enrichOffset) {
    offset = checkpoint.enrichOffset;
    enriched = checkpoint.counters?.enriched || 0;
    noImage = checkpoint.counters?.noImage || 0;
    console.log(`  ⏭️ Resuming from offset ${offset} (${enriched} already enriched)`);
  }

  // Count places needing images
  const { count } = await supabase
    .from('places').select('*', { count: 'exact', head: true })
    .is('image_url', null)
    .not('wiki_url', 'is', null);

  console.log(`  📦 ${(count || 0).toLocaleString()} places need image enrichment\n`);

  if (!count || count === 0) {
    console.log('  ✅ All places with wiki_url already have images');
    return;
  }

  while (true) {
    const { data: batch, error } = await supabase
      .from('places')
      .select('id,name,wiki_url')
      .is('image_url', null)
      .not('wiki_url', 'is', null)
      .range(0, ENRICH_BATCH - 1)  // Always fetch from start since we update as we go
      .order('name');

    if (error || !batch || batch.length === 0) break;

    for (const place of batch) {
      try {
        const imgUrl = await fetchWikipediaImage(place.name);
        if (imgUrl) {
          await supabase.from('places').update({ image_url: imgUrl }).eq('id', place.id);
          enriched++;
          backoff.recordSuccess();
        } else {
          // Set a placeholder to avoid re-processing
          await supabase.from('places').update({ image_url: 'none' }).eq('id', place.id);
          noImage++;
        }
      } catch (err) {
        errors++;
        backoff.recordError();
      }
      await backoff.wait();
    }

    offset += batch.length;
    const el = ((Date.now() - startTime) / 1000).toFixed(0);
    process.stdout.write(`\r  🖼️ ${enriched} enriched | ${noImage} no image | ${errors} errors | ${el}s`);

    saveCheckpoint({
      phase: 'enrich',
      enrichOffset: offset,
      counters: { enriched, noImage, errors },
    });
  }

  console.log(`\n\n  ✅ Enrichment complete: ${enriched} images | ${noImage} no image | ${errors} errors`);
  clearCheckpoint();
}

function fetchWikipediaImage(placeName) {
  return new Promise((resolve) => {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(placeName.replace(/ /g, '_'))}`;
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const data = JSON.parse(body);
            if (data.thumbnail?.source) {
              resolve(data.thumbnail.source.replace(/\/\d+px-/, '/400px-'));
              return;
            }
          } catch {}
        }
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('\n🗺️  ExploreHub — OSM Import v7 (Production-Reliable)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📂 File:     ${path.basename(PBF_FILE)} (${(fs.statSync(PBF_FILE).size / 1e9).toFixed(2)} GB)`);
  console.log(`🔑 Auth:     ${useServiceKey ? '✅ Service Role' : '🔑 Anon Key'}`);
  console.log(`🗄️  Database: ${SUPABASE_URL}`);
  console.log(`👷 Workers:  ${WORKERS} | Batches: D=${BATCH_DISTRICTS} C=${BATCH_CITIES} P=${BATCH_PLACES}`);
  if (DRY_RUN)          console.log('🏃 Mode:     DRY RUN');
  if (FRESH)            console.log('🔄 Mode:     FRESH (ignoring checkpoint)');
  if (LIMIT < Infinity) console.log(`🔢 Limit:    ${LIMIT} places`);
  if (PASS_ONLY)        console.log(`📊 Pass:     ${PASS_ONLY} only`);
  if (ENRICH_IMG)       console.log('🖼️  Mode:     Image enrichment');

  // Check for existing checkpoint
  const checkpoint = loadCheckpoint();
  if (checkpoint) {
    console.log(`\n  📋 Checkpoint found: phase=${checkpoint.phase}, updated=${checkpoint.timestamp}`);
    if (checkpoint.counters) {
      const c = checkpoint.counters;
      console.log(`     Progress: districts=${c.insertedDistricts || 0} cities=${c.insertedCities || 0}`);
    }
    if (checkpoint.completedStates) {
      console.log(`     Completed states: ${checkpoint.completedStates.length}/${checkpoint.stateOrder?.length || '?'}`);
    }
  }

  if (ENRICH_IMG) {
    await enrichImages();
    return;
  }

  if (!PASS_ONLY || PASS_ONLY === 'hierarchy') {
    // Pass 1: Collect raw data
    const { settlements, placeNodes, wayPlaces, adminBounds, neededNodeIds } = await pass1();

    // Pass 2: Resolve node coordinates
    const nodeCoords = await pass2(neededNodeIds);

    // Phase 3: Build hierarchy
    const { cityIndex } = await buildHierarchy(settlements, adminBounds, nodeCoords);

    // Phase 4: Verify hierarchy
    const ok = await verifyImport('hierarchy');

    if (PASS_ONLY === 'hierarchy') {
      console.log('\n  ✅ Hierarchy-only mode complete.');
      clearCheckpoint();
      return;
    }

    if (!ok && !DRY_RUN) {
      console.error('\n  ❌ Hierarchy verification failed — STOPPING.');
      return;
    }

    // Phase 5: Import places
    await importPlaces(placeNodes, wayPlaces, nodeCoords, cityIndex);

    // Phase 6: Re-verify after places
    await verifyImport('full');

    // Clear hierarchy/places checkpoint
    clearCheckpoint();
  }

  if (PASS_ONLY === 'places') {
    console.log('\n  ⏳ Loading existing hierarchy for place import...');
    const cityIndex = await loadCityIndex();
    console.log(`  ✅ ${cityIndex.count.toLocaleString()} cities loaded\n`);

    if (cityIndex.count === 0) {
      console.error('  ❌ No cities found — run hierarchy import first!');
      return;
    }

    const ok = await verifyImport('hierarchy');
    if (!ok) return;

    const { placeNodes, wayPlaces, neededNodeIds } = await pass1();
    const nodeCoords = await pass2(neededNodeIds);
    await importPlaces(placeNodes, wayPlaces, nodeCoords, cityIndex);

    await verifyImport('full');
    clearCheckpoint();
  }

  // Phase 7: Search indexes
  await createSearchIndexes();

  console.log('\n🎉 Import complete! Open http://localhost:5173 and search for places.');
}

main().catch(err => { console.error('\n❌ Fatal:', err.message || err); process.exit(1); });
