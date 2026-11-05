# Modes

Curchestra has three ways to build: a whole page, one section, or a transition between views.

```ts
import { curchestra } from 'curchestra';

const orchestra = curchestra(); // one instance per page
```

## page()

```ts
const run = orchestra.page();
```

Builds each top-level section of `<body>`, or every `[data-cu-section]` if the page has any.

- A section is hidden as it comes within one viewport of the screen.
- It starts building once it enters the view.
- Cursors work top to bottom, only on what the visitor has seen.
- Nothing far off-screen is hidden or scanned up front.

`run.done` resolves once every section has been reached and built.

Cursors enter and leave at the left and right edges of the viewport.

## section()

```ts
const run = orchestra.section('#pricing');
orchestra.section(document.querySelector('.hero'), { speed: 1.5 });
```

Builds one element when it scrolls into view (trigger `'in-view'` by default). Pass a selector or an element.

Its cursors stay inside the section: they enter through its nearest edge and leave through it.

## transition()

```ts
await orchestra.transition(() => router.navigate('/next'), { root: '#app' });
```

Runs your update function, then builds the new content under `root` (default `<body>`). Where the browser supports the View Transitions API, the swap uses it.

If `root` is a selector, it is looked up again after the update, so it can match a new element.

## Run

`page()` and `section()` return a `Run`:

| Member | Does |
|---|---|
| `done` | A promise that resolves when the area is built. |
| `finish()` | Reveals the area now, resolves `done` and fires `section:done`. |
| `cancel()` | Reveals the area now and resolves `done`, without events. |

## Instance methods

| Method | Does |
|---|---|
| `pause()` | Freezes every cursor. |
| `resume()` | Continues after `pause()`. |
| `finish()` | Reveals everything now. |
| `destroy()` | Finishes, then removes the canvas, stylesheet and listeners. |
| `on(event, fn)` | Listens to an event and returns an unsubscribe function. See [Events](EVENTS.md). |

## Options per call

Every mode takes the same options as `curchestra()`, and they apply to that call only:

```ts
orchestra.section('#faq', { preset: 'frenzy', idle: { behavior: 'leave' } });
```

Some keys only work on the instance. See [Configuration](CONFIGURATION.md#instance-only-keys).

## Server-side rendering

Importing has no side effects, and every call does nothing without a DOM, so it is safe to call during SSR.
