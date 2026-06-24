import React from 'react';
import { MapPin, Heart, Camera, BookOpen } from 'lucide-react';

const icons = {
  places: <MapPin size={40} />,
  wishlist: <Heart size={40} />,
  media: <Camera size={40} />,
  memories: <BookOpen size={40} />,
  default: <MapPin size={40} />,
};

export default function EmptyState({
  type = 'default',
  title,
  description,
  action,
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 24px',
        textAlign: 'center',
        gap: '16px',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 'var(--radius-xl)',
          background: 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-muted)',
        }}
      >
        {icons[type] ?? icons.default}
      </div>
      <div style={{ maxWidth: 320 }}>
        <h3
          style={{
            fontSize: '16px',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: '8px',
          }}
        >
          {title ?? 'Nothing here yet'}
        </h3>
        {description && (
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
