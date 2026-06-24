import React, { useState } from 'react';

export default function Input({
  id,
  label,
  type = 'text',
  placeholder,
  value,
  onChange,
  error,
  icon,
  required,
  disabled,
  autoComplete,
  style = {},
  hint,
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', ...style }}>
      {label && (
        <label
          htmlFor={id}
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--color-text-secondary)',
          }}
        >
          {label}
          {required && <span style={{ color: 'var(--color-accent)', marginLeft: 2 }}>*</span>}
        </label>
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {icon && (
          <span
            style={{
              position: 'absolute',
              left: '12px',
              color: focused ? 'var(--color-accent)' : 'var(--color-text-muted)',
              display: 'flex',
              alignItems: 'center',
              transition: 'color 150ms',
              pointerEvents: 'none',
            }}
          >
            {icon}
          </span>
        )}
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          style={{
            width: '100%',
            padding: icon ? '10px 12px 10px 40px' : '10px 12px',
            background: 'var(--color-bg-tertiary)',
            border: `1px solid ${error ? 'var(--color-danger)' : focused ? 'var(--color-border-focus)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
            fontSize: '14px',
            fontFamily: 'inherit',
            outline: 'none',
            transition: 'border-color 150ms',
            opacity: disabled ? 0.6 : 1,
          }}
        />
      </div>
      {error && (
        <span style={{ fontSize: '12px', color: 'var(--color-danger)' }}>{error}</span>
      )}
      {hint && !error && (
        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{hint}</span>
      )}
    </div>
  );
}
