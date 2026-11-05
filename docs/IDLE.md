# Idle behavior

What cursors do when there is no work.

## During a build

A cursor with nothing to do strolls between spots in the visible part of its area and pauses there. The stroll is tied to the page, so it scrolls away with the content and picks a new spot.

Spare cursors leave after 2.5 s once the crew is bigger than it needs to be.

## After a build

When everything is built, cursors go idle after `idle.after` seconds (default 1.5) and follow `idle.behavior`:

| Behavior | Cursors |
|---|---|
| `orbit` (default) | Flow around the visitor's pointer like a school of fish. The ring breathes, wobbles into soft petals and slowly reverses its swirl. The pointer is a small bubble they bounce off, and a quick flick scatters them. |
| `flock` | The same liquid motion as a tighter cluster. |
| `wander` | Drift within their area. |
| `leave` | Exit through the nearest edge and are removed. |
| `hide` | Fade out in place. |

New work, such as a section scrolling into range, brings idle cursors back.

```ts
curchestra({ idle: { behavior: 'flock', radius: 160, after: 3 } });
```

Set `persist: false` to make cursors leave whenever no work is in range.

## Without a pointer

On touch devices, or when the pointer leaves the window, `idle.noPointer` decides:

| Value | Cursors |
|---|---|
| `last-touch` (default) | Flow around the last tap. Before any tap, around a point drifting slowly across the viewport. |
| `wander` | Drift around the last area. |
| `stay` | Stop where they are. |

## Per section

```html
<section data-cu-section data-cu-idle="leave">...</section>
```

## Loading

Idle motion ships as its own small chunk. It loads in the background when an area starts or the intro plays.
