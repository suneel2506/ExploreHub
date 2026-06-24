import React, { useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { PLACE_CATEGORIES, MAP_DEFAULTS } from '@/lib/constants';
import { useUserDataStore } from '@/store/userDataStore';
import { useAuthStore } from '@/store/authStore';
import { MapPin, Navigation } from 'lucide-react';

// Fix Leaflet icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function MapPicker({ position, onPick }) {
  useMapEvents({
    click(e) {
      onPick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return position ? <Marker position={position} /> : null;
}

const CATEGORIES = PLACE_CATEGORIES.filter((c) => c.id !== 'all');

export default function AddCustomPlaceModal({ isOpen, onClose, onAdded }) {
  const { user } = useAuthStore();
  const { addCustomPlace } = useUserDataStore();

  const [form, setForm] = useState({
    name: '', description: '', category: 'Other',
    state: '', district: '', city: '',
    latitude: '', longitude: '',
  });
  const [picking, setPicking]   = useState(false);
  const [pinPos, setPinPos]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handlePick = useCallback((latlng) => {
    setPinPos(latlng);
    setField('latitude',  latlng[0].toFixed(6));
    setField('longitude', latlng[1].toFixed(6));
  }, []);

  const handleGeolocate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      setPinPos([lat, lon]);
      setField('latitude',  lat.toFixed(6));
      setField('longitude', lon.toFixed(6));
    });
  };

  const handleSubmit = async () => {
    setError('');
    if (!form.name.trim())   return setError('Name is required');
    if (!form.latitude || !form.longitude) return setError('Pick a location on the map or enter coordinates');

    const lat = parseFloat(form.latitude);
    const lon = parseFloat(form.longitude);
    if (isNaN(lat) || isNaN(lon)) return setError('Invalid coordinates');

    setLoading(true);
    const { data, error: err } = await addCustomPlace({
      user_id:     user.id,
      name:        form.name.trim(),
      description: form.description.trim() || null,
      category:    form.category,
      state:       form.state.trim()    || null,
      district:    form.district.trim() || null,
      city:        form.city.trim()     || null,
      latitude:    lat,
      longitude:   lon,
    });

    setLoading(false);
    if (err) return setError(err.message);

    onAdded?.(data);
    // Reset form
    setForm({ name: '', description: '', category: 'Other', state: '', district: '', city: '', latitude: '', longitude: '' });
    setPinPos(null);
    setPicking(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Custom Place"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={loading}>Add Place</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Basic Info */}
        <Input
          id="cp-name"
          label="Place Name *"
          placeholder="e.g. Hidden Waterfall, My Favourite Spot"
          value={form.name}
          onChange={(e) => setField('name', e.target.value)}
          icon={<MapPin size={15} />}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            placeholder="What makes this place special?"
            rows={3}
            style={{
              width: '100%', padding: '10px 12px',
              background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)',
              fontSize: '14px', fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.6,
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
          />
        </div>

        {/* Category */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Category</label>
          <select
            value={form.category}
            onChange={(e) => setField('category', e.target.value)}
            style={{
              width: '100%', padding: '10px 12px',
              background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)',
              fontSize: '14px', fontFamily: 'inherit', outline: 'none',
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
            ))}
          </select>
        </div>

        {/* Location Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <Input id="cp-state"    label="State"    placeholder="e.g. Kerala"     value={form.state}    onChange={(e) => setField('state', e.target.value)} />
          <Input id="cp-district" label="District" placeholder="e.g. Wayanad"    value={form.district} onChange={(e) => setField('district', e.target.value)} />
          <Input id="cp-city"     label="City/Town" placeholder="e.g. Kalpetta"  value={form.city}     onChange={(e) => setField('city', e.target.value)} />
        </div>

        {/* Coordinates */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8 }}>
            Location * — click map to pick coordinates
          </label>
          <div style={{ display: 'flex', gap: '10px', marginBottom: 10, flexWrap: 'wrap' }}>
            <Input
              id="cp-lat" label="Latitude"  placeholder="e.g. 11.2588"
              value={form.latitude}  onChange={(e) => setField('latitude', e.target.value)}
            />
            <Input
              id="cp-lon" label="Longitude" placeholder="e.g. 75.7804"
              value={form.longitude} onChange={(e) => setField('longitude', e.target.value)}
            />
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
              <button
                type="button"
                onClick={handleGeolocate}
                title="Use my current location"
                style={{
                  padding: '9px 12px', background: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  color: 'var(--color-accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
                  fontSize: '13px', fontFamily: 'inherit',
                }}
              >
                <Navigation size={14} /> My Location
              </button>
            </div>
          </div>

          {/* Map Picker */}
          <div style={{ height: 240, borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
            <MapContainer
              center={pinPos ?? MAP_DEFAULTS.center}
              zoom={pinPos ? 12 : MAP_DEFAULTS.zoom}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom
            >
              <TileLayer url={MAP_DEFAULTS.tileUrl} attribution={MAP_DEFAULTS.tileAttribution} />
              <MapPicker position={pinPos} onPick={handlePick} />
            </MapContainer>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 5 }}>
            👆 Click anywhere on the map to set the location pin
          </p>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: 'var(--color-danger-muted)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)', fontSize: '13px', color: 'var(--color-danger)' }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
