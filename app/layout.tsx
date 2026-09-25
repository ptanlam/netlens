import type { Metadata, Viewport } from 'next';
import { Figtree, Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { Nav } from '@/components/nav';
import { PullToRefresh } from '@/components/pull-to-refresh';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SafeAreaDebug } from '@/components/safe-area-debug';
import { NAV_PREF_SCRIPT } from '@/lib/nav-layout';
import { MASK_PREF_SCRIPT } from '@/lib/mask';
import './globals.css';

// The Wise pairing: Inter for everything, figures included (with tabular numerals, see
// `.font-mono` in globals.css), and a heavy display face for the brand moments only, which
// here means page titles, the wordmark and the net-worth figure.
//
// `opsz` matters: the design loads Inter's full variable font, whose optical-size axis
// switches large text (24px figures, the net-worth hero) to the tighter "Display" cut.
// Without the axis every size renders in the text cut and looks loose next to the design.
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'vietnamese'],
  axes: ['opsz'],
});

// The display face. Wise's own Wise Sans is proprietary, and the "Sans" file shipped with
// the design is a plain Helvetica-style bold, too thin for Wise's chunky display voice.
// Figtree at 900 is the nearest free match: heavy, friendly, with a tight fit.
// Figtree has no ₫, so the automatic Arial fallback is switched off. That way the dong
// sign falls through to Inter at 900 (the next face in `--font-display`) and stays as heavy
// as the digits beside it instead of dropping to a light Arial glyph.
const display = Figtree({
  variable: '--font-wise',
  subsets: ['latin', 'latin-ext'],
  weight: '900',
  adjustFontFallback: false,
  fallback: [],
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
    { media: '(prefers-color-scheme: light)', color: '#e8ebe6' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0f0c' },
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
      className={`${inter.variable} ${display.variable} h-full antialiased`}
    >
      <head>
        {/* Stamps the saved sidebar width on <html> before first paint — the rail is pure
            CSS keyed off `data-nav-collapsed`, so without this a collapsed rail would flash
            open on every load. Same trick next-themes uses for the theme class. */}
        <script dangerouslySetInnerHTML={{ __html: NAV_PREF_SCRIPT }} />
        {/* Same trick for "Hide amounts": with the mask on, the figures must never paint. */}
        <script dangerouslySetInnerHTML={{ __html: MASK_PREF_SCRIPT }} />
      </head>
      <body className='min-h-full flex flex-col'>
        <ThemeProvider>
          <TooltipProvider delay={200} closeDelay={0}>
            {process.env.NODE_ENV !== 'production' && <SafeAreaDebug />}
            <Nav />
            {/* Mounted here rather than in the nav: the gesture belongs to the page, and
                this is the one place every route passes through. */}
            <PullToRefresh />
            {/* The design runs the page on the bare field — no artwork behind it. Depth is
                the surface step from field to panel, so anything laid between the two would
                only flatten it. */}
            <main className='relative z-10 mx-auto w-full max-w-[1200px] flex-1 pt-5 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pt-6 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] sm:pl-[max(1.625rem,env(safe-area-inset-left))] sm:pr-[max(1.625rem,env(safe-area-inset-right))] xl:max-w-[1400px] 2xl:max-w-[1640px]'>
              {children}
            </main>
            <Toaster position='top-center' />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
