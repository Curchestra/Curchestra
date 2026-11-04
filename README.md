# Curchestra

An orchestra of animated cursors that builds a website's real DOM, piece by piece. Zero dependencies, one small TypeScript library, and the page underneath stays real: clickable, selectable and readable by search engines.

Use it on a whole page, on a single section, or as a transition between views.

## Install

```sh
npm install curchestra
```

The ESM build (`dist/index.js`) expects a bundler (Vite, webpack, esbuild, ...), which folds away its development-only validation. Without a bundler, use the script tag below.

## Quick start

```ts
import { curchestra } from 'curchestra';

const orchestra = curchestra({ preset: 'calm' }); // one instance per page

// 1. Page: builds each top-level section of the body (or every [data-cu-section])
//    as it approaches the viewport.
orchestra.page();

// 2. Section: builds one element when it scrolls into view. Its cursors enter and
//    leave through the section's own edges.
orchestra.section('#pricing', { idle: { behavior: 'leave' } });

// 3. Transition: runs your update, then builds the new content.
await orchestra.transition(() => router.navigate('/next'), { root: '#app' });
```

`page()` and `section()` return a `Run` with `done: Promise<void>`, `finish()` and `cancel()`.

Other methods: `pause()`, `resume()`, `finish()` (reveal everything now), `destroy()` (finish, then remove the canvas, stylesheet and listeners), and `on(event, fn)` which returns an unsubscribe function.

## Script tag

```html
<script
  src="https://cdn.jsdelivr.net/npm/curchestra@0.1.0/dist/curchestra.js"
  integrity="sha384-REPLACE_WITH_OUTPUT_OF_npm_run_sri"
  crossorigin="anonymous"
  data-curchestra="page"
  data-preset="calm"></script>

<section data-cu-section data-cu-trigger="in-view">...</section>
<nav data-cu-skip>...</nav>
```

Pin an exact version and keep the `integrity` and `crossorigin` attributes (Subresource Integrity). `npm run sri` prints the `integrity="sha384-..."` string for `dist/curchestra.js`; run it for each release and paste the result in.

`data-curchestra` is `page` or `section` (every `[data-cu-section]`). The script also exposes `window.Curchestra.curchestra`.

## Configuration

Every key is optional and fully typed.

