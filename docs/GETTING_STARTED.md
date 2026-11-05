# Getting started

Curchestra fills your page with animated cursors that build the real DOM, piece by piece. The page underneath stays real: clickable, selectable and readable by search engines.

This guide gets a page building in a few minutes. When you're done, see [Next steps](#next-steps).

## 1. Install

```sh
npm install curchestra
```

The ESM build expects a bundler (Vite, webpack, esbuild and so on). No bundler? Skip to [Script tag](SCRIPT_TAG.md).

## 2. Build your page

```ts
import { curchestra } from 'curchestra';

curchestra().page();
```

That's it. Each top-level section of `<body>` is hidden as it approaches the viewport, and cursors build it once it scrolls into view.

Create one instance per page and reuse it:

```ts
const orchestra = curchestra({ preset: 'calm' });
orchestra.page();
```

## 3. Avoid a flash of the finished page

Without this step, the visitor can see the finished page for a moment before the script loads. Load the stylesheet early:

```ts
import 'curchestra/preload.css';
```

or, without a bundler:

```html
<link rel="stylesheet" href="node_modules/curchestra/dist/preload.css">
```

Then mark the parts to hide with `data-cu-section`, or put `class="cu-intro"` on `<body>` to hide all of its children. They stay hidden until Curchestra is ready. If the script never loads, the content appears on its own after 15 s.

## 4. Try the signature look

```ts
curchestra({ sound: true }).page({ trigger: 'scroll', intro: '#logo' });
```

The page starts blank, with a ring of cursors circling your logo. The first scroll sends them off to build, with rulers, guides, typing and a glass-piano soundtrack.

## 5. Run the demo

From a clone of the repository:

```sh
npm install
npm run dev
```

Open the URL Vite prints. The demo has a playground panel to try presets, idle behaviors and sound.

## Next steps

| Read | To learn |
|---|---|
| [Modes](MODES.md) | `page()`, `section()` and `transition()`, and how to control a run |
| [Configuration](CONFIGURATION.md) | Every option, presets and merge order |
| [Script tag](SCRIPT_TAG.md) | Using Curchestra without a bundler, and data attributes |
| [Animations](ANIMATIONS.md) | What each cursor does and how they move |
| [Idle behavior](IDLE.md) | What cursors do when there is no work |
| [Sound](SOUND.md) | The optional glass-piano soundtrack |
| [Events](EVENTS.md) | Reacting when the build finishes |
| [Accessibility](ACCESSIBILITY.md) | Reduced motion, keyboard and failsafes |
| [Limitations](LIMITATIONS.md) | Known limits |
| [Performance](PERFORMANCE.md) | Size and benchmark numbers |
| [Development](DEVELOPMENT.md) | Working on Curchestra itself |
