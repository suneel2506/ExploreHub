import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Compass, Map, Heart, BookOpen, User, LogOut,
  ChevronLeft, ChevronRight, MapPin, Globe
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useUserDataStore } from '@/store/userDataStore';

const navItems = [
  { to: '/explore', icon: <Compass size={20} />, label: 'Explore' },
  { to: '/map', icon: <Map size={20} />, label: 'Map' },
  { to: '/my-places', icon: <MapPin size={20} />, label: 'My Places' },
  { to: '/memories', icon: <BookOpen size={20} />, label: 'Memories' },
  { to: '/profile', icon: <User size={20} />, label: 'Profile' },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { profile, signOut } = useAuthStore();
  const stats = useUserDataStore((s) => s.stats);
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <aside
      style={{
        width: collapsed ? 64 : 220,
        minHeight: '100vh',
        background: 'var(--color-bg-secondary)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 250ms ease',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: collapsed ? '20px 0' : '20px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          borderBottom: '1px solid var(--color-border)',
          minHeight: 64,
        }}
      >
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Globe size={18} color="#0A0A0A" />
            </div>
            <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--color-text-primary)', letterSpacing: '-0.02em' }}>
              ExploreHub
            </span>
          </div>
        )}
        {collapsed && (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Globe size={18} color="#0A0A0A" />
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            background: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-full)',
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            position: collapsed ? 'absolute' : 'relative',
            right: collapsed ? -12 : 'auto',
            top: collapsed ? 20 : 'auto',
            flexShrink: 0,
            transition: 'background 150ms',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-bg-tertiary)'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Stats Pills */}
      {!collapsed && stats && (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            gap: '8px',
          }}
        >
          <StatPill value={stats.visited_count} label="Visited" />
          <StatPill value={stats.countries_explored} label="Countries" />
          <StatPill value={stats.memory_count} label="Memories" />
        </div>
      )}

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={collapsed ? item.label : ''}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: collapsed ? '10px 0' : '10px 12px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              borderRadius: 'var(--radius-md)',
              color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              background: isActive ? 'var(--color-accent-muted)' : 'transparent',
              fontWeight: isActive ? 600 : 400,
              fontSize: '14px',
              textDecoration: 'none',
              transition: 'all 150ms',
            })}
            onMouseEnter={(e) => {
              if (!e.currentTarget.style.background.includes('accent-muted'))
                e.currentTarget.style.background = 'var(--color-bg-hover)';
            }}
            onMouseLeave={(e) => {
              const isActive = e.currentTarget.getAttribute('aria-current') === 'page';
              e.currentTarget.style.background = isActive ? 'var(--color-accent-muted)' : 'transparent';
            }}
          >
            {item.icon}
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User area */}
      <div
        style={{
          padding: collapsed ? '12px 8px' : '12px 16px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-accent-muted)',
            border: '2px solid var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--color-accent)',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            (profile?.username?.[0] ?? profile?.full_name?.[0] ?? 'U').toUpperCase()
          )}
        </div>
        {!collapsed && (
          <>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {profile?.full_name ?? profile?.username ?? 'Explorer'}
              </p>
              <p style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                @{profile?.username ?? 'you'}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                display: 'flex',
                alignItems: 'center',
                padding: '4px',
                borderRadius: 'var(--radius-sm)',
                transition: 'color 150ms',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-muted)'}
            >
              <LogOut size={16} />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

function StatPill({ value, label }) {
  return (
    <div
      style={{
        flex: 1,
        background: 'var(--color-bg-tertiary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '6px 4px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-accent)' }}>{value ?? 0}</div>
      <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  );
}
