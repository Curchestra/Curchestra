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
  /** 'scroll': hidden at once, built on the first scroll */
  trigger: 'load' | 'in-view' | 'manual' | 'scroll';
  persist: boolean;
  idle: {
    behavior: 'orbit' | 'flock' | 'wander' | 'leave' | 'hide';
    after: number;
    radius: number;
    noPointer: 'wander' | 'last-touch' | 'stay';
  };
  effects: {
    guides: boolean;
    duplicate: boolean;
    pen: boolean;
    sizeBadge: boolean;
    typing: boolean;
    /** rulers while work is on screen */
    rulers: boolean;
    /** text snaps onto its guide */
    snap: boolean;
    /** headings grow to size */
    grow: boolean;
  };
  /** true = default volume */
  sound: boolean | { volume: number };
  /** element to circle before the build (true = page center) */
  intro: boolean | string;
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
  /** computed font size in px (text pieces) */
  fs?: number;
  /** text with its own background or border */
  boxed?: boolean;
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
  /** Takes the next task off the queue; never one below `limit` (document y). */
  pick(cursorDocY: number, viewTop: number, viewBot: number, limit?: number): number | null;
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
  | { op: 'clip'; el: Element; lines: Rect[]; progress: number; rtl: boolean; elRect?: Rect; box?: boolean }
  | { op: 'unclip'; el: Element }
  /** move/scale the element; 0, 0, 1 clears it */
  | { op: 'xform'; el: Element; dx: number; dy: number; s: number };

export type CursorShape = 'arrow' | 'cross' | 'ibeam' | 'pen' | 'pen-add' | 'dup' | 'ew' | 'ns';

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
  /** degrees; 0 = upright */
  angle: number;
  task: number | null;
  phase: 'enter' | 'travel' | 'work' | 'idle' | 'leave' | 'hidden';
  idleFor: number;
  seedPhase: number;
  alpha: number;
}

/** Overlay drawn on the stage, viewport coords. */
export type Deco =
  /** selection box */
  | { t: 'sel'; r: Rect; red?: boolean; handles?: boolean; badge?: string; rulerLines?: boolean }
  /** spacing between two boxes */
  | { t: 'measure'; a: Pt; b: Pt; label: string }
  /** pen path; `tail` is the live end */
  | { t: 'pen'; pts: Pt[]; tail?: Pt; closed?: boolean }
  /** text selection highlight */
  | { t: 'hilite'; r: Rect }
  | { t: 'caret'; x: number; y: number; h: number; color: string }
  /** guide line; `flash` glows on snap, `drag` marks the ruler */
  | { t: 'guide'; x: number; color: string; flash?: number; drag?: boolean; label?: number }
  /** gray image placeholder */
  | { t: 'media'; r: Rect };

/** Something a cursor just did, for sound. */
export type Fx =
  | { k: 'press' }
  | { k: 'key'; n: number; space: boolean }
  | { k: 'place'; kind: 'box' | 'media' | 'text' | 'line' | 'dup' | 'guide'; r: Rect }
  | { k: 'snap' }
  | { k: 'grow'; step: number };

/** Rulers: `t` slides them in (0..1). */
export interface RulerState {
  t: number;
  sx: number;
  sy: number;
}

export interface Stage {
  /** Draws without reading layout. */
  draw(cursors: Cursor[], decos: Deco[], showNames: boolean, vp: { w: number; h: number }, rulers?: RulerState): void;
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
  /** A cursor did something; `at` is its viewport position. */
  onFx?(fx: Fx, at: Pt, vp: { w: number; h: number }): void;
  /** The intro begins. */
  onIntro?(): void;
  /** The first cursor reaches its first job. */
  onStart?(): void;
  onComplete?(): void;
  /** Called on the first user gesture. */
  unlock?(): void;
  destroy?(): void;
}

export interface Engine {
  addArea(root: Element, cfg: Config, mode: Mode): Run;
  /** Hide `root` now; a later addArea(root) builds it. */
  hold(root: Element): void;
  /** Ring around `target` (null = center) until the first area starts; `poke` runs when the pointer bumps it. */
  intro(target: Element | null, poke?: () => void): void;
  areaFor(el: Element): Run | null;
  pause(): void;
  resume(): void;
  finishAll(): void;
  destroy(): void;
  on(e: EngineEvent, fn: (payload?: unknown) => void): () => void;
  use(plugin: EnginePlugin): void;
  /** @internal the next frame throws (tests) */
  __failNextFrame(): void;
  /** @internal finish tasks whose elements left the DOM */
  __prune(root: Element): void;
  stats(): {
    /** last 120 frame script times, ms */
    frameMs: number[];
    /** decos drawn in the last frame */
    decos: Deco[];
    /** @internal live crew snapshot (tests) */
    cursors: Pick<Cursor, 'id' | 'name' | 'x' | 'y' | 'phase' | 'alpha' | 'shape' | 'angle'>[];
    /** @internal how far the rulers are slid in, 0..1 */
    rulers: number;
  };
}
