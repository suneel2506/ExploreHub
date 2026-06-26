import { supabase } from './supabase';
import compressImage from 'browser-image-compression';

// ─── File validation ──────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_PHOTO_SIZE = 15 * 1024 * 1024;   // 15 MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;   // 500 MB

function validateFile(file, type) {
  if (!file) return 'No file provided';
  const allowed = type === 'video' ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;
  const maxSize = type === 'video' ? MAX_VIDEO_SIZE : MAX_PHOTO_SIZE;

  if (!allowed.includes(file.type)) {
    return `Invalid file type: ${file.type}. Allowed: ${allowed.join(', ')}`;
  }
  if (file.size > maxSize) {
    return `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: ${(maxSize / 1024 / 1024).toFixed(0)}MB`;
  }
  return null;
}

// ─── Thumbnail generation ─────────────────────────────────────────────────────

async function generateThumbnail(file, maxSize = 200) {
  try {
    const thumb = await compressImage(file, {
      maxSizeMB: 0.1,
      maxWidthOrHeight: maxSize,
      useWebWorker: true,
      fileType: 'image/webp',
    });
    return thumb;
  } catch {
    return null;
  }
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      // Wait with exponential backoff
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
}

// ─── Storage path helper ──────────────────────────────────────────────────────

function makeStoragePath(userId, ext) {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  return `${userId}/${name}`;
}

/**
 * Upload a photo to Supabase Storage.
 * Compresses the image before upload (max 1920px, quality 0.85).
 * Also generates and uploads a 200px thumbnail.
 */
export async function uploadPhoto(file, userId, onProgress) {
  if (!supabase) return { url: null, path: null, thumbnailUrl: null, error: new Error('Supabase not configured') };

  // Validate
  const validationError = validateFile(file, 'image');
  if (validationError) return { url: null, path: null, thumbnailUrl: null, error: new Error(validationError) };

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
      console.timeEnd("Compress");
    }
  }

  const ext = 'webp';
  const storagePath = makeStoragePath(userId, ext);

  // Upload main image with retry
  const uploadResult = await withRetry(async () => {
    const { error } = await supabase.storage
      .from('photos')
      .upload(storagePath, fileToUpload, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    return true;
  });

  if (onProgress) onProgress(70);

  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(storagePath);
  const mainUrl = urlData.publicUrl;

  // Upload thumbnail
  let thumbnailUrl = null;
  try {
    const thumb = await generateThumbnail(file);
    if (thumb) {
      const thumbPath = storagePath.replace(`.${ext}`, `_thumb.webp`);
      await supabase.storage
        .from('photos')
        .upload(thumbPath, thumb, { cacheControl: '3600', upsert: false });
      const { data: thumbUrlData } = supabase.storage.from('photos').getPublicUrl(thumbPath);
      thumbnailUrl = thumbUrlData.publicUrl;
    }
  } catch {
    // Thumbnail failure is non-fatal
  }

  if (onProgress) onProgress(100);

  return { url: mainUrl, path: storagePath, thumbnailUrl, error: null };
}

/**
 * Upload a video to Supabase Storage (original file, no transcoding).
 * Supports progress callback and retry.
 */
export async function uploadVideo(file, userId, onProgress) {
  if (!supabase) return { url: null, path: null, thumbnailUrl: null, error: new Error('Supabase not configured') };

  // Validate
  const validationError = validateFile(file, 'video');
  if (validationError) return { url: null, path: null, thumbnailUrl: null, error: new Error(validationError) };

  const ext  = file.name?.split('.').pop() || 'mp4';
  const storagePath = makeStoragePath(userId, ext);

  if (onProgress) onProgress(10);

  // Upload with retry
  const uploadResult = await withRetry(async () => {
    const { error } = await supabase.storage
      .from('videos')
      .upload(storagePath, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    return true;
  });

  if (onProgress) onProgress(100);

  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(storagePath);
  return { url: urlData.publicUrl, path: storagePath, thumbnailUrl: null, error: null };
}

/**
 * Delete a file from Supabase Storage.
 */
export async function deleteStorageFile(bucket, storagePath) {
  if (!supabase || !storagePath) return;
  try {
    await supabase.storage.from(bucket).remove([storagePath]);
    // Also try to remove thumbnail
    const thumbPath = storagePath.replace(/\.[^.]+$/, '_thumb.webp');
    await supabase.storage.from(bucket).remove([thumbPath]);
  } catch {
    // Silent failure — file may not exist
  }
}

/**
 * Get public URL for a storage path.
 */
export function getPublicUrl(bucket, storagePath) {
  if (!supabase || !storagePath) return null;
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data?.publicUrl ?? null;
}
