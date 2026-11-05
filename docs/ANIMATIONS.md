# Animations

Each piece of the page gets its own routine, like a designer building it in a design tool.

## What the cursors do

| Piece | Routine |
|---|---|
| Boxes | A crosshair drags from the top-left: a selection with handles, a size badge and dashed lines to the rulers. Then the real element fades in. |
| Images | The same drag over a gray placeholder, then the image fades in. |
| Borders | The pen clicks the first corner, then each corner, leaving white dots on a blue path. |
| Text | A click (short text) or a dragged-out text box, then the I-beam types it like a person: bursts and small pauses. |
| Panels | Text on its own background or border (a code block, a button) has the whole panel dragged out. The panel grows with the typing, line by line. |
| Headings | Typed small, then grown to size. |
| Guides | The rulers slide in. A cursor grabs the left ruler and drags a red guide out, its position shown on the ruler. Text on a guide is dragged onto it and snaps with a red flash. |
| Repeats | The first card is selected, then alt-dragged into a real copy. A copy with different words is double-clicked and retyped. |

Turn routines on or off with [`effects`](CONFIGURATION.md#effects).

## Rulers and guides

Rulers show while cursors work on screen. They slide out when the build is done or the visitor scrolls back up to finished content, and return with the work. Placed guides hide and return the same way.

## How cursors move

The crew keeps up with the visitor.

- **Tempo.** Every trip, click and keystroke runs at a shared tempo: 2.1× at rest, rising to 3.2× while the visitor scrolls fast or work piles up.
- **Help on scroll.** One extra cursor per 50 px/s of scroll and per three pieces waiting on screen, up to `agents.max`. New cursors fly in from the left and right edges and slide back out sideways when they're not needed.
- **Fast response.** Scroll speed reacts at once and fades over about a second.
- **Order.** Cursors work top to bottom, on what the visitor has seen.

## Personality

Each cursor gets its own personality from the seed: about a quarter are quick and snappy, the rest calm.

- They fly to each job on a curved arc with a fast start and a soft landing.
- They lean into their motion, squash on every click and keystroke, and turn to face the flow when idle.
- The cursor shows what it is doing: an arrow while moving, an I-beam while typing, the pen while drawing borders, a crosshair while dragging boxes, and a duplicate arrow while copying.

Set [`seed`](CONFIGURATION.md#crew) for the same performance every time.

## Intro

With `intro: '#logo'`, cursors flow in a liquid ring around your logo before the build starts. The build begins after 1.4 s, on the first scroll (with `trigger: 'scroll'`), or when the visitor pushes the pointer into the ring.
