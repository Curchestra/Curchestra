# Curchestra

A swarm of animated cursors that builds a website's real DOM, piece by piece. Zero dependencies, one small TypeScript library, and the page underneath stays real: clickable, selectable and readable by search engines.

Use it on a whole page, on a single section, or as a transition between views.

## Install

```sh
npm install curchestra
```

The ESM build (`dist/index.js`) expects a bundler (Vite, webpack, esbuild, ...), which folds away its development-only validation. Without a bundler, use the script tag below.

## Quick start

```ts
import { curchestra } from 'curchestra';

const swarm = curchestra({ preset: 'calm' }); // one instance per page

// 1. Page: builds everything in the body (or every [data-cu-section]).
swarm.page();

// 2. Section: builds one element when it scrolls into view.
swarm.section('#pricing', { idle: { behavior: 'leave' } });

// 3. Transition: runs your update, then builds the new content.
await swarm.transition(() => router.navigate('/next'), { root: '#app' });
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
| `agents.showNames` | `true` | Show name labels. |
| `speed` | `1` | Speed multiplier. |
| `trigger` | page `'load'`, section `'in-view'` | When an area starts: `'load'`, `'in-view'` or `'manual'`. |
| `persist` | `true` | Keep idle cursors on the page (per `idle.behavior`) when no work is in range; `false` makes them leave instead. |
| `idle.behavior` | `'orbit'` | What cursors do with no work: `orbit`, `flock`, `wander`, `leave`, `hide`. |
| `idle.after` | `1.5` | Seconds without a ready task before a cursor goes idle. |
| `idle.radius` | `60` | Orbit radius around the visitor's pointer, in px. |
| `idle.noPointer` | `'last-touch'` | Idle behavior without a pointer: `wander`, `last-touch`, `stay`. |
| `effects.guides` / `duplicate` / `pen` / `sizeBadge` / `typing` | all `true` | Toggle each visual effect. |
| `sound` | `false` | `false` or `{ volume }`. Loads the optional audio chunk on demand. |
| `theme` | `'auto'` | Cursor theme: `'auto'`, `'light'`, `'dark'`. |
| `reducedMotion` | `'respect'` | `'respect'` shows content at once when the visitor prefers reduced motion; `'ignore'` animates anyway. |
| `skipOnClick` | `true` | A click, tap or focus inside an unbuilt area finishes it instantly. |
| `skip` | `[]` | Selectors that are never hidden or animated. |
| `seed` | random | Fixed seed for a repeatable swarm. |
| `maxTasks` | `1500` | Cap on animated pieces per build. |
| `failsafe` | `15000` | Milliseconds after which everything is revealed no matter what. |
| `zIndex` | `2147483000` | Stacking order of the cursor canvas. |

Merge order, later wins: built-in defaults, preset, `curchestra(config)`, per-call options, `data-cu-*` attributes on the target element. In development builds, unknown keys and invalid values print one `console.warn` naming the key and the value used instead.

### Idle and noPointer

A cursor goes idle when it has had no ready task for `idle.after` seconds. That covers both "the build is finished" and "waiting for the visitor to scroll". New work (a section scrolling into range) brings idle cursors back.

- `orbit`: each cursor circles the visitor's pointer on its own radius, phase and speed.
- `flock`: cursors cluster loosely near the pointer.
- `wander`: they drift within their area.
- `leave`: they exit through the nearest viewport edge and are removed.
- `hide`: they fade out in place.

With no pointer (touch devices, or the pointer has left the window), `idle.noPointer` decides: `wander` drifts around the last area, `last-touch` orbits the last tap, `stay` stops where they are.

## Data attributes

| Attribute | On | Effect |
|---|---|---|
| `data-curchestra="page\|section"` | the script tag | Mode started by the script-tag build. |
| `data-preset` | the script tag or any area | Preset for the script-tag build or for that area. |
| `data-cu-section` | any element | Marks an independently built area. |
| `data-cu-trigger` | a section | `load`, `in-view` or `manual`. |
| `data-cu-skip` | any element | Never hidden or animated. |
| `data-cu-speed` | a section | Speed multiplier for that area. |
| `data-cu-idle` | a section | Idle behavior for that area. |

## Events

```ts
const off = swarm.on('complete', () => console.log('everything built'));
```

| Event | Fires |
|---|---|
| `complete` | when all areas are built |
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

- Reduced motion: with the default `reducedMotion: 'respect'`, content is shown immediately and no swarm runs.
- Click or focus to skip: a click, tap or focus inside an unbuilt area finishes that area instantly.
- Keyboard: pressing Tab or Shift+Tab while any area is unbuilt finishes the build instantly, before focus moves, so the next focus target is visible and focusable.
- The cursor canvas is `aria-hidden`; the real content stays in the HTML.
- Hiding only lasts for the duration of a build, and a failsafe reveals everything on any error.

## Limitations

- Elements added to an area while it is still building are not given their own cursor animation. They appear together with their nearest hidden ancestor (or with the area, at its end).
- The ESM build expects a bundler. Script-tag users should use the IIFE (`dist/curchestra.js`).
- `seed`, `theme`, `zIndex` and `agents.showNames` are instance-level: set them in `curchestra(config)`. Per call or per attribute they are ignored (with a development warning).
- Crew bounds (`agents.min` / `agents.max`) are the maximum across all active areas' resolved configs, since one shared crew serves every area.
- Server-side rendering is safe (importing has no side effects, every call is a no-op without a DOM), but there is nothing to animate there.

## Why Curchestra

Performance rows come from [`bench/results.md`](bench/results.md): one 8 s run per cell in headless Chromium 156 on an i7-10750H, 64 GB, Windows 11, with Swarm Rebuild's original script as the baseline.

| | Swarm Rebuild | Curchestra |
|---|---|---|
| Where it runs | Your own browser (extension) | Any website (npm or script tag) |
| Scope | Whole page only | Whole page, one section, or a transition |
| Start-up | Copies the page; scrolls through all of it first. Time to first cursor move: 1,661 ms (landing), 1,843 ms (long), 3,180 ms (big) | Measures only what's near the screen, as it's reached. Time to first move: 16 ms (landing), 22 ms (long), 80 ms (big, not gated) |
| Per frame | Script time per frame: 0.89 ms (landing), 0.61 ms (long), 1.18 ms (big) | 0.55 ms (landing), 0.58 ms (long), 0.76 ms (big) |
| Memory | Peak heap 6.0 / 5.8 / 29.3 MB | Peak heap 4.6 / 4.6 / 4.9 MB |
| Long tasks (> 50 ms) | 1 / 1 / 2 (worst 828 ms on big) | 0 / 0 / 0 |
| Page during animation | Covered by a copy | The real page: clickable and readable by search engines |
| Configuration | None (hard-coded) | Presets, typed options, HTML attributes |
| Idle | Flocks to the mouse when finished | orbit / flock / wander / leave / hide, plus 3 no-pointer options |
| Failure handling | Can leave the page half-built | Failsafe always reveals everything |
| Accessibility | None | Respects reduced motion; click/focus/Tab skips |
| Size | Single file of about 3,800 lines (line count of the original `swarm.js`) | 14.2 KB gzipped core as measured by size-limit (budget 15 KB); sound only if enabled |

Numbers vary run to run and with the machine (three consecutive runs gave 11-22 ms first move on landing and long, 73-80 ms on big). The "big" fixture is a stress page of 20,000 elements (1,500 is only the default `maxTasks` cap); it is reported but excluded from the 50 ms first-move gate, while the script-time and long-task gates apply to every fixture. In one of three runs Curchestra had a single 52 ms long task on big, just over the 50 ms budget. See `bench/results.md` and re-run `npm run bench`.

## Development

| Script | What it does |
|---|---|
| `npm run dev` | Serves the demo (`examples/index.html`) with Vite. |
| `npm run build` | Builds `dist/` (ESM, audio chunk, IIFE, types, `preload.css`). |
| `npm run typecheck` | Type-checks the project. |
| `npm test` | Unit tests (Vitest). |
| `npm run test:e2e` | Browser tests (Playwright; chromium, firefox, webkit). |
| `npm run test:perf` | Wall-clock budget tests, run serially (excluded from the default runs because they flake under parallel load). |
| `npm run size` | Checks the core bundle against the 15 KB gzipped limit (size-limit). |
| `npm run bench` | Benchmarks against Swarm Rebuild and rewrites `bench/results.md`. Needs `npm run build` first; skips Swarm Rebuild if its script is absent. |
| `npm run sri` | Prints the Subresource Integrity string for `dist/curchestra.js`. |

## License

MIT

Inspired by Swarm Rebuild and Joel Califa's Swarm.
