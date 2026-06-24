import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Compass, Plus, Loader } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import PlaceFilters from '@/components/places/PlaceFilters';
import PlaceCard from '@/components/places/PlaceCard';
import PlaceDetailModal from '@/components/places/PlaceDetailModal';
import AddCustomPlaceModal from '@/components/places/AddCustomPlaceModal';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import { SkeletonCard } from '@/components/ui/LoadingSpinner';
import { usePlacesStore } from '@/store/placesStore';
import { useUserDataStore } from '@/store/userDataStore';
import { useAuthStore } from '@/store/authStore';
import { PAGE_SIZE } from '@/lib/constants';

// Debounce hook
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function ExplorePage() {
  const { places, customPlaces: storePlaces, totalCount, hasMore, loading, fetchPlaces, loadMore, fetchCustomPlaces } = usePlacesStore();
  const { visitedPlaces, wishlist, customPlaces: userCustom } = useUserDataStore();
  const { user } = useAuthStore();

  const [filters, setFilters] = useState({ category: 'all', search: '', sort: 'name_asc', visited: false, wishlist: false });
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const debouncedSearch = useDebounce(filters.search, 400);

  // Fetch from DB whenever category or debounced search changes
  useEffect(() => {
    fetchPlaces({ category: filters.category, search: debouncedSearch, sort: filters.sort }, true);
  }, [filters.category, debouncedSearch, filters.sort, fetchPlaces]);

  // Also fetch user's custom places for display
  useEffect(() => {
    if (user) fetchCustomPlaces(user.id, { category: filters.category, search: debouncedSearch });
  }, [user, filters.category, debouncedSearch, fetchCustomPlaces]);

  const visitedIds  = useMemo(() => new Set(visitedPlaces.map((v) => v.place_id)), [visitedPlaces]);
  const wishlistIds = useMemo(() => new Set(wishlist.map((w) => w.place_id)), [wishlist]);

  // Client-side filter (visited/wishlist toggles, since we already have DB results)
  const filteredPlaces = useMemo(() => {
    let list = [...places];
    if (filters.visited)  list = list.filter((p) => visitedIds.has(p.id));
    if (filters.wishlist) list = list.filter((p) => wishlistIds.has(p.id));
    return list;
  }, [places, filters.visited, filters.wishlist, visitedIds, wishlistIds]);

  // Merge custom places (mark isCustom)
  const allPlaces = useMemo(() => {
    let custom = userCustom;
    if (filters.visited)  custom = custom.filter((p) => visitedIds.has(p.id));
    if (filters.wishlist) custom = custom.filter((p) => wishlistIds.has(p.id));
    return [...custom.map((p) => ({ ...p, _isCustom: true })), ...filteredPlaces];
  }, [userCustom, filteredPlaces, filters.visited, filters.wishlist, visitedIds, wishlistIds]);

  const handleLoadMore = () => loadMore({ category: filters.category, search: debouncedSearch, sort: filters.sort });

  const displayCount = filteredPlaces.length + userCustom.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <PageHeader
        title="Explore"
        subtitle={totalCount > 0 ? `${totalCount.toLocaleString()} places in India` : `${displayCount} place${displayCount !== 1 ? 's' : ''}`}
        icon={<Compass size={20} />}
        actions={
          <Button
            id="add-custom-place-btn"
            icon={<Plus size={15} />}
            size="sm"
            variant="secondary"
            onClick={() => setShowAddModal(true)}
          >
            Add Place
          </Button>
        }
      />

      <PlaceFilters filters={filters} onChange={setFilters} />

      <div style={{ flex: 1, padding: '24px 32px', overflowY: 'auto' }}>
        {loading && places.length === 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
            {Array.from({ length: 12 }, (_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : allPlaces.length === 0 ? (
          <EmptyState
            type="places"
            title={filters.search ? `No results for "${filters.search}"` : 'No places found'}
            description={filters.search
              ? 'Try a different search term or adjust your filters.'
              : 'Import OSM data or add a custom place to get started.'}
            action={<Button icon={<Plus size={15} />} onClick={() => setShowAddModal(true)}>Add Custom Place</Button>}
          />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
              {allPlaces.map((place) => (
                <PlaceCard key={place.id} place={place} onClick={setSelectedPlace} />
              ))}
            </div>

            {/* Load More */}
            {hasMore && !filters.visited && !filters.wishlist && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '32px', paddingBottom: '24px' }}>
                <Button
                  variant="secondary"
                  onClick={handleLoadMore}
                  loading={loading}
                  icon={loading ? <Loader size={15} /> : null}
                  id="load-more-btn"
                >
                  {loading ? 'Loading...' : `Load More (${(totalCount - places.length).toLocaleString()} remaining)`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <PlaceDetailModal
        place={selectedPlace}
        isOpen={!!selectedPlace}
        onClose={() => setSelectedPlace(null)}
      />

      <AddCustomPlaceModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={(place) => {
          setShowAddModal(false);
        }}
      />
    </div>
  );
}
