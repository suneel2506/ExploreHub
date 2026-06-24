#!/usr/bin/env node
// =============================================================================
// ExploreHub — OSM Import Script v4
// =============================================================================
//
// PREREQUISITES (run ONCE in Supabase SQL Editor before this script):
//   supabase/migrations/004_nuclear_rebuild.sql
//
// The migration rebuilds all tables and adds a temporary anon INSERT policy
// so this script works WITHOUT a service role key.
//
// USAGE:
//   node scripts/import-osm.cjs                   full import
//   node scripts/import-osm.cjs --dry-run          parse + count, no DB writes
//   node scripts/import-osm.cjs --limit 2000       stop after N inserts
//   node scripts/import-osm.cjs --category Temples one category only
//
// After import finishes run in SQL Editor:
//   DROP POLICY "places_import_anon" ON public.places;
//
// =============================================================================
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY;

// ─── HTTPS agent ──────────────────────────────────────────────────────────────
// Note: keep-alive is disabled — Cloudflare aggressively closes persistent
// connections to Supabase, causing ECONNRESET. New connection per batch is safer.
const httpsAgent = new https.Agent({
  keepAlive:  false,
  maxSockets: 2,
  timeout:    30000,
});

// ─── CLI flags ────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const LIMIT      = (() => { const i = args.indexOf('--limit');    return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })();
const ONLY_CAT   = (() => { const i = args.indexOf('--category'); return i >= 0 ? args[i + 1] : null; })();
const BATCH_SIZE = 100;  // Smaller batches to avoid Supabase/Cloudflare rate limits
const INTER_BATCH_DELAY_MS = 400; // Pause between batches to prevent ECONNRESET

// ─── API key ──────────────────────────────────────────────────────────────────
const useServiceKey = SERVICE_KEY && SERVICE_KEY !== 'your-service-role-key-here';
const API_KEY       = useServiceKey ? SERVICE_KEY : ANON_KEY;

if (!SUPABASE_URL || !API_KEY) {
  console.error('\n❌ SUPABASE_URL or API key missing in .env\n');
  process.exit(1);
}

// ─── Canonical record shape ───────────────────────────────────────────────────
// PostgREST requires every object in a bulk POST to have IDENTICAL keys.
// RECORD_KEYS defines the canonical set. Every record is normalised through
// normalizeRecord() before being added to any batch.
const RECORD_KEYS = [
  'name',       // text NOT NULL
  'description',// text
  'country',    // text NOT NULL DEFAULT 'India'
  'state',      // text
  'district',   // text
  'city',       // text
  'category',   // text NOT NULL
  'place_type', // text
  'latitude',   // double precision NOT NULL
  'longitude',  // double precision NOT NULL
  'osm_id',     // bigint UNIQUE
  'source',     // text NOT NULL DEFAULT 'OpenStreetMap'
  'metadata',   // jsonb DEFAULT '{}'
];

// Sorted once for validation comparisons
const RECORD_KEYS_SORTED = [...RECORD_KEYS].sort();

/**
 * normalizeRecord: guarantee every record has exactly RECORD_KEYS.
 *
 * CRITICAL: avoids the undefined/null trap.
 *   null?.slice()  →  undefined  (optional chaining on null gives undefined)
 *   JSON.stringify silently drops keys with undefined values
 *   → different records get different key sets → PGRST102
 *
 * Solution: iterate RECORD_KEYS and replace undefined/NaN/''/null with null.
 */
function normalizeRecord(raw) {
  const out = {};
  for (const key of RECORD_KEYS) {
    let v = raw[key];
    if (v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) {
      v = null;
    }
    out[key] = (v !== undefined ? v : null);
  }
  return out;
}

/**
 * validateBatch: pre-flight check before every batch insert.
 * Compares SORTED keys of each record against SORTED RECORD_KEYS.
 * Logs exact mismatches. Returns true only if all records pass.
 */
