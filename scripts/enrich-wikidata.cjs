#!/usr/bin/env node
// =============================================================================
// ExploreHub — Wikidata Enrichment Script
// =============================================================================
//
// Enriches places with Wikidata metadata:
//   - population, elevation, official_website, heritage_status
//   - opening_date, instance_of, country, admin_entity
//   - Commons image, aliases, coordinates
//   - Saves to place_metadata table
//   - Saves images to place_images table
//   - Auto-assigns tags based on instance_of
//   - Caches API responses in api_cache
//
// USAGE:
//   node scripts/enrich-wikidata.cjs                   Enrich all
//   node scripts/enrich-wikidata.cjs --limit 500       Process 500 max
//   node scripts/enrich-wikidata.cjs --batch-size 50   DB batch size
//   node scripts/enrich-wikidata.cjs --delay 200       Delay between API calls
//   node scripts/enrich-wikidata.cjs --category Temples Only specific category
//   node scripts/enrich-wikidata.cjs --dry-run         Preview mode
//   node scripts/enrich-wikidata.cjs --resume          Resume from checkpoint
//   node scripts/enrich-wikidata.cjs --fresh           Ignore cache
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

// ─── CLI Flags ────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const FRESH      = args.includes('--fresh');
const RESUME     = args.includes('--resume');
const LIMIT      = (() => { const i = args.indexOf('--limit');      return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })();
const BATCH_SIZE = (() => { const i = args.indexOf('--batch-size'); return i >= 0 ? parseInt(args[i + 1], 10) : 50; })();
const DELAY_MS   = (() => { const i = args.indexOf('--delay');      return i >= 0 ? parseInt(args[i + 1], 10) : 200; })();
const CATEGORY   = (() => { const i = args.indexOf('--category');   return i >= 0 ? args[i + 1] : null; })();
const CACHE_DAYS = 30;

const useServiceKey = SERVICE_KEY && SERVICE_KEY !== 'your-service-role-key-here';
const API_KEY       = useServiceKey ? SERVICE_KEY : ANON_KEY;
if (!SUPABASE_URL || !API_KEY) { console.error('\n❌ Missing env vars\n'); process.exit(1); }

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, API_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Checkpoint ───────────────────────────────────────────────────────────────
const CHECKPOINT_FILE = path.join(__dirname, '.enrich-wikidata-checkpoint.json');
function saveCheckpoint(data) {
  data.timestamp = new Date().toISOString();
  const tmp = CHECKPOINT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try { fs.renameSync(tmp, CHECKPOINT_FILE); }
  catch { fs.copyFileSync(tmp, CHECKPOINT_FILE); try { fs.unlinkSync(tmp); } catch {} }
}
function loadCheckpoint() {
  if (!RESUME) return null;
  if (!fs.existsSync(CHECKPOINT_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')); } catch { return null; }
}
function clearCheckpoint() {
  try { if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE); } catch {}
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
function httpGet(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve({ data: JSON.parse(body), error: null }); }
          catch (e) { resolve({ data: null, error: `JSON parse: ${e.message}` }); }
        } else if (res.statusCode === 404) {
          resolve({ data: null, error: null });
        } else {
          resolve({ data: null, error: `HTTP ${res.statusCode}` });
        }
      });
    });
    req.on('error', (e) => resolve({ data: null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ data: null, error: 'timeout' }); });
  });
}

// ─── Cache ────────────────────────────────────────────────────────────────────
async function getCached(key) {
  if (FRESH) return null;
  const { data } = await supabase
    .from('api_cache').select('response_data')
    .eq('cache_key', key).gt('expires_at', new Date().toISOString())
    .limit(1).single();
  return data?.response_data || null;
}

async function setCache(key, source, responseData) {
  if (DRY_RUN) return;
  await supabase.from('api_cache').upsert({
    cache_key: key, source, response_data: responseData,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + CACHE_DAYS * 86400000).toISOString(),
    hit_count: 0,
  }, { onConflict: 'cache_key' });
}

