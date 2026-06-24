import React, { useState } from 'react';
import { MapPin, CheckCircle, Star, Trash2, Plus, Edit2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import PlaceDetailModal from '@/components/places/PlaceDetailModal';
import AddCustomPlaceModal from '@/components/places/AddCustomPlaceModal';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { useUserDataStore } from '@/store/userDataStore';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/ui/Toast';

const TABS = ['visited', 'wishlist', 'custom'];

export default function MyPlacesPage() {
  const [activeTab, setActiveTab]       = useState('visited');
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, type }

  const {
    visitedPlaces, wishlist, customPlaces, stats,
    unmarkVisited, removeFromWishlist, deleteCustomPlace,
  } = useUserDataStore();
  const { user } = useAuthStore();
  const toast    = useToast();

  const handleRemoveVisited = async (placeId, isCustom) => {
    await unmarkVisited(user.id, placeId, isCustom);
    toast?.toast('Removed from visited', 'info');
  };

  const handleRemoveWishlist = async (placeId, isCustom) => {
    await removeFromWishlist(user.id, placeId, isCustom);
    toast?.toast('Removed from wishlist', 'info');
  };

  const handleDeleteCustom = async (id) => {
    const { error } = await deleteCustomPlace(id);
    if (!error) toast?.toast('Custom place deleted', 'info');
    else        toast?.toast('Failed to delete', 'error');
    setDeleteConfirm(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <PageHeader
        title="My Places"
        subtitle="Your personal exploration record"
        icon={<MapPin size={20} />}
      />

      {/* Stats Bar */}
      {stats && (
        <div style={{ padding: '14px 32px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '24px', background: 'var(--color-bg-secondary)', flexWrap: 'wrap' }}>
          {[
            { label: 'Visited',   value: stats.visited_count,       icon: <CheckCircle size={15} color="#10B981" /> },
            { label: 'Countries', value: stats.countries_explored,   icon: <span>🌍</span> },
            { label: 'States',    value: stats.states_explored,      icon: <span>🗺️</span> },
            { label: 'Districts', value: stats.districts_explored,   icon: <span>📍</span> },
            { label: 'Memories',  value: stats.memory_count,         icon: <span>📓</span> },
            { label: 'Custom',    value: stats.custom_places_count,  icon: <span>✏️</span> },
          ].map((stat) => (
            <div key={stat.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {stat.icon}
              <div>
                <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>{stat.value ?? 0}</div>
                <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', padding: '0 32px', overflowX: 'auto' }}>
        {TABS.map((tab) => {
          const counts = { visited: visitedPlaces.length, wishlist: wishlist.length, custom: customPlaces.length };
          const labels = { visited: 'Visited', wishlist: 'Wishlist', custom: 'Custom Places' };
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              id={`my-places-${tab}-tab`}
              onClick={() => setActiveTab(tab)}
              style={{ padding: '14px 20px', background: 'none', border: 'none', borderBottom: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`, color: active ? 'var(--color-accent)' : 'var(--color-text-muted)', fontSize: '14px', fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', transition: 'all 150ms' }}
            >
              {labels[tab]}
              <span style={{ padding: '1px 7px', background: active ? 'var(--color-accent-muted)' : 'var(--color-bg-hover)', color: active ? 'var(--color-accent)' : 'var(--color-text-muted)', borderRadius: 'var(--radius-full)', fontSize: '11px', fontWeight: 600 }}>
                {counts[tab]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '24px 32px', overflowY: 'auto' }}>

        {/* Visited */}
        {activeTab === 'visited' && (
          visitedPlaces.length === 0
            ? <EmptyState type="places" title="No visited places yet" description="Open a place and mark it as visited to see it here." />
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {visitedPlaces.map((vp) => {
                  const place = vp.places;
                  if (!place) return null;
                  return (
                    <PlaceRow
                      key={vp.id}
                      place={place}
                      extra={vp.rating ? <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '12px', color: '#F59E0B' }}><Star size={12} fill="#F59E0B" /> {vp.rating}/10</span> : null}
                      onView={() => setSelectedPlace(place)}
                      onRemove={() => handleRemoveVisited(vp.place_id, false)}
                    />
                  );
                })}
              </div>
            )
        )}

        {/* Wishlist */}
        {activeTab === 'wishlist' && (
          wishlist.length === 0
            ? <EmptyState type="wishlist" title="Wishlist is empty" description="Browse places and add them to your wishlist." />
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {wishlist.map((wl) => {
                  const place = wl.places;
                  if (!place) return null;
                  return (
                    <PlaceRow
                      key={wl.id}
                      place={place}
                      badgePreset="wishlist"
                      onView={() => setSelectedPlace(place)}
                      onRemove={() => handleRemoveWishlist(wl.place_id, false)}
                    />
                  );
                })}
              </div>
            )
        )}

        {/* Custom Places */}
        {activeTab === 'custom' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <Button
                id="add-custom-place-myplaces-btn"
                icon={<Plus size={15} />}
                onClick={() => setShowAddModal(true)}
                size="sm"
              >
                Add Custom Place
              </Button>
            </div>

            {customPlaces.length === 0
              ? <EmptyState type="places" title="No custom places yet" description="Add places that aren't in the catalog — your favourite spots, hidden gems, local finds." action={<Button icon={<Plus size={15} />} onClick={() => setShowAddModal(true)}>Add Custom Place</Button>} />
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {customPlaces.map((cp) => (
                    <PlaceRow
                      key={cp.id}
                      place={cp}
                      badgePreset="custom"
                      meta={[cp.district, cp.state].filter(Boolean).join(', ')}
                      onRemove={() => setDeleteConfirm({ id: cp.id, name: cp.name })}
                    />
                  ))}
                </div>
              )
            }
          </>
        )}
      </div>

      {/* Place Detail */}
      <PlaceDetailModal
        place={selectedPlace}
        isOpen={!!selectedPlace}
        onClose={() => setSelectedPlace(null)}
      />

      {/* Add Custom Place */}
      <AddCustomPlaceModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={() => setShowAddModal(false)}
      />

      {/* Delete Confirm */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Custom Place"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => handleDeleteCustom(deleteConfirm?.id)}>Delete</Button>
          </>
        }
      >
        <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
          Delete "<strong>{deleteConfirm?.name}</strong>"? This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

function PlaceRow({ place, extra, badgePreset, meta, onView, onRemove }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', transition: 'border-color 150ms' }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-border-hover)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
    >
      {place.image_url ? (
        <img src={place.image_url} alt={place.name} style={{ width: 52, height: 52, borderRadius: 'var(--radius-lg)', objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 52, height: 52, borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
          🏞️
        </div>
      )}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <p style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-text-primary)', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {place.name}
        </p>
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
          {badgePreset ? <Badge preset={badgePreset} /> : <Badge category={place.category} />}
          {extra}
          {meta && <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{meta}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        {onView && (
          <button onClick={onView} style={{ padding: '6px 12px', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 150ms' }}>
            View
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove} style={{ padding: '6px 8px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 150ms' }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-danger)'; e.currentTarget.style.color = 'var(--color-danger)'; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
