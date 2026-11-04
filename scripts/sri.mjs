// Prints the Subresource Integrity string for the script-tag build: `npm run sri`.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'dist/curchestra.js';
console.log(`integrity="sha384-${createHash('sha384').update(readFileSync(file)).digest('base64')}"`);
