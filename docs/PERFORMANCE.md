# Performance

## Size

| Bundle | Gzipped |
|---|---|
| Core (what every page loads) | about 21 kB |
| Core + idle motion + sound chunks | about 25 kB |

Zero dependencies. Idle motion and sound load as separate chunks, only when needed. Check with `npm run size`.

## How it stays fast

- Only content near the screen is measured, as the visitor reaches it.
- Each frame reads layout first, then writes, so the browser never lays out twice in one frame.
- Cursors are drawn on one canvas, with cached sprites and only the changed area redrawn.

## Benchmarks

The numbers below are from [`bench/results.md`](../bench/results.md): one 8 s run per page in headless Chromium on an i7-10750H, with Swarm Rebuild's original script as the baseline.

| | Swarm Rebuild | Curchestra |
|---|---|---|
| Time to first cursor move | 1,596 / 1,779 / 2,825 ms | 13 / 18 / 45 ms |
| Script time per frame | 0.64 / 0.41 / 0.77 ms | 0.36 / 0.35 / 0.51 ms |
| Peak heap | 6.0 / 5.9 / 28.9 MB | 3.8 / 3.2 / 4.9 MB |
| Long tasks (> 50 ms) | 1 / 1 / 2 | 0 / 0 / 0 |

Each cell is landing / long / big page. "Big" is a stress page of 20,000 elements.

Numbers vary from run to run and by machine. To measure yourself:

```sh
npm run build
npm run bench
```

## Compared with Swarm Rebuild

| | Swarm Rebuild | Curchestra |
|---|---|---|
| Runs | In your own browser (extension) | On any website (npm or script tag) |
| Scope | Whole page | Page, section or transition |
| Page during animation | Covered by a copy | The real page |
| Configuration | None | Presets, typed options, HTML attributes |
| Failure handling | Can leave the page half-built | Failsafe always reveals everything |
| Accessibility | None | Reduced motion, keyboard skip |
