# Curchestra

An orchestra of animated cursors that builds a website's real DOM, piece by piece. Zero dependencies, one small TypeScript library, and the page underneath stays real: clickable, selectable and readable by search engines.

Use it on a whole page, on a single section, or as a transition between views.

## Install

```sh
npm install curchestra
```

## Quick start

```ts
import { curchestra } from 'curchestra';
import 'curchestra/preload.css';

const orchestra = curchestra({ preset: 'calm' });

orchestra.page();                                   // the whole page, as the visitor scrolls
orchestra.section('#pricing');                      // one section, when it scrolls into view
await orchestra.transition(() => router.navigate('/next'), { root: '#app' });
```

The signature look, with a logo intro and sound:

```ts
curchestra({ sound: true }).page({ trigger: 'scroll', intro: '#logo' });
```

No bundler? Use the [script tag](docs/SCRIPT_TAG.md).

## Docs

- **[Getting started](docs/GETTING_STARTED.md)**
- [Modes](docs/MODES.md)
- [Configuration](docs/CONFIGURATION.md)
- [Script tag](docs/SCRIPT_TAG.md)
- [Animations](docs/ANIMATIONS.md)
- [Idle behavior](docs/IDLE.md)
- [Sound](docs/SOUND.md)
- [Events](docs/EVENTS.md)
- [Accessibility](docs/ACCESSIBILITY.md)
- [Limitations](docs/LIMITATIONS.md)
- [Performance](docs/PERFORMANCE.md)
- [Development](docs/DEVELOPMENT.md)

## License

[MIT](LICENSE) © 2026 JoshLei

Inspired by Swarm Rebuild and Joel Califa's Swarm.
