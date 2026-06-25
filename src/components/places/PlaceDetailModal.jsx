import React, { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import StarRating from '@/components/ui/StarRating';
import { useToast } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';
import { useUserDataStore } from '@/store/userDataStore';
import { MapPin, Navigation, CheckCircle, Heart, BookOpen, Star } from 'lucide-react';

export default function PlaceDetailModal({ place, isOpen, onClose }) {
  const { user } = useAuthStore();
  const { visitedPlaces, wishlist, memories, markVisited, unmarkVisited, addToWishlist, removeFromWishlist } =
    useUserDataStore();
  const toast = useToast();

  const isVisited = visitedPlaces.some((v) => v.place_id === place?.id);
  const isWishlisted = wishlist.some((w) => w.place_id === place?.id);
  const visitData = visitedPlaces.find((v) => v.place_id === place?.id);
  const placeMemories = memories.filter((m) => m.place_id === place?.id);

  const [rating, setRating] = useState(visitData?.rating ?? 0);
  const [notes, setNotes] = useState(visitData?.notes ?? '');
  const [busy, setBusy] = useState(false);

  if (!place) return null;

  const district = place.district_name || place.districts?.name;
  const state    = place.state_name    || place.districts?.states?.name;
  const country  = place.country_name  || place.districts?.states?.countries?.name;
  const countryFlag = place.country_flag || place.districts?.states?.countries?.flag_emoji;

  const handleVisit = async () => {
    if (!user) return;
    setBusy(true);
    if (isVisited) {
      await unmarkVisited(user.id, place.id);
      toast?.toast('Removed from visited', 'info');
    } else {
      await markVisited(user.id, place.id, { rating: rating || null, notes: notes || null });
      toast?.toast('Marked as visited! ✓', 'success');
    }
    setBusy(false);
  };

  const handleWishlist = async () => {
    if (!user || isVisited) return;
    setBusy(true);
    if (isWishlisted) {
      await removeFromWishlist(user.id, place.id);
      toast?.toast('Removed from wishlist', 'info');
    } else {
      await addToWishlist(user.id, place.id);
      toast?.toast('Added to wishlist ♡', 'success');
    }
    setBusy(false);
  };

  const openMaps = () => {
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`,
      '_blank'
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={place.name}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="secondary" icon={<Navigation size={14} />} onClick={openMaps}>
            Open in Maps
          </Button>
          {!isVisited && (
            <Button
              variant="secondary"
              icon={<Heart size={14} fill={isWishlisted ? '#F59E0B' : 'none'} />}
              onClick={handleWishlist}
              loading={busy}
              style={{ color: isWishlisted ? '#F59E0B' : undefined }}
            >
              {isWishlisted ? 'Saved' : 'Wishlist'}
            </Button>
          )}
          <Button
            variant={isVisited ? 'secondary' : 'primary'}
            icon={<CheckCircle size={14} />}
            onClick={handleVisit}
            loading={busy}
          >
            {isVisited ? 'Unmark Visited' : 'Mark Visited'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Image */}
        {place.image_url && (
          <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', height: 240 }}>
            <img
              src={place.image_url}
              alt={place.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}

        {/* Meta */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <Badge category={place.category} size="md" />
          {place.place_type && (
            <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
              {place.place_type}
            </span>
          )}
          {(district || country) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
              <MapPin size={13} />
              {[district, state, country].filter(Boolean).join(', ')}
              {countryFlag && <span>{countryFlag}</span>}
            </div>
          )}
        </div>

        {/* Description */}
        {place.description && (
          <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
            {place.description}
          </p>
        )}

        {/* Rating (if visiting) */}
        {!isVisited && (
          <div
            style={{
              padding: '16px',
              background: 'var(--color-bg-tertiary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              Rate your visit (optional)
            </p>
            <StarRating value={rating} onChange={setRating} />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about your visit..."
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-primary)',
                fontSize: '13px',
                fontFamily: 'inherit',
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </div>
        )}

        {/* Visited rating display */}
        {isVisited && visitData?.rating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'var(--color-accent-muted)', borderRadius: 'var(--radius-lg)' }}>
            <Star size={16} color="#F59E0B" fill="#F59E0B" />
            <span style={{ fontSize: '14px', color: 'var(--color-text-primary)' }}>
              Your rating: <strong>{visitData.rating}/10</strong>
            </span>
          </div>
        )}
        {isVisited && visitData?.notes && (
          <div style={{ padding: '12px 16px', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-lg)', borderLeft: '3px solid var(--color-accent)' }}>
            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
              "{visitData.notes}"
            </p>
          </div>
        )}

        {/* Memories */}
        {placeMemories.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <BookOpen size={16} color="var(--color-text-muted)" />
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                Memories ({placeMemories.length})
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {placeMemories.map((mem) => (
                <div
                  key={mem.id}
                  style={{
                    padding: '12px 14px',
                    background: 'var(--color-bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {mem.title && (
                    <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '4px' }}>
                      {mem.title}
                    </p>
                  )}
                  {mem.content && (
                    <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }} className="line-clamp-3">
                      {mem.content}
                    </p>
                  )}
                  {mem.visit_date && (
                    <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                      {new Date(mem.visit_date).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Coordinates */}
        <div style={{ display: 'flex', gap: '8px', fontSize: '12px', color: 'var(--color-text-muted)', paddingTop: '4px' }}>
          <MapPin size={12} />
          <span>
            {place.latitude?.toFixed(4)}, {place.longitude?.toFixed(4)}
          </span>
        </div>
      </div>
    </Modal>
  );
}
