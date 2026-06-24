import React, { useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Compass, Map, MapPin, BookOpen, User } from 'lucide-react';
import Sidebar from './Sidebar';
import { ToastProvider } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';
import { useUserDataStore } from '@/store/userDataStore';

const NAV_ITEMS = [
  { to: '/explore',   icon: Compass,  label: 'Explore' },
  { to: '/map',       icon: Map,      label: 'Map' },
  { to: '/my-places', icon: MapPin,   label: 'Places' },
  { to: '/memories',  icon: BookOpen, label: 'Memories' },
  { to: '/profile',   icon: User,     label: 'Profile' },
];

export default function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const fetchUserData = useUserDataStore((s) => s.fetchUserData);

  useEffect(() => {
    if (user) fetchUserData(user.id);
  }, [user, fetchUserData]);

  return (
    <ToastProvider>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Desktop sidebar — hidden below 768px via CSS */}
        <div className="desktop-sidebar">
          <Sidebar />
        </div>

        {/* Main content */}
        <main
          style={{
            flex: 1,
            overflow: 'auto',
            background: 'var(--color-bg-primary)',
            display: 'flex',
            flexDirection: 'column',
            // On mobile, leave space for bottom nav (60px)
            paddingBottom: 'var(--mobile-nav-height, 0)',
          }}
          className="page-enter"
        >
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation — visible below 768px via CSS */}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className="mobile-nav-item"
            style={({ isActive }) => ({
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              flex: 1,
              padding: '8px 4px',
              textDecoration: 'none',
              color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
              fontSize: '10px',
              fontWeight: isActive ? 600 : 400,
              fontFamily: 'var(--font-family-sans)',
              transition: 'color 150ms',
            })}
          >
            {({ isActive }) => (
              <>
                <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <style>{`
        .desktop-sidebar { display: flex; }

        .mobile-bottom-nav {
          display: none;
          position: fixed;
          bottom: 0; left: 0; right: 0;
          z-index: 1000;
          background: var(--color-bg-secondary);
          border-top: 1px solid var(--color-border);
          height: 60px;
          backdrop-filter: blur(12px);
        }

        @media (max-width: 768px) {
          .desktop-sidebar { display: none !important; }
          .mobile-bottom-nav { display: flex !important; }
          main { padding-bottom: 60px !important; }
        }
      `}</style>
    </ToastProvider>
  );
}
