# Songinator

Songinator is a browser-only song generator and player. Open the standalone `index.html` file
directly in a browser.

It generates a new song on load in a random key, with tempo chosen from the key mode:
minor keys use 80-100 BPM, major keys use 90-130 BPM.

Playback uses smplr from the public CDN:

- `SplendidGrandPiano` left-hand block chords with doubled bass
- `SplendidGrandPiano` higher right-hand arpeggiations
- tension-aware `TR-808` drums

Rebuild the standalone file after changing source files:

```powershell
cd docs
node build-standalone.mjs
```

Source files:

- `index-base.html` for the UI shell
- `styles.css` for the interface
- `app.js` for playback, arrangement, and visuals
- `tonal-song-generator.js` for client-side song generation
- `build-standalone.mjs` for producing `index.html`
