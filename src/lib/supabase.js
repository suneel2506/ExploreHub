import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured =
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://your-project.supabase.co' &&
  supabaseAnonKey !== 'your-anon-key-here';

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

/**
 * Ensure storage buckets exist. Called once at app startup.
 * Silently ignores "already exists" errors.
 */
export async function initStorage() {
  if (!supabase) return;
  const buckets = [
    { name: 'photos', public: true, fileSizeLimit: 15 * 1024 * 1024 },   // 15 MB
    { name: 'videos', public: true, fileSizeLimit: 500 * 1024 * 1024 },  // 500 MB
    { name: 'place-images', public: true, fileSizeLimit: 10 * 1024 * 1024 }, // 10 MB — enrichment images
  ];
  for (const b of buckets) {
    await supabase.storage.createBucket(b.name, {
      public: b.public,
      fileSizeLimit: b.fileSizeLimit,
    });
    // Ignore error — bucket may already exist
  }
}
