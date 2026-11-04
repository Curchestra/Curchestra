import type { Config, DeepPartial } from '../types';
import { DEFAULTS } from './defaults';

type Rule =
  | { t: 'num'; min?: number; int?: boolean }
  | { t: 'bool' }
  | { t: 'enum'; values: readonly string[] }
  | { t: 'strs' }
  | { t: 'sound' }
  | { t: 'obj'; shape: Record<string, Rule> };

const SCHEMA: Record<string, Rule> = {
  preset: { t: 'enum', values: ['calm', 'default', 'frenzy'] },
  agents: {
    t: 'obj',
    shape: {
      min: { t: 'num', min: 0 },
      max: { t: 'num', min: 0 },
      names: { t: 'strs' },
      colors: { t: 'strs' },
      showNames: { t: 'bool' },
    },
  },
  speed: { t: 'num', min: 0.0001 },
  trigger: { t: 'enum', values: ['load', 'in-view', 'manual'] },
  persist: { t: 'bool' },
  idle: {
    t: 'obj',
    shape: {
      behavior: { t: 'enum', values: ['orbit', 'flock', 'wander', 'leave', 'hide'] },
      after: { t: 'num', min: 0 },
      radius: { t: 'num', min: 0 },
      noPointer: { t: 'enum', values: ['wander', 'last-touch', 'stay'] },
    },
  },
  effects: {
    t: 'obj',
    shape: {
      guides: { t: 'bool' },
      duplicate: { t: 'bool' },
      pen: { t: 'bool' },
      sizeBadge: { t: 'bool' },
      typing: { t: 'bool' },
    },
  },
  sound: { t: 'sound' },
  theme: { t: 'enum', values: ['auto', 'light', 'dark'] },
  reducedMotion: { t: 'enum', values: ['respect', 'ignore'] },
  skipOnClick: { t: 'bool' },
  skip: { t: 'strs' },
  seed: { t: 'num' },
  maxTasks: { t: 'num', min: 0 },
  failsafe: { t: 'num', min: 0 },
  zIndex: { t: 'num', int: true },
};

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const lookup = (path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (isPlain(o) ? o[k] : undefined), DEFAULTS);

const show = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

function check(rule: Rule, v: unknown): string | null {
  switch (rule.t) {
    case 'num':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a finite number';
      if (rule.min !== undefined && v < rule.min) return `must be >= ${rule.min}`;
      if (rule.int && !Number.isInteger(v)) return 'must be an integer';
      return null;
    case 'bool':
      return typeof v === 'boolean' ? null : 'must be a boolean';
    case 'enum':
      return typeof v === 'string' && rule.values.includes(v) ? null : `must be one of ${rule.values.join('|')}`;
    case 'strs':
      return Array.isArray(v) && v.every((s) => typeof s === 'string') ? null : 'must be an array of strings';
    case 'sound':
      if (v === false) return null;
      return isPlain(v) && typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1
        ? null
        : 'must be false or { volume: 0..1 }';
    default:
      return null;
  }
}

/**
 * Drop unknown keys and invalid values, calling `warn` once per problem.
 * With `isSelector`, `skip` entries it rejects are dropped with a warning.
 */
export function validate(
  input: unknown,
  warn: (msg: string) => void = (m) => console.warn(m),
  isSelector?: (selector: string) => boolean,
): DeepPartial<Config> {
  const walk = (obj: unknown, shape: Record<string, Rule>, prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!isPlain(obj)) return out;
    for (const key of Object.keys(obj)) {
      const path = prefix + key;
      const rule = shape[key];
      const v = obj[key];
      if (!rule) {
        warn(`[curchestra] ${path}: unknown key; ignored`);
        continue;
      }
      if (v === undefined) continue;
      if (rule.t === 'obj') {
        if (!isPlain(v)) {
          warn(`[curchestra] ${path}: must be an object; using defaults`);
          continue;
        }
        out[key] = walk(v, rule.shape, path + '.');
        continue;
      }
      const problem = check(rule, v);
      if (problem) {
        const fb = lookup(path);
        warn(`[curchestra] ${path}: ${problem}; using ${fb === undefined ? 'none' : show(fb)}`);
        continue;
      }
      if (path === 'skip' && isSelector) {
        out[key] = (v as string[]).filter((sel) => {
          const ok = isSelector(sel);
          if (!ok) warn(`[curchestra] skip: ${show(sel)} is not a valid selector; dropped`);
          return ok;
        });
        continue;
      }
      out[key] = v;
    }
    return out;
  };
  if (input !== undefined && !isPlain(input)) {
    warn('[curchestra] config: must be an object; using defaults');
    return {};
  }
  return walk(input, SCHEMA, '') as DeepPartial<Config>;
}
