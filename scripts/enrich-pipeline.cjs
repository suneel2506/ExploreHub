#!/usr/bin/env node
// =============================================================================
// ExploreHub — Multi-Stage Place Enrichment Pipeline v2
// =============================================================================
//
// ARCHITECTURE:
//   This replaces the single-pass Wikipedia search approach with a 7-stage
//   pipeline that uses Wikidata as the primary source, not Wikipedia search.
//
// WHY THE OLD SCRIPT FAILS:
//   The old script searches Wikipedia by bare place name (e.g. "Temple").
//   For Indian places, OSM names rarely match Wikipedia titles:
//     - OSM name: "Kailasanathar Temple"
//     - Wikipedia: "Kailasanathar Temple, Kanchipuram"
//   Wikipedia search returns irrelevant results → 0% enrichment rate.
//
// NEW APPROACH:
//   Stage 1: Read existing OSM tags (wikidata, wikipedia, heritage, etc.)
//   Stage 2: If wikidata_id exists → go DIRECTLY to Wikidata API
//   Stage 3: If no wikidata_id → search Wikidata (NOT Wikipedia) with
//            intelligent query: "Name + City + District + State + India"
//            Score candidates by name similarity + coordinates + instance type
//   Stage 4: From Wikidata entity → get Wikipedia article title + summary
//   Stage 5: Fetch multiple images from Wikimedia Commons (not just thumbnail)
//   Stage 6: Fallback chain: Wikidata → Wikipedia → Commons → OSM tags
//   Stage 7: Cache every API response in api_cache (30-day TTL)
//
// PERFORMANCE:
//   - Parallel workers (configurable, default 4)
//   - Batch DB reads (50 places per query)
//   - API response caching (eliminates redundant calls)
//   - Rate-limited (respects Wikidata/Wikipedia limits)
//   - Target: 100 places in <120 seconds (vs old: 1258 seconds)
//
// USAGE:
//   node scripts/enrich-pipeline.cjs                       Enrich all
//   node scripts/enrich-pipeline.cjs --limit 500           Process 500 places max
//   node scripts/enrich-pipeline.cjs --workers 6           6 parallel workers
//   node scripts/enrich-pipeline.cjs --category Temples    Only specific category
//   node scripts/enrich-pipeline.cjs --dry-run             Preview without writing
//   node scripts/enrich-pipeline.cjs --resume              Resume from checkpoint
//   node scripts/enrich-pipeline.cjs --fresh               Ignore cache, re-enrich
//   node scripts/enrich-pipeline.cjs --verbose             Show detailed API logs
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
const VERBOSE    = args.includes('--verbose');
const LIMIT      = (() => { const i = args.indexOf('--limit');      return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })();
const BATCH_SIZE = (() => { const i = args.indexOf('--batch-size'); return i >= 0 ? parseInt(args[i + 1], 10) : 50; })();
const WORKERS    = (() => { const i = args.indexOf('--workers');    return i >= 0 ? parseInt(args[i + 1], 10) : 4; })();
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
function log(msg) { if (VERBOSE) console.log(`    ${msg}`); }

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
// Wikidata/Wikipedia allow ~200 req/s but we stay conservative.
// This ensures we never exceed limits even with parallel workers.
class RateLimiter {
  constructor(maxPerSecond = 20) {
    this.minInterval = 1000 / maxPerSecond;
    this.lastCall = 0;
    this.queue = [];
    this.processing = false;
  }

  async acquire() {
    return new Promise(resolve => {
      this.queue.push(resolve);
      if (!this.processing) this._process();
    });
  }

  async _process() {
    this.processing = true;
    while (this.queue.length > 0) {
      const now = Date.now();
      const wait = Math.max(0, this.lastCall + this.minInterval - now);
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      const resolve = this.queue.shift();
      resolve();
    }
    this.processing = false;
  }
}

const rateLimiter = new RateLimiter(10); // 10 req/s across all workers (conservative to avoid 429s)

// ─── Checkpoint System ────────────────────────────────────────────────────────
const CHECKPOINT_FILE = path.join(__dirname, '.enrich-pipeline-checkpoint.json');

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

// ─── HTTP Helper (rate-limited, retries, redirect-following) ──────────────────
async function httpGet(url, timeoutMs = 15000, retries = 3) {
  await rateLimiter.acquire();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await new Promise((resolve) => {
        const client = url.startsWith('https') ? https : http;
        const headers = { 'User-Agent': 'ExploreHub/2.0 (travel app; suneel2506@gmail.com)' };
        const req = client.get(url, { timeout: timeoutMs, headers }, (response) => {
          // Follow redirects (up to 3)
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            resolve({ redirect: response.headers.location });
            return;
          }
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('end', () => {
            if (response.statusCode === 200) {
              try { resolve({ data: JSON.parse(body), error: null }); }
              catch (e) { resolve({ data: null, error: `JSON parse: ${e.message}` }); }
            } else if (response.statusCode === 404) {
              resolve({ data: null, error: null }); // Not found — not an error
            } else if (response.statusCode === 429) {
              resolve({ data: null, error: 'rate_limited' });
            } else {
              resolve({ data: null, error: `HTTP ${response.statusCode}` });
            }
          });
        });
        req.on('error', (e) => resolve({ data: null, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ data: null, error: 'timeout' }); });
      });

      if (result.redirect) {
        return httpGet(result.redirect, timeoutMs, 1);
      }

      // Rate limited — back off
      if (result.error === 'rate_limited') {
        const backoff = 2000 * attempt;
        log(`  ⚠️ Rate limited, backing off ${backoff}ms`);
        await sleep(backoff);
        continue;
      }

      if (result.data || result.error === null) {
        return result;
      }

      if (attempt < retries) {
        await sleep(1000 * attempt);
        continue;
      }
      return result;
    } catch (err) {
      if (attempt >= retries) return { data: null, error: err.message };
      await sleep(1000 * attempt);
    }
  }
  return { data: null, error: 'max_retries' };
}

