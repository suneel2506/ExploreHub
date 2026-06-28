#!/usr/bin/env node
// =============================================================================
// ExploreHub — Image Priority Resolver & Downloader
// =============================================================================
//
// Resolves the best image for each place using the priority chain:
//   1. Government Image (priority=1)
//   2. Wikimedia Commons (priority=2)
//   3. Wikipedia Featured Image (priority=3)
//   4. OSM Image (priority=4)
//   5. User Image (priority=5)
//   6. Placeholder (priority=99)
//
// Sets is_primary=true on the highest-priority image.
// Updates places.image_url with the primary image URL.
//
// USAGE:
//   node scripts/download-images.cjs                   Resolve all
//   node scripts/download-images.cjs --limit 500       Process 500 max
//   node scripts/download-images.cjs --batch-size 100  DB batch size
//   node scripts/download-images.cjs --dry-run         Preview mode
//   node scripts/download-images.cjs --resume          Resume from checkpoint
//
// =============================================================================
'use strict';

const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY;

const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const RESUME     = args.includes('--resume');
const DOWNLOAD   = args.includes('--download'); // Actually download images to Supabase Storage
const LIMIT      = (() => { const i = args.indexOf('--limit');      return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })();
const BATCH_SIZE = (() => { const i = args.indexOf('--batch-size'); return i >= 0 ? parseInt(args[i + 1], 10) : 100; })();

const useServiceKey = SERVICE_KEY && SERVICE_KEY !== 'your-service-role-key-here';
const API_KEY       = useServiceKey ? SERVICE_KEY : ANON_KEY;
if (!SUPABASE_URL || !API_KEY) { console.error('\n❌ Missing env vars\n'); process.exit(1); }

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, API_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

// ─── Checkpoint ───────────────────────────────────────────────────────────────
const CHECKPOINT_FILE = path.join(__dirname, '.download-images-checkpoint.json');
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

// ─── Image Download Helper ────────────────────────────────────────────────────
const https = require('https');
const http = require('http');
const crypto = require('crypto');

/**
 * Download an image from a URL and upload to Supabase Storage.
 * Returns { storagePath, storageUrl } on success, null on failure.
 */
