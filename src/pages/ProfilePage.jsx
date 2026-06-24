import React, { useState } from 'react';
import { User, Edit2, Save, X, Globe, MapPin, CheckCircle, BookOpen, Camera, Star } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ProgressBar from '@/components/ui/ProgressBar';
import { useAuthStore } from '@/store/authStore';
import { useUserDataStore } from '@/store/userDataStore';
import { useToast } from '@/components/ui/Toast';

export default function ProfilePage() {
  const { profile, updateProfile } = useAuthStore();
  const { stats, memories, visitedPlaces } = useUserDataStore();
  const toast = useToast();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ full_name: profile?.full_name ?? '', username: profile?.username ?? '' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await updateProfile({ full_name: form.full_name, username: form.username });
    if (!error) toast?.toast('Profile updated!', 'success');
    else toast?.toast('Failed to update profile', 'error');
    setSaving(false);
    setEditing(false);
  };

  const avatarLetter = (profile?.username?.[0] ?? profile?.full_name?.[0] ?? 'U').toUpperCase();

  // Recent memories for timeline
  const recentMemories = memories.slice(0, 5);

  // Top rated visited places
  const topRated = visitedPlaces
    .filter((v) => v.rating)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <PageHeader
        title="Profile"
        subtitle="Your exploration identity"
        icon={<User size={20} />}
        actions={
          editing ? (
            <>
              <Button variant="ghost" icon={<X size={15} />} onClick={() => setEditing(false)} size="sm">Cancel</Button>
              <Button icon={<Save size={15} />} onClick={handleSave} loading={saving} size="sm">Save</Button>
            </>
          ) : (
            <Button variant="secondary" icon={<Edit2 size={15} />} onClick={() => setEditing(true)} size="sm">Edit Profile</Button>
          )
        }
      />

      <div style={{ flex: 1, padding: '32px', overflowY: 'auto', maxWidth: 1000, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>

          {/* Profile Card */}
          <div style={{ gridColumn: '1 / -1' }}>
            <div
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-xl)',
                padding: '28px',
                display: 'flex',
                gap: '24px',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-accent-muted)',
                  border: '3px solid var(--color-accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '28px',
                  fontWeight: 800,
                  color: 'var(--color-accent)',
                  flexShrink: 0,
                  overflow: 'hidden',
                }}
              >
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  avatarLetter
                )}
              </div>

              {/* Info / Edit Form */}
              {editing ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <Input
                    id="profile-fullname"
                    label="Full Name"
                    value={form.full_name}
                    onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                    icon={<User size={15} />}
                  />
                  <Input
                    id="profile-username"
                    label="Username"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    icon={<span style={{ fontSize: '13px', fontWeight: 600 }}>@</span>}
                  />
                </div>
              ) : (
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '4px' }}>
                    {profile?.full_name ?? 'Explorer'}
                  </h2>
                  <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
                    @{profile?.username ?? 'you'}
                  </p>
                  <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                    Member since {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : '—'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Stats Grid */}
          <div
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px',
              gridColumn: '1 / -1',
            }}
          >
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '20px' }}>
              🌍 Exploration Stats
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '16px' }}>
              {[
                { label: 'Places Visited', value: stats?.visited_count ?? 0, icon: <CheckCircle size={20} color="#10B981" />, color: '#10B981' },
                { label: 'Countries', value: stats?.countries_explored ?? 0, icon: <Globe size={20} color="#3B82F6" />, color: '#3B82F6' },
                { label: 'States', value: stats?.states_explored ?? 0, icon: <MapPin size={20} color="#8B5CF6" />, color: '#8B5CF6' },
                { label: 'Districts', value: stats?.districts_explored ?? 0, icon: <MapPin size={20} color="#F59E0B" />, color: '#F59E0B' },
                { label: 'Memories', value: stats?.memory_count ?? 0, icon: <BookOpen size={20} color="#EC4899" />, color: '#EC4899' },
                { label: 'Photos', value: stats?.photo_count ?? 0, icon: <Camera size={20} color="#06B6D4" />, color: '#06B6D4' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    padding: '16px',
                    background: 'var(--color-bg-tertiary)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--color-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    alignItems: 'center',
                    textAlign: 'center',
                  }}
                >
                  {stat.icon}
                  <div style={{ fontSize: '28px', fontWeight: 800, color: stat.color, letterSpacing: '-0.02em' }}>
                    {stat.value}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 500 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Rated */}
          {topRated.length > 0 && (
            <div
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-xl)',
                padding: '24px',
              }}
            >
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Star size={16} color="#F59E0B" fill="#F59E0B" /> Top Rated Places
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {topRated.map((vp, i) => (
                  <div key={vp.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-muted)', width: 18, flexShrink: 0 }}>#{i + 1}</span>
                    {vp.places?.image_url && <img src={vp.places.image_url} alt="" style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />}
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {vp.places?.name ?? 'Unknown'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: '#F59E0B', fontWeight: 600, flexShrink: 0 }}>
                      <Star size={12} fill="#F59E0B" /> {vp.rating}/10
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Memories Timeline */}
          {recentMemories.length > 0 && (
            <div
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-xl)',
                padding: '24px',
              }}
            >
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BookOpen size={16} color="var(--color-accent)" /> Recent Memories
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {recentMemories.map((mem, i) => (
                  <div
                    key={mem.id}
                    style={{
                      display: 'flex',
                      gap: '14px',
                      paddingBottom: i < recentMemories.length - 1 ? '16px' : 0,
                      position: 'relative',
                    }}
                  >
                    {/* Timeline dot */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-accent)', marginTop: 4 }} />
                      {i < recentMemories.length - 1 && (
                        <div style={{ width: 1, flex: 1, background: 'var(--color-border)', marginTop: 4 }} />
                      )}
                    </div>
                    <div style={{ flex: 1, paddingBottom: 8 }}>
                      <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                        {mem.title ?? 'Untitled Memory'}
                      </p>
                      {mem.visit_date && (
                        <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 2 }}>
                          {new Date(mem.visit_date).toLocaleDateString()}
                        </p>
                      )}
                      {mem.content && (
                        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: 4 }} className="line-clamp-2">
                          {mem.content}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