// ─── Wikidata Property Extractors ─────────────────────────────────────────────
// Common Wikidata properties for places
const WIKIDATA_PROPS = {
  P31:   'instance_of',
  P17:   'country',
  P131:  'admin_entity',
  P18:   'image',
  P373:  'commons_category',
  P856:  'official_website',
  P625:  'coordinates',
  P1082: 'population',
  P2044: 'elevation',
  P1435: 'heritage_status',
  P1619: 'opening_date',
  P2046: 'area',
  P1566: 'geonames_id',
};

// Heritage designation labels
const HERITAGE_MAP = {
  'Q9259':      'UNESCO World Heritage Site',
  'Q43113623':  'UNESCO World Heritage Site (Tentative)',
  'Q15700834':  'ASI Protected Monument',
  'Q1459902':   'National Monument',
  'Q1435952':   'State Protected Monument',
  'Q358':       'World Heritage Site',
  'Q210272':    'Cultural Heritage',
  'Q5765951':   'Cultural Property',
};

// Instance_of → tag mapping
const INSTANCE_TAG_MAP = {
  'Q9259':    'UNESCO',
  'Q358':     'UNESCO',
  'Q839954':  'Heritage',     // archaeological site
  'Q5107':    'Nature',       // continent (geographic)
  'Q23397':   'Lakes',
  'Q34038':   'Waterfalls',
  'Q8502':    'Mountains',
  'Q4022':    'Nature',       // river
  'Q39816':   'Nature',       // valley
  'Q15324':   'Beaches',
  'Q22698':   'Parks',        // park
  'Q46169':   'National Parks',
  'Q33506':   'Museums',
  'Q16970':   'Temples',      // Hindu temple
  'Q44613':   'Monasteries',  // Buddhist monastery
  'Q32815':   'Mosques',
  'Q16560':   'Churches',     // cathedral/church
  'Q57821':   'Forts',
  'Q23413':   'Forts',        // castle
  'Q4989906': 'Monuments',    // monument
  'Q174782':  'Viewpoints',   // viewpoint
  'Q194195':  'Caves',
  'Q40080':   'Beaches',      // beach
  'Q23442':   'Islands',
  'Q12323':   'Dams',
  'Q134447':  'Bridges',      // bridge (structural)
  'Q94993':   'Wildlife',     // wildlife sanctuary
  'Q1195942': 'Wildlife',     // bird sanctuary
};

/**
 * Extract a simple value from a Wikidata claim.
 */
function getClaimValue(claims, prop) {
  const claim = claims[prop];
  if (!claim || claim.length === 0) return null;
  const snak = claim[0]?.mainsnak;
  if (!snak?.datavalue) return null;
  return snak.datavalue.value;
}

function getClaimString(claims, prop) {
  const val = getClaimValue(claims, prop);
  if (typeof val === 'string') return val;
  if (val?.text) return val.text;
  if (val?.id) return val.id;
  return null;
}

function getClaimNumber(claims, prop) {
  const val = getClaimValue(claims, prop);
  if (typeof val === 'number') return val;
  if (val?.amount) return parseFloat(val.amount);
  return null;
}

function getCoordinates(claims) {
  const val = getClaimValue(claims, 'P625');
  if (val?.latitude && val?.longitude) {
    return { lat: val.latitude, lon: val.longitude };
  }
  return null;
}

