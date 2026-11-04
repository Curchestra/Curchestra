/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */

import type { Config, DeepPartial } from '../types';

export const DEFAULTS: Config = {
  preset: 'default',
  agents: { min: 6, max: 30, showNames: false },
  speed: 1,
  trigger: 'load',
  persist: true,
  idle: { behavior: 'orbit', after: 1.5, radius: 120, noPointer: 'last-touch' },
  effects: { guides: true, duplicate: true, pen: true, sizeBadge: true, typing: true, rulers: true, snap: true, grow: true },
  sound: false,
  intro: false,
  theme: 'auto',
  reducedMotion: 'respect',
  skipOnClick: false,
  skip: [],
  maxTasks: 1500,
  failsafe: 15000,
  zIndex: 2147483000,
};

export const PRESETS: Record<'calm' | 'default' | 'frenzy', DeepPartial<Config>> = {
  calm: { agents: { min: 4, max: 12 }, speed: 0.8, effects: { duplicate: false, pen: false } },
  default: {},
  frenzy: { agents: { min: 12, max: 48 }, speed: 1.6 },
};
