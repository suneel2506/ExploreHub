#!/usr/bin/env node
// =============================================================================
// ExploreHub — Place Enrichment Script
// =============================================================================
//
// Enriches existing places with data from Wikidata, Wikipedia, and Wikimedia
// Commons. Designed to be incremental, idempotent, and resumable.
//
// ARCHITECTURE:
//   1. Query places that need enrichment (enriched_at IS NULL)
//   2. For each place, look up Wikidata via wiki_url or name search
//   3. Fetch description from Wikipedia if missing
//   4. Resolve best image from Wikimedia Commons or Wikipedia
//   5. Batch UPDATE to Supabase
//   6. Log each fetch to enrichment_log for deduplication
//
// USAGE:
//   node scripts/enrich-places.cjs                    Enrich all unenriched places
//   node scripts/enrich-places.cjs --limit 1000        Process 1000 places max
//   node scripts/enrich-places.cjs --batch-size 50     Fetch batch size from DB
//   node scripts/enrich-places.cjs --delay 200         Delay (ms) between API calls
//   node scripts/enrich-places.cjs --fresh             Re-enrich all (ignore enriched_at)
//   node scripts/enrich-places.cjs --category Temples  Only enrich specific category
//   node scripts/enrich-places.cjs --dry-run           Preview without writing to DB
//   node scripts/enrich-places.cjs --resume             Resume from checkpoint
//
// RATE LIMITS:
//   - Wikidata API: ~200 req/s (generous), we default to ~5 req/s to be safe
//   - Wikipedia REST API: similar
//   - Wikimedia Commons: similar
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

// Current enrichment schema version — bump this to re-enrich all
const ENRICHMENT_VERSION = 1;

// ─── API Key ──────────────────────────────────────────────────────────────────
const useServiceKey = SERVICE_KEY && SERVICE_KEY !== 'your-service-role-key-here';
const API_KEY       = useServiceKey ? SERVICE_KEY : ANON_KEY;

if (!SUPABASE_URL || !API_KEY) {
  console.error('\n❌ SUPABASE_URL or API key missing in .env\n');
  process.exit(1);
}

// ─── Supabase Client ──────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, API_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

// ─── Utilities ────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Checkpoint System ────────────────────────────────────────────────────────
const CHECKPOINT_FILE = path.join(__dirname, '.enrich-checkpoint.json');

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
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')); }
  catch { return null; }
}

function clearCheckpoint() {
  try { if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE); } catch {}
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
// Makes HTTPS GET requests with timeout and JSON parsing.
function httpGet(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve({ data: JSON.parse(body), error: null }); }
          catch (e) { resolve({ data: null, error: `JSON parse error: ${e.message}` }); }
        } else if (res.statusCode === 404) {
          resolve({ data: null, error: null }); // Not found is not an error
        } else {
          resolve({ data: null, error: `HTTP ${res.statusCode}` });
        }
      });
    });
    req.on('error', (e) => resolve({ data: null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ data: null, error: 'timeout' }); });
  });
}

// ─── Wikidata Lookup ──────────────────────────────────────────────────────────
// Looks up a place on Wikidata by its Wikipedia URL or by name search.
// Returns: { wikidataId, aliases, officialName, heritageStatus, commonsImage, wikipediaTitle }

