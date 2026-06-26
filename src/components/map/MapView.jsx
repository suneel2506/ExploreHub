import React, { useMemo, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import PlaceMarker from './PlaceMarker';
import { MAP_DEFAULTS } from '@/lib/constants';
import { useUserDataStore } from '@/store/userDataStore';

function ChangeView({ center, zoom }) {
  const map = useMap();

  useEffect(() => {
    if (!center) return;

    map.setView(center, zoom ?? map.getZoom(), {
      animate: true
    });
  }, [center, zoom, map]);

  return null;
}

/** Fires onBoundsChange whenever the user pans or zooms */
function BoundsWatcher({ onBoundsChange }) {
  const map = useMapEvents({
    moveend() {
      const b = map.getBounds();
      onBoundsChange?.({
        north: b.getNorth(),
        south: b.getSouth(),
        east:  b.getEast(),
        west:  b.getWest(),
      });
    },
    zoomend() {
      const b = map.getBounds();
      onBoundsChange?.({
        north: b.getNorth(),
        south: b.getSouth(),
        east:  b.getEast(),
        west:  b.getWest(),
      });
    },
    load() {
      const b = map.getBounds();
      onBoundsChange?.({
        north: b.getNorth(),
        south: b.getSouth(),
        east:  b.getEast(),
        west:  b.getWest(),
      });
    },
  });
  return null;
}

export default function MapView({ places = [], onPlaceClick, flyTo, onBoundsChange }) {
  const visitedPlaces = useUserDataStore((s) => s.visitedPlaces);
  const wishlist      = useUserDataStore((s) => s.wishlist);

  const visitedIds  = useMemo(() => new Set(visitedPlaces.map((v) => v.place_id)), [visitedPlaces]);
  const wishlistIds = useMemo(() => new Set(wishlist.map((w)  => w.place_id)),    [wishlist]);

  return (
    <MapContainer
      center={MAP_DEFAULTS.center}
      zoom={MAP_DEFAULTS.zoom}
      style={{ width: '100%', height: '100%' }}
      zoomControl={true}
      preferCanvas={true}
    >
      <TileLayer
        url={MAP_DEFAULTS.tileUrl}
        attribution={MAP_DEFAULTS.tileAttribution}
        maxZoom={19}
      />

      {/* Fly-to a selected place */}
      {flyTo && <ChangeView center={[flyTo.latitude, flyTo.longitude]} zoom={13} />}

      {/* Emit bounds on pan/zoom for viewport-based loading */}
      {onBoundsChange && <BoundsWatcher onBoundsChange={onBoundsChange} />}

      <MarkerClusterGroup
    chunkedLoading
    chunkInterval={200}
    chunkDelay={50}
    removeOutsideVisibleBounds
    maxClusterRadius={50}
>
{places.slice(0, 800).map(place => (
          <PlaceMarker
            key={place.id}
            place={place}
            isVisited={visitedIds.has(place.id)}
            isWishlisted={wishlistIds.has(place.id)}
            onClick={onPlaceClick}
          />
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
