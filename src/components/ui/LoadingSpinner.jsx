import React from 'react';

export default function LoadingSpinner({ fullscreen = false, size = 36, message }) {
  const spinner = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
      <div
        style={{
          width: size,
          height: size,
          border: `3px solid var(--color-border)`,
          borderTopColor: 'var(--color-accent)',
          borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }}
      />
      {message && (
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>{message}</p>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (fullscreen) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-primary)',
        }}
      >
        {spinner}
      </div>
    );
  }

  return spinner;
}

export function SkeletonCard() {
  return (
    <div
      style={{
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
      }}
    >
      <div className="skeleton" style={{ height: 180 }} />
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div className="skeleton" style={{ height: 16, width: '70%' }} />
        <div className="skeleton" style={{ height: 12, width: '45%' }} />
        <div className="skeleton" style={{ height: 12, width: '55%' }} />
      </div>
    </div>
  );
}