async function downloadToStorage(imageUrl, placeId) {
  if (!imageUrl || !placeId) return null;

  return new Promise((resolve) => {
    const client = imageUrl.startsWith('https') ? https : http;
    const req = client.get(imageUrl, {
      timeout: 20000,
      headers: { 'User-Agent': 'ExploreHub/2.0 (travel app)' },
    }, (response) => {
      // Follow redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadToStorage(response.headers.location, placeId).then(resolve);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return resolve(null);
      }

      const contentType = response.headers['content-type'] || 'image/jpeg';
      const ext = contentType.includes('png') ? '.png'
               : contentType.includes('webp') ? '.webp'
               : '.jpg';

      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          // Skip tiny images (likely broken/placeholder)
          if (buffer.length < 5000) return resolve(null);
          // Skip huge images (> 8MB)
          if (buffer.length > 8 * 1024 * 1024) return resolve(null);

          const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8);
          const storagePath = `places/${placeId.substring(0, 8)}/${hash}${ext}`;

          const { error } = await supabase.storage
            .from('place-images')
            .upload(storagePath, buffer, {
              contentType,
              upsert: true,
            });

          if (error) {
            // Bucket may not exist yet; skip silently
            return resolve(null);
          }

          // Get public URL
          const { data: urlData } = supabase.storage
            .from('place-images')
            .getPublicUrl(storagePath);

          resolve({
            storagePath,
            storageUrl: urlData?.publicUrl || null,
          });
        } catch {
          resolve(null);
        }
      });
      response.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🖼️  ExploreHub — Image Priority Resolver`);
  console.log('═══════════════════════════════════════════════════');
  console.log(`🔑 Auth: ${useServiceKey ? '✅ Service Role' : '🔑 Anon Key'}`);
  if (DRY_RUN)  console.log('🏃 DRY RUN mode');
  if (DOWNLOAD) console.log('📥 DOWNLOAD mode — will download images to Supabase Storage');

  // Step 1: Ensure all existing place images from places.image_url are in place_images
  console.log('\n  ⏳ Syncing existing place images to place_images table...');

  const { count: placesWithImages } = await supabase
    .from('places')
    .select('*', { count: 'exact', head: true })
    .not('image_url', 'is', null);

  console.log(`  📊 ${(placesWithImages || 0).toLocaleString()} places have images`);

  if (!DRY_RUN) {
    let synced = 0;
    let syncOffset = 0;

    while (syncOffset < (placesWithImages || 0)) {
      const { data: batch } = await supabase
        .from('places')
        .select('id, image_url, image_source')
        .not('image_url', 'is', null)
        .order('name')
        .range(syncOffset, syncOffset + BATCH_SIZE - 1);

      if (!batch || batch.length === 0) break;

      const imageRows = batch.map(p => ({
        place_id: p.id,
        url: p.image_url,
        source: p.image_source || 'osm',
        priority: p.image_source === 'government' ? 1
                : p.image_source === 'wikimedia' ? 2
                : p.image_source === 'wikipedia' ? 3
                : p.image_source === 'osm' ? 4
                : p.image_source === 'user' ? 5
                : 50,
        is_primary: false,
      }));

      await supabase
        .from('place_images')
        .upsert(imageRows, { onConflict: 'place_id,url' });

      synced += batch.length;
      syncOffset += batch.length;
      process.stdout.write(`\r  📸 Synced ${synced}/${placesWithImages}`);
    }
    console.log('');
  }

  // Step 2: Resolve primary image for each place
  console.log('\n  ⏳ Resolving primary images...');

  // Get all places that have entries in place_images
  const { count: totalWithImages } = await supabase
    .from('place_images')
    .select('place_id', { count: 'exact', head: true });

  // Get distinct place IDs from place_images
  const toProcess = Math.min(totalWithImages || 0, LIMIT);
  console.log(`  📊 ${toProcess.toLocaleString()} place-image entries to process`);

  let processed = 0, updated = 0, errors = 0;
  const startTime = Date.now();

  const cp = loadCheckpoint();
  if (cp) {
    processed = cp.processed || 0;
    updated = cp.updated || 0;
    errors = cp.errors || 0;
  }

  let offset = 0;
  const processedPlaces = new Set();

  while (processed < toProcess) {
    // Get next batch of place_images, grouped by place_id
    const { data: batch } = await supabase
      .from('place_images')
      .select('place_id, url, source, priority')
      .order('priority', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (!batch || batch.length === 0) break;
    offset += batch.length;

    // Group by place_id
    const byPlace = {};
    for (const img of batch) {
      if (!byPlace[img.place_id]) byPlace[img.place_id] = [];
      byPlace[img.place_id].push(img);
    }

    for (const [placeId, images] of Object.entries(byPlace)) {
      if (processedPlaces.has(placeId)) continue;
      processedPlaces.add(placeId);
      processed++;

      if (processed > toProcess) break;

      // Sort by priority (lowest number = highest priority)
      images.sort((a, b) => a.priority - b.priority);
      const bestImage = images[0];

      if (!DRY_RUN) {
        try {
          // Reset all to non-primary
          await supabase
            .from('place_images')
            .update({ is_primary: false })
            .eq('place_id', placeId);

          // Set best as primary
          await supabase
            .from('place_images')
            .update({ is_primary: true })
            .eq('place_id', placeId)
            .eq('url', bestImage.url);

          let finalUrl = bestImage.url;
          let finalSource = bestImage.source;

          // Download to Supabase Storage if --download flag and image is external
          if (DOWNLOAD && !bestImage.storage_path && bestImage.url &&
              (bestImage.url.includes('wikimedia') || bestImage.url.includes('wikipedia'))) {
            const stored = await downloadToStorage(bestImage.url, placeId);
            if (stored && stored.storageUrl) {
              finalUrl = stored.storageUrl;
              // Update place_images with storage path
              await supabase
                .from('place_images')
                .update({ storage_path: stored.storagePath })
                .eq('place_id', placeId)
                .eq('url', bestImage.url);
            }
          }

          // Update places.image_url
          await supabase
            .from('places')
            .update({
              image_url: finalUrl,
              image_source: finalSource,
            })
            .eq('id', placeId);

          updated++;
        } catch (err) {
          errors++;
        }
      }

      if (processed % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        process.stdout.write(`\r  🖼️  ${processed}/${toProcess} | ✅ ${updated} updated | ❌ ${errors} errors | ${elapsed}s`);
        saveCheckpoint({ processed, updated, errors });
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n  ═══════════════════════════════════════════════════`);
  console.log(`  ✅ Image resolution complete!`);
  console.log(`  📊 Processed: ${processed} | ✅ Updated: ${updated} | ❌ Errors: ${errors}`);
  console.log(`  ⏱️  Time: ${elapsed}s`);
  console.log(`  ═══════════════════════════════════════════════════\n`);
  clearCheckpoint();
}

main().catch(err => { console.error('\n❌ Fatal:', err.message || err); process.exit(1); });
