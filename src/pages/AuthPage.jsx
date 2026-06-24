import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Globe, Mail, Lock, User, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export default function AuthPage() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', username: '', fullName: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { signIn, signUp } = useAuthStore();
  const navigate = useNavigate();

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (mode === 'signin') {
      const { error: err } = await signIn({ email: form.email, password: form.password });
      if (err) setError(err.message);
      else navigate('/explore');
    } else {
      const { error: err } = await signUp({
        email: form.email,
        password: form.password,
        username: form.username,
        fullName: form.fullName,
      });
      if (err) setError(err.message);
      else setSuccess('Account created! Check your email to confirm, then sign in.');
    }
    setLoading(false);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        fontFamily: 'var(--font-family-sans)',
        background: 'var(--color-bg-primary)',
      }}
    >
      {/* Left Panel — Branding */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '48px',
          background: 'var(--color-bg-secondary)',
          borderRight: '1px solid var(--color-border)',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Glow */}
        <div
          style={{
            position: 'absolute',
            top: '30%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        <div style={{ position: 'relative' }}>
          {/* Logo */}
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '48px', textDecoration: 'none' }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Globe size={20} color="#0A0A0A" />
            </div>
            <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--color-text-primary)' }}>ExploreHub</span>
          </Link>

          <h2 style={{ fontSize: '36px', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text-primary)', lineHeight: 1.2, marginBottom: '16px' }}>
            Map your<br />
            <span style={{ color: 'var(--color-accent)' }}>world.</span>
          </h2>
          <p style={{ fontSize: '16px', color: 'var(--color-text-secondary)', lineHeight: 1.7, maxWidth: 340 }}>
            Your personal exploration atlas. Track every place you've been, dream of where you'll go next.
          </p>

          {/* Feature bullets */}
          <div style={{ marginTop: '40px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[
              '✓  Interactive world map with your places',
              '✓  Rate, review & journal your visits',
              '✓  Track progress across countries & states',
              '✓  Build your dream travel wishlist',
            ].map((feat) => (
              <p key={feat} style={{ fontSize: '14px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {feat}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel — Form */}
      <div
        style={{
          width: 460,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 40px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 380 }}>
          {/* Mode Toggle */}
          <div
            style={{
              display: 'flex',
              background: 'var(--color-bg-tertiary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: '4px',
              marginBottom: '32px',
            }}
          >
            {['signin', 'signup'].map((m) => (
              <button
                key={m}
                id={`auth-${m}-tab`}
                onClick={() => { setMode(m); setError(''); setSuccess(''); }}
                style={{
                  flex: 1,
                  padding: '9px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: mode === m ? 'var(--color-bg-secondary)' : 'transparent',
                  color: mode === m ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                  fontSize: '14px',
                  fontWeight: mode === m ? 600 : 400,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 150ms',
                  boxShadow: mode === m ? 'var(--shadow-sm)' : 'none',
                }}
              >
                {m === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '24px' }}>
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </h1>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {mode === 'signup' && (
              <>
                <Input
                  id="auth-fullname"
                  label="Full Name"
                  placeholder="Jane Doe"
                  value={form.fullName}
                  onChange={(e) => setField('fullName', e.target.value)}
                  icon={<User size={16} />}
                />
                <Input
                  id="auth-username"
                  label="Username"
                  placeholder="janedoe"
                  value={form.username}
                  onChange={(e) => setField('username', e.target.value)}
                  icon={<span style={{ fontSize: '14px', fontWeight: 600 }}>@</span>}
                  required
                />
              </>
            )}

            <Input
              id="auth-email"
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              icon={<Mail size={16} />}
              required
              autoComplete="email"
            />

            <div>
              <Input
                id="auth-password"
                label="Password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                icon={<Lock size={16} />}
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  fontSize: '12px',
                  padding: '6px 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontFamily: 'inherit',
                }}
              >
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                {showPassword ? 'Hide' : 'Show'} password
              </button>
            </div>

            {error && (
              <div
                style={{
                  padding: '12px 14px',
                  background: 'var(--color-danger-muted)',
                  border: '1px solid var(--color-danger)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '13px',
                  color: 'var(--color-danger)',
                }}
              >
                {error}
              </div>
            )}

            {success && (
              <div
                style={{
                  padding: '12px 14px',
                  background: 'var(--color-accent-muted)',
                  border: '1px solid var(--color-accent)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '13px',
                  color: 'var(--color-accent)',
                }}
              >
                {success}
              </div>
            )}

            <Button
              id="auth-submit-btn"
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              icon={<ArrowRight size={16} />}
            >
              {mode === 'signin' ? 'Sign In' : 'Create Account'}
            </Button>
          </form>

          <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '24px' }}>
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setSuccess(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 500 }}
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
