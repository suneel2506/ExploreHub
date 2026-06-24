import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Map, Search } from 'lucide-react';
import { useMap } from 'react-leaflet';
import MapView from '@/components/map/MapView';
import PlaceDetailModal from '@/components/places/PlaceDetailModal';
import Badge from '@/components/ui/Badge';
import { PLACE_CATEGORIES } from '@/lib/constants';
import { usePlacesStore } from '@/store/placesStore';
import { useUserDataStore } from '@/store/userDataStore';
import { useAuthStore } from '@/store/authStore';

// Debounce hook
function useDebounce(value, delay) {
  const [d, setD] = useState(value);
  useEffect(() => { const id = setTimeout(() => setD(value), delay); return () => clearTimeout(id); }, [value, delay]);
  return d;
}

export default function MapPage() {
  const { fetchPlacesByBounds } = usePlacesStore();
  const { visitedPlaces, wishlist, customPlaces } = useUserDataStore();
  const { user } = useAuthStore();

  const [viewportPlaces, setViewportPlaces]   = useState([]);
  const [selectedPlace, setSelectedPlace]     = useState(null);
  const [flyTo, setFlyTo]                     = useState(null);
  const [search, setSearch]                   = useState('');
  const [categoryFilter, setCategoryFilter]   = useState('all');
  const [statusFilter, setStatusFilter]       = useState('all');
  const [mapBounds, setMapBounds]             = useState(null);
  const [loadingMap, setLoadingMap]           = useState(false);

  const debouncedSearch = useDebounce(search, 350);

  const visitedIds  = useMemo(() => new Set(visitedPlaces.map((v) => v.place_id)), [visitedPlaces]);
  const wishlistIds = useMemo(() => new Set(wishlist.map((w) => w.place_id)), [wishlist]);

  // Fetch places when map bounds change
  const loadByBounds = useCallback(async (bounds) => {
    if (!bounds) return;
    setLoadingMap(true);
    const data = await fetchPlacesByBounds(bounds, 800);
    setViewportPlaces(data);
    setLoadingMap(false);
  }, [fetchPlacesByBounds]);

  useEffect(() => { if (mapBounds) loadByBounds(mapBounds); }, [mapBounds]);

  // Combine official + custom places
  const allPlaces = useMemo(() => [
    ...viewportPlaces,
    ...customPlaces.map((p) => ({ ...p, _isCustom: true })),
  ], [viewportPlaces, customPlaces]);

  // Apply sidebar filters to the list (for the panel list — map renders all)
  const filteredList = useMemo(() => {
    return allPlaces.filter((p) => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (debouncedSearch && !p.name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      if (statusFilter === 'visited'  && !visitedIds.has(p.id))  return false;
      if (statusFilter === 'wishlist' && !wishlistIds.has(p.id)) return false;
      if (statusFilter === 'unvisited' && (visitedIds.has(p.id) || wishlistIds.has(p.id))) return false;
      return true;
    });
  }, [allPlaces, categoryFilter, debouncedSearch, statusFilter, visitedIds, wishlistIds]);

  const handleListClick = (place) => {
    setFlyTo(place);
    setSelectedPlace(place);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Side Panel */}
      <div style={{ width: 300, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-secondary)', borderRight: '1px solid var(--color-border)', flexShrink: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '18px 14px 12px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Map size={17} color="var(--color-accent)" />
            <h1 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-primary)' }}>Map</h1>
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--color-text-muted)' }}>
              {loadingMap ? '…' : `${filteredList.length} visible`}
            </span>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: '10px' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
            <input
              id="map-search"
              placeholder="Search visible places..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', padding: '8px 10px 8px 28px', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}
              onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
            />
          </div>

          {/* Status filter pills */}
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
            {[{ id: 'all', label: 'All' }, { id: 'visited', label: '✓ Visited' }, { id: 'wishlist', label: '♡ Wishlist' }, { id: 'unvisited', label: 'Unexplored' }].map((sf) => (
              <button key={sf.id} onClick={() => setStatusFilter(sf.id)} style={{ padding: '4px 9px', borderRadius: 'var(--radius-full)', border: `1px solid ${statusFilter === sf.id ? 'var(--color-accent)' : 'var(--color-border)'}`, background: statusFilter === sf.id ? 'var(--color-accent-muted)' : 'transparent', color: statusFilter === sf.id ? 'var(--color-accent)' : 'var(--color-text-muted)', fontSize: '11px', fontWeight: statusFilter === sf.id ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 150ms' }}>
                {sf.label}
              </button>
            ))}
          </div>

          {/* Category scroller */}
          <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '2px' }}>
            {PLACE_CATEGORIES.map((cat) => (
              <button key={cat.id} onClick={() => setCategoryFilter(cat.id)} title={cat.label} style={{ padding: '4px 8px', borderRadius: 'var(--radius-full)', border: `1px solid ${categoryFilter === cat.id ? 'var(--color-accent)' : 'var(--color-border)'}`, background: categoryFilter === cat.id ? 'var(--color-accent-muted)' : 'transparent', color: categoryFilter === cat.id ? 'var(--color-accent)' : 'var(--color-text-muted)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 150ms' }}>
                {cat.emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Place list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredList.length === 0 ? (
            <p style={{ padding: '16px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
              {loadingMap ? 'Loading places in view…' : 'Pan / zoom the map to load places, or adjust filters.'}
            </p>
          ) : (
            filteredList.map((place) => {
              const isVisited   = visitedIds.has(place.id);
              const isWishlisted = wishlistIds.has(place.id);
              const isSelected  = selectedPlace?.id === place.id;
              return (
                <div
                  key={place.id}
                  onClick={() => handleListClick(place)}
                  style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', background: isSelected ? 'var(--color-accent-muted)' : 'transparent', display: 'flex', gap: '10px', alignItems: 'flex-start', transition: 'background 150ms' }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? 'var(--color-accent-muted)' : 'transparent'; }}
                >
                  {place.image_url ? (
                    <img src={place.image_url} alt={place.name} style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                      {PLACE_CATEGORIES.find((c) => c.id === place.category)?.emoji ?? '📍'}
                    </div>
                  )}
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: isSelected ? 'var(--color-accent)' : 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {place.name}
                      {place._isCustom && <span style={{ fontSize: '10px', color: 'var(--color-accent)', marginLeft: 5 }}>CUSTOM</span>}
                    </p>
                    <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[place.district, place.state].filter(Boolean).join(', ') || place.category}
                    </p>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                      <Badge category={place.category} />
                      {isVisited    && <Badge preset="visited" />}
                      {isWishlisted && !isVisited && <Badge preset="wishlist" />}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Map fills remaining space */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <MapView
          places={filteredList}
          onPlaceClick={handleListClick}
          flyTo={flyTo}
          onBoundsChange={setMapBounds}
        />
      </div>

      <PlaceDetailModal
        place={selectedPlace}
        isOpen={!!selectedPlace}
        onClose={() => setSelectedPlace(null)}
      />
    </div>
  );
}
