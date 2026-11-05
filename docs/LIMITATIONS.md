# Limitations

- **Late elements.** Elements added to an area while it is building don't get their own animation. They appear with their nearest hidden parent, or with the area at its end.
- **Bundler for ESM.** The ESM build (`dist/index.js`) expects a bundler, which removes its development checks. Without one, use the [script tag](SCRIPT_TAG.md) build (`dist/curchestra.js`).
- **Instance-only keys.** `seed`, `theme`, `zIndex`, `agents.showNames`, `skipOnClick` and `sound` only work in `curchestra(config)`. See [Configuration](CONFIGURATION.md#instance-only-keys).
- **One shared crew.** One crew serves every area, so crew bounds are the largest `agents.min` / `agents.max` among the areas that are building.
- **Where cursors enter.** `section()` cursors enter and leave through the section's edges. `page()` and `transition()` cursors use the viewport edges.
- **maxTasks.** A build animates at most `maxTasks` pieces (1500 by default). The rest appear with their parents.
- **Server-side rendering.** Safe to import and call, but there is nothing to animate without a DOM.
