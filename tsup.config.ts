import { defineConfig } from 'tsup';

// dist/ is emptied by the `prebuild` script; tsup builds run in parallel so neither clears it.
export default defineConfig([
  {
    entry: { index: 'src/index.ts', 'audio/index': 'src/audio/index.ts' },
    format: ['esm'],
    dts: true,
    splitting: true,
    target: 'es2020',
  },
  {
    // Script-tag build: reads data-curchestra and exposes window.Curchestra.
    entry: { curchestra: 'src/auto.ts' },
    format: ['iife'],
    globalName: 'Curchestra',
    minify: true,
    target: 'es2020',
    platform: 'browser',
    outExtension: () => ({ js: '.js' }),
    define: { 'process.env.NODE_ENV': '"production"' },
  },
]);
