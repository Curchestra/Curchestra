import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Serial wall-clock budget tests (R24): the default config excludes @perf.
export default defineConfig({
  ...base,
  grepInvert: undefined,
  grep: /@perf/,
  workers: 1,
  fullyParallel: false,
});
