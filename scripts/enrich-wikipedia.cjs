#!/usr/bin/env node
// =============================================================================
// ExploreHub — Wikipedia Enrichment Script
// =============================================================================
//
// Enriches places with Wikipedia data:
//   - title, summary, history (first 3 sections)
//   - featured image, page_id, wikipedia_url
//   - Saves to place_descriptions table
//   - Saves images to place_images table
//   - Respects is_manual_edit flag (never overwrites manual edits)
//   - Caches API responses in api_cache table
//
// USAGE:
//   node scripts/enrich-wikipedia.js                   Enrich all unenriched places
//   node scripts/enrich-wikipedia.js --limit 500       Process 500 places max
//   node scripts/enrich-wikipedia.js --batch-size 50   DB query batch size
//   node scripts/enrich-wikipedia.js --delay 200       Delay (ms) between API calls
//   node scripts/enrich-wikipedia.js --category Temples Only enrich specific category
//   node scripts/enrich-wikipedia.js --dry-run         Preview without writing
//   node scripts/enrich-wikipedia.js --resume           Resume from checkpoint
//   node scripts/enrich-wikipedia.js --fresh            Re-enrich all (ignore cache)
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
const CHECKPOINT_FILE = path.join(__dirname, '.enrich-wikipedia-checkpoint.json');

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

// ─── HTTP Helper with retries ─────────────────────────────────────────────────
function httpGet(url, timeoutMs = 15000, retries = 3) {
  return new Promise(async (resolve) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await new Promise((res) => {
          const client = url.startsWith('https') ? https : http;
          const req = client.get(url, { timeout: timeoutMs }, (response) => {
            // Follow redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              res({ redirect: response.headers.location });
              return;
            }
            let body = '';
            response.on('data', chunk => body += chunk);
            response.on('end', () => {
              if (response.statusCode === 200) {
                try { res({ data: JSON.parse(body), error: null }); }
                catch (e) { res({ data: null, error: `JSON parse error: ${e.message}` }); }
              } else if (response.statusCode === 404) {
                res({ data: null, error: null }); // Not found is not an error
              } else {
                res({ data: null, error: `HTTP ${response.statusCode}` });
              }
            });
          });
          req.on('error', (e) => res({ data: null, error: e.message }));
          req.on('timeout', () => { req.destroy(); res({ data: null, error: 'timeout' }); });
        });

        // Handle redirects
        if (result.redirect) {
          return resolve(await httpGet(result.redirect, timeoutMs, 1));
        }

        if (result.data || result.error === null) {
          return resolve(result);
        }

        // Transient error — retry
        if (attempt < retries) {
          await sleep(1000 * attempt);
          continue;
        }
        return resolve(result);
      } catch (err) {
        if (attempt >= retries) {
          return resolve({ data: null, error: err.message });
        }
        await sleep(1000 * attempt);
      }
    }
  });
}

// ─── API Cache Helpers ────────────────────────────────────────────────────────
async function getCachedResponse(cacheKey) {
  if (FRESH) return null;
  const { data } = await supabase
    .from('api_cache')
    .select('response_data')
    .eq('cache_key', cacheKey)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .single();
  if (data) {
    // Increment hit count
    await supabase
      .from('api_cache')
      .update({ hit_count: supabase.rpc ? undefined : 1 }) // Simple update
      .eq('cache_key', cacheKey);
  }
  return data?.response_data || null;
}

async function setCachedResponse(cacheKey, source, responseData) {
  if (DRY_RUN) return;
  const expiresAt = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await supabase
    .from('api_cache')
    .upsert({
      cache_key: cacheKey,
      source,
      response_data: responseData,
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt,
      hit_count: 0,
    }, { onConflict: 'cache_key' });
}

// ─── Wikipedia API Functions ──────────────────────────────────────────────────

/**
 * Fetch Wikipedia page summary via REST API.
 * Returns: { title, summary, pageId, thumbnailUrl, fullUrl, wikibaseItem }
 */
async function fetchWikipediaSummary(titleOrName) {
  if (!titleOrName) return null;
  const cacheKey = `wikipedia:summary:en:${titleOrName}`;
  const cached = await getCachedResponse(cacheKey);
  if (cached) return cached;

  const encoded = encodeURIComponent(titleOrName.replace(/ /g, '_'));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  const { data, error } = await httpGet(url);

  if (error || !data) return null;

  const result = {
    title: data.title || null,
    summary: data.extract || null,
    pageId: data.pageid || null,
    thumbnailUrl: data.thumbnail?.source || null,
    originalImageUrl: data.originalimage?.source || null,
    fullUrl: data.content_urls?.desktop?.page || null,
    wikibaseItem: data.wikibase_item || null,
    description: data.description || null,
  };

  await setCachedResponse(cacheKey, 'wikipedia', result);
  return result;
}

