# Script tag

Use Curchestra on any site without a bundler.

```html
<script
  src="https://cdn.jsdelivr.net/npm/curchestra@0.1.1/dist/curchestra.js"
  integrity="sha384-REPLACE_WITH_OUTPUT_OF_npm_run_sri"
  crossorigin="anonymous"
  data-curchestra="page"
  data-preset="calm"></script>
```

- `data-curchestra="page"` builds the page; `"section"` builds every `[data-cu-section]`.
- The script also exposes `window.Curchestra.curchestra` for calling the API yourself.

## Pin the version

Pin an exact version and keep `integrity` and `crossorigin` (Subresource Integrity). For each release, run:

```sh
npm run sri
```

It prints the `integrity="sha384-..."` value for `dist/curchestra.js`.

## Data attributes

| Attribute | On | Effect |
|---|---|---|
| `data-curchestra="page\|section"` | the script tag | Mode to start. |
| `data-preset` | the script tag or an area | Preset for the script or that area. |
| `data-cu-section` | any element | Marks an area that is built on its own. |
| `data-cu-trigger` | a section | `load`, `in-view`, `manual` or `scroll`. |
| `data-cu-skip` | any element | Never hidden or animated. |
| `data-cu-speed` | a section | Speed multiplier for that area. |
| `data-cu-idle` | a section | Idle behavior for that area. |

```html
<nav data-cu-skip>...</nav>
<section data-cu-section data-cu-trigger="in-view" data-cu-speed="1.5">...</section>
```

Attributes win over everything else. See [merge order](CONFIGURATION.md#merge-order).

## Preload

Add the stylesheet in `<head>` to avoid a flash of the finished page:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/curchestra@0.1.1/dist/preload.css">
```

It hides `[data-cu-section]` (and, with `class="cu-intro"` on `<body>`, all of the body's children) until Curchestra adds `cu-ready` to `<html>`. If the script never loads, a CSS animation shows the content after `--cu-failsafe` (15 s by default).

Its `animation` rule overrides your own `animation` on those elements until the page is ready.
