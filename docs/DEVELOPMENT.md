# Development

## Setup

```sh
npm install
npx playwright install
```

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Serves the demo (`examples/index.html`) with Vite. |
| `npm run build` | Builds `dist/`: ESM, sound chunk, script-tag build, types and `preload.css`. |
| `npm run typecheck` | Type-checks the project. |
| `npm test` | Unit tests (Vitest). |
| `npm run test:e2e` | Browser tests (Playwright: Chromium, Firefox, WebKit). |
| `npm run test:perf` | Timing tests, run one at a time. |
| `npm run size` | Checks bundle size against the budget (21.5 kB core). |
| `npm run bench` | Benchmarks against Swarm Rebuild and rewrites `bench/results.md`. Run `npm run build` first. |
| `npm run sri` | Prints the integrity string for `dist/curchestra.js`. |

## Layout

| Folder | Holds |
|---|---|
| `src/config` | Defaults, presets, merging and validation |
| `src/scanner` | Reads the DOM into pieces |
| `src/planner` | Turns pieces into tasks with dependencies |
| `src/scheduler` | Picks the next task and sizes the crew |
| `src/engine` | The frame loop, cursors and failsafes |
| `src/actions` | Each routine (drag, type, pen, guide, duplicate) |
| `src/motion` | Arcs, easing and springs |
| `src/reveal` | Hides and shows real elements |
| `src/stage` | The cursor canvas |
| `src/idle` | Idle behaviors and the liquid motion chunk |
| `src/audio` | The sound chunk |
| `src/modes` | `page()`, `section()`, `transition()` |

## Build output

`npm run build` leaves the license header as the only comment, at the top of every file in `dist/`.

## License

Every source file starts with:

```js
/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */
```

Curchestra is [MIT](../LICENSE) licensed.
