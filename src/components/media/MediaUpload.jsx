import React, { useRef, useState, useCallback } from 'react';
import { Upload, X, Image as ImageIcon, Video, Check, AlertCircle } from 'lucide-react';
import { uploadPhoto, uploadVideo } from '@/lib/storage';

const ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp,image/gif';
const ACCEPT_VIDEOS = 'video/mp4,video/quicktime,video/webm';

export default function MediaUpload({ userId, onUploaded, disabled = false }) {
  const [items, setItems]   = useState([]); // { file, type, preview, status, progress, url, path, error }
  const photoRef = useRef();
  const videoRef = useRef();

  const addFiles = useCallback((files, mediaType) => {
    const newItems = Array.from(files).map((f) => ({
      id:       Math.random().toString(36).slice(2),
      file:     f,
      type:     mediaType,
      preview:  f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      status:   'pending', // pending | uploading | done | error
      progress: 0,
      url:      null,
      path:     null,
      error:    null,
    }));
    setItems((prev) => [...prev, ...newItems]);
  }, []);

  const removeItem = useCallback((id) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const uploadAll = useCallback(async () => {
    if (!userId) return;

    const pending = items.filter((i) => i.status === 'pending');
    if (pending.length === 0) return;

    for (const item of pending) {
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'uploading' } : i));

      const fn = item.type === 'video' ? uploadVideo : uploadPhoto;
      const { url, path, error } = await fn(item.file, userId);

      if (error) {
        setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'error', error: error.message } : i));
      } else {
        setItems((prev) => prev.map((i) =>
          i.id === item.id ? { ...i, status: 'done', url, path } : i
        ));
        onUploaded?.({ url, path, type: item.type, file: item.file });
      }
    }
  }, [items, userId, onUploaded]);

  const photos = items.filter((i) => i.type === 'photo');
  const videos = items.filter((i) => i.type === 'video');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
            border: '1px dashed var(--color-border)',
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
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-secondary)',
            fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
            opacity: disabled ? 0.5 : 1,
            transition: 'all 150ms',
          }}
        >
          <Video size={15} /> Add Videos{videos.length > 0 ? ` (${videos.length})` : ''}
        </button>

        {items.some((i) => i.status === 'pending') && (
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
            <Upload size={15} /> Upload {items.filter((i) => i.status === 'pending').length} file{items.filter((i) => i.status === 'pending').length !== 1 ? 's' : ''}
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

              {/* Status overlay */}
              {item.status === 'uploading' && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                </div>
              )}
              {item.status === 'done' && (
                <div style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: '50%', background: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={11} color="#0A0A0A" />
                </div>
              )}
              {item.status === 'error' && (
                <div style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: '50%', background: 'var(--color-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertCircle size={11} color="#fff" />
                </div>
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
