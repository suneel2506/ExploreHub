#!/usr/bin/env node
// =============================================================================
// ExploreHub — Duplicate Detection & Merge Script
// =============================================================================
//
// Scans all places and detects duplicates using:
//   1. Exact match: OSM ID, Wikidata ID, Wikipedia Page ID
//   2. Fuzzy match: name similarity (>0.6) + coordinates within 500m
//
// Outputs a report CSV of suspected duplicates.
// --auto-merge flag merges them using the merge_duplicate_places RPC.
//
// USAGE:
//   node scripts/detect-duplicates.cjs                 Scan & report
//   node scripts/detect-duplicates.cjs --auto-merge    Auto-merge confirmed dupes
//   node scripts/detect-duplicates.cjs --threshold 0.7 Name similarity threshold
//   node scripts/detect-duplicates.cjs --radius 0.5    Radius in km
//   node scripts/detect-duplicates.cjs --limit 5000    Process N places max
//   node scripts/detect-duplicates.cjs --dry-run       Preview mode
//
// =============================================================================
'use strict';

const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY;

const args         = process.argv.slice(2);
const DRY_RUN      = args.includes('--dry-run');
const AUTO_MERGE   = args.includes('--auto-merge');
const LIMIT        = (() => { const i = args.indexOf('--limit');     return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })();
const THRESHOLD    = (() => { const i = args.indexOf('--threshold'); return i >= 0 ? parseFloat(args[i + 1]) : 0.6; })();
const RADIUS_KM    = (() => { const i = args.indexOf('--radius');    return i >= 0 ? parseFloat(args[i + 1]) : 0.5; })();
const BATCH_SIZE   = 100;

const useServiceKey = SERVICE_KEY && SERVICE_KEY !== 'your-service-role-key-here';
const API_KEY       = useServiceKey ? SERVICE_KEY : ANON_KEY;
if (!SUPABASE_URL || !API_KEY) { console.error('\n❌ Missing env vars\n'); process.exit(1); }

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, API_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

