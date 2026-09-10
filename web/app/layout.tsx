import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PennyAhead — A little saved. A future built.',
  icons: { icon: '/favicon.svg' },
  description:
    'Plan progress toward savings and retirement goals while keeping cash ready for spending. An interactive synthetic demo.',
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
