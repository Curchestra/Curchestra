// Build helpers: `clean` empties dist/, `css` copies preload.css and leaves the license as the only comment.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const HEADER = '/*!\n * curchestra\n * Copyright(c) 2026 JoshLei\n * MIT Licensed\n */\n';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function strip(file, code) {
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, false, file.endsWith('.d.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  return ts.createPrinter({ removeComments: true }).printFile(ast);
}

function license(file, minified) {
  let code = readFileSync(file, 'utf8');
  if (!minified) code = strip(file, code);
  code = code.replace(/\/\*![\s\S]*?\*\/\n?/g, '');
  writeFileSync(file, HEADER + code.replace(/^\s+/, ''));
}

const step = process.argv[2];
if (step === 'clean') {
  rmSync('dist', { recursive: true, force: true });
} else if (step === 'css') {
  mkdirSync('dist', { recursive: true });
  copyFileSync('src/preload.css', 'dist/preload.css');
  for (const f of files('dist')) {
    if (f.endsWith('.js') || f.endsWith('.d.ts')) license(f, f.endsWith('curchestra.js'));
  }
} else {
  console.error('usage: node scripts/dist.mjs clean|css');
  process.exit(1);
}