function validateBatch(records, batchIdx) {
  const expected = JSON.stringify(RECORD_KEYS_SORTED);
  let ok = true;

  for (let i = 0; i < records.length; i++) {
    const actual = JSON.stringify(Object.keys(records[i]).sort());
    if (actual !== expected) {
      if (ok) {
        console.error(`\n  ❌ Batch ${batchIdx} key mismatch (first offending record: [${i}]):`);
        console.error(`     Expected: ${expected}`);
        console.error(`     Got:      ${actual}`);
        const missing = RECORD_KEYS_SORTED.filter((k) => !(k in records[i]));
        const extra   = Object.keys(records[i]).filter((k) => !RECORD_KEYS.includes(k));
        if (missing.length) console.error(`     Missing:  ${JSON.stringify(missing)}`);
        if (extra.length)   console.error(`     Extra:    ${JSON.stringify(extra)}`);
      }
      ok = false;
    }

    // Paranoia: check for undefined values (would be dropped by JSON.stringify)
    for (const [k, v] of Object.entries(records[i])) {
      if (v === undefined) {
        console.error(`\n  ❌ Batch ${batchIdx} record[${i}].${k} is undefined (will be dropped by JSON.stringify!)`);
        ok = false;
      }
    }
  }

  return ok;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function httpPost(urlStr, payload, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const url  = new URL(urlStr);

    const req = https.request({
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname + url.search,
      method:   'POST',
      agent:    httpsAgent,   // ← reuse TCP connection, no per-request DNS
      timeout:  30000,        // request timeout ms
      headers:  {
        ...extraHeaders,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Connection':     'keep-alive',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        } else {
          resolve(true);
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('SOCKET_TIMEOUT')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function supabaseUpsert(records) {
  return httpPost(
    `${SUPABASE_URL}/rest/v1/places?on_conflict=osm_id`,
    records,
    {
      'apikey':        API_KEY,
      'Authorization': `Bearer ${API_KEY}`,
      'Prefer':        'resolution=ignore-duplicates,return=minimal',
    }
  );
}

// Network-error codes that warrant a retry
const RETRYABLE = new Set(['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'SOCKET_TIMEOUT', 'EAI_AGAIN']);

async function upsertWithRetry(records, batchIdx, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await supabaseUpsert(records);
      return true;
    } catch (err) {
      const msg  = err.message || '';
      const code = err.code    || '';

      // 4xx = schema or auth error — no point retrying
      if (msg.startsWith('HTTP 4')) {
        process.stderr.write(`\n  ❌ Batch ${batchIdx}: schema/auth error (NOT retrying)\n  ${msg.slice(0, 500)}\n`);
        return false;
      }

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const wait  = Math.min(1000 * Math.pow(2, attempt - 1), 16000);
        const label = RETRYABLE.has(code) || msg.includes('ENOTFOUND') ? '🌐 network' : '⚠️  server';
        process.stderr.write(
          `\n  ${label} error batch ${batchIdx} (attempt ${attempt}/${maxRetries}), retrying in ${wait / 1000}s… [${code || msg.slice(0, 60)}]\n`
        );
        await new Promise((r) => setTimeout(r, wait));
      } else {
        process.stderr.write(
          `\n  ⚠️  Batch ${batchIdx} failed after ${maxRetries} attempts: ${msg.slice(0, 200)}\n`
        );
        return false;
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

// ─── Tag helpers ─────────────────────────────────────────────────────────────
// str(): always returns null or a non-empty trimmed string — never undefined.
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
  // Do NOT use optional chaining on a potentially-null value:
  //   null?.slice()  →  undefined  (BAD)
  // Use the str() helper instead which always returns null | string.
  const d = str(tags.description || tags.note);
  return d ? d.slice(0, 2000) : null;
}

function getState(tags) {
  return str(tags['addr:state'] || tags['is_in:state'] || tags['is_in:state_code']);
}

function getDistrict(tags) {
  return str(tags['addr:district'] || tags['addr:county']);
}

function getCity(tags) {
  return str(tags['addr:city'] || tags['addr:town'] || tags['addr:village']);
}

function getPlaceType(tags) {
  return str(tags.natural || tags.tourism || tags.historic || tags.leisure || tags.amenity || tags.place);
}

function categorize(tags) {
  if (tags.natural === 'waterfall')                          return 'Waterfalls';
  if (tags.natural === 'beach')                              return 'Beaches';
  if (tags.natural === 'bay'  || tags.natural === 'cape')   return 'Beaches';
  if (tags.natural === 'peak' || tags.natural === 'volcano') return 'Mountains';
  if (tags.natural === 'lake' || tags.natural === 'water')  return 'Lakes';
  if (tags.natural === 'forest')                             return 'Forests';
  if (tags.natural === 'cave_entrance')                      return 'Caves';
  if (tags.natural === 'hot_spring')                         return 'Attractions';
  if (tags.natural === 'cliff')                              return 'Viewpoints';
  if (tags.tourism === 'attraction')                         return 'Attractions';
  if (tags.tourism === 'museum')                             return 'Museums';
  if (tags.tourism === 'viewpoint')                          return 'Viewpoints';
  if (tags.tourism === 'zoo')                                return 'Wildlife';
  if (tags.tourism === 'aquarium')                           return 'Wildlife';
  if (tags.tourism === 'theme_park')                         return 'Attractions';
  if (tags.tourism === 'artwork')                            return 'Attractions';
  if (tags.tourism === 'gallery')                            return 'Museums';
  if (tags.leisure === 'nature_reserve')                     return 'National Parks';
  if (tags.leisure === 'park')                               return 'Parks';
  if (tags.leisure === 'garden')                             return 'Parks';
  if (tags.historic === 'monument')                          return 'Historical';
  if (tags.historic === 'castle')                            return 'Historical';
  if (tags.historic === 'ruins')                             return 'Historical';
  if (tags.historic === 'fort')                              return 'Historical';
  if (tags.historic === 'palace')                            return 'Historical';
  if (tags.historic === 'archaeological_site')               return 'Historical';
  if (tags.historic === 'memorial')                          return 'Historical';
  if (tags.historic === 'temple')                            return 'Temples';
  if (tags.historic === 'mosque')                            return 'Temples';
  if (tags.historic === 'church')                            return 'Historical';
  if (tags.historic === 'lighthouse')                        return 'Attractions';
  if (tags.historic === 'battleground')                      return 'Historical';
  if (tags.historic === 'yes')                               return 'Historical';
  if (tags.amenity  === 'place_of_worship')                  return 'Temples';
  if (tags.place    === 'city')                              return 'Cities';
  if (tags.place    === 'town')                              return 'Cities';
  if (tags.place    === 'village')                           return 'Villages';
  if (tags.place    === 'hamlet')                            return 'Villages';
  return null;
}

function isRelevant(tags) {
  if (!getName(tags)) return false;
  if (tags.tourism   === 'information')   return false;
  if (tags.natural   === 'tree')          return false;
  if (tags.amenity   === 'parking')       return false;
  if (tags.amenity   === 'bench')         return false;
  if (tags.place     === 'suburb')        return false;
  if (tags.place     === 'neighbourhood') return false;
  if (tags.highway)                       return false;
  if (tags.power)                         return false;
  if (tags.railway && tags.railway !== 'station') return false;
  return categorize(tags) !== null;
}

/**
 * buildRecord: converts an OSM node to a normalised DB record.
 * Always calls normalizeRecord() at the end to guarantee key consistency.
 */
function buildRecord(item) {
  const tags     = item.tags || {};
  const name     = getName(tags);
  const category = categorize(tags);
  if (!name || !category) return null;
  if (ONLY_CAT && category !== ONLY_CAT) return null;

  // Compact metadata: keep at most 12 tags, skip redundant name:XX variants
  const metaTags = {};
  let count = 0;
  for (const [k, v] of Object.entries(tags)) {
    if (count >= 12) break;
    if (/^name:[a-z]{2,4}$/.test(k) && k !== 'name:en') continue;
    metaTags[k] = v;
    count++;
  }

  // Build raw record — all values must be null | string | number | object
  // getDescription() uses str() so it's always null | string (never undefined)
  const raw = {
    name:        name.slice(0, 500),
    description: getDescription(tags),      // null | string
    country:     'India',
    state:       getState(tags),            // null | string
    district:    getDistrict(tags),         // null | string
    city:        getCity(tags),             // null | string
    category,                              // string
    place_type:  getPlaceType(tags),       // null | string
    latitude:    item.lat,                 // number
    longitude:   item.lon,                 // number
    osm_id:      item.id,                  // number
    source:      'OpenStreetMap',
    metadata:    { tags: metaTags },       // object
  };

  // normalizeRecord guarantees identical key order and no undefined values
  return normalizeRecord(raw);
}

// ─── State ────────────────────────────────────────────────────────────────────
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

// ─── Progress & summary ───────────────────────────────────────────────────────
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

function printSummary() {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const verb    = DRY_RUN ? 'Would insert' : 'Inserted    ';
  console.log('\n\n═══════════════════════════════════════════════════');
  console.log(DRY_RUN ? '✅ Dry Run Complete!' : '✅ Import Complete!');
  console.log(`   Nodes scanned:   ${totalNodes.toLocaleString()}`);
  console.log(`   Relevant places: ${totalRelevant.toLocaleString()}`);
  console.log(`   ${verb}:  ${totalInserted.toLocaleString()}`);
  if (totalFailed > 0) console.log(`   ⚠️  Failed:       ${totalFailed.toLocaleString()}`);
  console.log(`   Time:            ${elapsed}s`);
  if (Object.keys(categoryCounts).length > 0) {
    console.log('\n   By Category:');
    Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .forEach(([cat, cnt]) => console.log(`     ${cat.padEnd(20)} ${cnt.toLocaleString()}`));
  }
  console.log('═══════════════════════════════════════════════════\n');

  if (!DRY_RUN && totalInserted === 0) {
    console.log('⚠️  Zero inserts. Checklist:');
    console.log('   1. Run 004_nuclear_rebuild.sql in Supabase SQL Editor first');
    console.log('   2. Confirm no error in the SQL Editor output');
    console.log('   3. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env\n');
  }

  if (!DRY_RUN && totalInserted > 0) {
    console.log('🎉 Next steps:');
    console.log('   1. Open http://localhost:5173 and search for Chennai, Ooty, etc.');
    console.log('   2. After verifying, drop the temp policy in SQL Editor:');
    console.log('      DROP POLICY "places_import_anon" ON public.places;\n');
  }
}

// ─── Batch flush ──────────────────────────────────────────────────────────────
async function flushBatch() {
  if (batch.length === 0) return;
  const records = batch.splice(0, batch.length);
  batchIndex++;

  // First-batch diagnostics (only once)
  if (firstBatch) {
    firstBatch = false;
    console.log(`\n  📦 First batch: ${records.length} records`);
    console.log(`  📋 Keys:        ${JSON.stringify(Object.keys(records[0]))}`);
    const valid = validateBatch(records, batchIndex);
    if (!valid) {
      console.error('\n  ❌ Key validation failed — aborting. This is a script bug, please report it.');
      process.exit(1);
    }
    console.log(`  ✅ Key validation passed — all ${records.length} records have identical keys\n`);
  }

  if (DRY_RUN) {
    totalInserted += records.length;
  } else {
    const ok = await upsertWithRetry(records, batchIndex);
    if (ok) totalInserted += records.length;
    else    totalFailed   += records.length;
    // Throttle to prevent Supabase/Cloudflare ECONNRESET under sustained load
    await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
  }

  for (const r of records) {
    categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
  }
}

// ─── Banner ───────────────────────────────────────────────────────────────────
console.log('\n🗺️  ExploreHub — OSM Import v4');
console.log('═══════════════════════════════════════════════════');
console.log(`📂 File:     ${path.basename(PBF_FILE)} (${(fs.statSync(PBF_FILE).size / 1e9).toFixed(2)} GB)`);
console.log(`🔑 Auth:     ${useServiceKey ? '✅ Service Role (RLS bypassed)' : '🔑 Anon Key (migration 004 grants INSERT)'}`);
console.log(`🗄️  Database: ${SUPABASE_URL}`);
if (DRY_RUN)          console.log('🏃 Mode:     DRY RUN (no DB writes)');
if (LIMIT < Infinity)  console.log(`🔢 Limit:    ${LIMIT} places`);
if (ONLY_CAT)          console.log(`🏷️  Category: ${ONLY_CAT}`);
console.log('\n📋 Record keys (sent on every insert):');
console.log(`   ${RECORD_KEYS.join(', ')}`);
console.log('\n⏳ Streaming OSM file...\n');

// ─── Stream ───────────────────────────────────────────────────────────────────
const parse   = require('osm-pbf-parser');
const through = require('through2');

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

        const record = buildRecord(item);
        if (!record) continue;

        totalRelevant++;
        batch.push(record);

        if (batch.length >= BATCH_SIZE) {
          await flushBatch();
        }

        if (totalInserted >= LIMIT && !limitReached) {
          limitReached = true;
          await flushBatch();
          printProgress();
          printSummary();
          process.exit(0);
        }

        if (totalNodes % 100000 === 0) printProgress();
      }
      next();
    })
  )
  .on('finish', async () => {
    await flushBatch();
    printProgress();
    printSummary();
  })
  .on('error', (err) => {
    console.error('\n❌ Stream error:', err.message);
    process.exit(1);
  });
