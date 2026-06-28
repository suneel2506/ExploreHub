import { useState, useEffect } from 'react';
import { useSearchStore } from '@/store/searchStore';
import { CATEGORY_COLORS } from '@/lib/constants';

/**
 * PlaceDetailEnriched — Enhanced place detail view with enrichment data.
 * Shows Wikipedia summary, image gallery, tags, heritage status, metadata.
 *
 * Designed to be used INSIDE the existing PlaceDetailModal as an
 * additional section, not as a replacement.
 *
 * USAGE:
 *   <PlaceDetailEnriched placeId={place.id} />
 */
export default function PlaceDetailEnriched({ placeId }) {
  const { placeDetail, placeDetailLoading, fetchPlaceDetail, clearPlaceDetail } = useSearchStore();
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showFullHistory, setShowFullHistory] = useState(false);

  useEffect(() => {
    if (placeId) {
      fetchPlaceDetail(placeId);
    }
    return () => clearPlaceDetail();
  }, [placeId, fetchPlaceDetail, clearPlaceDetail]);

  if (placeDetailLoading) {
    return (
      <div className="py-6 flex justify-center">
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'rgba(255,255,255,0.15)', borderTopColor: 'rgba(99,102,241,0.7)' }} />
      </div>
    );
  }

  if (!placeDetail) return null;

  const { descriptions, images, tags, metadata } = placeDetail;
  const wikiDesc = descriptions?.find(d => d.source === 'wikipedia');
  const tourismDesc = descriptions?.find(d => d.source === 'tourism');
  const allImages = images || [];
  const allTags = tags || [];
  const meta = metadata || {};

  const hasEnrichedData = wikiDesc || allImages.length > 0 || allTags.length > 0 || meta.population || meta.heritage_status;

  if (!hasEnrichedData) return null;

  return (
    <div className="mt-4 space-y-4">
      {/* ── Tags Row ────────────────────────────────────────────────── */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map(tag => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{
                backgroundColor: `${CATEGORY_COLORS[tag.name] || '#6B7280'}20`,
                color: CATEGORY_COLORS[tag.name] || '#9CA3AF',
                border: `1px solid ${CATEGORY_COLORS[tag.name] || '#6B7280'}30`,
              }}
            >
              {tag.emoji && <span>{tag.emoji}</span>}
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* ── Heritage Badge ──────────────────────────────────────────── */}
      {(meta.heritage_status || placeDetail.place?.heritage_status) && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{
            background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.1), rgba(245, 158, 11, 0.05))',
            border: '1px solid rgba(234, 179, 8, 0.2)',
          }}
        >
          <span className="text-lg">🏆</span>
          <span className="text-sm font-medium" style={{ color: 'rgba(234, 179, 8, 0.9)' }}>
            {meta.heritage_status || placeDetail.place?.heritage_status}
          </span>
        </div>
      )}

      {/* ── Image Gallery ───────────────────────────────────────────── */}
      {allImages.length > 1 && (
        <div>
          <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
            <img
              src={allImages[activeImageIndex]?.url}
              alt={placeDetail.place?.name}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { e.target.style.display = 'none'; }}
            />

            {/* Image source badge */}
            {allImages[activeImageIndex]?.source && (
              <span
                className="absolute bottom-2 right-2 px-2 py-0.5 rounded text-[10px] font-medium"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  color: 'rgba(255,255,255,0.7)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                📷 {allImages[activeImageIndex].source}
              </span>
            )}

            {/* Navigation arrows */}
            {allImages.length > 1 && (
              <>
                <button
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full"
                  style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                  onClick={() => setActiveImageIndex(prev => prev > 0 ? prev - 1 : allImages.length - 1)}
                >
                  <span style={{ color: 'white', fontSize: '14px' }}>‹</span>
                </button>
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full"
                  style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                  onClick={() => setActiveImageIndex(prev => prev < allImages.length - 1 ? prev + 1 : 0)}
                >
                  <span style={{ color: 'white', fontSize: '14px' }}>›</span>
                </button>
              </>
            )}
          </div>

          {/* Thumbnails */}
          {allImages.length > 1 && (
            <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
              {allImages.map((img, i) => (
                <button
                  key={img.id || i}
                  className="flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden"
                  style={{
                    border: i === activeImageIndex
                      ? '2px solid rgba(99, 102, 241, 0.7)'
                      : '2px solid transparent',
                    opacity: i === activeImageIndex ? 1 : 0.6,
                  }}
                  onClick={() => setActiveImageIndex(i)}
                >
                  <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Wikipedia Summary ───────────────────────────────────────── */}
      {wikiDesc?.summary && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2"
            style={{ color: 'rgba(255,255,255,0.8)' }}>
            <span>📚</span> About
          </h4>
          <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {wikiDesc.summary}
          </p>

          {/* Extended history (collapsible) */}
          {wikiDesc.history && wikiDesc.history.length > wikiDesc.summary.length && (
            <>
              {showFullHistory && (
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {wikiDesc.history.substring(wikiDesc.summary.length)}
                </p>
              )}
              <button
                className="text-xs font-medium"
                style={{ color: 'rgba(99, 102, 241, 0.8)' }}
                onClick={() => setShowFullHistory(!showFullHistory)}
              >
                {showFullHistory ? '← Show less' : 'Read more →'}
              </button>
            </>
          )}

          {/* Wikipedia link */}
          {wikiDesc.wikipedia_url && (
            <a
              href={wikiDesc.wikipedia_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium mt-1"
              style={{ color: 'rgba(59, 130, 246, 0.8)' }}
            >
              <span>🔗</span> View on Wikipedia
            </a>
          )}
        </div>
      )}

      {/* ── Tourism Description (if different from Wikipedia) ───────── */}
      {tourismDesc?.summary && tourismDesc.summary !== wikiDesc?.summary && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2"
            style={{ color: 'rgba(255,255,255,0.8)' }}>
            <span>🏛️</span> Official Description
          </h4>
          <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {tourismDesc.summary}
          </p>
        </div>
      )}

      {/* ── Metadata Grid ───────────────────────────────────────────── */}
      {(meta.population || meta.elevation || meta.official_website || meta.opening_hours || meta.fee) && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2"
            style={{ color: 'rgba(255,255,255,0.8)' }}>
            <span>📋</span> Details
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {meta.population && (
              <MetadataItem icon="👥" label="Population" value={Number(meta.population).toLocaleString()} />
            )}
            {meta.elevation && (
              <MetadataItem icon="⛰️" label="Elevation" value={`${Math.round(meta.elevation)}m`} />
            )}
            {meta.opening_hours && (
              <MetadataItem icon="🕐" label="Hours" value={meta.opening_hours} />
            )}
            {meta.fee && (
              <MetadataItem icon="🎫" label="Entry Fee" value={meta.fee} />
            )}
            {meta.phone && (
              <MetadataItem icon="📞" label="Phone" value={meta.phone} />
            )}
            {meta.official_website && (
              <div className="col-span-2">
                <a
                  href={meta.official_website.startsWith('http') ? meta.official_website : `https://${meta.official_website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.05)',
                    color: 'rgba(59, 130, 246, 0.8)',
                  }}
                >
                  <span>🌐</span>
                  <span className="truncate">{meta.official_website.replace(/^https?:\/\//, '')}</span>
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helper Component ─────────────────────────────────────────────────────────

function MetadataItem({ icon, label, value }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg"
      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
    >
      <span className="text-sm">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {label}
        </div>
        <div className="text-xs font-medium truncate" style={{ color: 'rgba(255,255,255,0.75)' }}>
          {value}
        </div>
      </div>
    </div>
  );
}
