import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

export default defineConfig({
  root: here,
  resolve: { alias: { '/src': path.resolve(repo, 'src') } },
  server: { fs: { allow: [repo] } },
});
