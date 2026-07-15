import type { Metadata, Viewport } from 'next';
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { Nav } from '@/components/nav';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const plexSans = IBM_Plex_Sans({
  variable: '--font-plex-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f2ee' },
    { media: '(prefers-color-scheme: dark)', color: '#14130f' },
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
      className={`${plexSans.variable} ${plexMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className='min-h-full flex flex-col'>
        <ThemeProvider>
          <TooltipProvider delay={200} closeDelay={0}>
            <Nav authEnabled={Boolean(process.env.APP_PASSWORD)} />
            <main className='mx-auto w-full max-w-[1180px] flex-1 px-5 pt-8 pb-18 sm:px-8 xl:max-w-[1400px] 2xl:max-w-[1640px]'>
              {children}
            </main>
            <Toaster richColors position='top-center' />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
