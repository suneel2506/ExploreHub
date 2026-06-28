import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Search, Filter } from 'lucide-react';
import { PLACE_CATEGORIES, SORT_OPTIONS } from '@/lib/constants';
import SearchSuggestions from '@/components/places/SearchSuggestions';
import { useSearchStore } from '@/store/searchStore';

export default function PlaceFilters({ filters, onChange }) {
  const setFilter = (key, value) => onChange({ ...filters, [key]: value });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const addToHistory = useSearchStore((s) => s.addToHistory);
  const searchWrapperRef = useRef(null);

  // Close suggestions when clicking outside the search area
  useEffect(() => {
    const handleClick = (e) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSuggestionSelect = useCallback((suggestion) => {
    const name = suggestion?.name || '';
    if (name) {
      addToHistory(name);
      setFilter('search', name);
    }
    setShowSuggestions(false);
  }, [addToHistory, setFilter]);

  return (
    <div
      style={{
        padding: '16px 32px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        flexShrink: 0,
      }}
    >
      {/* Search + Sort Row */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Search */}
        <div ref={searchWrapperRef} style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search
            size={15}
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-text-muted)',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
          <input
            id="places-search"
            type="text"
            placeholder="Search places, cities, states..."
            value={filters.search ?? ''}
            onChange={(e) => {
              setFilter('search', e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            autoComplete="off"
            style={{
              width: '100%',
              padding: '9px 12px 9px 38px',
              background: 'var(--color-bg-tertiary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
              fontSize: '14px',
              fontFamily: 'inherit',
              outline: 'none',
              transition: 'border-color 150ms',
            }}
          />
          <SearchSuggestions
            query={filters.search}
            onSelect={handleSuggestionSelect}
            onClose={() => setShowSuggestions(false)}
            visible={showSuggestions}
          />
        </div>

        {/* Status filters */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { key: 'visited', label: '✓ Visited' },
            { key: 'wishlist', label: '♡ Wishlist' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key, !filters[key])}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${filters[key] ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: filters[key] ? 'var(--color-accent-muted)' : 'var(--color-bg-tertiary)',
                color: filters[key] ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 150ms',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <select
          id="places-sort"
          value={filters.sort ?? 'name_asc'}
          onChange={(e) => setFilter('sort', e.target.value)}
          style={{
            padding: '8px 12px',
            background: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-secondary)',
            fontSize: '13px',
            fontFamily: 'inherit',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Category Tabs */}
      <div
        style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}
        className="scrollbar-hide"
      >
        {PLACE_CATEGORIES.map((cat) => {
          const active = (filters.category ?? 'all') === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setFilter('category', cat.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 14px',
                borderRadius: 'var(--radius-full)',
                border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: active ? 'var(--color-accent-muted)' : 'transparent',
                color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontSize: '12px',
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 150ms',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
                flexShrink: 0,
              }}
            >
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
