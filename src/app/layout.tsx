import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Urbania Café',
  description: 'QR café ordering',
  icons: { icon: '/urbania-logo.png', apple: '/urbania-logo.png' },
};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
