import React, { useState } from 'react';
import { X, Trash2, ZoomIn, Play } from 'lucide-react';

export default function MediaGallery({ items = [], onDelete, readOnly = false }) {
  const [lightbox, setLightbox] = useState(null); // { url, type }

  if (items.length === 0) return null;

  const photos = items.filter((m) => m.type === 'image');
  const videos = items.filter((m) => m.type === 'video');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Photo grid */}
      {photos.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: '8px',
          }}
        >
          {photos.map((m) => (
            <div
              key={m.id}
              style={{
                position: 'relative',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                aspectRatio: '1',
                background: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
              }}
              onClick={() => setLightbox({ url: m.url, type: 'image', caption: m.caption })}
            >
              <img
                src={m.url}
                alt={m.caption || 'Photo'}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                loading="lazy"
              />
              <div
                style={{
                  position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 150ms',
                  gap: '8px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0,0,0,0.4)';
                  e.currentTarget.querySelectorAll('button,svg').forEach(el => el.style.opacity = '1');
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(0,0,0,0)';
                  e.currentTarget.querySelectorAll('button,svg').forEach(el => el.style.opacity = '0');
                }}
              >
                <ZoomIn size={18} color="#fff" style={{ opacity: 0, transition: 'opacity 150ms' }} />
                {!readOnly && onDelete && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDelete(m); }}
                    style={{
                      background: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: '50%',
                      width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', opacity: 0, transition: 'opacity 150ms',
                    }}
                  >
                    <Trash2 size={12} color="#fff" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Video list */}
      {videos.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {videos.map((m) => (
            <div
              key={m.id}
              style={{
                borderRadius: 'var(--radius-md)', overflow: 'hidden',
                background: '#000', position: 'relative',
                border: '1px solid var(--color-border)',
              }}
            >
              <video
                src={m.url}
                controls
                preload="metadata"
                style={{ width: '100%', maxHeight: 320, display: 'block' }}
              />
              {!readOnly && onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(m)}
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    background: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: 'var(--radius-md)',
                    padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                    fontSize: '12px', color: '#fff',
                  }}
                >
                  <Trash2 size={12} /> Delete
                </button>
              )}
              {m.caption && (
                <p style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  {m.caption}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
          }}
        >
          <button
            onClick={() => setLightbox(null)}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'rgba(255,255,255,0.1)', border: 'none',
              borderRadius: '50%', width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#fff',
            }}
          >
            <X size={20} />
          </button>
          <img
            src={lightbox.url}
            alt={lightbox.caption || 'Photo'}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '100%', maxHeight: '90vh',
              borderRadius: 'var(--radius-lg)',
              objectFit: 'contain',
              boxShadow: '0 25px 60px rgba(0,0,0,0.8)',
            }}
          />
          {lightbox.caption && (
            <p style={{ position: 'absolute', bottom: 24, color: 'rgba(255,255,255,0.7)', fontSize: '13px', textAlign: 'center' }}>
              {lightbox.caption}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
