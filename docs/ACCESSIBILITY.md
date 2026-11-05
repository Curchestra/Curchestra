# Accessibility

The real content is always in the HTML. Cursors only change when it becomes visible.

## Reduced motion

With the default `reducedMotion: 'respect'`, visitors who prefer reduced motion see the content at once, and no cursors run.

## Keyboard

Pressing Tab or Shift+Tab while an area is unbuilt finishes the build before focus moves, so the next focus target is visible and focusable. Focusing an element inside an unbuilt area also reveals it.

## Clicks

By default, clicking does not skip the build. Set `skipOnClick: true` to let a click or tap inside an unbuilt area finish it at once.

## Screen readers and crawlers

- The cursor canvas is `aria-hidden`.
- A page only builds what the visitor has seen, but each area's `failsafe` (15 s by default) reveals it anyway, so tools that never scroll still get everything.

## Cleanup

Content is only hidden while it is building. When an area finishes, its `data-cu` attributes are removed so your own CSS applies again. The injected stylesheet is removed once nothing is building.

## Failsafes

- Each area is revealed after `failsafe` milliseconds no matter what.
- Any error inside a frame reveals everything and is logged.
- If the script never loads, `preload.css` shows the content after 15 s. See [Script tag](SCRIPT_TAG.md#preload).
