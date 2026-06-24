#!/usr/bin/env node
// =============================================================================
// Explore Hub — OSM Import Script
// =============================================================================
// Parses india-260623.osm.pbf and imports relevant places to Supabase.
//
// USAGE:
//   1. Add SUPABASE_SERVICE_KEY to .env
//   2. Run: node scripts/import-osm.cjs
//
// ESTIMATED TIME: 20-60 minutes for the full India dataset.
// =============================================================================

'use strict';

const fs      = require('fs');
const path    = require('path');
const through = require('through2');
const parse   = require('osm-pbf-parser');
const { createClient } = require('@supabase/supabase-js');

// Load .env manually (dotenv)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE || SUPABASE_SERVICE === 'your-service-role-key-here') {
  console.error('\n❌ ERROR: SUPABASE_SERVICE_KEY is missing or is still a placeholder.');
  console.error('   Add your service role key to .env:');
  console.error('   SUPABASE_SERVICE_KEY=eyJhbGci...\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { persistSession: false }
});

// OSM PBF file path — auto-detect
const PBF_FILE = fs.existsSync(path.join(__dirname, '..', 'india-260623.osm.pbf'))
  ? path.join(__dirname, '..', 'india-260623.osm.pbf')
  : path.join(__dirname, '..', 'india-latest.osm.pbf');

if (!fs.existsSync(PBF_FILE)) {
  console.error(`\n❌ ERROR: OSM file not found. Expected one of:\n  india-260623.osm.pbf\n  india-latest.osm.pbf\n`);
  process.exit(1);
}

// =============================================================================
// CATEGORY MAPPING
// =============================================================================
function categorize(tags) {
  // Natural features
  if (tags.natural === 'waterfall')     return 'Waterfalls';
  if (tags.natural === 'beach')         return 'Beaches';
  if (tags.natural === 'peak' || tags.natural === 'volcano') return 'Mountains';
  if (tags.natural === 'lake' || tags.natural === 'water')   return 'Lakes';
  if (tags.natural === 'forest')        return 'Forests';
  if (tags.natural === 'cave_entrance') return 'Caves';
  if (tags.natural === 'hot_spring')    return 'Attractions';

  // Tourism
  if (tags.tourism === 'museum')        return 'Museums';
  if (tags.tourism === 'viewpoint')     return 'Viewpoints';
  if (tags.tourism === 'zoo' || tags.tourism === 'aquarium') return 'Wildlife';
  if (tags.tourism === 'theme_park')    return 'Attractions';
  if (tags.tourism === 'attraction' || tags.tourism === 'artwork') return 'Attractions';

  // Leisure
  if (tags.leisure === 'nature_reserve') return 'National Parks';
  if (tags.leisure === 'park')          return 'Parks';

  // Historic
  if (tags.historic)                    return 'Historical';

  // Place of worship → Temples
  if (tags.amenity === 'place_of_worship') return 'Temples';

  // Populated places
  if (tags.place === 'city' || tags.place === 'town')  return 'Cities';
  if (tags.place === 'village')                         return 'Villages';

  return null; // Not relevant
}

// =============================================================================
// TAG EXTRACTION HELPERS
// =============================================================================
function getName(tags) {
  return tags['name:en'] || tags.name || tags['name:hi'] || null;
}

function getState(tags) {
  return (
    tags['addr:state'] ||
    tags['is_in:state'] ||
    tags['addr:state_district'] ||
    null
  );
}

function getDistrict(tags) {
  return tags['addr:district'] || tags['addr:county'] || null;
}

function getCity(tags) {
  return tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || null;
}

function getDescription(tags) {
  return tags.description || tags.note || null;
}

function getPlaceType(tags) {
  // More specific classification
  if (tags.natural)   return tags.natural;
  if (tags.tourism)   return tags.tourism;
  if (tags.historic)  return tags.historic;
  if (tags.leisure)   return tags.leisure;
  if (tags.amenity)   return tags.amenity;
  if (tags.place)     return tags.place;
  return null;
}

