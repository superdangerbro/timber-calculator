import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Timber Calculator', template: '%s · Timber Calculator' },
  description: 'Office dashboard for voice-tallied timber cruises: map, filters, area totals and what-if pricing.',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = { themeColor: '#0f2a1d', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
