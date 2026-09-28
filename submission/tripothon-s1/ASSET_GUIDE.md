# Tripothon S1 submission files

This folder contains a 16:9 cover image, a seven-image visual set, and a continuous narrated walkthrough. The visual set is captured from the English-default game build. The walkthrough shows the opening course, a scripted fall and megalodon encounter, checkpoint respawn, and a complete finish.

## Upload checklist

- `cover.jpg` — 2560 × 1440, 16:9, JPG, under 10 MB.
- `visual-01` through `visual-07` — 2560 × 1440 PNGs. Upload 3–8 images; the set shows the opening descent, first gap, open-ocean track, shark approach, fall outcome, checkpoint restart, and finish.
- `walkthrough.mp4` — continuous 1080p/30 fps MP4 with English narration, about 2 minutes, and under 500 MB.

The official event page identifies a complete playable demo, a walkthrough recording (not a trailer), and a visual asset board as required deliverables. The entrant upload form shown in the supplied screenshots gives the cover and file limits. A public development log is optional.

## Recreate the walkthrough

1. Run `npm ci` in the project root.
2. Start the game with `npm run dev -- --port 5177 --strictPort`.
3. Run `powershell -ExecutionPolicy Bypass -File submission/tripothon-s1/narration.ps1`.
4. Run `node submission/tripothon-s1/record-walkthrough.mjs`.
5. Run `node submission/tripothon-s1/create-cover.mjs` to rebuild the cover from the first gameplay still.

The script needs Chrome and FFmpeg. Temporary video frames and narration audio are written to `work/`; they are not submission uploads.
