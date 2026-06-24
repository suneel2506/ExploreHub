import React, { useState } from 'react';
import { MapPin, Heart, CheckCircle, ExternalLink, Star } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import { useAuthStore } from '@/store/authStore';
import { useUserDataStore } from '@/store/userDataStore';
import { useToast } from '@/components/ui/Toast';

export default function PlaceCard({ place, onClick }) {
  const { user } = useAuthStore();
  const { visitedPlaces, wishlist, markVisited, unmarkVisited, addToWishlist, removeFromWishlist } =
    useUserDataStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const isVisited = visitedPlaces.some((v) => v.place_id === place.id);
  const isWishlisted = wishlist.some((w) => w.place_id === place.id);
  const visitData = visitedPlaces.find((v) => v.place_id === place.id);

  const handleVisit = async (e) => {
    e.stopPropagation();
    if (!user) return;
    setBusy(true);
    if (isVisited) {
      const { error } = await unmarkVisited(user.id, place.id);
      if (!error) toast?.toast('Removed from visited', 'info');
    } else {
      const { error } = await markVisited(user.id, place.id);
      if (!error) toast?.toast('Marked as visited! ✓', 'success');
    }
    setBusy(false);
  };

  const handleWishlist = async (e) => {
    e.stopPropagation();
    if (!user || isVisited) return;
    setBusy(true);
    if (isWishlisted) {
      const { error } = await removeFromWishlist(user.id, place.id);
      if (!error) toast?.toast('Removed from wishlist', 'info');
    } else {
      const { error } = await addToWishlist(user.id, place.id);
      if (!error) toast?.toast('Added to wishlist ♡', 'success');
    }
    setBusy(false);
  };

  const district = place.districts;
  const state = district?.states;
  const country = state?.countries;

  return (
    <div
      onClick={() => onClick?.(place)}
      style={{
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${isVisited ? 'rgba(16,185,129,0.3)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'transform 200ms, box-shadow 200ms, border-color 200ms',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Image */}
      <div style={{ position: 'relative', height: 180, overflow: 'hidden', flexShrink: 0 }}>
        {place.image_url ? (
          <img
            src={place.image_url}
            alt={place.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 300ms' }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: 'var(--color-bg-tertiary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '40px',
            }}
          >
            🏞️
          </div>
        )}
        {/* Status overlay */}
        <div style={{ position: 'absolute', top: '10px', left: '10px', display: 'flex', gap: '6px' }}>
          <Badge category={place.category} />
          {isVisited && <Badge preset="visited" />}
          {isWishlisted && !isVisited && <Badge preset="wishlist" />}
        </div>
        {/* Rating */}
        {visitData?.rating && (
          <div
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              background: 'rgba(0,0,0,0.7)',
              borderRadius: 'var(--radius-full)',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#F59E0B',
            }}
          >
            <Star size={11} fill="#F59E0B" />
            {visitData.rating}/10
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div>
          <h3
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginBottom: '4px',
              lineHeight: 1.3,
            }}
            className="line-clamp-2"
          >
            {place.name}
          </h3>
          {(district || country) && (
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <MapPin size={11} />
              {[district?.name, state?.name, country?.flag_emoji].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        {place.description && (
          <p
            style={{ fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}
            className="line-clamp-2"
          >
            {place.description}
          </p>
        )}

        {/* Actions */}
        <div
          style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '8px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleVisit}
            disabled={busy}
            title={isVisited ? 'Unmark visited' : 'Mark as visited'}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '7px 10px',
              background: isVisited ? 'var(--color-accent-muted)' : 'var(--color-bg-tertiary)',
              border: `1px solid ${isVisited ? 'var(--color-accent)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              color: isVisited ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer',
              transition: 'all 150ms',
              fontFamily: 'inherit',
            }}
          >
            <CheckCircle size={14} />
            {isVisited ? 'Visited' : 'Visit'}
          </button>
          <button
            onClick={handleWishlist}
            disabled={busy || isVisited}
            title={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '7px 10px',
              background: isWishlisted ? 'rgba(245,158,11,0.12)' : 'var(--color-bg-tertiary)',
              border: `1px solid ${isWishlisted ? '#F59E0B' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              color: isWishlisted ? '#F59E0B' : 'var(--color-text-secondary)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: busy || isVisited ? 'not-allowed' : 'pointer',
              opacity: isVisited ? 0.4 : 1,
              transition: 'all 150ms',
              fontFamily: 'inherit',
            }}
          >
            <Heart size={14} fill={isWishlisted ? '#F59E0B' : 'none'} />
            {isWishlisted ? 'Saved' : 'Wishlist'}
          </button>
        </div>
      </div>
    </div>
  );
}
