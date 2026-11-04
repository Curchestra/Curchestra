import type { Config, DeepPartial } from '../types';
import { DEFAULTS, PRESETS } from './defaults';

type Obj = Record<string, unknown>;

const isPlain = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merge `src` into a copy of `base`. Arrays and scalars replace; undefined is skipped. */
function merge(base: Obj, src: Obj): Obj {
  const out: Obj = { ...base };
  for (const key of Object.keys(src)) {
    const v = src[key];
    if (v === undefined) continue;
    const cur = out[key];
    out[key] = isPlain(v) ? merge(isPlain(cur) ? cur : {}, v) : Array.isArray(v) ? [...v] : v;
  }
  return out;
}

/** DEFAULTS -> PRESETS[preset] -> layers in order (later wins). */
export function resolveConfig(...layers: (DeepPartial<Config> | undefined)[]): Config {
  const given = layers.filter((l): l is DeepPartial<Config> => !!l);
  let preset: Config['preset'] = DEFAULTS.preset;
  for (const l of given) if (l.preset) preset = l.preset;

  let out = merge(DEFAULTS as unknown as Obj, (PRESETS[preset] ?? {}) as Obj);
  for (const l of given) out = merge(out, l as Obj);
  out.preset = preset;

  const cfg = out as unknown as Config;
  if (cfg.agents.min > cfg.agents.max) cfg.agents.min = cfg.agents.max;
  return cfg;
}

/** Map `data-preset`, `data-cu-*` attributes on an element to a config layer. */
export function readDataAttrs(el: Element): DeepPartial<Config> {
  const out: DeepPartial<Config> = {};
  const preset = el.getAttribute('data-preset');
  if (preset) out.preset = preset as Config['preset'];
  const trigger = el.getAttribute('data-cu-trigger');
  if (trigger === 'load' || trigger === 'in-view' || trigger === 'manual') out.trigger = trigger;
  const speed = el.getAttribute('data-cu-speed');
  if (speed !== null && speed.trim() !== '' && Number(speed) > 0 && Number.isFinite(Number(speed))) out.speed = Number(speed);
  const idle = el.getAttribute('data-cu-idle');
  if (idle) out.idle = { behavior: idle as Config['idle']['behavior'] };
  return out;
}
