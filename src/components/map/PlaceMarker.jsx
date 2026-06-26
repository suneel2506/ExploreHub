import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { CATEGORY_COLORS } from '@/lib/constants';

function createDivIcon(color, visited, wishlisted) {
  const ring = visited ? '#10B981' : wishlisted ? '#F59E0B' : '#444';
  const dot = visited ? '#10B981' : wishlisted ? '#F59E0B' : color;

  return L.divIcon({
    html: `
      <div style="
        width:28px;height:28px;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        background:${dot};
        border:2.5px solid ${ring};
        box-shadow:0 2px 8px rgba(0,0,0,0.5);
        display:flex;align-items:center;justify-content:center;
      ">
        <div style="transform:rotate(45deg);width:8px;height:8px;background:rgba(255,255,255,0.35);border-radius:50%;"></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -30],
    className: '',
  });
}

export default function PlaceMarker({ place, isVisited, isWishlisted, onClick }) {
  const color = CATEGORY_COLORS[place.category] ?? '#6B7280';
  const icon = useMemo(() => {
    return createDivIcon(color, isVisited, isWishlisted);
}, [color, isVisited, isWishlisted]);

if (
  place.latitude == null ||
  place.longitude == null
) {
  return null;
}

  return (
    <Marker
    position={[
      Number(place.latitude),
      Number(place.longitude)
  ]}
  
      
      icon={icon}
      eventHandlers={{ click: () => onClick?.(place) }}
    >
      <Popup>
        <div style={{ minWidth: 180, fontFamily: 'inherit' }}>
          {place.image_url && (
            <img
              src={place.image_url}
              alt={place.name}
              style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 4, marginBottom: 8 }}
            />
          )}
          <strong style={{ fontSize: 14 }}>{place.name}</strong>
          <div style={{ fontSize: 12, color: '#A3A3A3', marginTop: 4 }}>{place.category}</div>
          {isVisited && (
            <div style={{ fontSize: 12, color: '#10B981', marginTop: 4 }}>✓ Visited</div>
          )}
          {isWishlisted && !isVisited && (
            <div style={{ fontSize: 12, color: '#F59E0B', marginTop: 4 }}>♡ Wishlisted</div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick?.(place);
          }}
            style={{
              marginTop: 8,
              width: '100%',
              padding: '6px 0',
              background: '#10B981',
              color: '#0A0A0A',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            View Details
          </button>
        </div>
      </Popup>
    </Marker>
  );
}
