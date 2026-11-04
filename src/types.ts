export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export type Mode = 'page' | 'section' | 'transition';

export interface Config {
  preset: 'calm' | 'default' | 'frenzy';
  agents: {
    min: number;
    max: number;
    names?: string[];
    colors?: string[];
    showNames: boolean;
  };
  speed: number;
  trigger: 'load' | 'in-view' | 'manual';
  persist: boolean;
  idle: {
    behavior: 'orbit' | 'flock' | 'wander' | 'leave' | 'hide';
    after: number;
    radius: number;
    noPointer: 'wander' | 'last-touch' | 'stay';
  };
  effects: { guides: boolean; duplicate: boolean; pen: boolean; sizeBadge: boolean; typing: boolean };
  sound: false | { volume: number };
  theme: 'auto' | 'light' | 'dark';
  reducedMotion: 'respect' | 'ignore';
  skipOnClick: boolean;
  skip: string[];
  seed?: number;
  maxTasks: number;
  failsafe: number;
  zIndex: number;
}
