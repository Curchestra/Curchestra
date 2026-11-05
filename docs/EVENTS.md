# Events

```ts
const off = orchestra.on('complete', () => console.log('built'));
off(); // stop listening
```

| Event | Fires | Payload |
|---|---|---|
| `complete` | Each time every started area is built and none is still building. | none |
| `section:done` | When one area finishes. | its root element |
| `idle` | When cursors run out of work. | none |
| `task` | For each finished piece. | `{ type, el }` |

## complete and page()

With `page()`, later sections start as the visitor scrolls to them, so `complete` can fire more than once, once per batch.

To wait for the whole page, use the run instead:

```ts
await orchestra.page().done;
```

## Waiting on one section

```ts
const run = orchestra.section('#pricing');
await run.done;
```

A listener that throws is logged and does not break the build.
