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
        // Deliberately a full-bleed opaque square, unlike the rounded `icon.svg` tile:
        // iOS masks the touch icon into its own squircle, so corners we round ourselves
        // fall outside that mask and flatten to white wedges along the edges. Declaring
        // it `maskable` says the same to Android, which otherwise shows a bare square.
        // The N sits inside the middle ~25%, well within the maskable safe zone.
        src: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