// ─── Similarity helper (Levenshtein-based) ────────────────────────────────────
function similarity(a, b) {
  if (!a || !b) return 0;
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;

  const longer  = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  // Simple Levenshtein
  const costs = [];
  for (let i = 0; i <= longer.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) { costs[j] = j; }
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (longer[i - 1] !== shorter[j - 1]) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }

  return 1 - costs[shorter.length] / longer.length;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍 ExploreHub — Duplicate Detection');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Similarity threshold: ${THRESHOLD}`);
  console.log(`  Radius: ${RADIUS_KM}km`);
  if (AUTO_MERGE) console.log('  ⚠️  AUTO-MERGE enabled');
  if (DRY_RUN) console.log('  🏃 DRY RUN mode');

  // ── Phase 1: Exact ID duplicates ────────────────────────────────────────
  console.log('\n  ═══ Phase 1: Exact ID Duplicates ═══');

  // OSM ID duplicates
  const { data: osmDupes } = await supabase.rpc('find_osm_id_duplicates') || { data: null };
  // Since RPC may not exist, do it manually
  const { data: places } = await supabase
    .from('places')
    .select('id, name, osm_id, wikidata_id, wikipedia_page_id, latitude, longitude, category, enriched_at')
    .not('osm_id', 'is', null)
    .order('name')
    .limit(Math.min(LIMIT, 50000));

  if (!places || places.length === 0) {
    console.log('  ✅ No places to scan');
    return;
  }

  console.log(`  📊 Scanning ${places.length.toLocaleString()} places...`);

  const duplicateGroups = [];
  const processedIds = new Set();

  // Group by OSM ID
  const byOsmId = {};
  const byWikidataId = {};
  const byWikiPageId = {};

  for (const p of places) {
    if (p.osm_id) {
      if (!byOsmId[p.osm_id]) byOsmId[p.osm_id] = [];
      byOsmId[p.osm_id].push(p);
    }
    if (p.wikidata_id) {
      if (!byWikidataId[p.wikidata_id]) byWikidataId[p.wikidata_id] = [];
      byWikidataId[p.wikidata_id].push(p);
    }
    if (p.wikipedia_page_id) {
      if (!byWikiPageId[p.wikipedia_page_id]) byWikiPageId[p.wikipedia_page_id] = [];
      byWikiPageId[p.wikipedia_page_id].push(p);
    }
  }

  // Find groups with >1 entry
  for (const [id, group] of Object.entries(byOsmId)) {
    if (group.length > 1) {
      duplicateGroups.push({ reason: 'osm_id', id, places: group });
      group.forEach(p => processedIds.add(p.id));
    }
  }
  for (const [id, group] of Object.entries(byWikidataId)) {
    if (group.length > 1 && !group.every(p => processedIds.has(p.id))) {
      duplicateGroups.push({ reason: 'wikidata_id', id, places: group });
      group.forEach(p => processedIds.add(p.id));
    }
  }
  for (const [id, group] of Object.entries(byWikiPageId)) {
    if (group.length > 1 && !group.every(p => processedIds.has(p.id))) {
      duplicateGroups.push({ reason: 'wikipedia_page_id', id, places: group });
      group.forEach(p => processedIds.add(p.id));
    }
  }

  console.log(`  🔍 Found ${duplicateGroups.length} exact ID duplicate groups`);

  // ── Phase 2: Fuzzy spatial duplicates ───────────────────────────────────
  console.log('\n  ═══ Phase 2: Fuzzy Spatial Duplicates ═══');

  let fuzzyChecked = 0;
  const spatialDupes = [];

  // Build a spatial grid for efficient lookup
  const grid = {};
  const cellSize = 0.01; // ~1.1km cells

  for (const p of places) {
    if (processedIds.has(p.id)) continue;
    const cellKey = `${Math.floor(p.latitude / cellSize)},${Math.floor(p.longitude / cellSize)}`;
    if (!grid[cellKey]) grid[cellKey] = [];
    grid[cellKey].push(p);
  }

  // Check neighbors
  for (const [cellKey, cellPlaces] of Object.entries(grid)) {
    const [cRow, cCol] = cellKey.split(',').map(Number);

    // Get all neighboring cells
    const neighbors = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nKey = `${cRow + dr},${cCol + dc}`;
        if (grid[nKey]) neighbors.push(...grid[nKey]);
      }
    }

    for (const p1 of cellPlaces) {
      if (processedIds.has(p1.id)) continue;

      for (const p2 of neighbors) {
        if (p2.id === p1.id || processedIds.has(p2.id)) continue;

        const dist = haversine(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
        if (dist > RADIUS_KM) continue;

        const sim = similarity(p1.name, p2.name);
        if (sim >= THRESHOLD) {
          spatialDupes.push({
            reason: 'coords_name',
            similarity: sim.toFixed(3),
            distance_km: dist.toFixed(3),
            places: [p1, p2],
          });
          processedIds.add(p2.id);
          fuzzyChecked++;
        }
      }
    }
  }

  console.log(`  🔍 Found ${spatialDupes.length} fuzzy spatial duplicate pairs`);

  // ── Phase 3: Report ─────────────────────────────────────────────────────
  const allDupes = [...duplicateGroups, ...spatialDupes];
  const totalDupes = allDupes.length;

  console.log(`\n  ═══ Summary ═══`);
  console.log(`  📊 Total duplicate groups: ${totalDupes}`);
  console.log(`  📊 Exact ID duplicates:    ${duplicateGroups.length}`);
  console.log(`  📊 Fuzzy spatial dupes:    ${spatialDupes.length}`);

  // Write CSV report
  const reportPath = path.join(__dirname, '..', 'duplicate-report.csv');
  const csvLines = ['reason,similarity,distance_km,place1_id,place1_name,place1_category,place2_id,place2_name,place2_category'];

  for (const group of allDupes) {
    const p1 = group.places[0];
    for (let i = 1; i < group.places.length; i++) {
      const p2 = group.places[i];
      csvLines.push([
        group.reason,
        group.similarity || '1.000',
        group.distance_km || '0.000',
        p1.id, `"${p1.name}"`, p1.category,
        p2.id, `"${p2.name}"`, p2.category,
      ].join(','));
    }
  }

  fs.writeFileSync(reportPath, csvLines.join('\n'));
  console.log(`\n  📄 Report saved: ${reportPath}`);

  // ── Phase 4: Auto-merge ─────────────────────────────────────────────────
  if (AUTO_MERGE && !DRY_RUN && totalDupes > 0) {
    console.log('\n  ⏳ Auto-merging duplicates...');
    let merged = 0, mergeErrors = 0;

    for (const group of allDupes) {
      // Keep the place with more data (enriched_at not null, or longer description)
      const sorted = [...group.places].sort((a, b) => {
        if (a.enriched_at && !b.enriched_at) return -1;
        if (!a.enriched_at && b.enriched_at) return 1;
        return 0;
      });

      const target = sorted[0]; // Keep this one
      for (let i = 1; i < sorted.length; i++) {
        const source = sorted[i];
        try {
          const { data, error } = await supabase.rpc('merge_duplicate_places', {
            p_source_id: source.id,
            p_target_id: target.id,
          });

          if (error) {
            mergeErrors++;
            console.error(`\n  ❌ Merge failed: ${source.name} → ${target.name}: ${error.message}`);
          } else if (data?.error) {
            mergeErrors++;
          } else {
            merged++;
            process.stdout.write(`\r  ✅ Merged ${merged} pairs`);
          }
        } catch (err) {
          mergeErrors++;
        }
      }
    }

    console.log(`\n  📊 Merged: ${merged} | Errors: ${mergeErrors}`);
  }

  console.log('\n  ✅ Duplicate detection complete!\n');
}

main().catch(err => { console.error('\n❌ Fatal:', err.message || err); process.exit(1); });
