import React from 'react';
import { Star } from 'lucide-react';

export default function StarRating({ value = 0, onChange, max = 10, readOnly = false }) {
  const filled = Math.round(value);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
      {Array.from({ length: max }, (_, i) => {
        const starVal = i + 1;
        const isActive = starVal <= filled;
        return (
          <button
            key={i}
            type="button"
            onClick={() => !readOnly && onChange && onChange(starVal)}
            style={{
              background: 'none',
              border: 'none',
              padding: '2px',
              cursor: readOnly ? 'default' : 'pointer',
              color: isActive ? '#F59E0B' : 'var(--color-border-hover)',
              transition: 'color 100ms, transform 100ms',
              display: 'flex',
            }}
            onMouseEnter={(e) => {
              if (!readOnly) e.currentTarget.style.transform = 'scale(1.2)';
            }}
            onMouseLeave={(e) => {
              if (!readOnly) e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Star size={16} fill={isActive ? '#F59E0B' : 'none'} />
          </button>
        );
      })}
      {value > 0 && (
        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: '4px' }}>
          {value}/10
        </span>
      )}
    </div>
  );
}
