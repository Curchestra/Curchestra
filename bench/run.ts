// Benchmark: curchestra vs the original Swarm Rebuild script on three fixtures.
// Run `npm run build` first (curchestra is measured from the production IIFE in dist/).
// Example_Base/swarm-rebuild/swarm.js is injected at runtime only; it is git-ignored and never copied.
import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type CDPSession, type Page } from '@playwright/test';
import { createServer } from 'vite';

const PORT = 5180;
const RUN_MS = 8000;
const FIXTURES = ['landing', 'long', 'big'] as const;
const SWARM_PATH = path.resolve('Example_Base/swarm-rebuild/swarm.js');
const CURCHESTRA_PATH = path.resolve('dist/curchestra.js');

// Spec section 8 budgets.
const BUDGET = { scriptMsPerFrame: 2, firstMoveMs: 50, longTaskMs: 50 };
// R28: first move is gated on the typical fixtures only; big (20,000 elements) is a stress fixture, reported but not gated.
const FIRST_MOVE_GATED = new Set<string>(['landing', 'long']);

type Engine = 'curchestra' | 'swarm-rebuild';
interface Result {
  fixture: string;
  engine: Engine;
  skipped?: string;
  firstMoveMs: number | null;
  scriptMsPerFrame: number;
  frames: number;
  longTasks: number;
  worstLongTaskMs: number;
  peakHeapMB: number;
}

async function metric(cdp: CDPSession, name: string): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return metrics.find((m) => m.name === name)?.value ?? 0;
}

async function measure(page: Page, cdp: CDPSession, engine: Engine, fixture: string): Promise<Result> {
  await page.goto(`http://localhost:${PORT}/fixtures/${fixture}.html`, { waitUntil: 'load' });
  if (engine === 'curchestra') await page.addScriptTag({ path: CURCHESTRA_PATH });

  // Page-side probes, installed before the engine starts.
  await page.evaluate(() => {
    const w = window as any;
    w.__b = { frames: 0, longTasks: [] as { start: number; dur: number }[], swarmStart: null as number | null };
    const tick = () => {
      w.__b.frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__b.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ entryTypes: ['longtask'] });
    setInterval(() => {
      if (w.__b.swarmStart === null && w.__swarmRebuild?.app?.engine?.started) w.__b.swarmStart = performance.now();
    }, 2);
  });

  await cdp.send('Performance.enable');
  const script0 = await metric(cdp, 'ScriptDuration');
  const frames0 = await page.evaluate(() => (window as any).__b.frames as number);
  let peak = 0;
  const poll = setInterval(() => {
    metric(cdp, 'JSHeapUsedSize')
      .then((v) => (peak = Math.max(peak, v)))
      .catch(() => {});
  }, 100);

  const t0 = await page.evaluate(() => performance.now());
  if (engine === 'curchestra') {
    await page.evaluate(() => (window as any).Curchestra.curchestra({ seed: 1 }).page());
  } else {
    await page.addScriptTag({ path: SWARM_PATH });
  }
  await page.waitForTimeout(RUN_MS);
  clearInterval(poll);

  const script1 = await metric(cdp, 'ScriptDuration');
  const out = await page.evaluate(() => {
    const w = window as any;
    return {
      frames: w.__b.frames as number,
      longTasks: w.__b.longTasks as { start: number; dur: number }[],
      swarmStart: w.__b.swarmStart as number | null,
      mark: performance.getEntriesByName('cu:first-move')[0]?.startTime ?? null,
    };
  });
  const frames = Math.max(1, out.frames - frames0);
  const first = engine === 'curchestra' ? out.mark : out.swarmStart;
  const mine = out.longTasks.filter((t) => t.start >= t0 && t.dur > BUDGET.longTaskMs);
  return {
    fixture,
    engine,
    firstMoveMs: first === null ? null : first - t0,
    scriptMsPerFrame: ((script1 - script0) * 1000) / frames,
    frames,
    longTasks: mine.length,
    worstLongTaskMs: mine.reduce((m, t) => Math.max(m, t.dur), 0),
    peakHeapMB: peak / 1048576,
  };
}

const f1 = (n: number | null) => (n === null ? 'n/a' : n.toFixed(1));

