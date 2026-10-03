# Open Dungeon Master trailer

The current version is **[output/v4/open-dungeon-master-trailer-v4.mp4](output/v4/open-dungeon-master-trailer-v4.mp4)**: 51.5 seconds of dark-theme gameplay with readable feature captions and longer sequences. Combat appears once, in the opening; the trailer then moves through character creation, maps, the workshop, and campaign creation. The title closes over campaign creation footage. Shot durations and action timing retain the slower pacing from v3, with sound effects and no music.

Rebuild with `python trailer/edit-v2.py --v4`, then verify with `python trailer/review.py --v4`. `timeline-v4.json` specifies source segments, fixed crops, captions, and sound cue timing. [SOURCES-v2.md](SOURCES-v2.md) documents the shared recordings and sound assets. Open **[index.html](index.html)** for the current preview and chapter shortcuts.

The previous 59-second cut is retained at `output/v3/open-dungeon-master-trailer-v3.mp4`; rebuild it with `python trailer/edit-v2.py --v3`.

The previous fast cut is retained at `output/v2/open-dungeon-master-trailer-v2.mp4`; rebuild it with `python trailer/edit-v2.py`.

## Earlier first cut

The finished first cut is **[output/open-dungeon-master-trailer.mp4](output/open-dungeon-master-trailer.mp4)**: 64 seconds, 1920 × 1080, 30 fps, H.264 video and stereo AAC audio. Open **[index.html](index.html)** for the player and chapter shortcuts. A poster and review contact sheet are in `output/`.

The footage was recorded from the real application, using an isolated, encrypted copy of the local demo database. It shows an actual spell action and its resulting rolls, action-card targeting, the character builder, saved characters, procedural map generation, a river painted in the terrain editor, the region map, workshop hub, custom monster editor, and campaign settings. Long model waits and setup steps are removed from the edit. Crop movements, captions, two title cards, and the d20 sequences are editorial additions.

All music and transition effects are synthesized by `score.py`; no downloaded samples or commercial tracks are used. The d20 sequences are rendered with Three.js from `motion.html`. Fonts come from the application's existing assets. Application code and the original campaign database were not changed.

## Edit and render

`timeline.json` controls shot order, durations, source in-points, crops, and captions. Negative in-points count backward from the end of a recording. The retained recordings live in `captures/`; generated media and exports are gitignored because of their size.

From the repository root:

```bash
python -m pip install -r trailer/requirements.txt
python trailer/score.py
python trailer/edit.py
python trailer/review.py
```

FFmpeg needs `libopenh264`, AAC, and VP8 decoding. This machine's FFmpeg supports these; its build does not include `libx264`. `FFMPEG` may select a different executable. Python rendering requires Pillow, numpy, scipy, fonttools, and brotli.

To rebuild the animated opening and closing sequences, serve the repository locally and run the motion renderer in another terminal:

```bash
python trailer/serve.py
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node trailer/render-motion.mjs
```

The renderer expects port 3017. The same server serves the preview player with byte ranges for video seeking. Playwright can be installed in a separate tools directory; it is not added to the app's dependencies. `edit.py` converts the bundled WOFF2 fonts to TTF on first use.

## Record another shot

Run the game against a **separate demo database**. Set `TRAILER_URL` to that instance, and `TRAILER_SESSION_FILE` to a local JSON file containing its authenticated session token. Keep this file outside the repository. The recorder does not modify or copy databases or mint sessions.

```bash
TRAILER_URL=http://127.0.0.1:3015 \
TRAILER_SESSION_FILE=/private/path/demo-session.json \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
node trailer/capture.mjs /workshop/WORKSHOP_ID workshop-new actions.json
```

The optional action file is a JSON array, for example:

```json
[
  {"action":"wait","ms":1500},
  {"action":"click","role":"button","name":"New map"},
  {"action":"fill","selector":"input[placeholder='Name it: the flooded crypt']","value":"The Emberwild Crossing"},
  {"action":"wait","ms":2000}
]
```

Supported actions are `click`, `fill`, `type`, `hover`, `key`, `move`, `down`, `up`, and `wait`. The recorder saves source video, a final frame, and action timing markers. Recordings have different in-points after a new shoot; update the timeline using these markers.