/**
 * Fetch extended Wikipedia content (first 3 sections) via MediaWiki API.
 * Returns: { sections: [{ title, content }] }
 */
async function fetchWikipediaSections(title) {
  if (!title) return null;
  const cacheKey = `wikipedia:sections:en:${title}`;
  const cached = await getCachedResponse(cacheKey);
  if (cached) return cached;

  const encoded = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encoded}&prop=sections|wikitext&format=json&redirects=1`;
  const { data } = await httpGet(url);

  if (!data?.parse?.sections) return null;

  // Get first 3 meaningful sections
  const sections = data.parse.sections
    .filter(s => parseInt(s.level) <= 2 && s.line)
    .slice(0, 3)
    .map(s => s.line);

  // Fetch extracts for the intro + first sections
  const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encoded}&prop=extracts&exintro=0&exsectionformat=plain&explaintext=1&exlimit=1&format=json&redirects=1`;
  const { data: extractData } = await httpGet(extractUrl);

  let history = null;
  if (extractData?.query?.pages) {
    const page = Object.values(extractData.query.pages)[0];
    if (page?.extract) {
      // Truncate to 5000 chars for storage
      history = page.extract.length > 5000
        ? page.extract.substring(0, 4997) + '...'
        : page.extract;
    }
  }

  const result = { sections, history };
  await setCachedResponse(cacheKey, 'wikipedia', result);
  return result;
}

/**
 * Search Wikipedia for a place name.
 * Returns the best matching page title.
 */
