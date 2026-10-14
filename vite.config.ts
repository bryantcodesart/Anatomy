import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// GitHub Pages serves the site from /<repo>/; override with BASE=/ for other hosts.
export default defineConfig({
  base: process.env.BASE ?? './',
  plugins: [solid()],
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
