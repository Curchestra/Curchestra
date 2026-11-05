# Configuration

Every key is optional and fully typed.

```ts
curchestra({
  preset: 'calm',
  speed: 1.2,
  agents: { max: 20, showNames: true },
  idle: { behavior: 'flock' },
});
```

## Presets

| Preset | Cursors | Speed | Effects |
|---|---|---|---|
| `'calm'` | 4–12 | 0.8 | No duplicate or pen |
| `'default'` | 6–30 | 1 | All |
| `'frenzy'` | 12–48 | 1.6 | All |

## Options

### Crew

| Key | Default | Meaning |
|---|---|---|
| `preset` | `'default'` | See [Presets](#presets). |
| `agents.min` / `agents.max` | `6` / `30` | Crew size bounds. The crew grows with work waiting and scroll speed. |
| `agents.names` | built-in | Names shown next to cursors. |
| `agents.colors` | built-in | Cursor colors. |
| `agents.showNames` | `false` | Show a name label next to each cursor. |
| `speed` | `1` | Speed multiplier. |
| `seed` | random | Fixed seed for a repeatable performance. |
| `maxTasks` | `1500` | Cap on animated pieces per build. |

### Starting

| Key | Default | Meaning |
|---|---|---|
| `trigger` | page `'load'`, section `'in-view'` | When an area starts. See [Triggers](#triggers). |
| `intro` | `false` | `true` or a selector (your logo). Cursors circle it in a liquid ring before the build starts (1.4 s, or until the first scroll with `trigger: 'scroll'`). Pushing the pointer into the ring starts the build too. |
| `failsafe` | `15000` | Milliseconds after an area starts after which it is revealed no matter what. Each area has its own timer. |

### Idle

| Key | Default | Meaning |
|---|---|---|
| `persist` | `true` | Keep idle cursors on the page. `false` makes them leave. |
| `idle.behavior` | `'orbit'` | `orbit`, `flock`, `wander`, `leave` or `hide`. |
| `idle.after` | `1.5` | Seconds without work before a cursor goes idle. |
| `idle.radius` | `120` | Orbit ring size in px (`flock` uses half). |
| `idle.noPointer` | `'last-touch'` | Without a pointer: `wander`, `last-touch` or `stay`. |

See [Idle behavior](IDLE.md).

### Effects

| Key | Default | Meaning |
|---|---|---|
| `effects.guides` | `true` | Red layout guides dragged out of the rulers. |
| `effects.duplicate` | `true` | Repeated cards are alt-dragged copies. |
| `effects.pen` | `true` | Borders drawn corner by corner with the pen. |
| `effects.sizeBadge` | `true` | Size badge while dragging out boxes. |
| `effects.typing` | `true` | Text is typed instead of faded in. |
| `effects.rulers` | `true` | Rulers while cursors work on screen. |
| `effects.snap` | `true` | Text dragged onto its guide until it snaps. |
| `effects.grow` | `true` | Headings typed small and grown to size. |

See [Animations](ANIMATIONS.md).

### Look and behavior

| Key | Default | Meaning |
|---|---|---|
| `sound` | `false` | `true`, `false` or `{ volume }` (0–1). See [Sound](SOUND.md). |
| `theme` | `'auto'` | Cursor theme: `'auto'`, `'light'` or `'dark'`. |
| `reducedMotion` | `'respect'` | `'respect'` shows content at once for visitors who prefer reduced motion; `'ignore'` animates anyway. |
| `skipOnClick` | `false` | `true`: a click or tap inside an unbuilt area finishes it at once. |
| `skip` | `[]` | Selectors that are never hidden or animated. |
| `zIndex` | `2147483000` | Stacking order of the cursor canvas. |

## Triggers

| Trigger | Starts |
|---|---|
| `'load'` | At once. In `page()`, sections near the viewport start at once and the rest as they approach. |
| `'in-view'` | When the area scrolls into view. |
| `'manual'` | Never on its own, and nothing is hidden. Build it later with `orchestra.section(el, { trigger: 'load' })`. |
| `'scroll'` | On the visitor's first scroll, wheel, touch or key. The page is blank until then. If nobody scrolls, it starts after `failsafe`. |

## Merge order

Later wins:

1. Built-in defaults
2. The preset
3. `curchestra(config)`
4. Options passed to `page()`, `section()` or `transition()`
5. `data-cu-*` attributes on the target element (see [Script tag](SCRIPT_TAG.md#data-attributes))

## Instance-only keys

`seed`, `theme`, `zIndex`, `agents.showNames`, `skipOnClick` and `sound` only work in `curchestra(config)`. Set per call or by attribute, they are ignored.

## Warnings

In development builds, an unknown key or invalid value prints one `console.warn` naming the key and the value used instead. Production builds drop these checks.
