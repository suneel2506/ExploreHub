import React from 'react';
import { Terminal, ExternalLink, Copy } from 'lucide-react';

export default function SetupPage() {
  const copy = (text) => navigator.clipboard?.writeText(text);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: 'var(--font-family-sans)',
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '28px',
          animation: 'fadeIn 400ms ease',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 'var(--radius-xl)',
              background: 'var(--color-accent-muted)',
              border: '1px solid var(--color-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: 'var(--color-accent)',
            }}
          >
            <Terminal size={26} />
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '8px' }}>
            Supabase Setup Required
          </h1>
          <p style={{ fontSize: '15px', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            ExploreHub needs a Supabase project to store your data. Follow the steps below to get started.
          </p>
        </div>

        {/* Steps */}
        {[
          {
            step: 1,
            title: 'Create a Supabase Project',
            body: (
              <a
                href="https://supabase.com/dashboard/new/new-project"
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-accent)', fontSize: '14px' }}
              >
                Open Supabase Dashboard <ExternalLink size={13} />
              </a>
            ),
          },
          {
            step: 2,
            title: 'Run the schema migration',
            body: (
              <div
                style={{
                  background: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 16px',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  color: 'var(--color-accent)',
                  position: 'relative',
                }}
              >
                <span>Paste </span>
                <code style={{ color: 'var(--color-text-primary)' }}>supabase/migrations/001_schema.sql</code>
                <span> in the SQL Editor in your project dashboard.</span>
              </div>
            ),
          },
          {
            step: 3,
            title: 'Add credentials to .env',
            body: (
              <div style={{ position: 'relative' }}>
                <pre
                  style={{
                    background: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 16px',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    color: 'var(--color-text-secondary)',
                    overflow: 'auto',
                    lineHeight: 1.7,
                  }}
                >
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}
                </pre>
                <button
                  onClick={() => copy('VITE_SUPABASE_URL=https://xxxx.supabase.co\nVITE_SUPABASE_ANON_KEY=your-anon-key')}
                  title="Copy to clipboard"
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    background: 'var(--color-bg-hover)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px 6px',
                    cursor: 'pointer',
                    color: 'var(--color-text-muted)',
                    display: 'flex',
                  }}
                >
                  <Copy size={13} />
                </button>
              </div>
            ),
          },
          {
            step: 4,
            title: 'Restart the dev server',
            body: (
              <div
                style={{
                  background: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 16px',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  color: 'var(--color-accent)',
                }}
              >
                npm run dev
              </div>
            ),
          },
        ].map(({ step, title, body }) => (
          <div
            key={step}
            style={{
              display: 'flex',
              gap: '16px',
              padding: '20px',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-xl)',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 700,
                color: '#0A0A0A',
                flexShrink: 0,
              }}
            >
              {step}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-text-primary)' }}>
                {title}
              </p>
              {body}
            </div>
          </div>
        ))}

        <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--color-text-muted)' }}>
          Find your URL and anon key in your Supabase project → Settings → API
        </p>
      </div>
    </div>
  );
}