function getCommonsImage(claims) {
  const filename = getClaimString(claims, 'P18');
  if (!filename) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename.replace(/ /g, '_'))}?width=600`;
}

function getInstanceOf(claims) {
  const claim = claims['P31'];
  if (!claim) return [];
  return claim
    .map(c => c?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean)
    .slice(0, 10);
}

function getHeritageStatus(claims) {
  const claim = claims['P1435'];
  if (!claim || claim.length === 0) return null;
  const heritageId = claim[0]?.mainsnak?.datavalue?.value?.id;
  return HERITAGE_MAP[heritageId] || (heritageId ? 'Heritage Site' : null);
}

// ─── Resolve Wikidata Entity ──────────────────────────────────────────────────

async function fetchWikidataEntity(wikidataId) {
  const cacheKey = `wikidata:entity:${wikidataId}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&props=labels|aliases|claims|sitelinks&languages=en&format=json`;
  const { data } = await httpGet(url);

  if (!data?.entities?.[wikidataId]) return null;
  const entity = data.entities[wikidataId];

  await setCache(cacheKey, 'wikidata', entity);
  return entity;
}

async function searchWikidata(name) {
  const cacheKey = `wikidata:search:${name}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&limit=5&format=json`;
  const { data } = await httpGet(url);

  if (!data?.search?.length) return null;

  // Prefer location-related results
  const locationTerms = ['temple', 'fort', 'monument', 'city', 'village', 'town', 'district',
    'river', 'lake', 'mountain', 'beach', 'park', 'museum', 'heritage', 'india',
    'historical', 'tourist', 'attraction', 'waterfall', 'cave', 'dam', 'island',
    'church', 'mosque', 'monastery', 'national park', 'forest', 'wildlife'];

  const best = data.search.find(s => {
    const desc = (s.description || '').toLowerCase();
    return locationTerms.some(t => desc.includes(t));
  }) || data.search[0];

  const result = { id: best.id, label: best.label, description: best.description };
  await setCache(cacheKey, 'wikidata', result);
  return result;
}

// ─── Tag Assignment ───────────────────────────────────────────────────────────

async function assignTags(placeId, instanceOfIds) {
  if (DRY_RUN || !instanceOfIds?.length) return;

  // Map instance_of QIDs to tag names
  const tagNames = [];
  for (const qid of instanceOfIds) {
    if (INSTANCE_TAG_MAP[qid]) {
      tagNames.push(INSTANCE_TAG_MAP[qid]);
    }
  }

  if (tagNames.length === 0) return;

  // Fetch category IDs
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .in('name', [...new Set(tagNames)]);

  if (!categories?.length) return;

  // Insert tags
  const tags = categories.map(c => ({
    place_id: placeId,
    category_id: c.id,
    source: 'wikidata',
  }));

  await supabase
    .from('place_tags')
    .upsert(tags, { onConflict: 'place_id,category_id' });
}

// ─── Enrich a Single Place ────────────────────────────────────────────────────

async function enrichPlace(place) {
  const enrichedFields = [];

  // Check if source is stale
  if (!FRESH) {
    const { data: src } = await supabase
      .from('place_sources').select('next_fetch_after,status')
      .eq('place_id', place.id).eq('source_name', 'wikidata')
      .limit(1).single();
    if (src && src.status !== 'error' && new Date(src.next_fetch_after) > new Date()) {
      return { status: 'skipped', reason: 'cache_fresh', fields: [] };
    }
  }

  // ── Resolve Wikidata ID ─────────────────────────────────────────────────
  let wikidataId = place.wikidata_id;

  // Strategy 1: From wiki_url via Wikipedia API
  if (!wikidataId && place.wiki_url) {
    const match = place.wiki_url.match(/wikipedia\.org\/wiki\/(.+)$/);
    if (match) {
      const title = match[1];
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`;
      const { data } = await httpGet(summaryUrl);
      if (data?.wikibase_item) {
        wikidataId = data.wikibase_item;
      }
      await sleep(DELAY_MS);
    }
  }

  // Strategy 2: Search Wikidata by name
  if (!wikidataId && place.name) {
    const searchResult = await searchWikidata(place.name);
    if (searchResult?.id) {
      wikidataId = searchResult.id;
    }
    await sleep(DELAY_MS);
  }

  if (!wikidataId) {
    if (!DRY_RUN) {
      await supabase.from('place_sources').upsert({
        place_id: place.id, source_name: 'wikidata',
        status: 'not_found', last_fetched: new Date().toISOString(),
        next_fetch_after: new Date(Date.now() + CACHE_DAYS * 86400000).toISOString(),
      }, { onConflict: 'place_id,source_name' });
    }
    return { status: 'not_found', reason: 'no_wikidata_id', fields: [] };
  }

  // ── Fetch entity ────────────────────────────────────────────────────────
  const entity = await fetchWikidataEntity(wikidataId);
  await sleep(DELAY_MS);

  if (!entity) {
    return { status: 'not_found', reason: 'entity_fetch_failed', fields: [] };
  }

  const claims = entity.claims || {};

  // ── Extract metadata ────────────────────────────────────────────────────
  const metadata = {
    place_id: place.id,
    population: getClaimNumber(claims, 'P1082'),
    elevation: getClaimNumber(claims, 'P2044'),
    official_website: getClaimString(claims, 'P856'),
    heritage_status: getHeritageStatus(claims),
    opening_date: getClaimString(claims, 'P1619'),
    instance_of: getInstanceOf(claims),
    country: getClaimString(claims, 'P17'),
    admin_entity: getClaimString(claims, 'P131'),
    commons_image: getCommonsImage(claims),
    commons_category: getClaimString(claims, 'P373'),
    raw_wikidata: { claims_summary: Object.keys(claims) },
  };

  // ── Save metadata ──────────────────────────────────────────────────────
  if (!DRY_RUN) {
    const { error } = await supabase
      .from('place_metadata')
      .upsert(metadata, { onConflict: 'place_id' });

    if (error) {
      console.error(`\n  ❌ Metadata upsert failed for ${place.name}: ${error.message}`);
    } else {
      enrichedFields.push('metadata');
    }
  }

  // ── Save Commons image to place_images ──────────────────────────────────
  if (metadata.commons_image && !DRY_RUN) {
    await supabase.from('place_images').upsert({
      place_id: place.id,
      url: metadata.commons_image,
      source: 'wikimedia',
      priority: 2,
      is_primary: false,
    }, { onConflict: 'place_id,url' });
    enrichedFields.push('commons_image');
  }

  // ── Update places table ─────────────────────────────────────────────────
  if (!DRY_RUN) {
    const placeUpdates = {};

    if (!place.wikidata_id) placeUpdates.wikidata_id = wikidataId;

    // Extract aliases from Wikidata
    if (entity.aliases?.en && (!place.aliases || place.aliases.length === 0)) {
      placeUpdates.aliases = entity.aliases.en.map(a => a.value).slice(0, 10);
    }

    // Official name from labels
    if (!place.official_name && entity.labels?.en?.value) {
      placeUpdates.official_name = entity.labels.en.value;
    }

    // Heritage status
    if (!place.heritage_status && metadata.heritage_status) {
      placeUpdates.heritage_status = metadata.heritage_status;
    }

    // Image from Commons if missing
    if (!place.image_url && metadata.commons_image) {
      placeUpdates.image_url = metadata.commons_image;
      placeUpdates.image_source = 'wikimedia';
    }

    if (Object.keys(placeUpdates).length > 0) {
      await supabase.from('places').update(placeUpdates).eq('id', place.id);
      enrichedFields.push(...Object.keys(placeUpdates));
    }
  }

  // ── Assign tags based on instance_of ────────────────────────────────────
  if (metadata.instance_of?.length > 0) {
    await assignTags(place.id, metadata.instance_of);
    enrichedFields.push('tags');
  }

  // ── Update place_sources ────────────────────────────────────────────────
  if (!DRY_RUN) {
    await supabase.from('place_sources').upsert({
      place_id: place.id,
      source_name: 'wikidata',
      source_id: wikidataId,
      source_url: `https://www.wikidata.org/wiki/${wikidataId}`,
      status: 'success',
      last_fetched: new Date().toISOString(),
      next_fetch_after: new Date(Date.now() + CACHE_DAYS * 86400000).toISOString(),
    }, { onConflict: 'place_id,source_name' });
  }

  return { status: 'enriched', fields: enrichedFields };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔬 ExploreHub — Wikidata Enrichment Script');
  console.log('═══════════════════════════════════════════════════');
  console.log(`🔑 Auth:       ${useServiceKey ? '✅ Service Role' : '🔑 Anon Key'}`);
  console.log(`🗄️  Database:   ${SUPABASE_URL}`);
  console.log(`📦 Batch size: ${BATCH_SIZE}`);
  console.log(`⏱️  Delay:      ${DELAY_MS}ms`);
  if (DRY_RUN)          console.log('🏃 Mode:       DRY RUN');
  if (FRESH)            console.log('🔄 Mode:       FRESH');
  if (LIMIT < Infinity) console.log(`🔢 Limit:      ${LIMIT}`);
  if (CATEGORY)         console.log(`📂 Category:   ${CATEGORY}`);

  let countQuery = supabase.from('places').select('*', { count: 'exact', head: true });
  if (CATEGORY) countQuery = countQuery.eq('category', CATEGORY);
  const { count: totalPlaces } = await countQuery;
  const toProcess = Math.min(totalPlaces || 0, LIMIT);

  console.log(`\n  📊 ${(totalPlaces || 0).toLocaleString()} total places`);
  console.log(`  📊 Will process up to: ${toProcess.toLocaleString()}\n`);

  if (toProcess === 0) { console.log('  ✅ Nothing to enrich!'); return; }

  let processed = 0, enriched = 0, skipped = 0, notFound = 0, errors = 0;
  const startTime = Date.now();

  const checkpoint = loadCheckpoint();
  if (checkpoint) {
    processed = checkpoint.processed || 0;
    enriched = checkpoint.enriched || 0;
    skipped = checkpoint.skipped || 0;
    notFound = checkpoint.notFound || 0;
    errors = checkpoint.errors || 0;
    console.log(`  ⏭️ Resuming from ${processed}\n`);
  }

  let offset = processed;
  while (processed < toProcess) {
    let batchQuery = supabase
      .from('v_places_full')
      .select('id, name, description, image_url, wiki_url, wikidata_id, wikipedia_title, category, osm_id, aliases, official_name, heritage_status, image_source')
      .order('name')
      .range(offset, offset + BATCH_SIZE - 1);
    if (CATEGORY) batchQuery = batchQuery.eq('category', CATEGORY);

    const { data: batch, error: batchError } = await batchQuery;
    if (batchError) { errors++; await sleep(5000); continue; }
    if (!batch || batch.length === 0) { console.log('\n  ✅ Done'); break; }

    offset += batch.length;

    for (const place of batch) {
      if (processed >= toProcess) break;
      try {
        const result = await enrichPlace(place);
        processed++;
        if (result.status === 'enriched') {
          enriched++;
          process.stdout.write(`\r  ✨ [${processed}/${toProcess}] ${place.name.substring(0, 35).padEnd(35)} → ${result.fields.join(', ')}`);
        } else if (result.status === 'not_found') { notFound++; }
        else { skipped++; }
      } catch (err) {
        errors++;
        console.error(`\n  ❌ ${place.name}: ${err.message}`);
      }

      if (processed % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        process.stdout.write(`\r  📊 ${processed}/${toProcess} | ✨${enriched} | ⏭️${skipped} | 🔍${notFound} | ❌${errors} | ${elapsed}s     `);
      }
      if (processed % 50 === 0) saveCheckpoint({ processed, enriched, skipped, notFound, errors });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n  ═══════════════════════════════════════════════════`);
  console.log(`  ✅ Wikidata enrichment complete!`);
  console.log(`  📊 Processed: ${processed} | ✨ ${enriched} | ⏭️ ${skipped} | 🔍 ${notFound} | ❌ ${errors}`);
  console.log(`  ⏱️  Time: ${elapsed}s`);
  console.log(`  ═══════════════════════════════════════════════════\n`);
  clearCheckpoint();
}

main().catch(err => { console.error('\n❌ Fatal:', err.message || err); process.exit(1); });
