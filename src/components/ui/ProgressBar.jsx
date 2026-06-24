import React from 'react';

export default function ProgressBar({
  value = 0,
  max = 100,
  label,
  showPercent = true,
  color = 'var(--color-accent)',
  height = 6,
  animated = true,
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {(label || showPercent) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {label && (
            <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{label}</span>
          )}
          {showPercent && (
            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
              {value}/{max} ({pct}%)
            </span>
          )}
        </div>
      )}
      <div
        style={{
          height,
          background: 'var(--color-bg-hover)',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: 'var(--radius-full)',
            transition: 'width 0.8s ease',
            animation: animated ? 'progressFill 1s ease-out' : 'none',
          }}
        />
      </div>
    </div>
  );
}
