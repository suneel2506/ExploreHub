import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Heart, CheckCircle, Star } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import { useAuthStore } from '@/store/authStore';
import { useUserDataStore } from '@/store/userDataStore';
import { useToast } from '@/components/ui/Toast';
import { CATEGORY_COLORS } from '@/lib/constants';

// ─── Wikipedia image cache (module-level, lives for session) ──────────────────
const wikiCache = new Map(); // name → imageUrl | null

async function fetchWikiImage(name) {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  if (wikiCache.has(key)) return wikiCache.get(key);

  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) { wikiCache.set(key, null); return null; }
    const json = await res.json();
    const url  = json?.thumbnail?.source ?? null;
    // Bump thumbnail to 400px for better card quality
    const large = url ? url.replace(/\/\d+px-/, '/400px-') : null;
    wikiCache.set(key, large);
    return large;
  } catch {
    wikiCache.set(key, null);
    return null;
  }
}

// ─── Category gradient backgrounds (fallback when no image) ───────────────────
const CATEGORY_GRADIENTS = {
  Waterfalls:      'linear-gradient(135deg, #1a4a7a 0%, #0ea5e9 100%)',
  Beaches:         'linear-gradient(135deg, #0c4a6e 0%, #06b6d4 50%, #f59e0b 100%)',
  Mountains:       'linear-gradient(135deg, #1e1b4b 0%, #4c1d95 50%, #7c3aed 100%)',
  Lakes:           'linear-gradient(135deg, #0c4a6e 0%, #0369a1 100%)',
  Forests:         'linear-gradient(135deg, #14532d 0%, #16a34a 100%)',
  Temples:         'linear-gradient(135deg, #78350f 0%, #d97706 100%)',
  Historical:      'linear-gradient(135deg, #431407 0%, #b45309 100%)',
  Forts:           'linear-gradient(135deg, #451a03 0%, #92400e 100%)',
  Museums:         'linear-gradient(135deg, #1e1b4b 0%, #7c3aed 100%)',
  'National Parks':'linear-gradient(135deg, #14532d 0%, #22c55e 100%)',
  Parks:           'linear-gradient(135deg, #166534 0%, #4ade80 100%)',
  Wildlife:        'linear-gradient(135deg, #422006 0%, #c2410c 100%)',
  Caves:           'linear-gradient(135deg, #1c1917 0%, #57534e 100%)',
  Viewpoints:      'linear-gradient(135deg, #0f172a 0%, #334155 50%, #f59e0b 100%)',
  Attractions:     'linear-gradient(135deg, #4a044e 0%, #a21caf 100%)',
  Mosques:         'linear-gradient(135deg, #064e3b 0%, #059669 100%)',
  Churches:        'linear-gradient(135deg, #2e1065 0%, #7c3aed 100%)',
  Gurudwaras:      'linear-gradient(135deg, #78350f 0%, #e88d2a 100%)',
  Monasteries:     'linear-gradient(135deg, #4a044e 0%, #d946ef 100%)',
  Dams:            'linear-gradient(135deg, #0c4a6e 0%, #0284c7 100%)',
  Islands:         'linear-gradient(135deg, #134e4a 0%, #14b8a6 100%)',
  Bridges:         'linear-gradient(135deg, #1e293b 0%, #64748b 100%)',
  Airports:        'linear-gradient(135deg, #1e3a5f 0%, #3b82f6 100%)',
  'Railway Stations':'linear-gradient(135deg, #4c1d95 0%, #9333ea 100%)',
  Cities:          'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
  Villages:        'linear-gradient(135deg, #365314 0%, #84cc16 100%)',
  Other:           'linear-gradient(135deg, #1e293b 0%, #475569 100%)',
};

const CATEGORY_EMOJIS = {
  Waterfalls: '💧', Beaches: '🏖️', Mountains: '⛰️', Lakes: '🏞️',
  Forests: '🌲', Temples: '🛕', Historical: '🏛️', Forts: '🏰',
  Museums: '🏫', 'National Parks': '🏕️', Parks: '🌿', Wildlife: '🐘',
  Caves: '🪨', Viewpoints: '🔭', Attractions: '⭐',
  Mosques: '🕌', Churches: '⛪', Gurudwaras: '🙏', Monasteries: '🧘',
  Dams: '🌊', Islands: '🏝️', Bridges: '🌉',
  Airports: '✈️', 'Railway Stations': '🚂',
  Cities: '🏙️', Villages: '🏘️', Other: '📍',
};

