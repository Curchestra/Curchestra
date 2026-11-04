// Tiny build helpers (no dependencies): `clean` empties dist/, `css` copies preload.css into it.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

const step = process.argv[2];
if (step === 'clean') {
  rmSync('dist', { recursive: true, force: true });
} else if (step === 'css') {
  mkdirSync('dist', { recursive: true });
  copyFileSync('src/preload.css', 'dist/preload.css');
} else {
  console.error('usage: node scripts/dist.mjs clean|css');
  process.exit(1);
}
