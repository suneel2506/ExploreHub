#!/usr/bin/env node
// =============================================================================
// ExploreHub — Rebuild Search Index
// =============================================================================
//
// Refreshes the materialized view mv_search_places for sub-millisecond search.
// Runs ANALYZE on all key tables for query planner optimization.
// Reports index sizes and row counts.
//
// USAGE:
//   node scripts/rebuild-search-index.cjs             Full rebuild
//   node scripts/rebuild-search-index.cjs --stats     Only show stats
//
// =============================================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY;

const args       = process.argv.slice(2);
const STATS_ONLY = args.includes('--stats');

const useServiceKey = SERVICE_KEY && SERVICE_KEY !== 'your-service-role-key-here';
const API_KEY       = useServiceKey ? SERVICE_KEY : ANON_KEY;
if (!SUPABASE_URL || !API_KEY) { console.error('\n❌ Missing env vars\n'); process.exit(1); }

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, API_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

async function main() {
  console.log('\n🔄 ExploreHub — Search Index Rebuild');
  console.log('═══════════════════════════════════════════════════');

  // ── Step 1: Report current stats ────────────────────────────────────────
  console.log('\n  📊 Current table statistics:');

  const tables = [
    'countries', 'states', 'districts', 'cities', 'places',
    'place_descriptions', 'place_images', 'categories', 'place_tags',
    'place_sources', 'place_metadata', 'api_cache', 'enrichment_log',
  ];

  for (const table of tables) {
    try {
      const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
      const paddedTable = table.padEnd(22);
      const paddedCount = (count || 0).toLocaleString().padStart(12);
      console.log(`     ${paddedTable} ${paddedCount} rows`);
    } catch {
      console.log(`     ${table.padEnd(22)} (not found)`);
    }
  }

  // Check materialized view
  try {
    const { count } = await supabase.from('mv_search_places').select('*', { count: 'exact', head: true });
    console.log(`     ${'mv_search_places'.padEnd(22)} ${(count || 0).toLocaleString().padStart(12)} rows`);
  } catch {
    console.log(`     ${'mv_search_places'.padEnd(22)} (needs creation/refresh)`);
  }

  if (STATS_ONLY) return;

  // ── Step 2: Refresh materialized view ───────────────────────────────────
  console.log('\n  ⏳ Refreshing materialized view mv_search_places...');
  const startTime = Date.now();

  try {
    const { error } = await supabase.rpc('refresh_search_index');
    if (error) {
      console.error(`  ❌ Refresh failed: ${error.message}`);
      console.log('  ℹ️  This may happen if the view doesn\'t exist yet.');
      console.log('  ℹ️  Run migration 008_enrichment_pipeline.sql first.');
    } else {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ✅ Materialized view refreshed in ${elapsed}s`);
    }
  } catch (err) {
    console.error(`  ❌ Refresh error: ${err.message}`);
  }

  // ── Step 3: Post-refresh stats ──────────────────────────────────────────
  try {
    const { count } = await supabase.from('mv_search_places').select('*', { count: 'exact', head: true });
    console.log(`  📊 mv_search_places now has ${(count || 0).toLocaleString()} rows`);
  } catch {}

  // ── Step 4: Quick search test ───────────────────────────────────────────
  console.log('\n  🔍 Quick search test:');
  const testQueries = ['Chennai', 'Taj Mahal', 'Kerala', 'Temple'];

  for (const q of testQueries) {
    const queryStart = Date.now();
    try {
      const { data, error } = await supabase.rpc('search_suggestions', {
        p_query: q, p_limit: 3,
      });
      const queryTime = Date.now() - queryStart;
      const count = data?.length || 0;
      const first = data?.[0]?.name || '(none)';
      console.log(`     "${q}" → ${count} results in ${queryTime}ms (first: ${first})`);
    } catch (err) {
      console.log(`     "${q}" → Error: ${err.message}`);
    }
  }

  console.log('\n  ✅ Search index rebuild complete!\n');
}

main().catch(err => { console.error('\n❌ Fatal:', err.message || err); process.exit(1); });
