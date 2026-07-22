import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { Nav } from '@/components/nav';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SafeAreaDebug } from '@/components/safe-area-debug';
import { NAV_LAYOUT_SCRIPT } from '@/lib/nav-layout';
import './globals.css';

// One face for everything that isn't a number, one for everything that is. Space Grotesk
// carries headings as well, so there's no third family to load.
const grotesk = Space_Grotesk({
  variable: '--font-grotesk',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Netlens',
  description: 'Netlens tracking and visualization',
  // Launch standalone (no Safari chrome) when added to the iOS Home Screen.
  appleWebApp: {
    capable: true,
    title: 'Netlens',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  // Extend under the system UI so we control the safe areas ourselves — required for
  // env(safe-area-inset-*) to report the iPhone notch/home-indicator AND the window
  // controls (traffic lights) that iPadOS 26 overlays on a windowed/split web app.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1efe9' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0c10' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang='en'
      suppressHydrationWarning
      className={`${grotesk.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        {/* Stamps the saved nav layout on <html> before first paint — the rail is pure CSS
            keyed off `data-nav`, so without this it would flash in as a top bar on every
            load. Same trick next-themes uses for the theme class. */}
        <script dangerouslySetInnerHTML={{ __html: NAV_LAYOUT_SCRIPT }} />
      </head>
      <body className='min-h-full flex flex-col'>
        <ThemeProvider>
          <TooltipProvider delay={200} closeDelay={0}>
            {process.env.NODE_ENV !== 'production' && <SafeAreaDebug />}
            <Nav authEnabled={Boolean(process.env.APP_PASSWORD)} />
            <main className='mx-auto w-full max-w-[1180px] flex-1 pt-8 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] sm:pl-[max(2rem,env(safe-area-inset-left))] sm:pr-[max(2rem,env(safe-area-inset-right))] xl:max-w-[1400px] 2xl:max-w-[1640px]'>
              {children}
            </main>
            <Toaster richColors position='top-center' />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
