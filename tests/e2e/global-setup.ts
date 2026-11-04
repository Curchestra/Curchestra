import { execSync } from 'node:child_process';

/** The script-tag tests load dist/, so build it fresh once per run. */
export default function globalSetup(): void {
  execSync('npm run build', { stdio: 'inherit' });
}
