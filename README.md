# Letterboard Letter Generator

Type a phrase (letters, emoji, uploaded images) and download 3D-printable letterboard letters with pegs on the back, aligned to your board's groove spacing.

## Use it

Open `index.html` in Chrome, Edge, Firefox or Safari. You don't need to install anything. The bundled Google Fonts need an internet connection; system fonts and your own uploaded fonts work offline.

1. Type your phrase. `{1}`, `{2}`… insert uploaded images (a star is preloaded as `{1}` for the demo).
2. Pick a font and set the letter height, thickness and peg settings.
3. Check the **board preview**: grooves are drawn every 8 mm and red marks show where each peg lands.
4. Download one of:
   - **3MF**: one plate, each letter a separate object (best for Bambu Studio / PrusaSlicer / Orca).
   - **STL**: one plate, everything in one file.
   - **ZIP**: one STL per letter.

## How it works

- Each character is rendered at 20 px/mm, traced into polygons and extruded to the chosen thickness.
- Pegs are placed on rows spaced at the groove pitch (default 8 mm), starting at a fixed height above the text **baseline**. Because every letter uses the same grid, baselines line up on the board.
- On each row it looks for a spot where the letter is solid enough to hold the peg plus a margin. It then picks up to *Max pegs* spots, spaced far apart for stability.
- If a glyph has no solid spot on any row (tiny punctuation, thin fonts), it is nudged up or down to the nearest row that works and the app shows a warning. If even that fails, the letter is made without pegs and also warned about.
- Peg styles: **flat tab** (default 2 mm along the groove × 1 mm thick, slides into the slot) or **round pin** (default Ø1.5 mm).
- Pieces are laid out **face-down** (front on the bed, pegs pointing up), so they print without supports. They therefore look mirrored in the 3D view.

## Printing tips

- Use bold fonts: strokes need to be wider than the peg plus 2 × the margin.
- Print a single letter first to test the fit, then adjust the tab thickness or pin diameter (±0.1 mm) for your board and printer.
- A smooth or textured PEI sheet gives the letter fronts a nice finish.

## Files

```
index.html         page markup
css/style.css      styles
js/app.js          all app logic (rasterise, trace, peg placement, mesh, STL/3MF/ZIP export, 3D viewer)
js/earcut.min.js   polygon triangulation (earcut 2.2.4, ISC license, Mapbox)
```

Keep the folder together: `index.html` loads the CSS and JS by relative path. Plain (non-module) scripts are used, so opening the file directly from disk (`file://`) works without a web server.