async function lookupWikidata(place) {
  const result = {
    wikidataId: null,
    aliases: [],
    officialName: null,
    heritageStatus: null,
    commonsImage: null,
    wikipediaTitle: null,
  };

  let wikidataId = null;

  // Strategy 1: Extract from wiki_url (most reliable)
  if (place.wiki_url) {
    const match = place.wiki_url.match(/wikipedia\.org\/wiki\/(.+)$/);
    if (match) {
      const title = decodeURIComponent(match[1].replace(/_/g, ' '));
      // Use Wikipedia API to get the Wikidata item
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(match[1])}`;
      const { data } = await httpGet(url);
      if (data?.wikibase_item) {
        wikidataId = data.wikibase_item;
        result.wikipediaTitle = data.title || title;
      }
    }
  }

  // Strategy 2: Search Wikidata by name
  if (!wikidataId && place.name) {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(place.name)}&language=en&limit=3&format=json`;
    const { data } = await httpGet(searchUrl);
    if (data?.search?.length > 0) {
      // Pick the best match — prefer items with descriptions containing location-related terms
      const locationTerms = ['temple', 'fort', 'monument', 'city', 'village', 'town', 'district',
                              'river', 'lake', 'mountain', 'beach', 'park', 'museum', 'heritage',
                              'india', 'historical', 'tourist', 'attraction', 'waterfall', 'cave',
                              'dam', 'island', 'church', 'mosque', 'monastery'];
      const best = data.search.find(s => {
        const desc = (s.description || '').toLowerCase();
        return locationTerms.some(t => desc.includes(t));
      }) || data.search[0];

      wikidataId = best.id;
      if (!result.wikipediaTitle) {
        result.wikipediaTitle = best.label || null;
      }
    }
  }

  if (!wikidataId) return result;
  result.wikidataId = wikidataId;

  // Fetch full Wikidata entity
  await sleep(DELAY_MS); // Rate limiting
  const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&props=labels|aliases|claims|sitelinks&languages=en&format=json`;
  const { data: entityData } = await httpGet(entityUrl);

  if (!entityData?.entities?.[wikidataId]) return result;
  const entity = entityData.entities[wikidataId];

  // Extract aliases
  if (entity.aliases?.en) {
    result.aliases = entity.aliases.en.map(a => a.value).slice(0, 10); // Cap at 10
  }

  // Extract official name from labels
  if (entity.labels?.en?.value) {
    result.officialName = entity.labels.en.value;
  }

  // Extract heritage status (P1435 = heritage designation)
  const heritageClaims = entity.claims?.P1435;
  if (heritageClaims?.length > 0) {
    // Try to get the heritage designation label
    const heritageId = heritageClaims[0]?.mainsnak?.datavalue?.value?.id;
    if (heritageId) {
      // Map common heritage IDs
      const heritageMap = {
        'Q9259': 'UNESCO World Heritage Site',
        'Q43113623': 'UNESCO World Heritage Site (Tentative)',
        'Q15700834': 'ASI Protected Monument',
        'Q1459902': 'National Monument',
        'Q1435952': 'State Protected Monument',
      };
      result.heritageStatus = heritageMap[heritageId] || 'Heritage Site';
    }
  }

  // Extract Wikimedia Commons image (P18 = image)
  const imageClaims = entity.claims?.P18;
  if (imageClaims?.length > 0) {
    const filename = imageClaims[0]?.mainsnak?.datavalue?.value;
    if (filename) {
      result.commonsImage = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename.replace(/ /g, '_'))}?width=600`;
    }
  }

  // Extract Wikipedia title from sitelinks if not already found
  if (!result.wikipediaTitle && entity.sitelinks?.enwiki) {
    result.wikipediaTitle = entity.sitelinks.enwiki.title;
  }

  return result;
}

// ─── Wikipedia Description Fetch ──────────────────────────────────────────────
// Fetches a short extract from Wikipedia for use as description.

async function fetchWikipediaDescription(titleOrName) {
  if (!titleOrName) return null;
  const encoded = encodeURIComponent(titleOrName.replace(/ /g, '_'));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  const { data } = await httpGet(url);
  if (data?.extract) {
    // Truncate to 500 chars for storage
    return data.extract.length > 500
      ? data.extract.substring(0, 497) + '...'
      : data.extract;
  }
  return null;
}

// ─── Wikipedia Image Fetch ────────────────────────────────────────────────────
// Fetches the thumbnail image from Wikipedia's REST API.

async function fetchWikipediaImage(titleOrName) {
  if (!titleOrName) return null;
  const encoded = encodeURIComponent(titleOrName.replace(/ /g, '_'));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  const { data } = await httpGet(url);
  if (data?.thumbnail?.source) {
    // Bump to 600px for better quality
    return data.thumbnail.source.replace(/\/\d+px-/, '/600px-');
  }
  return null;
}

// ─── Enrichment Log Helpers ───────────────────────────────────────────────────

async function isAlreadyFetched(placeId, source) {
  const { data } = await supabase
    .from('enrichment_log')
    .select('id')
    .eq('place_id', placeId)
    .eq('source', source)
    .limit(1);
  return data && data.length > 0;
}

async function logEnrichment(placeId, source, status, errorMsg = null) {
  if (DRY_RUN) return;
  await supabase
    .from('enrichment_log')
    .upsert({
      place_id: placeId,
      source,
      status,
      error_msg: errorMsg,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'place_id,source' });
}

