# Task: "Graphite Blocks" — Retro hand-drawn paper Tetris (single-page web game)

Write files in the current directory: `index.html`, `style.css`, `game.js` (you may also split into a few more .js files). Pure front-end, NO build step, NO external CDN or network requests of any kind. A local font file already exists: `fonts/ArchitectsDaughter.woff2` (hand-written font) — load it via @font-face from that relative path and use it for ALL UI text (fallback: "Comic Sans MS", "Segoe Print", cursive). Do NOT touch the `ref/` folder.

Original prompt from the design author: "Build me a Retro Tetris game with film grain effects. The grain effect needs to be rolling when playing. Include game sound, optional music, and great graphic effects + movement. Use the referenced image."
The referenced image = a game drawn on aged graph paper with colored-pencil blocks and hand-lettered labels.

## Visual design spec (reproduce faithfully)
- Page background (outside the sheet): very dark warm brown `#1d1911`, with a soft radial vignette (slightly lighter `#2a241a` at center).
- Centered "paper sheet" card: aspect ~ 0.9 (width:height ≈ 490:530 at desktop, scale to fit viewport height, max height ~96vh). Paper color `#d6cfb4` → `#cfc8b0` with subtle blotchy aging (radial gradients of darker `#c4bc9f` at the corners/edges, faint stains), and a faint fine graph-paper grid across the whole sheet (lines `rgba(90,80,60,0.10)` every ~12px). Slight drop shadow `0 20px 60px rgba(0,0,0,.6)`. Edges very slightly darker (inset box-shadow).
- Top-left of sheet: small faded title "GRAPHITE BLOCKS" in hand font, color `#8a8270`, ~15px, letter-spacing 1px.
- Layout inside the sheet (desktop): LEFT = playfield (10 cols x 20 rows, ~40% of sheet width, square cells ~19-30px depending on size). RIGHT column = stacked panels:
  1. "HOLD" label (hand font ~22px, ink `#3f372a`), under it a rectangular box with a sketchy hand-drawn 2px ink border (~ 170x70 px), holds the held piece.
  2. "NEXT" label, box ~170x140 showing the next 3 pieces vertically, first one larger, next two smaller.
  3. A thin pencil rule line, then "SCORE" label, big number (~26px) e.g. `702`, and a tiny "BEST 806" under it (~9px, color `#8a8270`). Another thin rule.
  4. Two columns: "LEVEL" / "01" (zero-padded 2 digits) and "LINES" / "0".
- Below both, full sheet width: a pencil rule line, then a row of hand-drawn checkboxes: `[✓] SOUND   [✓] MUSIC   [✓] GRAIN: FULL` (grain cycles FULL → LIGHT → OFF when clicked). Checkboxes are small sketchy squares with a pencil check mark.
- Bottom controls legend, 2 lines, centered, ~13px: keys in muted red `#a8564a` and descriptions in ink grey `#6b6352`:
  `←→ MOVE   ↓ SOFT DROP   SPACE HARD DROP   ↑/X ROTATE`
  `Z COUNTER   A FLIP(180°)   C HOLD   P PAUSE   R RESTART`
