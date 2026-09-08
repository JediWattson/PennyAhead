import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PennyAhead — Your accounts, a step ahead',
  icons: { icon: '/favicon.svg' },
  description:
    'Explore synthetic checking and savings accounts with the PennyAhead mock assistant. No real money movement.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
