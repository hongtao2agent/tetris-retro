# Fix pass 2 (small, targeted). Do not read ref/ or images. Do not rewrite files.
1. game.js, desktop NEXT box: queued pieces are drawn far too small (cell ~8px while HOLD draws at ~30px). Desktop NEXT: 1st next piece mini cell ~0.8 x playfield cell, 2nd/3rd ~0.6 x playfield cell, stacked vertically, centered horizontally, evenly spaced to fill the box height (clamp so all three fit). HOLD desktop mini cell ~0.8 x playfield cell (clamped to fit its box). Use rg to find drawNext/drawHold/miniCellFor and edit only those regions.
2. style.css, desktop: large empty gap between the bottom of the playfield and the settings row. Make the playfield taller: ~77% of sheet height (keep 10:20 aspect), right column keeps top alignment; gap above settings row ~2.5% of sheet height.
3. style.css, mobile: the "GRAPHITE BLOCKS" title overlaps the "HOLD" label at top-left. On mobile center the title on its own line at the very top (12px) or hide it; ensure no overlap.
4. Run node --check game.js.