// =============================================================================
// RELEVANCE CHECK
// =============================================================================
function isRelevant(tags) {
  const name = getName(tags);
  if (!name || name.trim() === '') return false; // Unnamed features are useless

  if (tags.natural === 'waterfall')       return true;
  if (tags.natural === 'beach')           return true;
  if (tags.natural === 'peak')            return true;
  if (tags.natural === 'volcano')         return true;
  if (tags.natural === 'lake')            return true;
  if (tags.natural === 'forest')          return true;
  if (tags.natural === 'cave_entrance')   return true;
  if (tags.natural === 'hot_spring')      return true;

  if (tags.tourism === 'attraction')      return true;
  if (tags.tourism === 'museum')          return true;
  if (tags.tourism === 'viewpoint')       return true;
  if (tags.tourism === 'zoo')             return true;
  if (tags.tourism === 'aquarium')        return true;
  if (tags.tourism === 'theme_park')      return true;
  if (tags.tourism === 'artwork')         return !!(tags['name']);

  if (tags.leisure === 'nature_reserve')  return true;
  if (tags.leisure === 'park')            return !!(tags['name']);

  if (tags.historic === 'monument')       return true;
  if (tags.historic === 'castle')         return true;
  if (tags.historic === 'ruins')          return true;
  if (tags.historic === 'fort')           return true;
  if (tags.historic === 'archaeological_site') return true;
  if (tags.historic === 'memorial')       return true;
  if (tags.historic === 'temple')         return true;
  if (tags.historic === 'palace')         return true;
  if (tags.historic === 'boundary_stone') return false;

  if (tags.amenity === 'place_of_worship') return true;

  if (tags.place === 'city')    return true;
  if (tags.place === 'town')    return true;
  if (tags.place === 'village') return true;

  return false;
}

// =============================================================================
// BATCH INSERT
// =============================================================================
const BATCH_SIZE   = 200;
const batch        = [];
let totalProcessed = 0;
let totalRelevant  = 0;
let totalInserted  = 0;
let totalErrors    = 0;
const startTime    = Date.now();

async function flushBatch() {
  if (batch.length === 0) return;
  const toInsert = batch.splice(0, batch.length); // drain

  const { error } = await supabase
    .from('places')
    .upsert(toInsert, {
      onConflict:     'osm_id',
      ignoreDuplicates: false,
    });

  if (error) {
    console.error(`  ⚠️  Batch insert error: ${error.message}`);
    totalErrors += toInsert.length;
  } else {
    totalInserted += toInsert.length;
  }
}

// =============================================================================
// MAIN STREAM
// =============================================================================
console.log('\n🗺️  Explore Hub — OSM Import Script');
console.log('========================================');
console.log(`📂 File: ${path.basename(PBF_FILE)} (${(fs.statSync(PBF_FILE).size / 1e9).toFixed(2)} GB)`);
console.log(`🔌 Supabase: ${SUPABASE_URL}`);
console.log('\n⏳ Streaming OSM data...\n');

const osmStream = parse();

fs.createReadStream(PBF_FILE)
  .pipe(osmStream)
  .pipe(
    through.obj(async function (items, enc, next) {
      for (const item of items) {
        // Only process nodes (have direct lat/lon)
        if (item.type !== 'node') continue;
        if (item.lat == null || item.lon == null) continue;

        totalProcessed++;

        const tags = item.tags || {};
        if (!isRelevant(tags)) continue;

        totalRelevant++;

        const name     = getName(tags);
        const category = categorize(tags);
        if (!category) continue;

        const record = {
          name:        name.trim(),
          description: getDescription(tags),
          country:     'India',
          state:       getState(tags),
          district:    getDistrict(tags),
          city:        getCity(tags),
          category,
          place_type:  getPlaceType(tags),
          latitude:    item.lat,
          longitude:   item.lon,
          osm_id:      item.id,
          source:      'OpenStreetMap',
          metadata:    {
            osm_tags: Object.fromEntries(
              Object.entries(tags).slice(0, 20) // cap stored tags
            ),
          },
        };

        batch.push(record);

        if (batch.length >= BATCH_SIZE) {
          await flushBatch();
        }

        // Progress report
        if (totalRelevant % 1000 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          const rate    = Math.round(totalProcessed / (elapsed || 1));
          process.stdout.write(
            `\r  ✅ ${totalInserted.toLocaleString()} inserted | ` +
            `📍 ${totalRelevant.toLocaleString()} relevant | ` +
            `🔍 ${totalProcessed.toLocaleString()} scanned | ` +
            `⚡ ${rate.toLocaleString()} nodes/s   `
          );
        }
      }
      next();
    })
  )
  .on('finish', async () => {
    // Flush remaining
    await flushBatch();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n\n========================================');
    console.log('✅ Import Complete!');
    console.log(`   Nodes scanned:  ${totalProcessed.toLocaleString()}`);
    console.log(`   Places found:   ${totalRelevant.toLocaleString()}`);
    console.log(`   Inserted:       ${totalInserted.toLocaleString()}`);
    console.log(`   Errors:         ${totalErrors}`);
    console.log(`   Time:           ${elapsed}s`);
    console.log('========================================\n');
  })
  .on('error', (err) => {
    console.error('\n❌ Stream error:', err.message);
    process.exit(1);
  });
