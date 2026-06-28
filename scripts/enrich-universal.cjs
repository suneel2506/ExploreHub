#!/usr/bin/env node
// =============================================================================
// ExploreHub — Universal Multi-Tier Enrichment (Tiers 2-6)
// =============================================================================
// Generates descriptions for EVERY place using category templates + OSM data.
// Does NOT call any external APIs — uses only existing DB data.
//
// Usage:
//   node scripts/enrich-universal.cjs                       # All places
//   node scripts/enrich-universal.cjs --dry-run --limit 100 # Preview
//   node scripts/enrich-universal.cjs --quality-only         # Recalculate scores
//   node scripts/enrich-universal.cjs --category Temples     # One category
//
// Speed: 500-1000+ places/sec (DB-only, no API calls)
// =============================================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// ─── Supabase Client ──────────────────────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey     = process.env.VITE_SUPABASE_ANON_KEY;
const useServiceKey = !!serviceKey;

const supabase = createClient(supabaseUrl, serviceKey || anonKey, {
  auth: { persistSession: false },
});

// ─── CLI Args ─────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const VERBOSE     = args.includes('--verbose');
const QUALITY_ONLY= args.includes('--quality-only');
const LIMIT       = (() => { const i = args.indexOf('--limit');      return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })();
const BATCH_SIZE  = (() => { const i = args.indexOf('--batch-size'); return i >= 0 ? parseInt(args[i + 1], 10) : 200; })();
const CATEGORY    = (() => { const i = args.indexOf('--category');   return i >= 0 ? args[i + 1] : null; })();

function log(msg) { if (VERBOSE) console.log(msg); }

// ─── Checkpoint ───────────────────────────────────────────────────────────────
const CHECKPOINT_FILE = `${__dirname}/.enrich-universal-checkpoint.json`;

function loadCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
  } catch {}
  return null;
}

function saveCheckpoint(data) {
  try { fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(data), 'utf8'); } catch {}
}

function clearCheckpoint() {
  try { if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE); } catch {}
}

// =============================================================================
// TEMPLATE ENGINE
// =============================================================================
// Fills {{placeholders}} from place + hierarchy data.

/**
 * Build a description from a template and place data.
 * @param {string} template - Template with {{name}}, {{city}}, {{state}}, etc.
 * @param {Object} place - Place row from v_places_full
 * @returns {string} Generated description
 */
function fillTemplate(template, place) {
  const vars = {
    name:     place.name || 'This place',
    city:     place.city_name || '',
    district: place.district_name || '',
    state:    place.state_name || '',
    category: place.category || 'Other',
    type:     place.place_type || place.category?.toLowerCase() || 'place',
  };

  // Extract religion from metadata or name
  const meta = place.metadata || {};
  const religion = meta.religion
    || (place.name?.toLowerCase().includes('mosque') ? 'Islamic'
      : place.name?.toLowerCase().includes('church') ? 'Christian'
      : place.name?.toLowerCase().includes('gurudwara') ? 'Sikh'
      : place.name?.toLowerCase().includes('buddhist') ? 'Buddhist'
      : place.name?.toLowerCase().includes('jain') ? 'Jain'
      : 'Hindu');
  vars.religion = religion;

  // Heritage note
  vars.heritage_note = place.heritage_status
    ? ` It is designated as ${place.heritage_status}.`
    : '';

  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  // Clean up empty location references
  result = result.replace(/in\s*,\s*/g, 'in ');
  result = result.replace(/,\s*,/g, ',');
  result = result.replace(/in\s+,/g, 'in');
  result = result.replace(/\s+India\.\s*$/, ', India.');
  result = result.replace(/in\s+India\./, 'in India.');

  return result.trim();
}

// =============================================================================
// QUALITY SCORE CALCULATOR
// =============================================================================

