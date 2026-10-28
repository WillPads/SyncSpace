# SyncSpace logo

Two sideways capital S's, one inside each ring. The rings overlap like a venn diagram and the S's cross in the overlap: the shared space where a room's Pomodoro clock is kept in sync.

| File | Use |
| --- | --- |
| `syncspace-mark-dark.svg` | Mark on dark backgrounds (default) |
| `syncspace-mark-light.svg` | Mark on light / day-mode backgrounds |
| `syncspace-lockup-dark.svg` / `-light.svg` | Mark + "SyncSpace" wordmark (Space Grotesk 700) |
| `syncspace-favicon.svg` | App icon / favicon (heavier strokes, dark tile) |

## Colors (flat, no gradients)

- Left ring `--brand-primary-hover` #58af49
- Right ring `--brand-primary` #3c683b
- S strokes: #f9fafb on dark, #09160b on light
- Lens (overlap fill): #14301a on dark, #cfe6c9 on light

## Rules

- Never apply a gradient, glow or shadow to the mark.
- Minimum size: 24 px tall (use the favicon file's heavier strokes below 32 px).
- In the mockups the mark is the `#logo-mark` SVG symbol. It reads its colors from `--logo-a`, `--logo-b`, `--logo-s` and `--logo-lens`; day mode overrides the last two.
