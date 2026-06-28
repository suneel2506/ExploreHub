#!/usr/bin/env node
// =============================================================================
// ExploreHub — Government Tourism Data Import Script
// =============================================================================
//
// Imports government/official tourism data from CSV or JSON files.
// Merges alongside Wikipedia data without replacing it.
//
// INPUT FORMAT (CSV):
//   name, state, district, city, category, description, ranking,
//   image_url, website, tags (comma-separated)
//
// INPUT FORMAT (JSON):
//   [{ name, state, district, city, category, description, ranking,
//      image_url, website, tags: [...] }]
//
// USAGE:
//   node scripts/import-tourism.cjs --file data/tourism.csv
//   node scripts/import-tourism.cjs --file data/tourism.json
//   node scripts/import-tourism.cjs --file data/tourism.csv --dry-run
//   node scripts/import-tourism.cjs --file data/tourism.csv --limit 100
//
// =============================================================================
'use strict';

const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY;

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const LIMIT    = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })();
const FILE     = (() => { const i = args.indexOf('--file');  return i >= 0 ? args[i + 1] : null; })();

const useServiceKey = SERVICE_KEY && SERVICE_KEY !== 'your-service-role-key-here';
const API_KEY       = useServiceKey ? SERVICE_KEY : ANON_KEY;
if (!SUPABASE_URL || !API_KEY) { console.error('\n❌ Missing env vars\n'); process.exit(1); }

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, API_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

// ─── CSV Parser (simple, handles quoted fields) ───────────────────────────────
function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim().toLowerCase()] = (values[i] || '').trim(); });
    return obj;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if (char === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += char;
  }
  result.push(current);
  return result;
}