| Key | Default | Meaning |
|---|---|---|
| `preset` | `'default'` | `'calm'` (4-12 cursors, speed 0.8, no duplicate or pen), `'default'` (6-30, speed 1, all effects), `'frenzy'` (12-48, speed 1.6, all effects). |
| `agents.min` / `agents.max` | `6` / `30` | Crew size bounds. The crew grows with backlog and scroll speed. |
| `agents.names` | built-in | Names shown next to cursors. |
| `agents.colors` | built-in | Cursor colors. |
| `agents.showNames` | `false` | Show a name label next to each cursor. |
| `speed` | `1` | Speed multiplier. |
| `trigger` | page `'load'`, section `'in-view'` | When an area starts: `'load'`, `'in-view'`, `'manual'` or `'scroll'` (the page is blank until the visitor's first scroll, wheel, touch or key; nobody scrolling, it starts after `failsafe`). In `page()`, `'load'` starts the sections near the viewport at once and each other section as it approaches (within one viewport); nothing off-screen is hidden or scanned up front. A page is built as the visitor watches: a section is hidden as it approaches but only starts (and starts its `failsafe` clock) once it enters the view, and cursors only work on what has been on screen, top to bottom. `page().done` resolves once every section has been reached and built. For `section()`, `'load'` starts immediately. |
| `persist` | `true` | Keep idle cursors on the page (per `idle.behavior`) when no work is in range; `false` makes them leave instead. |
| `idle.behavior` | `'orbit'` | What cursors do with no work: `orbit`, `flock`, `wander`, `leave`, `hide`. |
| `idle.after` | `1.5` | Seconds without a ready task before a cursor goes idle. |
| `idle.radius` | `120` | Size of the liquid orbit's ring around the visitor's pointer, in px (`flock` uses half). |
| `idle.noPointer` | `'last-touch'` | Idle behavior without a pointer: `wander`, `last-touch`, `stay`. |
| `effects.guides` / `duplicate` / `pen` / `sizeBadge` / `typing` | all `true` | Toggle each visual effect. |
| `effects.rulers` / `snap` / `grow` | all `true` | Design-tool rulers while cursors are working on screen (they slide out when the build is done or the visitor scrolls back to finished content, and return with the work; placed guides hide and return the same way); text dragged onto its guide until it snaps; headings typed small and grown to size. |
| `intro` | `false` | `true` or a selector (your logo): cursors flow in a liquid ring around it before the build starts (1.4 s, or until the first scroll with `trigger: 'scroll'`). Pushing the pointer into the ring starts the build too. |
| `sound` | `false` | `true`, `false` or `{ volume }` (0..1). The glass-piano sound chunk loads on demand and starts on the visitor's first click or key (browsers block sound before that). |
| `theme` | `'auto'` | Cursor theme: `'auto'`, `'light'`, `'dark'`. |
| `reducedMotion` | `'respect'` | `'respect'` shows content at once when the visitor prefers reduced motion; `'ignore'` animates anyway. |
| `skipOnClick` | `false` | `true`: a click or tap inside an unbuilt area finishes it instantly. Keyboard focus (Tab) always reveals unbuilt content before it lands, since hidden content cannot take focus. |
| `skip` | `[]` | Selectors that are never hidden or animated. |
| `seed` | random | Fixed seed for a repeatable performance. |
| `maxTasks` | `1500` | Cap on animated pieces per build. |
| `failsafe` | `15000` | Milliseconds after an area starts after which that area is revealed no matter what. Each area has its own timer, so a section reached late still gets its build. |
| `zIndex` | `2147483000` | Stacking order of the cursor canvas. |

Merge order, later wins: built-in defaults, preset, `curchestra(config)`, per-call options, `data-cu-*` attributes on the target element. In development builds, unknown keys and invalid values print one `console.warn` naming the key and the value used instead.

### Idle and noPointer

While a build is going, a cursor with nothing to do strolls between spots in the visible part of its area and pauses there; the stroll is anchored to the page, so it scrolls away with the content and picks a new spot. Spare cursors leave after 2.5 s once the crew is above its target. When everything is built, cursors go idle after `idle.after` seconds and follow `idle.behavior`. New work (a section scrolling into range) brings idle cursors back.

- `orbit`: a liquid orbit. Cursors flow around the visitor's pointer like a school of fish: the ring breathes, wobbles into soft petals and slowly reverses its swirl; neighbours match each other's speed; the pointer is a small bubble they bounce off, and a quick flick scatters them.
- `flock`: the same liquid motion as a tighter cluster.
- `wander`: they drift within their area.
- `leave`: they exit through the nearest viewport edge and are removed.
- `hide`: they fade out in place.

With no pointer (touch devices, or the pointer has left the window), `idle.noPointer` decides: `wander` drifts around the last area, `last-touch` flows around the last tap (before any tap, around a point drifting slowly across the viewport), `stay` stops where they are.

### The Swarm look in one line

```ts
curchestra({ sound: true }).page({ trigger: 'scroll', intro: '#logo' });
```

A ring of cursors circles your logo on a blank page; the first scroll sends them off to build it, with rulers, guides, selection handles, typing and a glass-piano soundtrack.

### What the cursors do

| Piece | Routine |
|---|---|
| Boxes | Crosshair drag from the top-left: selection with handles, a size badge and dashed lines to the rulers; then the real element fades in with a piano note. |
| Images | The same drag over a gray placeholder; the image fades in with a two-note chord. |
| Borders | The pen (with a +) clicks the first corner, then each corner, leaving white vertex dots on a blue path. |
| Text | A click (short text) or a dragged-out text box, then the I-beam types it like a person: bursts, small hesitations, mechanical key clicks. Text on its own background or border (a code panel, a button) has the whole panel dragged out, and the panel grows with the typing, line by line. Headings start small and grow to size; text on a guide is dragged onto it and snaps with a red flash. |
| Guides | The rulers slide in; the cursor grabs the left ruler with the ↔ cursor and drags a red guide out, its position shown on the ruler. |
| Repeats | Select the first card, switch to the duplicate cursor, alt-drag the real copy into place (red boxes and the spacing between them); a copied label with different words is double-clicked and retyped. |

### Sound

A glass piano in E: every finished box, image, duplicate or guide plays one note of the E major pentatonic on a soft 16th-note grid at 104 BPM, so a busy page comes out as a generative melody. Big sections sound low, small pieces high, pitch rises left to right and each note is panned to its cursor. Typing and clicks are quiet mechanical ticks underneath; the intro is an airy swell, the build starts with an arpeggio and ends with a strummed chord. All synthesized, no audio files.

### How cursors move

The crew keeps up with the visitor. Every trip, click and keystroke runs at a shared tempo: 2.1× at rest, rising to 3.2× while the visitor scrolls fast or work piles up per cursor. Scrolling also calls in help: one extra cursor per 50 px/s of scroll and per three pieces waiting on screen (up to `agents.max`), flying in from the left and right edges and sliding back out sideways when they are no longer needed. Scroll speed reacts at once and fades over about a second.

Every cursor has its own personality from the seed: about a quarter are quick and snappy, the rest calm. They fly to each job on a curved arc with a fast start and a soft landing, lean into their motion, squash on every click and keystroke, and turn to face the flow when idle. The cursor shows what it is doing: the arrow while moving or idle, a text cursor while typing, the pen while drawing borders, a crosshair while dragging out boxes and images, and a duplicate arrow while copying cards.

Idle motion (the liquid orbit and the stroll between jobs) ships as its own small chunk, like sound, loaded in the background when an area starts or the intro plays.

## Data attributes

| Attribute | On | Effect |
|---|---|---|
| `data-curchestra="page\|section"` | the script tag | Mode started by the script-tag build. |
| `data-preset` | the script tag or any area | Preset for the script-tag build or for that area. |
| `data-cu-section` | any element | Marks an independently built area. |
| `data-cu-trigger` | a section | `load`, `in-view`, `manual` or `scroll`. |
| `data-cu-skip` | any element | Never hidden or animated. |
| `data-cu-speed` | a section | Speed multiplier for that area. |
| `data-cu-idle` | a section | Idle behavior for that area. |

## Events

```ts
const off = orchestra.on('complete', () => console.log('everything started so far is built'));
```

| Event | Fires |
|---|---|
| `complete` | each time every started area is built and none is still building. With `page()`, later sections start as the visitor scrolls to them, so `complete` can fire more than once (once per batch). `page().done` resolves only after every section has been reached and built. |
| `section:done` | when one area finishes (payload: its root element) |
| `idle` | when cursors have run out of work |
| `task` | for each finished piece (payload: `{ type, el }`) |

## preload.css

To avoid a flash of the finished page before the script loads, include the stylesheet early:

```html
<link rel="stylesheet" href="node_modules/curchestra/dist/preload.css">
```

or `import 'curchestra/preload.css'` in a bundler. It hides `[data-cu-section]` (and, with `class="cu-intro"` on `<body>`, the body's children) until curchestra adds `cu-ready` to `<html>`. If the script never loads, a CSS animation reveals the content after `--cu-failsafe` (15 s by default).

Note: the rule's `animation` shorthand overrides any author `animation` on those elements until the page is ready.

## Accessibility

- Reduced motion: with the default `reducedMotion: 'respect'`, content is shown immediately and no cursors run.
- Click or focus to skip: a click, tap or focus inside an unbuilt area finishes that area instantly.
- Keyboard: pressing Tab or Shift+Tab while any area is unbuilt finishes the build instantly, before focus moves, so the next focus target is visible and focusable.
- The cursor canvas is `aria-hidden`; the real content stays in the HTML.
- Hiding only lasts for the duration of a build. When an area finishes (and no enclosing area is still building), its `data-cu` attributes are removed, so your own CSS applies again; the injected stylesheet is removed once no area is building. A failsafe reveals everything on any error.

## Limitations

- Elements added to an area while it is still building are not given their own cursor animation. They appear together with their nearest hidden ancestor (or with the area, at its end).
- The ESM build expects a bundler. Script-tag users should use the IIFE (`dist/curchestra.js`).
- `seed`, `theme`, `zIndex`, `agents.showNames`, `skipOnClick` and `sound` are instance-level: set them in `curchestra(config)`. Per call or per attribute they are ignored (with a development warning).
- Cursors of a `section()` build are confined to it: they spawn just outside the section's nearest edge and leave through it, fading in and out there. `page()` and `transition()` cursors enter and leave at the viewport edges.
- Crew bounds (`agents.min` / `agents.max`) are the maximum across all active areas' resolved configs, since one shared crew serves every area.
- Server-side rendering is safe (importing has no side effects, every call is a no-op without a DOM), but there is nothing to animate there.

## Why Curchestra

Performance rows come from [`bench/results.md`](bench/results.md): one 8 s run per cell in headless Chromium 156 on an i7-10750H, 64 GB, Windows 11, with Swarm Rebuild's original script as the baseline.

| | Swarm Rebuild | Curchestra |
|---|---|---|
| Where it runs | Your own browser (extension) | Any website (npm or script tag) |
| Scope | Whole page only | Whole page, one section, or a transition |
| Start-up | Copies the page; scrolls through all of it first. Time to first cursor move: 1,596 ms (landing), 1,779 ms (long), 2,825 ms (big) | Measures only what's near the screen, as it's reached. Time to first move: 13 ms (landing), 18 ms (long), 45 ms (big, not gated) |
| Per frame | Script time per frame: 0.64 ms (landing), 0.41 ms (long), 0.77 ms (big) | 0.36 ms (landing), 0.35 ms (long), 0.51 ms (big) |
| Memory | Peak heap 6.0 / 5.9 / 28.9 MB | Peak heap 3.8 / 3.2 / 4.9 MB |
| Long tasks (> 50 ms) | 1 / 1 / 2 (worst 511 ms on big) | 0 / 0 / 0 |
| Page during animation | Covered by a copy | The real page: clickable and readable by search engines |
| Configuration | None (hard-coded) | Presets, typed options, HTML attributes |
| Idle | Flocks to the mouse when finished | orbit / flock / wander / leave / hide, plus 3 no-pointer options |
| Failure handling | Can leave the page half-built | Failsafe always reveals everything |
| Accessibility | None | Respects reduced motion; click/focus/Tab skips |
| Size | Single file of about 3,800 lines (line count of the original `swarm.js`) | 19.62 KB gzipped core as measured by size-limit (budget 20 KB); liquid orbit and sound load as separate chunks (23.14 KB with both) |

Numbers vary run to run and with the machine (three consecutive runs gave 8-20 ms first move on landing and long, 41-46 ms on big, and no long task on any fixture). The "big" fixture is a stress page of 20,000 elements (1,500 is only the default `maxTasks` cap); it is reported but excluded from the 50 ms first-move gate, while the script-time and long-task gates apply to every fixture. `page()` is called from a script tag in the benchmark, so the browser attributes any long task to it. See `bench/results.md` and re-run `npm run bench`.

## Development

| Script | What it does |
|---|---|
| `npm run dev` | Serves the demo (`examples/index.html`) with Vite. |
| `npm run build` | Builds `dist/` (ESM, audio chunk, IIFE, types, `preload.css`). |
| `npm run typecheck` | Type-checks the project. |
| `npm test` | Unit tests (Vitest). |
| `npm run test:e2e` | Browser tests (Playwright; chromium, firefox, webkit). |
| `npm run test:perf` | Wall-clock budget tests, run serially (excluded from the default runs because they flake under parallel load). |
| `npm run size` | Checks the core bundle against the 15 KB gzipped limit, and reports the total with the optional liquid-orbit and sound chunks (size-limit). |
| `npm run bench` | Benchmarks against Swarm Rebuild and rewrites `bench/results.md`. Needs `npm run build` first; skips Swarm Rebuild if its script is absent. |
| `npm run sri` | Prints the Subresource Integrity string for `dist/curchestra.js`. |

## License

MIT

Inspired by Swarm Rebuild and Joel Califa's Swarm.