// =============================================================================
// API CACHE — Never call the same API twice
// =============================================================================

async function getCached(key) {
  if (FRESH) return null;
  try {
    const { data } = await supabase
      .from('api_cache')
      .select('response_data')
      .eq('cache_key', key)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .single();
    return data?.response_data || null;
  } catch { return null; }
}

async function setCache(key, source, responseData) {
  if (DRY_RUN) return;
  try {
    await supabase.from('api_cache').upsert({
      cache_key: key,
      source,
      response_data: responseData,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + CACHE_DAYS * 86400000).toISOString(),
      hit_count: 0,
    }, { onConflict: 'cache_key' });
  } catch {}
}

// =============================================================================
// STRING SIMILARITY — Used for fuzzy matching Wikidata candidates
// =============================================================================

/**
 * Trigram-based similarity between two strings.
 * Returns a score between 0.0 and 1.0.
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;

  // Generate character trigrams
  function trigrams(s) {
    const padded = `  ${s} `;
    const set = new Set();
    for (let i = 0; i < padded.length - 2; i++) {
      set.add(padded.substring(i, i + 3));
    }
    return set;
  }

  const tA = trigrams(a);
  const tB = trigrams(b);
  let intersection = 0;
  for (const t of tA) {
    if (tB.has(t)) intersection++;
  }
  return intersection / Math.max(tA.size, tB.size);
}

/**
 * Haversine distance in km between two lat/lon pairs.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// =============================================================================
// STAGE 1: Read existing OSM tags
// =============================================================================
// The places.metadata column contains OSM tags stored during import.
// Many places already have wikidata=Q..., wikipedia=en:..., or other tags
// that can accelerate enrichment without any API call.

function extractOsmTags(place) {
  const tags = place.metadata?.tags || {};
  return {
    // Direct Wikidata/Wikipedia tags from OSM
    wikidataId:       tags.wikidata || tags['wikidata:id'] || place.wikidata_id || null,
    wikipediaTag:     tags.wikipedia || null,        // e.g. "en:Taj_Mahal"
    wikimediaCommons: tags.wikimedia_commons || tags['image'] || null,
    website:          tags.website || tags.url || tags.contact_website || null,
    // Place classification tags
    tourism:          tags.tourism || null,
    historic:         tags.historic || null,
    amenity:          tags.amenity || null,
    religion:         tags.religion || null,
    denomination:     tags.denomination || null,
    heritage:         tags.heritage || tags['heritage:operator'] || null,
    heritageUNESCO:   tags['heritage:UNESCO'] || null,
    // Name variants
    nameEn:           tags['name:en'] || null,
    officialName:     tags.official_name || tags['name:official'] || null,
    altName:          tags.alt_name || null,
    oldName:          tags.old_name || null,
    // Existing wiki_url from import
    wikiUrl:          place.wiki_url || null,
  };
}

/**
 * Parse the wikipedia=en:Title tag from OSM into a Wikipedia URL and title.
 */
function parseWikipediaTag(tag) {
  if (!tag) return null;
  const parts = tag.split(':');
  if (parts.length >= 2) {
    const lang = parts[0];
    const title = parts.slice(1).join(':');
    return {
      lang,
      title: title.replace(/_/g, ' '),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    };
  }
  return null;
}

// =============================================================================
// STAGE 2: Wikidata Entity Fetch (when ID is known)
// =============================================================================
// If wikidata_id exists, we go directly to Wikidata API — no search needed.
// This is the fastest path and produces the most accurate results.

async function fetchWikidataEntity(qid) {
  if (!qid || !qid.startsWith('Q')) return null;

  const cacheKey = `wikidata:entity:${qid}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels|aliases|claims|sitelinks|descriptions&languages=en&format=json`;
  const { data, error } = await httpGet(url);

  if (error || !data?.entities?.[qid]) return null;
  const entity = data.entities[qid];

  await setCache(cacheKey, 'wikidata', entity);
  return entity;
}

// =============================================================================
// STAGE 3: Wikidata Search (when no ID exists)
// =============================================================================
// Instead of searching Wikipedia (which fails for Indian places), we search
// Wikidata which has much better coverage and structured metadata.
//
// KEY INSIGHT: We build an intelligent search query by combining:
//   Place Name + City + District + State + "India"
// Then score candidates by multiple factors.

/**
 * Build search queries from most specific to least specific.
 * Example for "Kailasanathar Temple" in Kanchipuram, Tamil Nadu:
 *   1. "Kailasanathar Temple Kanchipuram Tamil Nadu"
 *   2. "Kailasanathar Temple Kanchipuram"
 *   3. "Kailasanathar Temple Tamil Nadu India"
 *   4. "Kailasanathar Temple India"
 *   5. "Kailasanathar Temple"
 */
