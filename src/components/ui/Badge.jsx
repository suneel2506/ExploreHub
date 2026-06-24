import React from 'react';
import { CATEGORY_COLORS } from '@/lib/constants';

const presets = {
  visited: { bg: 'rgba(16,185,129,0.12)', color: '#10B981', label: '✓ Visited' },
  wishlist: { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', label: '♡ Wishlist' },
  custom: { bg: 'rgba(59,130,246,0.12)', color: '#3B82F6', label: '📍 Custom' },
};

export default function Badge({ children, category, preset, size = 'sm' }) {
  let bg, color, text;

  if (preset && presets[preset]) {
    bg = presets[preset].bg;
    color = presets[preset].color;
    text = children ?? presets[preset].label;
  } else if (category) {
    const c = CATEGORY_COLORS[category] ?? '#6B7280';
    bg = `${c}20`;
    color = c;
    text = children ?? category;
  } else {
    bg = 'var(--color-bg-hover)';
    color = 'var(--color-text-secondary)';
    text = children;
  }

  const padding = size === 'sm' ? '3px 8px' : '5px 12px';
  const fontSize = size === 'sm' ? '11px' : '13px';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding,
        fontSize,
        fontWeight: 600,
        color,
        background: bg,
        borderRadius: 'var(--radius-full)',
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}
