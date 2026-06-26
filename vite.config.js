import { defineConfig } from 'vite';

// Vite configuration.
// `base: './'` keeps asset paths relative so the production build can be
// hosted from any sub-folder (e.g. GitHub Pages) without extra config.
export default defineConfig({
  base: './',
  server: {
    open: true,
    host: true,
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});