function buildSearchQueries(place) {
  const name = place.name?.trim();
  if (!name) return [];

  const city     = place.city_name?.trim() || '';
  const district = place.district_name?.trim() || '';
  const state    = place.state_name?.trim() || '';

  const queries = [];

  // Most specific → least specific
  if (city && state)     queries.push(`${name} ${city} ${state}`);
  if (city)              queries.push(`${name} ${city}`);
  if (district && state) queries.push(`${name} ${district} ${state}`);
  if (state)             queries.push(`${name} ${state} India`);
  queries.push(`${name} India`);
  queries.push(name);

  // Deduplicate while preserving order
  const seen = new Set();
  return queries.filter(q => {
    const key = q.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Wikidata instance_of (P31) values that indicate geographic/place entities
const PLACE_INSTANCE_IDS = new Set([
  'Q9259',      // UNESCO World Heritage Site
  'Q839954',    // archaeological site
  'Q16970',     // Hindu temple
  'Q44613',     // Buddhist temple
  'Q32815',     // mosque
  'Q16560',     // palace / cathedral
  'Q5153359',   // church building
  'Q57821',     // fortification
  'Q23413',     // castle
  'Q4989906',   // monument
  'Q33506',     // museum
  'Q174782',    // viewpoint
  'Q194195',    // cave
  'Q34038',     // waterfall
  'Q23397',     // lake
  'Q8502',      // mountain
  'Q15324',     // body of water
  'Q40080',     // beach
  'Q23442',     // island
  'Q46169',     // national park
  'Q22698',     // park
  'Q12323',     // dam
  'Q94993',     // wildlife sanctuary
  'Q515',       // city
  'Q3957',      // town
  'Q532',       // village
  'Q486972',    // human settlement
  'Q1549591',   // big city
  'Q15078955',  // municipality of India
  'Q1093829',   // city of India
  'Q376799',    // hill station
  'Q34763',     // peninsula
  'Q54050',     // hill
  'Q159313',    // gorge
  'Q47521',     // stream
  'Q4022',      // river
  'Q39816',     // valley
  'Q131681',    // bay
  'Q35509',     // cave
  'Q3947',      // house
  'Q41176',     // building
  'Q12280',     // bridge
  'Q55488',     // railway station
  'Q1248784',   // airport
  'Q928830',    // bus station
  'Q27686',     // hotel
  'Q11707',     // restaurant
  'Q483110',    // stadium
  'Q3914',      // school
  'Q3918',      // university
  'Q16917',     // hospital
]);

/**
 * Score a Wikidata candidate against our place.
 * Returns a score from 0.0 to 1.0.
 */
function scoreCandidateMatch(candidate, place) {
  let score = 0;
  let factors = 0;

  // Factor 1: Name similarity (weight: 0.4)
  const nameSim = similarity(candidate.label || '', place.name || '');
  score += nameSim * 0.4;
  factors++;

  // Factor 2: Description relevance (weight: 0.15)
  const desc = (candidate.description || '').toLowerCase();
  const descTerms = [
    place.city_name, place.district_name, place.state_name, 'india',
    place.category?.toLowerCase(),
  ].filter(Boolean).map(t => t.toLowerCase());

  let descMatches = 0;
  for (const term of descTerms) {
    if (desc.includes(term)) descMatches++;
  }
  const descScore = descTerms.length > 0 ? descMatches / descTerms.length : 0;
  score += descScore * 0.15;
  factors++;

  // Factor 3: Is a known place type? (weight: 0.15)
  if (candidate.instanceOf && candidate.instanceOf.length > 0) {
    const isPlace = candidate.instanceOf.some(id => PLACE_INSTANCE_IDS.has(id));
    score += (isPlace ? 1.0 : 0.1) * 0.15;
  }
  factors++;

  // Factor 4: Coordinate proximity (weight: 0.2)
  if (candidate.lat != null && candidate.lon != null && place.latitude && place.longitude) {
    const dist = haversineKm(place.latitude, place.longitude, candidate.lat, candidate.lon);
    // Within 5km = 1.0, 50km = 0.5, 200km = 0.1, >500km = 0.0
    const coordScore = dist < 5 ? 1.0 : dist < 50 ? 0.5 : dist < 200 ? 0.1 : 0;
    score += coordScore * 0.2;
  }
  factors++;

  // Factor 5: Has English Wikipedia article (weight: 0.1)
  if (candidate.hasEnWiki) {
    score += 0.1;
  }

  return score;
}

/**
 * Search Wikidata for the best matching entity for a place.
 * Tries multiple query strategies and scores all candidates.
 */
async function searchWikidata(place) {
  const queries = buildSearchQueries(place);
  const allCandidates = [];
  const seenIds = new Set();

  for (const query of queries) {
    const cacheKey = `wikidata:search:${query}`;
    let results = await getCached(cacheKey);

    if (!results) {
      const encoded = encodeURIComponent(query);
      const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encoded}&language=en&limit=7&format=json`;
      const { data } = await httpGet(url);

      if (data?.search) {
        results = data.search.map(r => ({
          id: r.id,
          label: r.label || '',
          description: r.description || '',
        }));
        await setCache(cacheKey, 'wikidata', results);
      }
    }

    if (results) {
      for (const r of results) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);
        allCandidates.push(r);
      }
    }

    // Stop early if we have enough good candidates
    if (allCandidates.length >= 15) break;
  }

  if (allCandidates.length === 0) return null;

  // ── Enrich top candidates with entity data for better scoring ───────────
  // Only fetch entity details for top ~5 candidates to save API calls
  const enrichedCandidates = [];

  for (const cand of allCandidates.slice(0, 5)) {
    // Quick entity fetch for coordinates + instance_of
    const miniCacheKey = `wikidata:mini:${cand.id}`;
    let miniEntity = await getCached(miniCacheKey);

    if (!miniEntity) {
      const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${cand.id}&props=claims|sitelinks&languages=en&format=json`;
      const { data } = await httpGet(url);

      if (data?.entities?.[cand.id]) {
        const claims = data.entities[cand.id].claims || {};
        const sitelinks = data.entities[cand.id].sitelinks || {};

        // Extract coordinates (P625)
        const coordClaim = claims.P625?.[0]?.mainsnak?.datavalue?.value;
        // Extract instance_of (P31)
        const instanceOf = (claims.P31 || [])
          .map(c => c?.mainsnak?.datavalue?.value?.id)
          .filter(Boolean);

        miniEntity = {
          lat: coordClaim?.latitude || null,
          lon: coordClaim?.longitude || null,
          instanceOf,
          hasEnWiki: !!sitelinks.enwiki,
          enWikiTitle: sitelinks.enwiki?.title || null,
        };
        await setCache(miniCacheKey, 'wikidata', miniEntity);
      }
    }

    enrichedCandidates.push({
      ...cand,
      lat: miniEntity?.lat || null,
      lon: miniEntity?.lon || null,
      instanceOf: miniEntity?.instanceOf || [],
      hasEnWiki: miniEntity?.hasEnWiki || false,
      enWikiTitle: miniEntity?.enWikiTitle || null,
    });
  }

  // ── Score all enriched candidates ───────────────────────────────────────
  const scored = enrichedCandidates.map(c => ({
    ...c,
    score: scoreCandidateMatch(c, place),
  }));

  scored.sort((a, b) => b.score - a.score);

  log(`  🔍 Candidates for "${place.name}": ${scored.map(c => `${c.label}(${c.score.toFixed(2)})`).join(', ')}`);

  // Minimum threshold: 0.25 (very generous for Indian places with partial names)
  const best = scored[0];
  if (best.score < 0.25) {
    log(`  ❌ Best score ${best.score.toFixed(2)} below threshold 0.25`);
    return null;
  }

  return best;
}

// =============================================================================
// STAGE 4: Wikipedia Content Fetch
// =============================================================================
// Once we have a Wikipedia title (from Wikidata sitelinks), fetch the actual
// article content: summary, extended text, and images.

async function fetchWikipediaSummary(title) {
  if (!title) return null;

  const cacheKey = `wikipedia:summary:en:${title}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
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

  await setCache(cacheKey, 'wikipedia', result);
  return result;
}

async function fetchWikipediaExtract(title) {
  if (!title) return null;

  const cacheKey = `wikipedia:extract:en:${title}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const encoded = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encoded}&prop=extracts&exintro=0&explaintext=1&exlimit=1&format=json&redirects=1`;
  const { data } = await httpGet(url);

  let history = null;
  if (data?.query?.pages) {
    const page = Object.values(data.query.pages)[0];
    if (page?.extract) {
      history = page.extract.length > 5000
        ? page.extract.substring(0, 4997) + '...'
        : page.extract;
    }
  }

  const result = { history };
  await setCache(cacheKey, 'wikipedia', result);
  return result;
}

// =============================================================================
// STAGE 5: Wikimedia Commons Images
// =============================================================================
// Fetch multiple images from Wikimedia Commons, not just the Wikipedia thumbnail.
// Prefer landscape images. Store all in place_images.

async function fetchCommonsImages(commonsCategory, wikidataQid, wikiTitle) {
  const images = [];

  // Strategy 1: Commons category (from Wikidata P373)
  if (commonsCategory) {
    const cacheKey = `commons:cat:${commonsCategory}`;
    let catImages = await getCached(cacheKey);

    if (!catImages) {
      const encoded = encodeURIComponent(`Category:${commonsCategory}`);
      const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&gcmtitle=${encoded}&gcmtype=file&gcmlimit=10&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=800&format=json`;
      const { data } = await httpGet(url);

      catImages = [];
      if (data?.query?.pages) {
        for (const page of Object.values(data.query.pages)) {
          const info = page.imageinfo?.[0];
          if (info && info.mime?.startsWith('image/')) {
            catImages.push({
              url: info.thumburl || info.url,
              originalUrl: info.url,
              width: info.width || 0,
              height: info.height || 0,
              source: 'wikimedia',
            });
          }
        }
      }
      await setCache(cacheKey, 'commons', catImages);
    }

    images.push(...catImages);
  }

  // Strategy 2: Image from Wikidata P18 claim
  if (wikidataQid) {
    const entity = await fetchWikidataEntity(wikidataQid);
    if (entity?.claims?.P18) {
      const filename = entity.claims.P18[0]?.mainsnak?.datavalue?.value;
      if (filename) {
        const encoded = encodeURIComponent(filename.replace(/ /g, '_'));
        images.push({
          url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=800`,
          originalUrl: `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}`,
          width: 0,
          height: 0,
          source: 'wikimedia',
        });
      }
    }
  }

  // Strategy 3: Wikipedia article images
  if (wikiTitle) {
    const cacheKey = `wikipedia:images:en:${wikiTitle}`;
    let wikiImages = await getCached(cacheKey);

    if (!wikiImages) {
      const encoded = encodeURIComponent(wikiTitle);
      const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encoded}&prop=images&imlimit=10&format=json&redirects=1`;
      const { data } = await httpGet(url);

      wikiImages = [];
      if (data?.query?.pages) {
        const page = Object.values(data.query.pages)[0];
        if (page?.images) {
          for (const img of page.images) {
            const filename = img.title?.replace('File:', '');
            if (filename && /\.(jpg|jpeg|png|webp)$/i.test(filename)) {
              const encoded2 = encodeURIComponent(filename.replace(/ /g, '_'));
              wikiImages.push({
                url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded2}?width=800`,
                originalUrl: `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded2}`,
                width: 0,
                height: 0,
                source: 'wikipedia',
              });
            }
          }
        }
      }
      await setCache(cacheKey, 'wikipedia', wikiImages);
    }

    images.push(...wikiImages);
  }

  // Deduplicate by URL and prefer landscape
  const seen = new Set();
  const unique = [];
  for (const img of images) {
    const key = img.originalUrl || img.url;
    if (seen.has(key)) continue;
    // Skip icons, logos, SVGs
    if (/\.(svg|gif)$/i.test(key)) continue;
    if (/flag|logo|icon|coat_of_arms|emblem/i.test(key)) continue;
    seen.add(key);
    unique.push(img);
  }

  // Sort: landscape first, then by size
  unique.sort((a, b) => {
    const aLandscape = a.width > a.height ? 1 : 0;
    const bLandscape = b.width > b.height ? 1 : 0;
    if (bLandscape !== aLandscape) return bLandscape - aLandscape;
    return (b.width * b.height) - (a.width * a.height);
  });

  return unique.slice(0, 8); // Max 8 images per place
}

// =============================================================================
// WIKIDATA METADATA EXTRACTION
// =============================================================================
// Extract structured metadata from a Wikidata entity.

const HERITAGE_MAP = {
  'Q9259':      'UNESCO World Heritage Site',
  'Q43113623':  'UNESCO World Heritage Site (Tentative)',
  'Q15700834':  'ASI Protected Monument',
  'Q1459902':   'National Monument',
  'Q1435952':   'State Protected Monument',
  'Q358':       'World Heritage Site',
  'Q210272':    'Cultural Heritage',
};

function extractWikidataMetadata(entity) {
  if (!entity?.claims) return {};

  const claims = entity.claims;

  function getClaimValue(prop) {
    const claim = claims[prop];
    if (!claim || !claim[0]?.mainsnak?.datavalue) return null;
    return claim[0].mainsnak.datavalue.value;
  }

  function getClaimString(prop) {
    const val = getClaimValue(prop);
    if (typeof val === 'string') return val;
    if (val?.text) return val.text;
    if (val?.id) return val.id;
    return null;
  }

  function getClaimNumber(prop) {
    const val = getClaimValue(prop);
    if (typeof val === 'number') return val;
    if (val?.amount) return parseFloat(val.amount);
    return null;
  }

  function getInstanceOf() {
    return (claims.P31 || [])
      .map(c => c?.mainsnak?.datavalue?.value?.id)
      .filter(Boolean)
      .slice(0, 10);
  }

  function getHeritageStatus() {
    const claim = claims.P1435;
    if (!claim || claim.length === 0) return null;
    const id = claim[0]?.mainsnak?.datavalue?.value?.id;
    return HERITAGE_MAP[id] || (id ? 'Heritage Site' : null);
  }

  function getAliases() {
    if (!entity.aliases?.en) return [];
    return entity.aliases.en.map(a => a.value).slice(0, 10);
  }

  function getCoordinates() {
    const val = getClaimValue('P625');
    if (val?.latitude && val?.longitude) return { lat: val.latitude, lon: val.longitude };
    return null;
  }

  function getCommonsImage() {
    const filename = getClaimString('P18');
    if (!filename) return null;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename.replace(/ /g, '_'))}?width=800`;
  }

  return {
    population:       getClaimNumber('P1082'),
    elevation:        getClaimNumber('P2044'),
    officialWebsite:  getClaimString('P856'),
    heritageStatus:   getHeritageStatus(),
    openingDate:      getClaimString('P1619'),
    instanceOf:       getInstanceOf(),
    country:          getClaimString('P17'),
    adminEntity:      getClaimString('P131'),
    commonsImage:     getCommonsImage(),
    commonsCategory:  getClaimString('P373'),
    coordinates:      getCoordinates(),
    aliases:          getAliases(),
    officialName:     entity.labels?.en?.value || null,
    description:      entity.descriptions?.en?.value || null,
    enWikiTitle:      entity.sitelinks?.enwiki?.title || null,
  };
}

// =============================================================================
// MAIN ENRICHMENT FUNCTION — Processes one place through all 7 stages
// =============================================================================

/**
 * Check if a place name is valid enough to attempt enrichment.
 * Skips junk entries like '......', '#cc8976', '*park*', etc.
 */
function isValidPlaceName(name) {
  if (!name || name.length < 3) return false;
  // Must contain at least 2 alphabetic characters (any script)
  const letterCount = (name.match(/\p{L}/gu) || []).length;
  if (letterCount < 2) return false;
  // Skip names that are mostly punctuation/symbols
  const symbolRatio = (name.match(/[^\p{L}\p{N}\s]/gu) || []).length / name.length;
  if (symbolRatio > 0.5) return false;
  // Skip names that start with # or * or pure numbers
  if (/^[#*\d]/.test(name)) return false;
  return true;
}

async function enrichPlace(place) {
  // ── Skip junk place names ───────────────────────────────────────────────
  if (!isValidPlaceName(place.name)) {
    return { status: 'skipped', reason: 'invalid_name', fields: [] };
  }
  const enrichedFields = [];

  // ── Respect manual edits ────────────────────────────────────────────────
  try {
    const { data: manualEdit } = await supabase
      .from('place_descriptions')
      .select('id')
      .eq('place_id', place.id)
      .eq('is_manual_edit', true)
      .limit(1);
    if (manualEdit && manualEdit.length > 0) {
      return { status: 'skipped', reason: 'manual_edit', fields: [] };
    }
  } catch {}

  // ── Check if source is still fresh ──────────────────────────────────────
  if (!FRESH) {
    try {
      const { data: src } = await supabase
        .from('place_sources')
        .select('next_fetch_after,status')
        .eq('place_id', place.id)
        .eq('source_name', 'enrichment_v2')
        .limit(1)
        .single();
      if (src && src.status === 'success' && new Date(src.next_fetch_after) > new Date()) {
        return { status: 'skipped', reason: 'cache_fresh', fields: [] };
      }
    } catch {}
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 1: Extract existing OSM tags
  // ══════════════════════════════════════════════════════════════════════════
  const osmTags = extractOsmTags(place);
  log(`  📋 OSM tags for "${place.name}": wikidata=${osmTags.wikidataId || 'none'}, wikipedia=${osmTags.wikipediaTag || 'none'}`);

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 2 & 3: Resolve Wikidata entity
  // ══════════════════════════════════════════════════════════════════════════
  let wikidataId = osmTags.wikidataId;
  let wikidataEntity = null;
  let resolveMethod = 'none';

  // Stage 2: Direct Wikidata fetch if ID is known
  if (wikidataId) {
    wikidataEntity = await fetchWikidataEntity(wikidataId);
    if (wikidataEntity) resolveMethod = 'osm_tag';
    log(`  📡 Direct Wikidata fetch: ${wikidataEntity ? '✅' : '❌'}`);
  }

  // Stage 2b: Try extracting QID from wiki_url via Wikipedia summary API
  if (!wikidataEntity && osmTags.wikiUrl) {
    const match = osmTags.wikiUrl.match(/wikipedia\.org\/wiki\/(.+)$/);
    if (match) {
      const title = decodeURIComponent(match[1].replace(/_/g, ' '));
      const summary = await fetchWikipediaSummary(title);
      if (summary?.wikibaseItem) {
        wikidataId = summary.wikibaseItem;
        wikidataEntity = await fetchWikidataEntity(wikidataId);
        if (wikidataEntity) resolveMethod = 'wiki_url';
        log(`  📡 Via wiki_url → QID ${wikidataId}: ${wikidataEntity ? '✅' : '❌'}`);
      }
    }
  }

  // Stage 2c: Try the OSM wikipedia=en:Title tag
  if (!wikidataEntity && osmTags.wikipediaTag) {
    const parsed = parseWikipediaTag(osmTags.wikipediaTag);
    if (parsed) {
      const summary = await fetchWikipediaSummary(parsed.title);
      if (summary?.wikibaseItem) {
        wikidataId = summary.wikibaseItem;
        wikidataEntity = await fetchWikidataEntity(wikidataId);
        if (wikidataEntity) resolveMethod = 'wikipedia_tag';
        log(`  📡 Via wikipedia tag → QID ${wikidataId}: ${wikidataEntity ? '✅' : '❌'}`);
      }
    }
  }

  // Stage 3: Search Wikidata with intelligent queries
  if (!wikidataEntity) {
    const bestMatch = await searchWikidata(place);
    if (bestMatch) {
      wikidataId = bestMatch.id;
      wikidataEntity = await fetchWikidataEntity(wikidataId);
      if (wikidataEntity) resolveMethod = 'wikidata_search';
      log(`  🔍 Wikidata search → "${bestMatch.label}" (${bestMatch.id}, score=${bestMatch.score.toFixed(2)})`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXTRACT METADATA from Wikidata entity
  // ══════════════════════════════════════════════════════════════════════════
  let metadata = {};
  let wikiTitle = null;
  let commonsCategory = null;

  if (wikidataEntity) {
    metadata = extractWikidataMetadata(wikidataEntity);
    wikiTitle = metadata.enWikiTitle;
    commonsCategory = metadata.commonsCategory;
    enrichedFields.push('metadata');

    // Save metadata to place_metadata table
    if (!DRY_RUN) {
      try {
        await supabase.from('place_metadata').upsert({
          place_id: place.id,
          population: metadata.population,
          elevation: metadata.elevation,
          official_website: metadata.officialWebsite || osmTags.website,
          heritage_status: metadata.heritageStatus,
          opening_date: metadata.openingDate,
          instance_of: metadata.instanceOf,
          country: metadata.country,
          admin_entity: metadata.adminEntity,
          commons_image: metadata.commonsImage,
          commons_category: metadata.commonsCategory,
          raw_wikidata: { claims_count: Object.keys(wikidataEntity.claims || {}).length },
        }, { onConflict: 'place_id' });
      } catch (err) {
        log(`  ❌ Metadata save error: ${err.message}`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 4: Wikipedia content
  // ══════════════════════════════════════════════════════════════════════════
  let wikiSummary = null;
  let wikiHistory = null;

  if (wikiTitle) {
    wikiSummary = await fetchWikipediaSummary(wikiTitle);

    if (wikiSummary) {
      const extractData = await fetchWikipediaExtract(wikiTitle);
      wikiHistory = extractData?.history || null;
    }
  }

  // Stage 6 Fallback: If no Wikipedia via Wikidata, try direct Wikipedia search
  if (!wikiSummary && place.name) {
    // Try name + city as Wikipedia search
    const searchQueries = buildSearchQueries(place).slice(0, 3);
    for (const query of searchQueries) {
      const encoded = encodeURIComponent(query);
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&srlimit=3&format=json`;
      const cacheKey = `wikipedia:search:en:${query}`;
      let searchResults = await getCached(cacheKey);

      if (!searchResults) {
        const { data } = await httpGet(url);
        searchResults = data?.query?.search || [];
        await setCache(cacheKey, 'wikipedia', searchResults);
      }

      if (searchResults.length > 0) {
        // Score search results by title similarity
        const scored = searchResults.map(r => ({
          title: r.title,
          score: similarity(r.title, place.name),
        }));
        scored.sort((a, b) => b.score - a.score);

        if (scored[0].score > 0.3) {
          wikiTitle = scored[0].title;
          wikiSummary = await fetchWikipediaSummary(wikiTitle);
          if (wikiSummary) {
            const extractData = await fetchWikipediaExtract(wikiTitle);
            wikiHistory = extractData?.history || null;
            break;
          }
        }
      }
    }
  }

  // ── Save description ────────────────────────────────────────────────────
  if (wikiSummary) {
    enrichedFields.push('description');
    if (!DRY_RUN) {
      try {
        await supabase.from('place_descriptions').upsert({
          place_id: place.id,
          title: wikiSummary.title,
          summary: wikiSummary.summary,
          history: wikiHistory,
          featured_image: wikiSummary.thumbnailUrl
            ? wikiSummary.thumbnailUrl.replace(/\/\d+px-/, '/800px-')
            : null,
          wikipedia_url: wikiSummary.fullUrl,
          page_id: wikiSummary.pageId,
          language: 'en',
          source: 'wikipedia',
          is_manual_edit: false,
        }, { onConflict: 'place_id,language,source' });
      } catch (err) {
        log(`  ❌ Description save error: ${err.message}`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 5: Images from Wikimedia Commons
  // ══════════════════════════════════════════════════════════════════════════
  const images = await fetchCommonsImages(commonsCategory, wikidataId, wikiTitle);

  // Add the Wikipedia summary thumbnail/original if not already included
  if (wikiSummary?.originalImageUrl) {
    const exists = images.some(i => i.originalUrl === wikiSummary.originalImageUrl || i.url === wikiSummary.originalImageUrl);
    if (!exists) {
      images.unshift({
        url: wikiSummary.originalImageUrl.includes('?') ? wikiSummary.originalImageUrl : wikiSummary.originalImageUrl,
        originalUrl: wikiSummary.originalImageUrl,
        width: 0,
        height: 0,
        source: 'wikipedia',
      });
    }
  }

  // Save all images to place_images
  if (images.length > 0) {
    enrichedFields.push(`images(${images.length})`);
    if (!DRY_RUN) {
      const imageRows = images.map((img, i) => ({
        place_id: place.id,
        url: img.url,
        source: img.source,
        priority: img.source === 'wikimedia' ? 2 : 3,
        is_primary: i === 0, // First image = primary
      }));

      for (const row of imageRows) {
        try {
          await supabase.from('place_images').upsert(row, { onConflict: 'place_id,url' });
        } catch {}
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // UPDATE PLACES TABLE — Fill in missing fields
  // ══════════════════════════════════════════════════════════════════════════
  const placeUpdates = {};

  // Wikidata ID
  if (wikidataId && !place.wikidata_id) {
    placeUpdates.wikidata_id = wikidataId;
  }

  // Description
  if (!place.description && wikiSummary?.summary) {
    placeUpdates.description = wikiSummary.summary.length > 500
      ? wikiSummary.summary.substring(0, 497) + '...'
      : wikiSummary.summary;
  }

  // Wikipedia title
  if (!place.wikipedia_title && wikiTitle) {
    placeUpdates.wikipedia_title = wikiTitle;
  }

  // Wikipedia page ID
  if (wikiSummary?.pageId) {
    placeUpdates.wikipedia_page_id = wikiSummary.pageId;
  }

  // Wiki URL
  if (!place.wiki_url && wikiSummary?.fullUrl) {
    placeUpdates.wiki_url = wikiSummary.fullUrl;
  }

  // Image (best from Commons or Wikipedia)
  if (images.length > 0) {
    placeUpdates.image_url = images[0].url;
    placeUpdates.image_source = images[0].source;
  }

  // Aliases from Wikidata
  if (metadata.aliases && metadata.aliases.length > 0 && (!place.aliases || place.aliases.length === 0)) {
    placeUpdates.aliases = metadata.aliases;
  }

  // Official name
  if (!place.official_name && metadata.officialName) {
    placeUpdates.official_name = metadata.officialName;
  }

  // Heritage status
  if (!place.heritage_status && metadata.heritageStatus) {
    placeUpdates.heritage_status = metadata.heritageStatus;
  }

  // Track what would be updated
  const updateKeys = Object.keys(placeUpdates).filter(k => k !== 'enriched_at' && k !== 'enrichment_version');
  if (updateKeys.length > 0) {
    enrichedFields.push(...updateKeys);
  }

  if (!DRY_RUN && Object.keys(placeUpdates).length > 0) {
    placeUpdates.enriched_at = new Date().toISOString();
    placeUpdates.enrichment_version = 2;
    try {
      await supabase.from('places').update(placeUpdates).eq('id', place.id);
    } catch (err) {
      log(`  ❌ Place update error: ${err.message}`);
    }
  }

  // ── Record source provenance ────────────────────────────────────────────
  if (!DRY_RUN) {
    const hasData = enrichedFields.length > 0;
    try {
      await supabase.from('place_sources').upsert({
        place_id: place.id,
        source_name: 'enrichment_v2',
        source_id: wikidataId || null,
        source_url: wikidataId ? `https://www.wikidata.org/wiki/${wikidataId}` : null,
        status: hasData ? 'success' : 'not_found',
        last_fetched: new Date().toISOString(),
        next_fetch_after: new Date(Date.now() + CACHE_DAYS * 86400000).toISOString(),
      }, { onConflict: 'place_id,source_name' });
    } catch {}
  }

  if (enrichedFields.length === 0) {
    return { status: 'not_found', reason: 'no_data_found', fields: [], method: resolveMethod };
  }

  return { status: 'enriched', fields: enrichedFields, method: resolveMethod };
}

// =============================================================================
// PARALLEL WORKER POOL
// =============================================================================
// Processes places in parallel with configurable concurrency.
// Each worker pulls from a shared queue.

async function processWithWorkers(places, onProgress) {
  let index = 0;
  const results = { enriched: 0, skipped: 0, notFound: 0, errors: 0 };
  const methods = {};

  async function worker(workerId) {
    while (index < places.length) {
      const i = index++;
      const place = places[i];

      try {
        const result = await enrichPlace(place);

        switch (result.status) {
          case 'enriched':
            results.enriched++;
            if (result.method) methods[result.method] = (methods[result.method] || 0) + 1;
            break;
          case 'not_found':
            results.notFound++;
            break;
          case 'skipped':
            results.skipped++;
            break;
          default:
            results.errors++;
        }

        onProgress(i + 1, places.length, place, result);
      } catch (err) {
        results.errors++;
        console.error(`\n  ❌ [W${workerId}] ${place.name}: ${err.message}`);
      }
    }
  }

  // Launch parallel workers
  const workerPromises = [];
  for (let w = 0; w < WORKERS; w++) {
    workerPromises.push(worker(w + 1));
  }
  await Promise.all(workerPromises);

  return { ...results, methods };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('\n🚀 ExploreHub — Multi-Stage Enrichment Pipeline v2');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🔑 Auth:       ${useServiceKey ? '✅ Service Role' : '🔑 Anon Key'}`);
  console.log(`🗄️  Database:   ${SUPABASE_URL}`);
  console.log(`👷 Workers:    ${WORKERS} parallel`);
  console.log(`📦 Batch size: ${BATCH_SIZE}`);
  console.log(`📅 Cache TTL:  ${CACHE_DAYS} days`);
  if (DRY_RUN)          console.log('🏃 Mode:       DRY RUN (no DB writes)');
  if (FRESH)            console.log('🔄 Mode:       FRESH (ignore cache)');
  if (LIMIT < Infinity) console.log(`🔢 Limit:      ${LIMIT} places`);
  if (CATEGORY)         console.log(`📂 Category:   ${CATEGORY}`);
  if (VERBOSE)          console.log('📝 Verbose:    ON');

  console.log('\n  Pipeline stages:');
  console.log('    1️⃣  Read OSM tags (wikidata, wikipedia, heritage...)');
  console.log('    2️⃣  Wikidata direct fetch (if QID known)');
  console.log('    3️⃣  Wikidata intelligent search (name + city + state)');
  console.log('    4️⃣  Wikipedia article content');
  console.log('    5️⃣  Wikimedia Commons images');
  console.log('    6️⃣  Fallback chain');
  console.log('    7️⃣  Cache everything');

  // Count total
  let countQuery = supabase.from('places').select('*', { count: 'exact', head: true });
  if (CATEGORY) countQuery = countQuery.eq('category', CATEGORY);
  const { count: totalPlaces } = await countQuery;

  const toProcess = Math.min(totalPlaces || 0, LIMIT);
  console.log(`\n  📊 Total places: ${(totalPlaces || 0).toLocaleString()}`);
  console.log(`  📊 Will process: ${toProcess.toLocaleString()}\n`);

  if (toProcess === 0) {
    console.log('  ✅ No places to enrich!');
    return;
  }

  // Load checkpoint
  let globalOffset = 0;
  let globalEnriched = 0;
  let globalSkipped = 0;
  let globalNotFound = 0;
  let globalErrors = 0;

  const checkpoint = loadCheckpoint();
  if (checkpoint) {
    globalOffset = checkpoint.offset || 0;
    globalEnriched = checkpoint.enriched || 0;
    globalSkipped = checkpoint.skipped || 0;
    globalNotFound = checkpoint.notFound || 0;
    globalErrors = checkpoint.errors || 0;
    console.log(`  ⏭️  Resuming from offset ${globalOffset} (${globalEnriched} enriched so far)\n`);
  }

  const startTime = Date.now();
  let totalProcessed = globalOffset;

  // Process in batches
  while (totalProcessed < toProcess) {
    const batchStart = totalProcessed;
    // Respect --limit: don't fetch more than remaining quota
    const remaining = toProcess - totalProcessed;
    const thisBatchSize = Math.min(BATCH_SIZE, remaining);
    let batchQuery = supabase
      .from('v_places_full')
      .select('id, name, description, image_url, wiki_url, wikidata_id, wikipedia_title, wikipedia_page_id, category, osm_id, city_name, district_name, state_name, image_source, aliases, official_name, heritage_status, metadata, latitude, longitude')
      // Filter out junk names at DB level: skip names starting with symbols/numbers
      .gt('name', 'A')
      .order('name')
      .range(batchStart, batchStart + thisBatchSize - 1);

    if (CATEGORY) batchQuery = batchQuery.eq('category', CATEGORY);

    const { data: batch, error: batchError } = await batchQuery;

    if (batchError) {
      console.error(`\n  ❌ Batch fetch error: ${batchError.message}`);
      globalErrors++;
      totalProcessed += BATCH_SIZE; // Skip this batch to avoid infinite loop
      await sleep(5000);
      continue;
    }

    if (!batch || batch.length === 0) {
      console.log('\n  ✅ No more places to process');
      break;
    }

    // Track progress within this batch without referencing batchResult
    let batchProgress = 0;

    // Process batch with parallel workers
    const batchResult = await processWithWorkers(batch, (i, total, place, result) => {
      batchProgress++;
      const currentTotal = batchStart + batchProgress;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (currentTotal / (elapsed || 1)).toFixed(1);

      if (result.status === 'enriched') {
        process.stdout.write(`\r  ✨ [${currentTotal}/${toProcess}] ${(place.name || '').substring(0, 30).padEnd(30)} → ${result.fields.slice(0, 3).join(', ')} (${result.method}) [${rate}/s]     `);
      } else if (batchProgress % 5 === 0) {
        process.stdout.write(`\r  📊 ${currentTotal}/${toProcess} | ✨${globalEnriched} ⏭️${globalSkipped} 🔍${globalNotFound} | ${elapsed}s [${rate}/s]     `);
      }
    });

    // Update totals AFTER batch completes
    totalProcessed += batch.length;
    globalEnriched += batchResult.enriched;
    globalSkipped += batchResult.skipped;
    globalNotFound += batchResult.notFound;
    globalErrors += batchResult.errors;

    // Checkpoint after each batch
    saveCheckpoint({
      offset: totalProcessed,
      enriched: globalEnriched,
      skipped: globalSkipped,
      notFound: globalNotFound,
      errors: globalErrors,
    });
  }

  // Final stats
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = (totalProcessed / (elapsed || 1)).toFixed(2);

  console.log(`\n\n  ═══════════════════════════════════════════════════════════`);
  console.log(`  ✅ Enrichment pipeline v2 complete!`);
  console.log(`  ──────────────────────────────────────────────────────────`);
  console.log(`  📊 Processed:  ${totalProcessed.toLocaleString()}`);
  console.log(`  ✨ Enriched:   ${globalEnriched.toLocaleString()}`);
  console.log(`  ⏭️  Skipped:    ${globalSkipped.toLocaleString()}`);
  console.log(`  🔍 Not found:  ${globalNotFound.toLocaleString()}`);
  console.log(`  ❌ Errors:     ${globalErrors.toLocaleString()}`);
  console.log(`  ⏱️  Time:       ${elapsed}s (${rate} places/sec)`);
  console.log(`  ═══════════════════════════════════════════════════════════\n`);

  clearCheckpoint();
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message || err);
  process.exit(1);
});
