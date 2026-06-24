import React from 'react';
import { Link } from 'react-router-dom';
import { Globe, Map, CheckCircle, BookOpen, Camera, ArrowRight, Star } from 'lucide-react';

const features = [
  {
    icon: <Map size={22} />,
    title: 'Interactive Map',
    desc: 'Visualize every place you\'ve explored on a beautiful world map with color-coded markers.',
  },
  {
    icon: <CheckCircle size={22} />,
    title: 'Track Visits',
    desc: 'Mark places as visited, rate them, and add personal notes to remember your experience.',
  },
  {
    icon: <Star size={22} />,
    title: 'Wishlist',
    desc: 'Save dream destinations to your wishlist and plan your next great adventure.',
  },
  {
    icon: <BookOpen size={22} />,
    title: 'Memories Journal',
    desc: 'Write journal entries attached to places, preserving stories and emotions from each trip.',
  },
  {
    icon: <Camera size={22} />,
    title: 'Photo Gallery',
    desc: 'Upload and organize your travel photos linked to specific places and memories.',
  },
  {
    icon: <Globe size={22} />,
    title: 'Progress Tracking',
    desc: 'Watch your exploration progress grow across countries, states, and districts.',
  },
];

export default function LandingPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg-primary)',
        fontFamily: 'var(--font-family-sans)',
        overflowX: 'hidden',
      }}
    >
      {/* Nav */}
      <nav
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          padding: '16px 48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(10,10,10,0.8)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Globe size={18} color="#0A0A0A" />
          </div>
          <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--color-text-primary)', letterSpacing: '-0.02em' }}>
            ExploreHub
          </span>
        </div>
        <Link
          to="/auth"
          id="landing-signin-btn"
          style={{
            padding: '9px 20px',
            background: 'var(--color-accent)',
            color: '#0A0A0A',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            fontSize: '14px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'background 150ms',
          }}
        >
          Get Started <ArrowRight size={14} />
        </Link>
      </nav>

      {/* Hero */}
      <section
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '120px 24px 80px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Glowing background orbs */}
        <div
          style={{
            position: 'absolute',
            top: '20%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 600,
            height: 600,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '10%',
            left: '20%',
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        <div style={{ position: 'relative', maxWidth: 720, animation: 'fadeIn 600ms ease' }}>
          {/* Pill badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              background: 'var(--color-accent-muted)',
              border: '1px solid rgba(16,185,129,0.3)',
              borderRadius: 'var(--radius-full)',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--color-accent)',
              marginBottom: '28px',
              letterSpacing: '0.04em',
            }}
          >
            🗺️ YOUR PERSONAL EXPLORATION ATLAS
          </div>

          <h1
            style={{
              fontSize: 'clamp(36px, 6vw, 72px)',
              fontWeight: 800,
              letterSpacing: '-0.04em',
              lineHeight: 1.1,
              marginBottom: '24px',
              color: 'var(--color-text-primary)',
            }}
          >
            Track Every Place
            <br />
            <span
              style={{
                background: 'linear-gradient(135deg, #10B981, #34D399)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              You've Explored
            </span>
          </h1>

          <p
            style={{
              fontSize: '18px',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.7,
              marginBottom: '40px',
              maxWidth: 540,
              margin: '0 auto 40px',
            }}
          >
            Discover places, mark your visits, build your wishlist, and preserve memories from every
            adventure across the world.
          </p>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              to="/auth"
              id="hero-get-started-btn"
              style={{
                padding: '14px 32px',
                background: 'var(--color-accent)',
                color: '#0A0A0A',
                borderRadius: 'var(--radius-lg)',
                fontWeight: 700,
                fontSize: '16px',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 200ms',
                boxShadow: '0 0 40px rgba(16,185,129,0.3)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-accent-hover)';
                e.currentTarget.style.boxShadow = '0 0 60px rgba(16,185,129,0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--color-accent)';
                e.currentTarget.style.boxShadow = '0 0 40px rgba(16,185,129,0.3)';
              }}
            >
              Start Exploring Free <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        {/* Stats row */}
        <div
          style={{
            marginTop: '80px',
            display: 'flex',
            gap: '48px',
            flexWrap: 'wrap',
            justifyContent: 'center',
            animation: 'fadeIn 800ms ease 200ms both',
          }}
        >
          {[
            { value: 'Infinite', label: 'Places to Discover' },
            { value: 'Your Own', label: 'Exploration Atlas' },
            { value: 'Private', label: 'Data & Memories' },
          ].map((stat) => (
            <div key={stat.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-accent)', letterSpacing: '-0.02em' }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features Grid */}
      <section style={{ padding: '80px 48px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '56px' }}>
          <h2 style={{ fontSize: '36px', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text-primary)' }}>
            Everything you need to{' '}
            <span style={{ color: 'var(--color-accent)' }}>explore more</span>
          </h2>
          <p style={{ fontSize: '16px', color: 'var(--color-text-muted)', marginTop: '12px' }}>
            A complete toolkit for the passionate traveler and local explorer.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '20px',
          }}
        >
          {features.map((f) => (
            <div
              key={f.title}
              style={{
                padding: '28px',
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-xl)',
                transition: 'border-color 200ms, transform 200ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(16,185,129,0.4)';
                e.currentTarget.style.transform = 'translateY(-3px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--color-accent-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-accent)',
                  marginBottom: '16px',
                }}
              >
                {f.icon}
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '8px' }}>
                {f.title}
              </h3>
              <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section
        style={{
          padding: '80px 48px',
          textAlign: 'center',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <h2 style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text-primary)', marginBottom: '16px' }}>
          Ready to map your world?
        </h2>
        <p style={{ fontSize: '16px', color: 'var(--color-text-muted)', marginBottom: '32px' }}>
          Join and start building your personal exploration atlas today.
        </p>
        <Link
          to="/auth"
          id="cta-get-started-btn"
          style={{
            padding: '14px 40px',
            background: 'var(--color-accent)',
            color: '#0A0A0A',
            borderRadius: 'var(--radius-lg)',
            fontWeight: 700,
            fontSize: '16px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'background 150ms',
          }}
        >
          Create Free Account <ArrowRight size={16} />
        </Link>
      </section>

      {/* Footer */}
      <footer
        style={{
          padding: '24px 48px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        }}
      >
        <Globe size={14} color="var(--color-accent)" />
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          ExploreHub — Your Personal Exploration Atlas
        </span>
      </footer>
    </div>
  );
}
