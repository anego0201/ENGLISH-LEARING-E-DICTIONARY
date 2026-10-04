import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/**
 * Generates PWA icons (64/192/512 + maskable), apple-touch-icon (180) and favicon.ico
 * from a single SVG at build time. Do not hand-maintain PNG icons.
 */
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // iOS renders transparent apple-touch-icons on black — give it the app background.
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#0b1020' } },
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#0b1020' } },
  },
  images: ['public/favicon.svg'],
});
