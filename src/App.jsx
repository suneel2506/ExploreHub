import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isConfigured, initStorage } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import AppLayout from '@/components/layout/AppLayout';
import SetupPage from '@/pages/SetupPage';
import LandingPage from '@/pages/LandingPage';
import AuthPage from '@/pages/AuthPage';
import ExplorePage from '@/pages/ExplorePage';
import MapPage from '@/pages/MapPage';
import MyPlacesPage from '@/pages/MyPlacesPage';
import MemoriesPage from '@/pages/MemoriesPage';
import ProfilePage from '@/pages/ProfilePage';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return <LoadingSpinner fullscreen />;
  if (!user) return <Navigate to="/auth" replace />;
  return children;
}

function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return <LoadingSpinner fullscreen />;
  if (user) return <Navigate to="/explore" replace />;
  return children;
}

export default function App() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    init();
    // Initialise Supabase Storage buckets once on mount
    if (isConfigured) initStorage();
  }, [init]);

  if (!isConfigured) {
    return <SetupPage />;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route
          path="/"
          element={
            <PublicOnlyRoute>
              <LandingPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/auth"
          element={
            <PublicOnlyRoute>
              <AuthPage />
            </PublicOnlyRoute>
          }
        />

        {/* Protected — inside AppLayout */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/explore"   element={<ExplorePage />} />
          <Route path="/map"       element={<MapPage />} />
          <Route path="/my-places" element={<MyPlacesPage />} />
          <Route path="/memories"  element={<MemoriesPage />} />
          <Route path="/profile"   element={<ProfilePage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
