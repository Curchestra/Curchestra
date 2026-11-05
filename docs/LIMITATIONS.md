# Limitations

- **Late elements.** Elements added to an area while it is building don't get their own animation. They appear with their nearest hidden parent, or with the area at its end.
- **Bundler for ESM.** The ESM build (`dist/index.js`) expects a bundler, which removes its development checks. Without one, use the [script tag](SCRIPT_TAG.md) build (`dist/curchestra.js`).
- **Instance-only keys.** `seed`, `theme`, `zIndex`, `agents.showNames`, `skipOnClick` and `sound` only work in `curchestra(config)`. See [Configuration](CONFIGURATION.md#instance-only-keys).
- **One shared crew.** One crew serves every area, so crew bounds are the largest `agents.min` / `agents.max` among the areas that are building.
- **Where cursors enter.** `section()` cursors enter and leave through the section's edges. `page()` and `transition()` cursors use the viewport edges.
- **maxTasks.** A build animates at most `maxTasks` pieces (1500 by default). The rest appear with their parents.
- **Media is faded in whole.** `img`, `svg`, `video`, `canvas`, `iframe`, `picture`, `embed` and `object` get a placeholder drag, then appear as one piece. Nothing inside them is built.
- **Shadow DOM.** An element with a shadow root (most web components) is treated like media: it appears as one piece, and its inner content is not built.
- **Hidden content is skipped.** Elements with `display: none`, `visibility: hidden`, `opacity: 0`, or smaller than 2 px when the area starts are not animated. Content shown later (menus, tabs, accordions) just appears.
- **Layout is measured once.** Positions are read when an area starts. If the layout shifts during the build (late web fonts, images without a width and height), the cursors work where things used to be. Give images a size and load fonts early.
- **Plain swap without View Transitions.** `transition()` uses the View Transitions API where the browser has it, and otherwise swaps the content without a cross-fade.
- **Server-side rendering.** Safe to import and call, but there is nothing to animate without a DOM.