async function main(): Promise<void> {
  if (!existsSync(CURCHESTRA_PATH)) throw new Error('dist/curchestra.js is missing: run `npm run build` first');
  const haveSwarm = existsSync(SWARM_PATH);
  const server = await createServer({
    configFile: path.resolve('examples/vite.config.ts'),
    server: { port: PORT, strictPort: true },
    logLevel: 'error',
  });
  await server.listen();
  const browser = await chromium.launch();
  const results: Result[] = [];
  try {
    for (const fixture of FIXTURES) {
      for (const engine of ['curchestra', 'swarm-rebuild'] as const) {
        if (engine === 'swarm-rebuild' && !haveSwarm) {
          results.push({
            fixture,
            engine,
            skipped: 'Example_Base/swarm-rebuild/swarm.js not found',
            firstMoveMs: null,
            scriptMsPerFrame: 0,
            frames: 0,
            longTasks: 0,
            worstLongTaskMs: 0,
            peakHeapMB: 0,
          });
          continue;
        }
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        const cdp = await ctx.newCDPSession(page);
        console.log(`bench: ${engine} on ${fixture} (${RUN_MS / 1000} s)`);
        const r = await measure(page, cdp, engine, fixture);
        results.push(r);
        console.log(
          `  first move ${f1(r.firstMoveMs)} ms, script ${r.scriptMsPerFrame.toFixed(3)} ms/frame over ${r.frames} frames, long tasks ${r.longTasks}, heap ${r.peakHeapMB.toFixed(1)} MB`,
        );
        await ctx.close();
      }
    }
    const cpus = os.cpus();
    const failures: string[] = [];
    for (const r of results.filter((x) => x.engine === 'curchestra')) {
      if (r.scriptMsPerFrame > BUDGET.scriptMsPerFrame)
        failures.push(`${r.fixture}: script ${r.scriptMsPerFrame.toFixed(3)} ms/frame > ${BUDGET.scriptMsPerFrame}`);
      if (FIRST_MOVE_GATED.has(r.fixture) && (r.firstMoveMs === null || r.firstMoveMs > BUDGET.firstMoveMs))
        failures.push(`${r.fixture}: first move ${f1(r.firstMoveMs)} ms > ${BUDGET.firstMoveMs}`);
      if (r.longTasks > 0)
        failures.push(`${r.fixture}: ${r.longTasks} long task(s) > ${BUDGET.longTaskMs} ms (worst ${r.worstLongTaskMs.toFixed(0)} ms)`);
    }
    const row = (r: Result) =>
      r.skipped
        ? `| ${r.fixture} | ${r.engine} | skipped: ${r.skipped} | | | | |`
        : `| ${r.fixture} | ${r.engine} | ${f1(r.firstMoveMs)}${FIRST_MOVE_GATED.has(r.fixture) ? '' : ' (not gated)'} | ${r.scriptMsPerFrame.toFixed(3)} | ${r.longTasks}${r.longTasks ? ` (worst ${r.worstLongTaskMs.toFixed(0)} ms)` : ''} | ${r.peakHeapMB.toFixed(1)} | ${r.frames} |`;
    const md = [
      '# Benchmark results',
      '',
      `Generated by \`npm run bench\` on ${new Date().toISOString().slice(0, 10)}.`,
      '',
      `- Machine: ${cpus[0]?.model.trim() ?? 'unknown CPU'} (${cpus.length} logical cores), ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM, ${os.type()} ${os.release()}`,
      `- Browser: Chromium ${browser.version()} (headless, 1280x800, via Playwright)`,
      `- Each cell is one ${RUN_MS / 1000} s run on a fresh page. Curchestra runs the production IIFE (\`dist/curchestra.js\`) with \`curchestra({ seed: 1 }).page()\`; Swarm Rebuild is the original script, injected unmodified.`,
      '- First move: curchestra from the call to its first cursor movement (`cu:first-move` mark); Swarm Rebuild from script injection until `engine.started` (polled every 2 ms). Script ms/frame: CDP `ScriptDuration` delta divided by rAF frames. Long tasks: > 50 ms, started after the engine was invoked. Heap: peak `JSHeapUsedSize`, sampled every 100 ms.',
      '',
      '| Fixture | Engine | First move (ms) | Script ms/frame | Long tasks > 50 ms | Peak heap (MB) | Frames |',
      '|---|---|---|---|---|---|---|',
      ...results.map(row),
      '',
      `Budgets (spec section 8, curchestra only): script <= ${BUDGET.scriptMsPerFrame} ms/frame on all fixtures, 0 long tasks on all fixtures, first move <= ${BUDGET.firstMoveMs} ms on landing and long. First move on big is not gated (stress fixture, 20,000 elements; R28). ${failures.length ? 'FAILED:' : 'All met.'}`,
      ...failures.map((f) => `- ${f}`),
      '',
    ].join('\n');
    writeFileSync('bench/results.md', md);
    console.log('wrote bench/results.md');
    if (failures.length) {
      console.error('Budget failures:\n' + failures.join('\n'));
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
