import React from 'react';

const variants = {
  primary: {
    background: 'var(--color-accent)',
    color: 'var(--color-text-inverse)',
    border: 'none',
    hover: 'var(--color-accent-hover)',
  },
  secondary: {
    background: 'var(--color-bg-tertiary)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
    hover: 'var(--color-bg-hover)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    border: 'none',
    hover: 'var(--color-bg-hover)',
  },
  danger: {
    background: 'var(--color-danger)',
    color: '#fff',
    border: 'none',
    hover: 'var(--color-danger-hover)',
  },
  accent_outline: {
    background: 'transparent',
    color: 'var(--color-accent)',
    border: '1px solid var(--color-accent)',
    hover: 'var(--color-accent-muted)',
  },
};

const sizes = {
  sm: { padding: '6px 12px', fontSize: '12px', height: '30px' },
  md: { padding: '8px 16px', fontSize: '14px', height: '36px' },
  lg: { padding: '12px 24px', fontSize: '16px', height: '44px' },
};

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  icon,
  onClick,
  type = 'button',
  style = {},
  id,
}) {
  const v = variants[variant] ?? variants.primary;
  const s = sizes[size] ?? sizes.md;

  return (
    <button
      id={id}
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        background: v.background,
        color: v.color,
        border: v.border,
        borderRadius: 'var(--radius-md)',
        padding: s.padding,
        fontSize: s.fontSize,
        height: s.height,
        fontWeight: 500,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 150ms ease',
        width: fullWidth ? '100%' : 'auto',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !loading) e.currentTarget.style.background = v.hover;
      }}
      onMouseLeave={(e) => {
        if (!disabled && !loading) e.currentTarget.style.background = v.background;
      }}
    >
      {loading ? (
        <span
          style={{
            width: 14,
            height: 14,
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite',
          }}
        />
      ) : icon ? (
        <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>
      ) : null}
      {children}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}
