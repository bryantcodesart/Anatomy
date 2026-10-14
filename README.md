# Anatomy Flashcards

A 3D anatomy study aid for personal trainers and physical-therapy students.
The camera flies to a single muscle or bone, ghosts the anatomy around it, and
asks you to name it. Reveal shows the name, **etymology**, and for muscles the
**origin, insertion, actions and innervation**. You grade yourself
(Again / Hard / Good / Easy) and the **FSRS-5** spaced-repetition scheduler
decides when you see it again.

- **348 cards**: 123 bones + 225 individual muscles (rectus femoris, not "quads"),
  graded into 5 difficulty levels. New cards come from the easiest level first;
  each level unlocks once 70% of the one below has graduated.
- Left/right copies are picked at random each time.
- **Lookup mode** (top-bar switch): browse every muscle and bone by region, or
  search by name, alternate name, region or etymology word (`/` focuses search).
  Picking one flies the camera there and shows its full card, with a Left/Right toggle
  and "Part of" / "Made of" links (e.g. Anterior deltoid ↔ Deltoid). You can also
  **tap any structure on the body** to identify it.
- Free orbit (drag), zoom (pinch / wheel), pan (two fingers / right-drag), re-center (R).
- Keyboard: `Space` reveal, `1–4` grade.
- Progress lives in `localStorage`. The dashboard shows review history, a due-date
  forecast, per-level progress and settings. From there you can include/exclude or
  force-unlock levels, reset a single level, or (danger zone) reset everything.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # rebuilds public/db.json from data/, typechecks, bundles to dist/
```

Pushing to `main`/`master` deploys to GitHub Pages via `.github/workflows/deploy.yml`
(enable **Settings → Pages → Source: GitHub Actions** once).

## Architecture (data-oriented)

All state lives in one **arena** (`src/arena.ts`), allocated once at boot. It holds
typed-array stores indexed by part or card id (struct-of-arrays), the review log
ring buffer, the camera rig, the input accumulators, a command queue and every
three.js object. **Systems** (`src/systems/*`) are plain functions that run every
tick in a fixed order inside one `requestAnimationFrame` loop (`src/loop.ts`):

```
1 input    pointer deltas -> camera goals; taps recorded
2 pick     lookup mode: tap -> BVH ray cast -> selection request
3 commands UI command queue -> grading / settings / mode / resets
4 session  study: next card (FSRS), side, camera view; lookup: apply selection
5 resize   canvas + visible-area projection offset
6 camera   damp toward goals
7 focus    target / ghosted / opaque goal per part (vicinity + camera ray tests)
8 fade     animate per-part state -> GPU state texture
9 render   draw only if something changed
10 persist throttled localStorage save
11 ui sync push a snapshot to Solid when ui.version changed
```

DOM listeners only record raw input into the arena; the Solid UI only pushes
commands. There are no callbacks driving app logic.

**Rendering.** The whole body is one merged `BufferGeometry` (uint16-quantized
positions, int8 normals, ~380k triangles, 2.7 MB gzipped) drawn by two meshes:
an opaque pass and a translucent "x-ray" pass. A per-vertex `partId` attribute
indexes a 1-row `DataTexture` holding each part's highlight and opacity, so
re-focusing the scene means writing bytes into a typed array.

## Data

- `data/cards/*.json`: the card database, hand-authored per region. Schema is in
  `data/CARD_SCHEMA.md`.
- `data/model-parts.json`: mesh names, sides and bounds produced by the model build.
- `scripts/build-db.mjs` merges and validates both into `public/db.json`. It fails
  if a card names a mesh that doesn't exist, and applies `SOURCE_FIXES`: corrections
  for meshes the Z-Anatomy source mislabels (its upper and lower trapezius are swapped).
- `data/views.json`: each card's camera direction, picked by `npm run views`. It
  ray-casts the real triangles from many angles and keeps the one that shows the most
  of the structure unobstructed.

### Auditing the meshes

Open the app with `?audit` and call `__audit.show(cardIndex)` in the console. It
isolates that card's meshes and snaps the camera to them. Every muscle card was
rendered this way and checked by eye: each highlight is exactly the muscle (or set
of muscles) it names. Multi-mesh cards combine only the anatomical heads or parts
of one muscle (pec major = clavicular + sternocostal + abdominal part).

### Rebuilding the 3D model (only needed to change it)

1. Download Z-Anatomy's Blender template (`Z-Anatomy.zip` from
   https://github.com/Z-Anatomy/The-blend) and unzip it.
2. `pip install bpy` (Python 3.11), then
   `python scripts/blender-export.py Z-Anatomy/Startup.blend <rawDir> 0`.
   This exports every bone and muscle mesh (excluding fascia, bursae, sheaths and
   ligaments), with `.l` / `.r` sides.
3. `node scripts/build-model.mjs <rawDir> 380000` simplifies with meshoptimizer to
   the triangle budget, quantizes, and writes `public/model/body.bin.gz` +
   `data/model-parts.json`.

## Credits & licenses

- 3D models: **Z-Anatomy** (CC BY-SA 4.0), https://www.z-anatomy.com. Derived from
  **BodyParts3D**, © The Database Center for Life Science (CC BY-SA 2.1 JP / CC BY 4.0).
  The files in `public/model/` are a simplified adaptation and are distributed
  under **CC BY-SA 4.0**.
- Scheduling: FSRS-5 algorithm and default weights from the
  [open-spaced-repetition](https://github.com/open-spaced-repetition) project.
- Card text was written for this project. It's a study aid, so check it against your course texts.
