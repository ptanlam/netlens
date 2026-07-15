import type { MetadataRoute } from 'next';

// PWA manifest — lets Netlens be installed to the Home Screen on iOS/iPadOS
// (Safari → Share → Add to Home Screen) and Android, launching standalone
// without browser chrome. Icons resolve to the app-dir `icon.svg` /
// `apple-icon.png` routes. Colors mirror the light theme in `globals.css`.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Netlens',
    short_name: 'Netlens',
    description: 'Net-worth tracking and visualization',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f2ee',
    theme_color: '#f4f2ee',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
