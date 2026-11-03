import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict Content-Security-Policy for the built site: only same-origin scripts, data and fonts.
// Added at build time only, because Vite's dev server injects an inline script.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'uplift-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// base './' keeps every asset URL relative, so the build works from any sub-path
// (for example https://<user>.github.io/uplift/).
export default defineConfig({
  base: './',
  plugins: [react(), csp()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  // @ts-expect-error vitest reads this key
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