// ─── Duplicate Detection ──────────────────────────────────────────────────────
async function findExistingPlace(name, lat, lon, district) {
  // Try by name + proximity
  const { data } = await supabase.rpc('find_duplicates', {
    p_osm_id: null,
    p_wikidata_id: null,
    p_name: name,
    p_lat: lat || null,
    p_lon: lon || null,
    p_radius_km: 1.0,
  });

  if (data && data.length > 0) return data[0].place_id;

  // Try by name + district
  if (district) {
    const { data: places } = await supabase
      .from('v_places_full')
      .select('id')
      .ilike('name', name)
      .ilike('district_name', district)
      .limit(1);
    if (places?.length > 0) return places[0].id;
  }

  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🏛️  ExploreHub — Government Tourism Import');
  console.log('═══════════════════════════════════════════════════');

  if (!FILE) {
    console.error('❌ Please specify --file path/to/data.csv or data.json');
    console.log('\nExpected CSV columns:');
    console.log('  name, state, district, city, category, description,');
    console.log('  ranking, image_url, website, latitude, longitude, tags\n');
    process.exit(1);
  }

  if (!fs.existsSync(FILE)) {
    console.error(`❌ File not found: ${FILE}`);
    process.exit(1);
  }

  // Parse input file
  const content = fs.readFileSync(FILE, 'utf8');
  let records;

  if (FILE.endsWith('.json')) {
    records = JSON.parse(content);
    if (!Array.isArray(records)) records = [records];
  } else {
    records = parseCSV(content);
  }

  const toProcess = Math.min(records.length, LIMIT);
  console.log(`📊 Records: ${records.length} | Processing: ${toProcess}`);
  if (DRY_RUN) console.log('🏃 DRY RUN mode');

  let processed = 0, updated = 0, inserted = 0, skipped = 0, errors = 0;

  for (const record of records.slice(0, toProcess)) {
    processed++;
    const name = record.name?.trim();
    if (!name) { skipped++; continue; }

    try {
      // Find existing place
      const lat = parseFloat(record.latitude) || null;
      const lon = parseFloat(record.longitude) || null;
      const existingId = await findExistingPlace(name, lat, lon, record.district);

      if (existingId) {
        // ── Update existing place with tourism data ───────────────────────
        if (!DRY_RUN) {
          // Save tourism description to place_descriptions (won't overwrite wikipedia)
          if (record.description) {
            await supabase.from('place_descriptions').upsert({
              place_id: existingId,
              title: name,
              summary: record.description.substring(0, 2000),
              language: 'en',
              source: 'tourism',
              is_manual_edit: false,
            }, { onConflict: 'place_id,language,source' });
          }

          // Save tourism image with highest priority
          if (record.image_url) {
            await supabase.from('place_images').upsert({
              place_id: existingId,
              url: record.image_url,
              source: 'government',
              priority: 1,
              is_primary: false, // download-images.js will set primary
            }, { onConflict: 'place_id,url' });
          }

          // Save metadata
          const metadataUpdates = {};
          if (record.website) metadataUpdates.official_website = record.website;

          if (Object.keys(metadataUpdates).length > 0) {
            await supabase.from('place_metadata').upsert({
              place_id: existingId,
              ...metadataUpdates,
            }, { onConflict: 'place_id' });
          }

          // Save tags
          if (record.tags) {
            const tagNames = (typeof record.tags === 'string' ? record.tags.split(',') : record.tags)
              .map(t => t.trim()).filter(Boolean);

            for (const tagName of tagNames) {
              const { data: cat } = await supabase
                .from('categories')
                .select('id')
                .eq('name', tagName)
                .limit(1)
                .single();

              if (cat) {
                await supabase.from('place_tags').upsert({
                  place_id: existingId,
                  category_id: cat.id,
                  source: 'government',
                }, { onConflict: 'place_id,category_id' });
              }
            }
          }

          // Update place_sources
          await supabase.from('place_sources').upsert({
            place_id: existingId,
            source_name: 'government',
            source_url: record.source_url || null,
            status: 'success',
            last_fetched: new Date().toISOString(),
            next_fetch_after: new Date(Date.now() + 90 * 86400000).toISOString(),
          }, { onConflict: 'place_id,source_name' });

          // Update tourism_info on places table
          await supabase.from('places').update({
            tourism_info: {
              ranking: record.ranking || null,
              tourism_category: record.category || null,
              source: 'government',
            },
          }).eq('id', existingId);
        }
        updated++;
        process.stdout.write(`\r  📝 [${processed}/${toProcess}] Updated: ${name.substring(0, 40)}`);
      } else {
        // ── Place doesn't exist — skip or insert ──────────────────────────
        // Only insert if we have coordinates
        if (lat && lon && !DRY_RUN) {
          // Find nearest city
          const { data: nearCity } = await supabase.rpc('find_nearest_city', {
            p_lat: lat, p_lon: lon, p_max_km: 75,
          });
          const cityId = nearCity?.[0]?.city_id || null;

          const { data: newPlace, error: insertErr } = await supabase
            .from('places')
            .insert({
              name,
              description: record.description?.substring(0, 2000) || null,
              city_id: cityId,
              category: record.category || 'Attractions',
              latitude: lat,
              longitude: lon,
              image_url: record.image_url || null,
              image_source: record.image_url ? 'government' : null,
              source: 'Government',
              tourism_info: {
                ranking: record.ranking || null,
                tourism_category: record.category || null,
              },
            })
            .select('id')
            .single();

          if (newPlace) inserted++;
          else if (insertErr) errors++;
        } else {
          skipped++;
        }
      }
    } catch (err) {
      errors++;
      console.error(`\n  ❌ ${name}: ${err.message}`);
    }
  }

  console.log(`\n\n  ═══════════════════════════════════════════════════`);
  console.log(`  ✅ Tourism import complete!`);
  console.log(`  📊 Processed: ${processed} | 📝 Updated: ${updated} | ➕ Inserted: ${inserted}`);
  console.log(`  ⏭️ Skipped: ${skipped} | ❌ Errors: ${errors}`);
  console.log(`  ═══════════════════════════════════════════════════\n`);
}

main().catch(err => { console.error('\n❌ Fatal:', err.message || err); process.exit(1); });
