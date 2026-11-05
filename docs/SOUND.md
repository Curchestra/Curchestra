# Sound

An optional glass-piano soundtrack, synthesized in the browser. No audio files.

```ts
curchestra({ sound: true });
curchestra({ sound: { volume: 0.4 } }); // 0 to 1
```

## How it sounds

- Every finished box, image, copy or guide plays one note of the E major pentatonic, on a soft 16th-note grid at 104 BPM. A busy page comes out as a melody.
- Big sections sound low, small pieces high. Pitch rises from left to right, and each note is panned to its cursor.
- Typing and clicks are quiet mechanical ticks underneath.
- The intro is an airy swell, the build starts with an arpeggio, and it ends with a strummed chord.

## When it plays

Browsers block sound until the visitor interacts, so sound starts on the visitor's first click or key.

## Loading

The sound code is a separate chunk. It loads only when `sound` is on, so pages without sound don't pay for it.

`sound` only works on the instance, in `curchestra(config)`. See [instance-only keys](CONFIGURATION.md#instance-only-keys).
