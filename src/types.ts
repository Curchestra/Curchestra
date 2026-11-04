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
  | { op: 'clip'; el: Element; lines: Rect[]; progress: number; rtl: boolean; elRect?: Rect }
  | { op: 'unclip'; el: Element };

export type CursorShape = 'arrow' | 'cross' | 'ibeam' | 'pen' | 'dup';

export interface Cursor {
  id: number;
  name: string;
  color: string;
  /** viewport coords */
  x: number;
  y: number;
  sx: { x: number; v: number };
  sy: { x: number; v: number };
  shape: CursorShape;
  /** 0..1 */
  press: number;
  task: number | null;
  phase: 'enter' | 'travel' | 'work' | 'idle' | 'leave' | 'hidden';
  idleFor: number;
  seedPhase: number;
  alpha: number;
}

export type Deco =
  | { t: 'outline'; r: Rect; color: string }
  | { t: 'badge'; x: number; y: number; text: string; color: string }
  | { t: 'caret'; x: number; y: number; h: number; color: string }
  | { t: 'guide'; x: number; color: string }
  | { t: 'path'; pts: Pt[]; color: string }
  | { t: 'ghost'; r: Rect; color: string }
  | { t: 'media'; r: Rect };

export interface Stage {
  draw(cursors: Cursor[], decos: Deco[], showNames: boolean): void;
  resize(): void;
  destroy(): void;
  el: HTMLCanvasElement;
}

export interface Run {
  done: Promise<void>;
  /** reveal the area now, resolve `done`, emit 'section:done' */
  finish(): void;
  /** reveal the area now and resolve `done`, without events */
  cancel(): void;
}

export type EngineEvent = 'complete' | 'section:done' | 'idle' | 'task';

export interface EnginePlugin {
  onTask?(type: TaskType, xNorm: number): void;
  onKey?(xNorm: number): void;
  onComplete?(): void;
  destroy?(): void;
}

export interface Engine {
  addArea(root: Element, cfg: Config, mode: Mode): Run;
  areaFor(el: Element): Run | null;
  pause(): void;
  resume(): void;
  finishAll(): void;
  destroy(): void;
  on(e: EngineEvent, fn: (payload?: unknown) => void): () => void;
  use(plugin: EnginePlugin): void;
  stats(): {
    /** last 120 frame script times, ms */
    frameMs: number[];
    /** decos drawn in the last frame */
    decos: Deco[];
    /** snapshot of the live crew (inspection only) */
    cursors: Pick<Cursor, 'id' | 'name' | 'x' | 'y' | 'phase' | 'alpha'>[];
  };
}
