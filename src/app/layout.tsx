import type { Metadata } from 'next';
import './globals.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Toaster as HotToaster } from 'react-hot-toast';
import { ScoringProvider } from '@/hooks/use-scoring-store';

export const metadata: Metadata = {
  title: 'Key Stone AI',
  description: 'A Real-Estate Query & Building-Estimator Platform',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=Source+Code+Pro&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased">
        <HotToaster />
        <ScoringProvider>
          {children}
        </ScoringProvider>
      </body>
    </html>
  );
}