async function searchWikipedia(placeName, cityName, stateName) {
  if (!placeName) return null;

  // Try multiple search queries for better matching
  const queries = [
    placeName,
    cityName ? `${placeName} ${cityName}` : null,
    stateName ? `${placeName} ${stateName}` : null,
  ].filter(Boolean);

  for (const query of queries) {
    const cacheKey = `wikipedia:search:en:${query}`;
    const cached = await getCachedResponse(cacheKey);
    if (cached?.title) return cached;

    const encoded = encodeURIComponent(query);
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&srlimit=3&format=json`;
    const { data } = await httpGet(url);

    if (data?.query?.search?.length > 0) {
      const result = { title: data.query.search[0].title };
      await setCachedResponse(cacheKey, 'wikipedia', result);
      return result;
    }

    await sleep(DELAY_MS);
  }

  return null;
}

// ─── Place Source Helpers ─────────────────────────────────────────────────────

async function isSourceStale(placeId, sourceName) {
  if (FRESH) return true;
  const { data } = await supabase
    .from('place_sources')
    .select('next_fetch_after,status')
    .eq('place_id', placeId)
    .eq('source_name', sourceName)
    .limit(1)
    .single();

  if (!data) return true; // Never fetched
  if (data.status === 'error') return true; // Retry errors
  return new Date(data.next_fetch_after) < new Date(); // Check TTL
}

async function hasManualDescription(placeId) {
  const { data } = await supabase
    .from('place_descriptions')
    .select('id')
    .eq('place_id', placeId)
    .eq('is_manual_edit', true)
    .limit(1);
  return data && data.length > 0;
}

async function updatePlaceSource(placeId, sourceName, sourceId, sourceUrl, status, errorMessage = null) {
  if (DRY_RUN) return;
  const nextFetchAfter = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await supabase
    .from('place_sources')
    .upsert({
      place_id: placeId,
      source_name: sourceName,
      source_id: sourceId,
      source_url: sourceUrl,
      status,
      error_message: errorMessage,
      last_fetched: new Date().toISOString(),
      next_fetch_after: nextFetchAfter,
    }, { onConflict: 'place_id,source_name' });
}

// ─── Enrich a Single Place ────────────────────────────────────────────────────

async function enrichPlace(place) {
  const updates = {};
  let enrichedFields = [];

  // Skip if manually edited
  if (await hasManualDescription(place.id)) {
    return { status: 'skipped', reason: 'manual_edit', fields: [] };
  }

  // Skip if source is not stale
  if (!await isSourceStale(place.id, 'wikipedia')) {
    return { status: 'skipped', reason: 'cache_fresh', fields: [] };
  }

  // ── Step 1: Resolve Wikipedia title ─────────────────────────────────────
  let wikiTitle = place.wikipedia_title;
  let wikiSummaryData = null;

  // Try existing wiki_url first
  if (place.wiki_url) {
    const match = place.wiki_url.match(/wikipedia\.org\/wiki\/(.+)$/);
    if (match) {
      wikiTitle = decodeURIComponent(match[1].replace(/_/g, ' '));
    }
  }

  // Fetch summary
  if (wikiTitle) {
    wikiSummaryData = await fetchWikipediaSummary(wikiTitle);
    await sleep(DELAY_MS);
  }

  // If no result, try searching
  if (!wikiSummaryData && place.name) {
    const searchResult = await searchWikipedia(place.name, place.city_name, place.state_name);
    await sleep(DELAY_MS);

    if (searchResult?.title) {
      wikiTitle = searchResult.title;
      wikiSummaryData = await fetchWikipediaSummary(wikiTitle);
      await sleep(DELAY_MS);
    }
  }

  if (!wikiSummaryData) {
    await updatePlaceSource(place.id, 'wikipedia', null, null, 'not_found');
    return { status: 'not_found', reason: 'no_wikipedia_page', fields: [] };
  }

  // ── Step 2: Fetch extended content (history/sections) ───────────────────
  let sectionsData = null;
  if (wikiSummaryData.title) {
    sectionsData = await fetchWikipediaSections(wikiSummaryData.title);
    await sleep(DELAY_MS);
  }

  // ── Step 3: Save to place_descriptions ──────────────────────────────────
  if (!DRY_RUN) {
    const descriptionData = {
      place_id: place.id,
      title: wikiSummaryData.title,
      summary: wikiSummaryData.summary,
      history: sectionsData?.history || null,
      featured_image: wikiSummaryData.thumbnailUrl
        ? wikiSummaryData.thumbnailUrl.replace(/\/\d+px-/, '/600px-')
        : null,
      wikipedia_url: wikiSummaryData.fullUrl,
      page_id: wikiSummaryData.pageId,
      language: 'en',
      source: 'wikipedia',
      is_manual_edit: false,
    };

    const { error } = await supabase
      .from('place_descriptions')
      .upsert(descriptionData, { onConflict: 'place_id,language,source' });

    if (error) {
      console.error(`\n  ❌ Description upsert failed for ${place.name}: ${error.message}`);
    } else {
      enrichedFields.push('description');
    }
  }

  // ── Step 4: Save featured image to place_images ─────────────────────────
  const imageUrl = wikiSummaryData.thumbnailUrl
    ? wikiSummaryData.thumbnailUrl.replace(/\/\d+px-/, '/600px-')
    : wikiSummaryData.originalImageUrl;

  if (imageUrl && !DRY_RUN) {
    await supabase
      .from('place_images')
      .upsert({
        place_id: place.id,
        url: imageUrl,
        source: 'wikipedia',
        priority: 3,
        is_primary: false, // Will be set by download-images.js
      }, { onConflict: 'place_id,url' });
    enrichedFields.push('image');
  }

  // ── Step 5: Update places table ─────────────────────────────────────────
  if (!DRY_RUN) {
    const placeUpdates = {};

    // Update description if missing
    if (!place.description && wikiSummaryData.summary) {
      placeUpdates.description = wikiSummaryData.summary.length > 500
        ? wikiSummaryData.summary.substring(0, 497) + '...'
        : wikiSummaryData.summary;
    }

    // Update wikipedia_title if missing
    if (!place.wikipedia_title && wikiSummaryData.title) {
      placeUpdates.wikipedia_title = wikiSummaryData.title;
    }

    // Update wikipedia_page_id
    if (wikiSummaryData.pageId) {
      placeUpdates.wikipedia_page_id = wikiSummaryData.pageId;
    }

    // Update wiki_url if missing
    if (!place.wiki_url && wikiSummaryData.fullUrl) {
      placeUpdates.wiki_url = wikiSummaryData.fullUrl;
    }

    // Update image if missing
    if (!place.image_url && imageUrl) {
      placeUpdates.image_url = imageUrl;
      placeUpdates.image_source = 'wikipedia';
    }

    if (Object.keys(placeUpdates).length > 0) {
      await supabase.from('places').update(placeUpdates).eq('id', place.id);
      enrichedFields.push(...Object.keys(placeUpdates));
    }
  }

  // ── Step 6: Update place_sources ────────────────────────────────────────
  await updatePlaceSource(
    place.id,
    'wikipedia',
    wikiSummaryData.pageId?.toString(),
    wikiSummaryData.fullUrl,
    'success'
  );

  return { status: 'enriched', fields: enrichedFields };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📚 ExploreHub — Wikipedia Enrichment Script');
  console.log('═══════════════════════════════════════════════════');
  console.log(`🔑 Auth:       ${useServiceKey ? '✅ Service Role' : '🔑 Anon Key'}`);
  console.log(`🗄️  Database:   ${SUPABASE_URL}`);
  console.log(`📦 Batch size: ${BATCH_SIZE}`);
  console.log(`⏱️  Delay:      ${DELAY_MS}ms between API calls`);
  console.log(`📅 Cache TTL:  ${CACHE_DAYS} days`);
  if (DRY_RUN)          console.log('🏃 Mode:       DRY RUN (no DB writes)');
  if (FRESH)            console.log('🔄 Mode:       FRESH (ignore cache)');
  if (LIMIT < Infinity) console.log(`🔢 Limit:      ${LIMIT} places`);
  if (CATEGORY)         console.log(`📂 Category:   ${CATEGORY}`);

  // Find places needing Wikipedia enrichment
  // A place needs enrichment if:
  //   - No entry in place_sources for 'wikipedia'
  //   - OR place_sources.next_fetch_after < now()
  //   - OR --fresh flag is set

  let countQuery = supabase
    .from('places')
    .select('*', { count: 'exact', head: true });

  if (!FRESH) {
    // Only places without recent wikipedia source entry
    // We'll filter more precisely in the batch loop
  }
  if (CATEGORY) {
    countQuery = countQuery.eq('category', CATEGORY);
  }

  const { count: totalPlaces } = await countQuery;
  const toProcess = Math.min(totalPlaces || 0, LIMIT);

  console.log(`\n  📊 ${(totalPlaces || 0).toLocaleString()} total places`);
  console.log(`  📊 Will process up to: ${toProcess.toLocaleString()}\n`);

  if (toProcess === 0) {
    console.log('  ✅ No places to enrich!');
    return;
  }

  // Counters
  let processed = 0;
  let enriched = 0;
  let skipped = 0;
  let notFound = 0;
  let errors = 0;
  const startTime = Date.now();

  // Resume from checkpoint
  const checkpoint = loadCheckpoint();
  if (checkpoint) {
    processed = checkpoint.processed || 0;
    enriched = checkpoint.enriched || 0;
    skipped = checkpoint.skipped || 0;
    notFound = checkpoint.notFound || 0;
    errors = checkpoint.errors || 0;
    console.log(`  ⏭️ Resuming: ${processed} already processed (${enriched} enriched)\n`);
  }

  // Process in batches
  let offset = processed;
  while (processed < toProcess) {
    let batchQuery = supabase
      .from('v_places_full')
      .select('id, name, description, image_url, wiki_url, wikidata_id, wikipedia_title, category, osm_id, city_name, district_name, state_name, image_source')
      .order('name')
      .range(offset, offset + BATCH_SIZE - 1);

    if (CATEGORY) {
      batchQuery = batchQuery.eq('category', CATEGORY);
    }

    const { data: batch, error: batchError } = await batchQuery;

    if (batchError) {
      console.error(`\n  ❌ Batch fetch error: ${batchError.message}`);
      errors++;
      await sleep(5000);
      continue;
    }

    if (!batch || batch.length === 0) {
      console.log('\n  ✅ No more places to process');
      break;
    }

    offset += batch.length;

    for (const place of batch) {
      if (processed >= toProcess) break;

      try {
        const result = await enrichPlace(place);
        processed++;

        switch (result.status) {
          case 'enriched':
            enriched++;
            process.stdout.write(`\r  ✨ [${processed}/${toProcess}] ${place.name.substring(0, 35).padEnd(35)} → ${result.fields.join(', ')}`);
            break;
          case 'not_found':
            notFound++;
            break;
          case 'skipped':
            skipped++;
            break;
          default:
            errors++;
        }
      } catch (err) {
        errors++;
        console.error(`\n  ❌ ${place.name}: ${err.message}`);
      }

      // Progress every 10 places
      if (processed % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (processed / (elapsed || 1)).toFixed(1);
        process.stdout.write(
          `\r  📊 ${processed}/${toProcess} | ✨${enriched} | ⏭️${skipped} | 🔍${notFound} | ❌${errors} | ${elapsed}s (${rate}/s)     `
        );
      }

      // Checkpoint every 50 places
      if (processed % 50 === 0) {
        saveCheckpoint({ processed, enriched, skipped, notFound, errors });
      }
    }
  }

  // Final stats
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n  ═══════════════════════════════════════════════════`);
  console.log(`  ✅ Wikipedia enrichment complete!`);
  console.log(`  📊 Processed: ${processed}`);
  console.log(`  ✨ Enriched:  ${enriched}`);
  console.log(`  ⏭️  Skipped:   ${skipped}`);
  console.log(`  🔍 Not found: ${notFound}`);
  console.log(`  ❌ Errors:    ${errors}`);
  console.log(`  ⏱️  Time:      ${elapsed}s`);
  console.log(`  ═══════════════════════════════════════════════════\n`);

  clearCheckpoint();
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message || err);
  process.exit(1);
});
