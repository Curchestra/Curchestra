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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PieceKind = 'box' | 'text' | 'media' | 'line';

export interface Piece {
  id: number;
  el: Element;
  kind: PieceKind;
  /** document coords at scan */
  rect: Rect;
  /** nearest ancestor piece */
  parent: number | null;
  /** tag+class signature */
  sig: string;
  textLen: number;
  rtl: boolean;
}

export type TaskType = 'box' | 'text' | 'media' | 'line' | 'dup' | 'guide';

export interface Task {
  id: number;
  type: TaskType;
  piece: number | null;
  y: number;
  x: number;
  deps: number[];
  dependents: number[];
  pending: number;
  state: 'wait' | 'ready' | 'active' | 'done';
  /** dup: original task id */
  original?: number;
}

export interface TaskGraph {
  tasks: Task[];
  pieceTask: Map<number, number>;
}

export interface Scheduler {
  add(ids: number[]): void;
  /** removes the chosen task from the queue and sets its state to 'active' */
  pick(cursorDocY: number, viewTop: number, viewBot: number): number | null;
  size(): number;
  /** queued tasks in bands overlapping [viewTop - margin, viewBot + margin] */
  inRange(viewTop: number, viewBot: number, margin: number): number;
}

export type Pt = { x: number; y: number };

export interface IdleCtx {
  pointer: Pt | null;
  lastTouch: Pt | null;
  /** where the cursor went idle */
  home: Pt;
  /** viewport coords */
  areaRect: Rect;
  viewport: { w: number; h: number };
  time: number;
  /** per-cursor 0..1 */
  seedPhase: number;
}

export interface Host {
  win: Window;
  doc: Document;
  now(): number;
  raf(cb: (t: number) => void): number;
  caf(id: number): void;
  scroll(): Pt;
  viewport(): { w: number; h: number };
  dpr(): number;
  reducedMotion(): boolean;
  hidden(): boolean;
}

export type RevealOp =
  | { op: 'hide'; el: Element }
  | { op: 'show'; el: Element }
  | { op: 'fade'; el: Element; ms: number }
  | { op: 'clip'; el: Element; lines: Rect[]; progress: number; rtl: boolean }
  | { op: 'unclip'; el: Element };
