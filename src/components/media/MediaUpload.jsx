import React, { useRef, useState, useCallback } from 'react';
import { Upload, X, Image as ImageIcon, Video, Check, AlertCircle, RotateCcw } from 'lucide-react';
import { uploadPhoto, uploadVideo } from '@/lib/storage';

const ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp,image/gif';
const ACCEPT_VIDEOS = 'video/mp4,video/quicktime,video/webm';
const MAX_PHOTO_MB = 15;
const MAX_VIDEO_MB = 500;

export default function MediaUpload({ userId, onUploaded, disabled = false }) {
  const [items, setItems]   = useState([]); // { file, type, preview, status, progress, url, path, error, retryCount }
  const [isDragging, setIsDragging] = useState(false);
  const photoRef = useRef();
  const videoRef = useRef();
  const dropRef  = useRef();

  const addFiles = useCallback((files, mediaType) => {
    const newItems = Array.from(files).map((f) => {
      const isVideo = mediaType === 'video' || f.type.startsWith('video/');
      const maxMB = isVideo ? MAX_VIDEO_MB : MAX_PHOTO_MB;

      // Validate file size
      let error = null;
      if (f.size > maxMB * 1024 * 1024) {
        error = `File too large (${(f.size / 1024 / 1024).toFixed(1)}MB). Max: ${maxMB}MB`;
      }

      return {
        id:         Math.random().toString(36).slice(2),
        file:       f,
        type:       isVideo ? 'video' : 'photo',
        preview:    f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
        status:     error ? 'error' : 'pending',
        progress:   0,
        url:        null,
        path:       null,
        error,
        retryCount: 0,
      };
    });
    setItems((prev) => [...prev, ...newItems]);
  }, []);

  const removeItem = useCallback((id) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  // Retry a failed upload
  const retryItem = useCallback((id) => {
    setItems((prev) => prev.map((i) =>
      i.id === id ? { ...i, status: 'pending', error: null, retryCount: i.retryCount + 1 } : i
    ));
  }, []);

  const uploadAll = useCallback(async () => {
    if (!userId) return;

    const pending = items.filter((i) => i.status === 'pending');
    if (pending.length === 0) return;

    for (const item of pending) {
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'uploading', progress: 0 } : i));

      const fn = item.type === 'video' ? uploadVideo : uploadPhoto;
      const onProgress = (pct) => {
        setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, progress: pct } : i));
      };

      const { url, path, thumbnailUrl, error } = await fn(item.file, userId, onProgress);

      if (error) {
        setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'error', error: error.message } : i));
      } else {
        setItems((prev) => prev.map((i) =>
          i.id === item.id ? { ...i, status: 'done', url, path, progress: 100 } : i
        ));
        onUploaded?.({ url, path, type: item.type, file: item.file, thumbnailUrl });
      }
    }
  }, [items, userId, onUploaded]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Separate photos and videos
    const photos = [];
    const videos = [];
    for (const f of files) {
      if (f.type.startsWith('image/')) photos.push(f);
      else if (f.type.startsWith('video/')) videos.push(f);
    }

    if (photos.length > 0) addFiles(photos, 'photo');
    if (videos.length > 0) addFiles(videos, 'video');
  }, [addFiles]);

  const photos = items.filter((i) => i.type === 'photo');
  const videos = items.filter((i) => i.type === 'video');
  const pendingCount = items.filter((i) => i.status === 'pending').length;

  return (
    <div
      ref={dropRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
    >
      {/* Drag & Drop Zone */}
      <div
        style={{
          border: `2px dashed ${isDragging ? 'var(--color-accent)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-lg)',
          padding: '20px',
          textAlign: 'center',
          background: isDragging ? 'var(--color-accent-muted)' : 'var(--color-bg-tertiary)',
          transition: 'all 200ms',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
        onClick={() => !disabled && photoRef.current?.click()}
      >
        <Upload size={24} color={isDragging ? 'var(--color-accent)' : 'var(--color-text-muted)'} style={{ margin: '0 auto 8px' }} />
        <p style={{ fontSize: '13px', color: isDragging ? 'var(--color-accent)' : 'var(--color-text-muted)', fontWeight: 500 }}>
          {isDragging ? 'Drop files here' : 'Drag & drop photos/videos here, or click to browse'}
        </p>
        <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          Photos: JPG, PNG, WebP, GIF (max {MAX_PHOTO_MB}MB) · Videos: MP4, MOV, WebM (max {MAX_VIDEO_MB}MB)
        </p>
      </div>

      {/* Upload Buttons */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <input
          ref={photoRef}
          type="file"
          accept={ACCEPT_IMAGES}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => addFiles(e.target.files, 'photo')}
        />
        <input
          ref={videoRef}
          type="file"
          accept={ACCEPT_VIDEOS}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => addFiles(e.target.files, 'video')}
        />

        <button
          type="button"
          onClick={() => photoRef.current?.click()}
          disabled={disabled}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '8px 14px',
            background: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-secondary)',
            fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
            opacity: disabled ? 0.5 : 1,
            transition: 'all 150ms',
          }}
        >
          <ImageIcon size={15} /> Add Photos{photos.length > 0 ? ` (${photos.length})` : ''}
        </button>

        <button
          type="button"
          onClick={() => videoRef.current?.click()}
          disabled={disabled}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '8px 14px',
            background: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-secondary)',
            fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
            opacity: disabled ? 0.5 : 1,
            transition: 'all 150ms',
          }}
        >
          <Video size={15} /> Add Videos{videos.length > 0 ? ` (${videos.length})` : ''}
        </button>

        {pendingCount > 0 && (
          <button
            type="button"
            onClick={uploadAll}
            style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '8px 14px',
              background: 'var(--color-accent)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              color: '#0A0A0A',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'opacity 150ms',
            }}
          >
            <Upload size={15} /> Upload {pendingCount} file{pendingCount !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Preview Grid */}
      {items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden',
                aspectRatio: '1', background: 'var(--color-bg-tertiary)',
                border: `2px solid ${
                  item.status === 'done'     ? 'var(--color-accent)' :
                  item.status === 'error'    ? 'var(--color-danger)' :
                  item.status === 'uploading'? '#F59E0B' :
                  'var(--color-border)'
                }`,
              }}
            >
              {item.preview ? (
                <img src={item.preview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Video size={24} color="var(--color-text-muted)" />
                </div>
              )}

              {/* Progress overlay */}
              {item.status === 'uploading' && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  {item.progress > 0 && (
                    <span style={{ fontSize: '10px', color: '#fff', fontWeight: 600 }}>{item.progress}%</span>
                  )}
                </div>
              )}

              {/* Done badge */}
              {item.status === 'done' && (
                <div style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: '50%', background: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={11} color="#0A0A0A" />
                </div>
              )}

              {/* Error badge + retry */}
              {item.status === 'error' && (
                <>
                  <div style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: '50%', background: 'var(--color-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertCircle size={11} color="#fff" />
                  </div>
                  <button
                    type="button"
                    onClick={() => retryItem(item.id)}
                    title={item.error || 'Retry upload'}
                    style={{
                      position: 'absolute', bottom: 4, left: 4,
                      width: 22, height: 22,
                      borderRadius: '50%', border: 'none',
                      background: 'rgba(0,0,0,0.8)', color: '#F59E0B',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <RotateCcw size={11} />
                  </button>
                </>
              )}

              {/* Remove button */}
              {item.status !== 'uploading' && (
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  style={{
                    position: 'absolute', bottom: 4, right: 4,
                    width: 20, height: 20,
                    borderRadius: '50%', border: 'none',
                    background: 'rgba(0,0,0,0.7)', color: '#fff',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <X size={11} />
                </button>
              )}

              {/* Video badge */}
              {item.type === 'video' && (
                <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.7)', borderRadius: 3, padding: '1px 5px', fontSize: '10px', color: '#fff' }}>
                  VID
                </div>
              )}

              {/* File size */}
              {item.file && (
                <div style={{ position: 'absolute', bottom: item.status === 'error' ? 28 : 4, left: 4, background: 'rgba(0,0,0,0.6)', borderRadius: 3, padding: '1px 5px', fontSize: '9px', color: 'rgba(255,255,255,0.7)' }}>
                  {(item.file.size / 1024 / 1024).toFixed(1)}MB
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
