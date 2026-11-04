import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

/** Serves the repo's built dist/ at /dist for the script-tag fixtures. */
const serveDist: Plugin = {
  name: 'serve-dist',
  configureServer(server) {
    server.middlewares.use('/dist', (req, res, next) => {
      const name = path.basename((req.url ?? '').split('?')[0]);
      const file = path.resolve(repo, 'dist', name);
      if (!name || !fs.existsSync(file)) return next();
      res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.setHeader('Cache-Control', 'no-store');
      res.end(fs.readFileSync(file));
    });
  },
};

export default defineConfig({
  plugins: [serveDist],
  root: here,
  resolve: { alias: { '/src': path.resolve(repo, 'src') } },
  server: { fs: { allow: [repo] } },
});
