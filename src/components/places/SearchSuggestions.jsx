import { useState, useRef, useEffect } from 'react';
import { useSearchStore } from '@/store/searchStore';
import { useDebouncedCallback } from '@/lib/useDebounce';
import { PLACE_CATEGORIES, CATEGORY_COLORS } from '@/lib/constants';

/**
 * SearchSuggestions — Autocomplete dropdown for place search.
 * Shows top 8 matching places with category emoji, name, and location.
 * Supports keyboard navigation (↑/↓/Enter/Escape).
 *
 * USAGE:
 *   <SearchSuggestions
 *     query="chen"
 *     onSelect={(place) => handleSearch(place.name)}
 *     onClose={() => setShowSuggestions(false)}
 *     visible={showSuggestions}
 *   />
 */
export default function SearchSuggestions({ query, onSelect, onClose, visible }) {
  const { suggestions, suggestionsLoading, fetchSuggestions, clearSuggestions, searchHistory } = useSearchStore();
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const listRef = useRef(null);

  // Debounced fetch (300ms)
  const debouncedFetch = useDebouncedCallback((q) => {
    if (q && q.trim().length >= 2) {
      fetchSuggestions(q);
    } else {
      clearSuggestions();
    }
  }, 300);

  // Trigger fetch when query changes
  useEffect(() => {
    debouncedFetch(query);
    setSelectedIndex(-1);
  }, [query, debouncedFetch]);

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e) => {
      const items = suggestions.length > 0 ? suggestions : searchHistory;
      const maxIndex = items.length - 1;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, maxIndex));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, -1));
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex <= maxIndex) {
            const item = items[selectedIndex];
            if (typeof item === 'string') {
              onSelect({ name: item });
            } else {
              onSelect(item);
            }
          }
          break;
        case 'Escape':
          onClose?.();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, suggestions, searchHistory, selectedIndex, onSelect, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-suggestion]');
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!visible) return null;

  // Get emoji for category
  const getEmoji = (category) => {
    const cat = PLACE_CATEGORIES.find(c => c.id === category);
    return cat?.emoji || '📍';
  };

  // Show history when query is empty
  const showHistory = (!query || query.trim().length < 2) && searchHistory.length > 0;
  const showSuggestions = !showHistory && suggestions.length > 0;
  const showLoading = suggestionsLoading && query?.trim().length >= 2;
  const showEmpty = !showHistory && !showSuggestions && !showLoading && query?.trim().length >= 2;

  if (!showHistory && !showSuggestions && !showLoading && !showEmpty) return null;

  return (
    <div
      className="absolute top-full left-0 right-0 mt-1 z-50 overflow-hidden"
      style={{
        backgroundColor: 'rgba(30, 30, 40, 0.98)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        maxHeight: '380px',
        overflowY: 'auto',
      }}
      ref={listRef}
    >
      {/* Search History */}
      {showHistory && (
        <div className="p-2">
          <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            Recent Searches
          </div>
          {searchHistory.map((item, index) => (
            <button
              key={item}
              data-suggestion
              className="w-full text-left px-3 py-2.5 flex items-center gap-3 rounded-lg transition-colors"
              style={{
                backgroundColor: selectedIndex === index ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: 'rgba(255,255,255,0.85)',
              }}
              onClick={() => onSelect({ name: item })}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>🕐</span>
              <span className="text-sm">{item}</span>
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {showLoading && (
        <div className="px-4 py-6 text-center">
          <div className="inline-block w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: 'transparent' }} />
          <p className="mt-2 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Searching...</p>
        </div>
      )}

      {/* Suggestions */}
      {showSuggestions && (
        <div className="p-2">
          {suggestions.map((suggestion, index) => {
            const location = [suggestion.city_name, suggestion.state_name]
              .filter(Boolean).join(', ');

            return (
              <button
                key={suggestion.id}
                data-suggestion
                className="w-full text-left px-3 py-2.5 flex items-center gap-3 rounded-lg transition-colors"
                style={{
                  backgroundColor: selectedIndex === index ? 'rgba(255,255,255,0.08)' : 'transparent',
                }}
                onClick={() => onSelect(suggestion)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                {/* Category emoji */}
                <span className="text-lg flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
                  style={{
                    backgroundColor: `${CATEGORY_COLORS[suggestion.category] || '#6B7280'}15`,
                  }}>
                  {getEmoji(suggestion.category)}
                </span>

                {/* Name & location */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'rgba(255,255,255,0.9)' }}>
                    {suggestion.name}
                  </div>
                  {location && (
                    <div className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {location}
                    </div>
                  )}
                </div>

                {/* Match badge */}
                {suggestion.match_type && suggestion.match_type !== 'fuzzy' && (
                  <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      color: 'rgba(59, 130, 246, 0.8)',
                    }}>
                    {suggestion.match_type}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* No results */}
      {showEmpty && (
        <div className="px-4 py-6 text-center">
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            No places found for "{query}"
          </p>
        </div>
      )}
    </div>
  );
}
