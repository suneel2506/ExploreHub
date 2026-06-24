import { supabase } from './supabase';
import compressImage from 'browser-image-compression';

/**
 * Upload a photo to Supabase Storage.
 * Compresses the image before upload (max 1920px, quality 0.85).
 */
export async function uploadPhoto(file, userId) {
  if (!supabase) return { url: null, path: null, error: new Error('Supabase not configured') };

  let fileToUpload = file;

  // Compress images (not GIFs)
  if (file.type !== 'image/gif' && file.type.startsWith('image/')) {
    try {
      fileToUpload = await compressImage(file, {
        maxSizeMB: 2,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
        fileType: 'image/webp',
      });
    } catch {
      fileToUpload = file; // use original if compression fails
    }
  }

  const ext  = fileToUpload.name?.split('.').pop() || 'webp';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const storagePath = `${userId}/${name}`;

  const { error } = await supabase.storage
    .from('photos')
    .upload(storagePath, fileToUpload, { cacheControl: '3600', upsert: false });

  if (error) return { url: null, path: null, error };

  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(storagePath);
  return { url: urlData.publicUrl, path: storagePath, error: null };
}

/**
 * Upload a video to Supabase Storage (original file, no transcoding).
 */
export async function uploadVideo(file, userId) {
  if (!supabase) return { url: null, path: null, error: new Error('Supabase not configured') };

  const ext  = file.name?.split('.').pop() || 'mp4';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const storagePath = `${userId}/${name}`;

  const { error } = await supabase.storage
    .from('videos')
    .upload(storagePath, file, { cacheControl: '3600', upsert: false });

  if (error) return { url: null, path: null, error };

  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(storagePath);
  return { url: urlData.publicUrl, path: storagePath, error: null };
}

/**
 * Delete a file from Supabase Storage.
 */
export async function deleteStorageFile(bucket, storagePath) {
  if (!supabase || !storagePath) return;
  await supabase.storage.from(bucket).remove([storagePath]);
}

/**
 * Get public URL for a storage path.
 */
export function getPublicUrl(bucket, storagePath) {
  if (!supabase || !storagePath) return null;
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data?.publicUrl ?? null;
}