- Playfield: paper-white-ish cell area (`#ddd6c0`, slightly lighter than the sheet) with a pencil grid: every cell has thin grey lines `rgba(70,62,48,0.35)` 1px; outer border is a thick 2.5px dark graphite ink `#423b2b` line that is SLIGHTLY WOBBLY (hand-drawn: draw with canvas path segments with tiny random jitter, generated once with a fixed seed so it doesn't flicker).
- Blocks = colored pencil / crayon squares: each cell is a pastel-but-saturated fill with visible pencil hatching texture (draw many short semi-transparent diagonal strokes over a base fill, pre-render each color to an offscreen canvas tile with fixed seed), darker sketchy outline of the same hue (~1.5px, darker 35%), small inset (1px) so the grid shows between cells. Colors (use these, slightly desaturated pastel like the video, but closer to the colored-pencil reference):
  I cyan `#7fb0ab` (ref image pencil cyan `#719aa2`), O yellow `#dcc87e`, T purple `#a48fb0`, S green `#93b07c`, Z red `#c97a6e`, J blue `#7f98b8`, L orange `#d49a68`.
- Ghost piece: dashed (3px dash) grey-green outline `rgba(110,120,95,.7)` squares, no fill.
- Canvas rendering: use devicePixelRatio for crisp output.
- FILM GRAIN overlay over the whole viewport (pointer-events:none): animated rolling noise. Pre-generate ~6-8 small noise canvases (e.g. 256x256 random grey alpha) and cycle them every ~50ms while also shifting background-position randomly so the grain "rolls"; plus faint horizontal scanline/ flicker band slowly scrolling vertically and a very subtle global brightness flicker (opacity 0.97-1). Grain FULL = opacity ~0.22, LIGHT ~0.10, OFF = hidden. Also vignette darkening at screen corners. Also occasional tiny dust specks/scratches (thin vertical light line appearing randomly for 100ms) like old film.
- Sheet has a gentle idle "breathing" (no), keep static, but add screen shake (few px, 150ms) on hard drop and on tetris (4 lines).

## Animations / effects
- Piece movement smooth: render the active piece with a short (~60ms) interpolation of its visual position toward its logical position (lerp), so moves look fluid.
- Hard drop: a fading vertical pencil-speed trail behind the piece + small shake + dust particles (grey pencil-shaving particles) at landing.
- Line clear: rows flash (paper-white then eraser effect: the row gets "erased" left-to-right with an eraser-smudge over ~280ms), little eraser-crumb particles fly, then rows above drop. Show floating hand-written text popup: "SINGLE", "DOUBLE", "TRIPLE", "TETRIS!", "T-SPIN", "BACK-TO-BACK", "COMBO x2" that floats up and fades, in muted red `#a8564a`.
- Lock: tiny squash/pulse of the locked piece.
- Level up: the LEVEL number does a scribble pulse.
- Score number counts up quickly toward new value.
- Game over: blocks get greyed out row by row from bottom to top (pencil grey), then a paper "note" card (slightly rotated -2deg, with tape strip on top) appears over the playfield: "GAME OVER", final score, best, and a hand-drawn button "PLAY AGAIN (R)". If new best, show "NEW BEST!" circled in red pencil.
- Pause overlay: card "PAUSED — press P".
- Start screen: same note card "GRAPHITE BLOCKS" / "press ENTER or tap to start", with a small blinking pencil cursor.

## Gameplay (must be correct, guideline Tetris)
- 7 tetrominoes, 10x20 visible field (+2 hidden rows above for spawn).
- SRS rotation with full wall kick tables (JLSTZ table and the separate I table), CW (↑ / X), CCW (Z / Ctrl), 180° (A) (simple 180 kicks ok).
- 7-bag randomizer. Next queue shows 3. Hold (C / Shift), once per piece drop.
- Ghost piece. Soft drop (↓, +1 point/cell), hard drop (Space, +2/cell).
- DAS/ARR for left/right: DAS 160ms, ARR 40ms; soft drop repeat ~30ms.
- Lock delay 500ms with move-reset up to 15 resets.
- Gravity per level (guideline: seconds per row = (0.8-(level-1)*0.007)^(level-1)); level up every 10 lines; start level 1.
- Scoring: single 100, double 300, triple 500, tetris 800 (×level); T-spin (3-corner rule) mini/regular bonuses (T-spin single 800, double 1200, triple 1600, T-spin no lines 400); back-to-back ×1.5 for tetris/T-spin; combo +50×combo×level.
- Pause (P / Esc), restart (R), game over when spawn overlaps (block out).
- Best score saved to localStorage key `graphiteBlocksBest`. Settings (sound/music/grain) saved to localStorage too.
- Pause automatically when the tab loses visibility.

## Audio (WebAudio, generated, no files)
- SFX: move tick (soft pencil tap, short filtered noise), rotate (short click/blip), soft drop tick very quiet, hard drop thud (low sine + noise), lock click, line clear (rising chime, brighter for tetris), hold swoosh, level up arpeggio, game over descending tune.
- Optional MUSIC: a gentle lo-fi chiptune/music-box loop of Korobeiniki (Tetris theme A) melody using square/triangle oscillators at low volume with a soft bass line, scheduled with lookahead. Tempo increases slightly with level. Music toggle via the MUSIC checkbox (and key M). SOUND checkbox mutes SFX (key N... optional).
- AudioContext must be created/resumed on first user gesture.

## Mobile / responsive
- Must fit on a phone portrait (e.g. 390x844) without scrolling: on narrow screens (< 700px wide or portrait), layout becomes: compact top bar with HOLD (small), SCORE/LEVEL/LINES and NEXT (small) above/around the playfield; playfield as big as possible; the paper sheet becomes full screen.
- On touch devices show hand-drawn on-screen buttons below the field (sketchy pencil-bordered round/rect buttons on paper): ◀ ▶ ▼(soft) ⤓(hard drop) ⟳(rotate CW) ⟲(rotate CCW) HOLD, PAUSE. Buttons support press-and-hold auto-repeat for left/right/down. Also support swipe gestures on the playfield: tap = rotate, swipe left/right = move, swipe down fast = hard drop. Prevent page scroll/zoom (touch-action:none, viewport meta user-scalable=no).
- Settings checkboxes must be clickable/tappable.
- Also expose `window.__tetris` debug object with: `state()` returning {score, level, lines, over, paused, started, board (2D array), active piece type}, so automated tests can inspect.

## Quality
- No console errors. Use requestAnimationFrame loop. Code clean and commented. Keep total size reasonable (< 150KB).
- After writing, open nothing; just make sure the files are complete and syntactically valid (you may run `node --check game.js`).