/**
 * usePlaceImage: lazy-loads a Wikipedia thumbnail for the place.
 * Uses IntersectionObserver so cards off-screen don't fetch until scrolled to.
 */
function usePlaceImage(place) {
  const [imgUrl, setImgUrl] = useState(place.image_url || null);
  const fetched = useRef(false);
  const ref     = useRef(null);

  useEffect(() => {
    // If place already has an image, no need to fetch
    if (place.image_url) { setImgUrl(place.image_url); return; }
    if (fetched.current) return;

    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      async ([entry]) => {
        if (entry.isIntersecting && !fetched.current) {
          fetched.current = true;
          obs.disconnect();
          const url = await fetchWikiImage(place.name);
          if (url) setImgUrl(url);
        }
      },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [place.image_url, place.name]);

  return { imgUrl, ref };
}

// ─── PlaceCard ────────────────────────────────────────────────────────────────
export default function PlaceCard({ place, onClick }) {
  const { user } = useAuthStore();
  const { visitedPlaces, wishlist, markVisited, unmarkVisited, addToWishlist, removeFromWishlist } =
    useUserDataStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const isVisited   = visitedPlaces.some((v) => v.place_id === place.id);
  const isWishlisted = wishlist.some((w) => w.place_id === place.id);
  const visitData   = visitedPlaces.find((v) => v.place_id === place.id);

  const { imgUrl, ref } = usePlaceImage(place);

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

  const locationLine = [place.city_name || place.city, place.district_name || place.district, place.state_name || place.state].filter(Boolean).join(' · ');
  const gradient     = CATEGORY_GRADIENTS[place.category] || CATEGORY_GRADIENTS.Other;
  const emoji        = CATEGORY_EMOJIS[place.category]    || '📍';

  return (
    <div
      ref={ref}
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
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={place.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 300ms' }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          /* Beautiful category gradient fallback */
          <div
            style={{
              width: '100%',
              height: '100%',
              background: gradient,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '42px', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))' }}>{emoji}</span>
            <span style={{
              fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.7)',
            }}>
              {place.category}
            </span>
          </div>
        )}

        {/* Badges */}
        <div style={{ position: 'absolute', top: '10px', left: '10px', display: 'flex', gap: '6px' }}>
          <Badge category={place.category} />
          {isVisited     && <Badge preset="visited" />}
          {isWishlisted && !isVisited && <Badge preset="wishlist" />}
        </div>

        {/* Rating badge */}
        {visitData?.rating && (
          <div
            style={{
              position: 'absolute', top: '10px', right: '10px',
              background: 'rgba(0,0,0,0.7)', borderRadius: 'var(--radius-full)',
              padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '12px', fontWeight: 600, color: '#F59E0B',
            }}
          >
            <Star size={11} fill="#F59E0B" />{visitData.rating}/10
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div>
          <h3
            style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '4px', lineHeight: 1.3 }}
            className="line-clamp-2"
          >
            {place.name}
          </h3>
          {locationLine && (
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <MapPin size={11} />{locationLine}
            </p>
          )}
        </div>

        {place.description && (
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }} className="line-clamp-2">
            {place.description}
          </p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '8px' }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={handleVisit}
            disabled={busy}
            title={isVisited ? 'Unmark visited' : 'Mark as visited'}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '7px 10px',
              background: isVisited ? 'var(--color-accent-muted)' : 'var(--color-bg-tertiary)',
              border: `1px solid ${isVisited ? 'var(--color-accent)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              color: isVisited ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              fontSize: '12px', fontWeight: 500, cursor: busy ? 'wait' : 'pointer',
              transition: 'all 150ms', fontFamily: 'inherit',
            }}
          >
            <CheckCircle size={14} />{isVisited ? 'Visited' : 'Visit'}
          </button>
          <button
            onClick={handleWishlist}
            disabled={busy || isVisited}
            title={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '7px 10px',
              background: isWishlisted ? 'rgba(245,158,11,0.12)' : 'var(--color-bg-tertiary)',
              border: `1px solid ${isWishlisted ? '#F59E0B' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              color: isWishlisted ? '#F59E0B' : 'var(--color-text-secondary)',
              fontSize: '12px', fontWeight: 500,
              cursor: busy || isVisited ? 'not-allowed' : 'pointer',
              opacity: isVisited ? 0.4 : 1,
              transition: 'all 150ms', fontFamily: 'inherit',
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