function calculateQualityScore(place, descSource) {
  let score = 20; // Base: exists in DB with coordinates

  const hasDesc = !!place.description && place.description.length > 10;
  const hasImage = !!place.image_url && !place.image_url.includes('placeholder');
  const hasWikidata = !!place.wikidata_id;
  const hasWikiUrl = !!place.wiki_url;
  const hasMetadata = place.metadata && Object.keys(place.metadata).length > 0;
  const hasAliases = place.aliases && place.aliases.length > 0;
  const hasHeritage = !!place.heritage_status;
  const hasCoords = place.latitude != null && place.longitude != null;

  if (hasCoords) score += 5;      // 25
  if (hasDesc) score += 25;       // 50 (basic description)
  if (hasImage) score += 15;      // 65
  if (hasMetadata) score += 10;   // 75
  if (hasWikidata) score += 10;   // 85
  if (hasWikiUrl) score += 5;     // 90
  if (hasAliases) score += 3;     // 93
  if (hasHeritage) score += 7;    // 100

  // Wikipedia-sourced descriptions get a bonus
  if (descSource === 'wikipedia') score = Math.min(100, score + 5);

  return {
    score: Math.min(100, score),
    has_description: hasDesc,
    has_image: hasImage,
    has_metadata: hasMetadata || hasWikidata,
    has_history: !!place.wiki_url,
    has_coordinates: hasCoords,
    description_source: descSource || 'none',
    image_source: place.image_source || null,
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('\n🌍 ExploreHub — Universal Multi-Tier Enrichment');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🔑 Auth:       ${useServiceKey ? '✅ Service Role' : '🔑 Anon Key'}`);
  console.log(`📦 Batch size: ${BATCH_SIZE}`);
  if (DRY_RUN)      console.log('🏃 DRY RUN mode');
  if (QUALITY_ONLY) console.log('📊 QUALITY-ONLY mode (no descriptions)');
  if (CATEGORY)     console.log(`📂 Category:   ${CATEGORY}`);

  // ── Load category templates ──────────────────────────────────────────────
  const { data: templates, error: tplError } = await supabase
    .from('category_templates')
    .select('category, tier, template, fallback, icon_emoji');

  if (tplError || !templates || templates.length === 0) {
    console.error('\n❌ Failed to load category_templates. Run migration 009 first.');
    console.error('   Error:', tplError?.message || 'No templates found');
    process.exit(1);
  }

  const templateMap = {};
  for (const t of templates) {
    templateMap[t.category] = t;
  }
  console.log(`\n  📋 Loaded ${templates.length} category templates`);

  // ── Count places ─────────────────────────────────────────────────────────
  let countQuery = supabase.from('places').select('*', { count: 'exact', head: true });
  if (CATEGORY) countQuery = countQuery.eq('category', CATEGORY);
  const { count: totalPlaces } = await countQuery;

  const toProcess = Math.min(totalPlaces || 0, LIMIT);
  console.log(`  📊 Total places: ${(totalPlaces || 0).toLocaleString()}`);
  console.log(`  📊 Will process: ${toProcess.toLocaleString()}\n`);

  if (toProcess === 0) {
    console.log('  ✅ No places to process!');
    return;
  }

  // ── Load checkpoint ──────────────────────────────────────────────────────
  let processed = 0;
  let generated = 0;
  let scored = 0;
  let skipped = 0;
  let errors = 0;
  let cursorId = null;

  const checkpoint = loadCheckpoint();
  if (checkpoint) {
    processed = checkpoint.processed || 0;
    generated = checkpoint.generated || 0;
    scored = checkpoint.scored || 0;
    skipped = checkpoint.skipped || 0;
    errors = checkpoint.errors || 0;
    cursorId = checkpoint.cursorId || null;
    console.log(`  ⏭️  Resuming from ${cursorId?.substring(0,8) || 'start'} (${processed} done)\n`);
  }

  const startTime = Date.now();
  const categoryStats = {};

  // ── Process in batches ───────────────────────────────────────────────────
  while (processed < toProcess) {
    const remaining = toProcess - processed;
    const thisBatchSize = Math.min(BATCH_SIZE, remaining);

    // Fetch batch — UUID cursor, no string interpolation
    let query = supabase
      .from('v_places_full')
      .select('id, name, description, image_url, wiki_url, wikidata_id, wikipedia_title, category, place_type, city_name, district_name, state_name, image_source, aliases, heritage_status, metadata, latitude, longitude, enriched_at');

    if (cursorId) query = query.gt('id', cursorId);
    if (CATEGORY) query = query.eq('category', CATEGORY);

    query = query.order('id', { ascending: true }).limit(thisBatchSize);

    const { data: batch, error: batchError } = await query;

    if (batchError) {
      console.error(`\n  ❌ Batch error: ${batchError.message}`);
      errors++;
      // Try to advance cursor
      if (cursorId) {
        const { data: skip } = await supabase
          .from('v_places_full')
          .select('id')
          .gt('id', cursorId)
          .order('id', { ascending: true })
          .limit(1);
        if (skip?.[0]) cursorId = skip[0].id;
      }
      continue;
    }

    if (!batch || batch.length === 0) break;

    // ── Process each place in batch ──────────────────────────────────────
    const descUpserts = [];
    const scoreUpserts = [];
    const placeUpdates = [];

    for (const place of batch) {
      try {
        const cat = place.category || 'Other';
        categoryStats[cat] = (categoryStats[cat] || 0) + 1;

        // Determine description source
        let descSource = 'none';
        if (place.wiki_url || place.wikidata_id) descSource = 'wikipedia';
        else if (place.description && place.description.length > 10) descSource = 'existing';

        // ── QUALITY-ONLY mode: just calculate scores ───────────────────
        if (QUALITY_ONLY) {
          const qs = calculateQualityScore(place, descSource);
          scoreUpserts.push({ place_id: place.id, ...qs, last_scored_at: new Date().toISOString() });
          scored++;
          continue;
        }

        // ── Generate description if missing ────────────────────────────
        const hasWikiDescription = place.description && place.description.length > 20 && place.enriched_at;
        const hasExistingDesc = place.description && place.description.length > 10;

        if (hasWikiDescription) {
          // Already has a Wikipedia/enriched description — don't overwrite
          descSource = 'wikipedia';
          skipped++;
        } else {
          // Generate from template
          const tpl = templateMap[cat] || templateMap['Other'];
          if (tpl) {
            const hasLocation = place.city_name || place.state_name;
            const templateStr = hasLocation ? tpl.template : tpl.fallback;
            const generatedDesc = fillTemplate(templateStr, place);

            if (generatedDesc && generatedDesc.length > 10) {
              descSource = 'osm_generated';

              // Only update places.description if currently empty
              if (!hasExistingDesc) {
                placeUpdates.push({
                  id: place.id,
                  description: generatedDesc,
                  enriched_at: new Date().toISOString(),
                  enrichment_version: 3,
                });
              }

              // Always upsert to place_descriptions
              descUpserts.push({
                place_id: place.id,
                title: place.name,
                summary: generatedDesc,
                language: 'en',
                source: 'osm_generated',
                is_manual_edit: false,
                updated_at: new Date().toISOString(),
              });

              generated++;
              log(`  ✨ [${place.id.substring(0,8)}] "${place.name}" → ${cat} (${generatedDesc.length} chars)`);
            }
          }
        }

        // ── Calculate quality score ─────────────────────────────────────
        const qs = calculateQualityScore(place, descSource);
        scoreUpserts.push({ place_id: place.id, ...qs, last_scored_at: new Date().toISOString() });
        scored++;
      } catch (err) {
        errors++;
        log(`  ❌ [${place.id?.substring(0,8)}] "${place.name}": ${err.message}`);
      }
    }

    // ── Batch write to DB ──────────────────────────────────────────────────
    if (!DRY_RUN) {
      // Upsert descriptions
      if (descUpserts.length > 0) {
        const { error: descErr } = await supabase
          .from('place_descriptions')
          .upsert(descUpserts, { onConflict: 'place_id,language,source' });
        if (descErr) log(`  ⚠️ Description upsert error: ${descErr.message}`);
      }

      // Upsert quality scores
      if (scoreUpserts.length > 0) {
        const { error: scoreErr } = await supabase
          .from('place_quality_scores')
          .upsert(scoreUpserts, { onConflict: 'place_id' });
        if (scoreErr) log(`  ⚠️ Quality score upsert error: ${scoreErr.message}`);
      }

      // Update places with generated descriptions
      for (const upd of placeUpdates) {
        const { id, ...fields } = upd;
        await supabase.from('places').update(fields).eq('id', id);
      }
    }

    // ── Update cursor + progress ───────────────────────────────────────────
    cursorId = batch[batch.length - 1].id;
    processed += batch.length;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (processed / (elapsed || 1)).toFixed(1);
    process.stdout.write(`\r  📊 ${processed.toLocaleString()}/${toProcess.toLocaleString()} | ✨${generated} scored:${scored} ⏭️${skipped} ❌${errors} | ${elapsed}s [${rate}/s]     `);

    // Checkpoint every 5 batches
    if (Math.floor(processed / BATCH_SIZE) % 5 === 0) {
      saveCheckpoint({ processed, generated, scored, skipped, errors, cursorId });
    }
  }

  // ── Final stats ──────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = (processed / (elapsed || 1)).toFixed(2);

  console.log(`\n\n  ═══════════════════════════════════════════════════════════`);
  console.log(`  ✅ Universal enrichment complete!`);
  console.log(`  ──────────────────────────────────────────────────────────`);
  console.log(`  📊 Processed:    ${processed.toLocaleString()}`);
  console.log(`  ✨ Generated:    ${generated.toLocaleString()} descriptions`);
  console.log(`  📊 Scored:       ${scored.toLocaleString()} quality scores`);
  console.log(`  ⏭️  Skipped:      ${skipped.toLocaleString()} (already enriched)`);
  console.log(`  ❌ Errors:       ${errors.toLocaleString()}`);
  console.log(`  ⏱️  Time:         ${elapsed}s (${rate} places/sec)`);

  // Category breakdown
  if (Object.keys(categoryStats).length > 0) {
    console.log(`  ── Category breakdown ────────────────────────────────────`);
    const sorted = Object.entries(categoryStats).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted.slice(0, 15)) {
      const tpl = templateMap[cat];
      console.log(`     ${(tpl?.icon_emoji || '📍')} ${cat.padEnd(20)} ${count.toLocaleString().padStart(6)}  (Tier ${tpl?.tier || 6})`);
    }
    if (sorted.length > 15) console.log(`     ... and ${sorted.length - 15} more categories`);
  }

  console.log(`  ═══════════════════════════════════════════════════════════\n`);

  clearCheckpoint();
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message || err);
  process.exit(1);
});