// ─── Enrich a Single Place ────────────────────────────────────────────────────

async function enrichPlace(place) {
  const updates = {};
  let wikidataFetched = false;
  let wikipediaFetched = false;
  let imageFetched = false;

  // ── Step 1: Wikidata lookup ─────────────────────────────────────────────
  if (!await isAlreadyFetched(place.id, 'wikidata')) {
    try {
      const wd = await lookupWikidata(place);
      wikidataFetched = true;

      if (wd.wikidataId)     updates.wikidata_id = wd.wikidataId;
      if (wd.officialName)   updates.official_name = wd.officialName;
      if (wd.heritageStatus) updates.heritage_status = wd.heritageStatus;
      if (wd.wikipediaTitle) updates.wikipedia_title = wd.wikipediaTitle;
      if (wd.aliases?.length > 0) updates.aliases = wd.aliases;

      // Store commons image for later
      if (wd.commonsImage && !place.image_url) {
        updates.image_url = wd.commonsImage;
        updates.image_source = 'wikimedia';
        imageFetched = true;
      }

      await logEnrichment(place.id, 'wikidata', wd.wikidataId ? 'success' : 'not_found');
    } catch (err) {
      await logEnrichment(place.id, 'wikidata', 'error', err.message);
    }
    await sleep(DELAY_MS);
  }

  // ── Step 2: Wikipedia description ───────────────────────────────────────
  const wikiTitle = updates.wikipedia_title || place.wikipedia_title || place.name;
  if (!place.description && !await isAlreadyFetched(place.id, 'wikipedia')) {
    try {
      const desc = await fetchWikipediaDescription(wikiTitle);
      wikipediaFetched = true;
      if (desc) updates.description = desc;
      await logEnrichment(place.id, 'wikipedia', desc ? 'success' : 'not_found');
    } catch (err) {
      await logEnrichment(place.id, 'wikipedia', 'error', err.message);
    }
    await sleep(DELAY_MS);
  }

  // ── Step 3: Image resolution (if still no image) ───────────────────────
  if (!place.image_url && !updates.image_url && !await isAlreadyFetched(place.id, 'wikimedia')) {
    try {
      const imgUrl = await fetchWikipediaImage(wikiTitle);
      imageFetched = true;
      if (imgUrl) {
        updates.image_url = imgUrl;
        updates.image_source = 'wikipedia';
      }
      await logEnrichment(place.id, 'wikimedia', imgUrl ? 'success' : 'not_found');
    } catch (err) {
      await logEnrichment(place.id, 'wikimedia', 'error', err.message);
    }
    await sleep(DELAY_MS);
  }

  // ── Step 4: Mark as enriched ────────────────────────────────────────────
  if (Object.keys(updates).length > 0 || wikidataFetched || wikipediaFetched || imageFetched) {
    updates.enriched_at = new Date().toISOString();
    updates.enrichment_version = ENRICHMENT_VERSION;

    if (!DRY_RUN) {
      const { error } = await supabase
        .from('places')
        .update(updates)
        .eq('id', place.id);
      if (error) {
        console.error(`\n  ❌ Failed to update place ${place.name}: ${error.message}`);
        return { status: 'error', updates };
      }
    }
    return { status: 'enriched', updates };
  }

  // Mark as enriched even if no data was found (to skip next time)
  if (!DRY_RUN) {
    await supabase
      .from('places')
      .update({ enriched_at: new Date().toISOString(), enrichment_version: ENRICHMENT_VERSION })
      .eq('id', place.id);
  }
  return { status: 'skipped', updates: {} };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔬 ExploreHub — Place Enrichment Script');
  console.log('═══════════════════════════════════════════════════');
  console.log(`🔑 Auth:       ${useServiceKey ? '✅ Service Role' : '🔑 Anon Key'}`);
  console.log(`🗄️  Database:   ${SUPABASE_URL}`);
  console.log(`📦 Batch size: ${BATCH_SIZE}`);
  console.log(`⏱️  Delay:      ${DELAY_MS}ms between API calls`);
  if (DRY_RUN)          console.log('🏃 Mode:       DRY RUN (no DB writes)');
  if (FRESH)            console.log('🔄 Mode:       FRESH (re-enrich all)');
  if (LIMIT < Infinity) console.log(`🔢 Limit:      ${LIMIT} places`);
  if (CATEGORY)         console.log(`📂 Category:   ${CATEGORY}`);

  // Count places needing enrichment
  let countQuery = supabase
    .from('places')
    .select('*', { count: 'exact', head: true });

  if (!FRESH) {
    countQuery = countQuery.or(`enriched_at.is.null,enrichment_version.lt.${ENRICHMENT_VERSION}`);
  }
  if (CATEGORY) {
    countQuery = countQuery.eq('category', CATEGORY);
  }

  const { count: totalNeeding } = await countQuery;
  const toProcess = Math.min(totalNeeding || 0, LIMIT);

  console.log(`\n  📊 ${(totalNeeding || 0).toLocaleString()} places need enrichment`);
  console.log(`  📊 Will process: ${toProcess.toLocaleString()}\n`);

  if (toProcess === 0) {
    console.log('  ✅ Nothing to enrich!');
    return;
  }

  // Counters
  let processed = 0;
  let enriched = 0;
  let skipped = 0;
  let errors = 0;
  const startTime = Date.now();

  // Resume from checkpoint if available
  const checkpoint = loadCheckpoint();
  if (checkpoint) {
    processed = checkpoint.processed || 0;
    enriched = checkpoint.enriched || 0;
    skipped = checkpoint.skipped || 0;
    errors = checkpoint.errors || 0;
    console.log(`  ⏭️ Resuming: ${processed} already processed (${enriched} enriched)\n`);
  }

  // Process in batches
  while (processed < toProcess) {
    // Fetch next batch of unenriched places
    let batchQuery = supabase
      .from('places')
      .select('id, name, description, image_url, wiki_url, wikidata_id, wikipedia_title, category, osm_id')
      .order('name');

    if (!FRESH) {
      batchQuery = batchQuery.or(`enriched_at.is.null,enrichment_version.lt.${ENRICHMENT_VERSION}`);
    }
    if (CATEGORY) {
      batchQuery = batchQuery.eq('category', CATEGORY);
    }

    batchQuery = batchQuery.range(0, BATCH_SIZE - 1); // Always from 0 since we update as we go

    const { data: batch, error: batchError } = await batchQuery;

    if (batchError) {
      console.error(`\n  ❌ Batch fetch error: ${batchError.message}`);
      await sleep(5000); // Wait before retrying
      continue;
    }

    if (!batch || batch.length === 0) {
      console.log('\n  ✅ No more places to enrich');
      break;
    }

    for (const place of batch) {
      if (processed >= toProcess) break;

      try {
        const result = await enrichPlace(place);
        processed++;

        if (result.status === 'enriched') {
          enriched++;
          const updatedFields = Object.keys(result.updates).filter(k => k !== 'enriched_at' && k !== 'enrichment_version');
          if (updatedFields.length > 0) {
            process.stdout.write(`\r  ✨ [${processed}/${toProcess}] ${place.name.substring(0, 40).padEnd(40)} → ${updatedFields.join(', ')}`);
          }
        } else if (result.status === 'skipped') {
          skipped++;
        } else {
          errors++;
        }
      } catch (err) {
        errors++;
        console.error(`\n  ❌ ${place.name}: ${err.message}`);
      }

      // Progress display every 10 places
      if (processed % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (processed / (elapsed || 1)).toFixed(1);
        process.stdout.write(`\r  📊 ${processed}/${toProcess} | ✨${enriched} enriched | ⏭️${skipped} skipped | ❌${errors} errors | ${elapsed}s (${rate}/s)     `);
      }

      // Save checkpoint every 50 places
      if (processed % 50 === 0) {
        saveCheckpoint({ processed, enriched, skipped, errors });
      }
    }
  }

  // Final stats
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n  ═══════════════════════════════════════════════════`);
  console.log(`  ✅ Enrichment complete!`);
  console.log(`  📊 Processed: ${processed}`);
  console.log(`  ✨ Enriched:  ${enriched}`);
  console.log(`  ⏭️  Skipped:   ${skipped}`);
  console.log(`  ❌ Errors:    ${errors}`);
  console.log(`  ⏱️  Time:      ${elapsed}s`);
  console.log(`  ═══════════════════════════════════════════════════\n`);

  clearCheckpoint();
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message || err);
  process.exit(1);
});
