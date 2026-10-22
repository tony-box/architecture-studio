# Image Intake

Read this whenever the user supplies an image: a satellite or aerial view, a
survey or plat, a site plan, a floor plan, a framing, rafter, or truss plan, an
elevation, a photo, or a sketch. An image is evidence, not geometry. Read the
numbers printed on it, estimate its scale from what it shows, and record where
every derived value came from.

The pixel frame, how calibrations combine, the placement math, and evidence
references are defined in `coordinate-contract.md`, Source Images. The
manifest, `sources/sources.json`, is described by `sources.schema.json` and is
written only by `scripts/import-image.mjs`; never edit it by hand. Commands
below abbreviate `node <skill>/scripts/import-image.mjs` to `import-image.mjs`.

## Rules

- **Printed numbers win.** A dimension, bearing, distance, elevation, or pitch
  printed on the image is used exactly as written. The scale is only for
  things that are not dimensioned.
- **Imagery never sets property lines, setbacks, or existing trees.** They come
  from a survey, a plat, or the user. A satellite image may suggest candidates;
  add only the ones the user confirms.
- **Photos are context only.** Never calibrate or measure them.
- **Elevations give heights only.** They are never placed or drawn as an
  underlay.
- **Known objects are not a scale** (cars, doors, parking stalls) unless the
  user accepts one as an assumption.
- **The manifest, not the picture, holds the calibration.** Viewing an image
  shows only its pixels; the user's calibration, north, placement, and
  labelled points live in `sources/sources.json`. Whenever the user points to
  an image ("use the survey"), and at the start of every resumed session, run
  `import-image.mjs list <project> --json` first and work from what it
  reports.
- **Author clean geometry.** Measure the few distances and points you need and
  write straight, square, real-unit geometry from them; never copy a pixel
  outline.
- Every value measured from an image stays `needs-review` until the user
  confirms it.

## Supported files

PNG, JPEG, and WebP. Ask the user to export anything else first:

- PDF: export each page to PNG at full resolution. Keep the whole sheet, so
  the scale bar, north arrow, title block, and notes stay in the same file.
- HEIC (phone photos): export to JPEG.
- TIFF (scans): export to PNG.

Never accept a crop that cuts off the scale bar or the dimensions you need.

## Workflow

1. **Add.**

   ```text
   import-image.mjs add <project> <file> --kind <kind> [--id <id>] [--notes <text>]
   ```

   Kinds: `satellite` (aerial too), `survey` (plats and tree surveys),
   `site-plan`, `floor-plan`, `framing-plan` (rafter and truss plans too),
   `elevation`, `photo`, `sketch`, `other`. `add` copies the file into
   `sources/`, hashes it, reads its oriented pixel size, and registers it in
   `brief.json` `sources[]` (running it twice is harmless). It refuses a file
   or id that already exists. When the user sends a new version of the same
   image, run `add` again with `--replace`; that clears its calibrations,
   north, references, areas, and placement, so redo them and re-derive anything taken
   from it. A calibration recorded in an older `brief.json` arrives as
   `legacyCalibration`, without pixel points: find it on the image and record
   it as a real calibration (step 3).
2. **Read the image.** Look at the whole image. List what it carries: the
   title block and any stated scale, scale bars, the north arrow, dimension
   strings, bearings and distances, notes (basis of bearing, pitch, imagery
   date), and any detail views, enlarged plans, or insets drawn at another
   scale. Write printed values down exactly as written. Note the pixel size of
   the copy you are looking at; it is the `--seen` size for every coordinate
   you read from it.
3. **Estimate the scale.** Do it without asking, with the first method that
   applies. Record a second, independent calibration whenever the image has
   one.

   | Method | Use when | Notes |
   | --- | --- | --- |
   | `printed-dimension` | A dimension string, or a bearing and distance, is printed | Prefer the longest. Put the ends on the extension lines or ticks, not on the text. |
   | `scale-bar` | A graphic scale bar is drawn | Survives resizing. Measure the whole bar. |
   | `stated-scale` | A ratio is printed and the user confirms the scan's DPI and that it was not resized | `mm/px = 25.4 / DPI × ratio`: 1/4" = 1'-0" (1:48) at 300 DPI is 4.064. Never from a screenshot, file metadata, or screen DPI. |
   | `map-metadata` | The user supplies the web map's zoom, latitude, tile size, and device pixel ratio (a map URL often has the first two), and the capture is unresized | `mm/px = 40075016686 × cos(latitude) / (tileSize × 2^zoom × devicePixelRatio)`. Otherwise use the map's scale bar. |

   ```text
   import-image.mjs calibrate <project> <id> --method printed-dimension|scale-bar --from x,y --to x,y --distance <len> --seen WxH [--uncertainty-px n] [--region x0,y0,x1,y1[,label]] --provenance <text>
   import-image.mjs calibrate <project> <id> --method stated-scale|map-metadata --mm-per-px n --provenance <text> [--relative-uncertainty u]
   ```

   - Lengths need a unit: `48'-0"`, `12' 6"`, `12.5ft`, `150in`, `3.81m`,
     `381cm`, `3810mm`. A bare number is rejected.
   - `--provenance` says what is printed and where: `printed 48'-0" along the
     north wall`, `100 ft scale bar, lower left, full bar`.
   - The two points must be at least 10 % of the image diagonal apart.
   - `--relative-uncertainty` defaults to 0.02; raise it when the user is
     unsure of the DPI or zoom.
   - On a sheet that mixes scales, give each calibration the `--region` it
     applies to (see Floor plan).
   - Two calibrations in the same region (or both without one) that disagree
     by more than 5 % disable measuring there. Tell the user which references
     disagree, ask which is right (or whether the image was stretched), and
     remove the wrong one with
     `import-image.mjs uncalibrate <project> <id> <calibration-id>`. Use
     `measure --force` only when the user chooses to go on regardless, and say
     so in the evidence note.
   - `known-object`: propose it only when nothing else exists. Once the user
     accepts it, record the assumption in `brief.json` and calibrate with
     `--method known-object ... --accepted`.
4. **Report the estimate and offer calibration.** Measure each undimensioned
   distance you need:

   ```text
   import-image.mjs measure <project> <id> --from x,y --to x,y --seen WxH [--uncertainty-px n]
   ```

   Give the user the number as `measure` prints it, with its ± and method:
   "about 48 ft ± 2 ft (estimated from the scale bar)". Then offer the viewer's
   manual calibration. Start the viewer if it is not running
   (`node <skill>/scripts/serve.mjs <project>`, SKILL.md step 8); its Sources
   tab works before a model exists. Tell the user:
   1. Open the Sources tab and select the image.
   2. Click the two ends of the longest distance you trust, and type it.
   3. Optionally mark labelled points, such as house corners, for placing the
      image, and outline labelled areas, such as a garden bed or an existing
      shed, with the Area tool.
   4. Press **Copy calibration** and paste the text back to me.

   Pass the whole pasted text to `apply`, through stdin or a scratch file
   (outside `sources/`; delete it afterwards) rather than as an argument,
   because the JSON's quotes break shell quoting:

   ```text
   import-image.mjs apply <project> --file <path>
   import-image.mjs apply <project> -
   ```

   If `apply` rejects the paste as stale or mismatched, ask the user to reload
   the viewer and calibrate again. A manual calibration replaces the estimated
   ones in its region, and measurements are no longer estimated. Never record
   `--method manual` yourself. A manual calibration is the user's deliberate
   override of whatever the image shows: apply it and use it. When `apply`
   notes that it differs from the estimate by more than 5%, tell the user in
   one line (the two scales, and what the estimate makes their line) so a typo
   can be caught, then carry on with the manual scale. Remove it with
   `uncalibrate` only when the user says it was a mistake.
5. **Set north** on every plan-type image (not elevations or photos):

   ```text
   import-image.mjs north <project> <id> --deg <n> --source north-arrow|survey-basis|user|assumed [--note <text>]
   ```

   `--deg` is clockwise from image-up to true north: an arrow pointing 30° to
   the right of up is `30`, 15° to the left is `345`. An `assumed` north (a
   north-up map export) also goes into `brief.json` assumptions.
6. **Place it for the underlay** once a model exists. Satellite images,
   surveys, and site plans go on `--view site`; floor and framing plans on
   `--view <levelId>`. Mark points that exist in both the image and the model
   (the user's labelled points from the viewer arrive through `apply`), then
   pair them with model millimetres:

   ```text
   import-image.mjs reference <project> <id> --label <text> --at x,y --seen WxH
   import-image.mjs place <project> <id> --view site|<levelId> --pair ref:<label>=mx,my --pair px,py=mx,my[=label] --seen WxH
   ```

   One pair is enough when north is set; otherwise give two or more, far
   apart. `place` reports each pair's residual. A residual over 2 % of the pair
   spacing or 150 mm usually means the two sides are not the same physical
   point (a roof corner paired with a wall corner, or building lean). Without a
   calibration, two or more pairs set the scale as `control-points`. The
   underlay is drawn only in the viewer; exported drawings never show it, and
   it never stands in for geometry.
7. **Derive geometry.** Take printed values as written. Measure the rest with
   `measure`, or convert positions on a placed image with
   `import-image.mjs to-model <project> <id> x,y [x,y ...] --seen WxH`. Set each
   derived entity's evidence by this policy (the defaults are policy values,
   not accuracies):

   | Origin | `source` | `confidence` |
   | --- | --- | --- |
   | Printed on the image, read as written | `attachment` | 0.7 |
   | Measured with a `manual` or `control-points` scale | `attachment` | 0.6, lower above 2 % uncertainty |
   | Measured with an estimated scale | `attachment` | 0.4 |
   | Measured with an accepted `known-object` scale | `heuristic` | 0.2 |

   - `status: "needs-review"` until the user confirms it.
   - `reference`: `source:<id>@<revision>.<calibrationRevision>`, with the
     current numbers from `import-image.mjs list <project> --json`.
   - `note`: the printed value used, or the calibration method and the ± from
     `measure`, plus any adjustment you made (`roof edge less an assumed 1'-6"
     overhang`).
   - Keep a list of image-derived dimensions, with method and uncertainty, for
     `HANDOFF.md`.

   **Labelled areas.** Areas the user outlined in the viewer arrive through
   `apply` and are context: they say what the user means by "the garden bed"
   or "the existing shed". `list --json` gives each one's `areaMm2`,
   `perimeterMm`, and `relativeUncertainty`, computed from the current scale
   every time (`null` when no scale applies). To turn one into a boundary
   (a surface, planting, or existing structure), place the image and run
   `import-image.mjs to-model <project> <id> --area <label>`, then author clean
   geometry from those model points with evidence per the table above and the
   `reference`. An area never sets a property line or setback.
8. **Check.** Run `import-image.mjs check <project>` after changing a source or
   anything derived from one, and before handoff. For each item it lists:
   re-import a stale file with `add --replace`; re-derive entities whose source
   has moved on and update their `reference`; set any that were `accepted`
   back to `needs-review` and ask the user to approve them again.

## Estimating endpoints

The scale's relative error is about `2ε / L`: the endpoint error `ε` over the
baseline `L`. Make `L` long and `ε` honest.

- **Use the longest baseline.** The overall dimension, not one room; the whole
  scale bar (0 to 100 ft), never one tick (0 to 20 ft).
- **Read the measured points, not the label.** A dimension measures between
  its extension lines or ticks; a scale bar between its first and last
  divisions.
- **State the size you saw.** Your view of a large image is often a reduced
  copy. Pass `--seen WxH` with that copy's size on every command that takes
  pixels. Never read coordinates from a crop or a zoomed part of the image.
- **Cross-check.** Record a second, independent reference in a different
  direction (a horizontal and a vertical dimension, or the scale bar and a
  printed lot line). Agreement within 5 % confirms the scale; disagreement
  points to a misreading or a scan stretched in one direction.
- **Be honest with `--uncertainty-px`.** It is how far each endpoint could be
  off, in full-size (canonical) pixels; a 2 px doubt on a half-size copy is
  4 px. The default is 3. Raise it for blurry or thick lines, compression
  artefacts, or a much-reduced copy. Never lower it to make a number look
  better.

## By image type

### Satellite and aerial

- **Orientation.** Most map exports are north-up but rotated, tilted, and
  phone-screenshot views may not be. Without a compass on the image, north is
  `assumed` and listed as an assumption.
- **Footprint versus roof.** An aerial shows the roof edge, overhang included.
  Subtract an assumed overhang to get the walls, and say so.
- **Lean.** Off-nadir imagery shifts roofs and treetops away from their bases.
  Take positions from ground-level features (wall bases, drive edges, fences);
  use roof outlines for shape and size only.
- **Date.** Ask for, or read from the attribution, the imagery date. Buildings,
  drives, and trees may have changed since.
- **Candidates.** Drives, walks, outbuildings, and trees are candidates. Show
  them to the user with sizes and ±; add only those confirmed. A canopy is not
  a trunk: its centre is a guess at the trunk position. Never derive property
  lines or setbacks from it.
- **Scale.** Use the map's scale bar. Use `map-metadata` only when the user
  supplies zoom, latitude, tile size, and device pixel ratio for an unresized
  capture.

### Survey and plat

- **Bearings and distances as printed.** Build the property line from the
  printed courses, not from pixels. Convert each quadrant bearing to an
  azimuth `A` clockwise from north (N θ E = θ, S θ E = 180 − θ, S θ W = 180 +
  θ, N θ W = 360 − θ). With `T` the model's `trueNorthDeg`, a course of length
  `L` moves `dx = L·sin(A + T)`, `dy = L·cos(A + T)` in model millimetres.
- **Curves.** Use the printed radius `R` and arc length: sweep `Δ = arc / R`,
  `bulge = tan(Δ / 4)`, positive when the curve turns left as you walk the
  boundary in vertex order. Reach the next vertex by the chord bearing and
  chord length when printed.
- **Closure.** Walking every course should return to the point of beginning.
  Report the misclosure to the user; never spread it silently.
- **Basis of bearing.** Read the basis note (record plat, grid, magnetic,
  true). If the survey gives the angle between its basis and true north, apply
  it. Otherwise treat the basis as true north, record that as an assumption,
  and list it as a survey question in `HANDOFF.md`. The survey's arrow is
  `north --source survey-basis`.
- **Easements.** List each easement (utility, drainage, access) with its width
  and location in `HANDOFF.md`; the model has no easement entity.
- **Evidence.** The property line, and setbacks, trees, contours, and spot
  elevations the survey dimensions or labels, are `source: "attachment"`,
  confidence 0.7, with the survey's `reference`. Trees or contours the survey
  draws but does not dimension are measured from it (lower confidence).
- **Underlay.** Pair lot corners on the image with the corners computed from
  the courses. Large residuals mean a misread course or the wrong corner.

### Site plan

- Take the building's ties to the property line, and drive and walk sizes, as
  printed.
- Setbacks come from a site plan only when they are dimensioned on a recorded
  or approved plan. A setback line drawn without a dimension, or on a design
  sketch, is not evidence: leave it to the user or the code research.
- A site plan is not a survey. Its property line is evidence only when it
  prints bearings and distances from a survey; say which.

### Floor plan

- **Printed dimensions first.** Check that each string adds up to its overall
  dimension and report any mismatch.
- **What a dimension measures to.** Face of stud, face of masonry, centreline,
  or finish face. Read the drawing's notes; otherwise assume the usual
  convention and record it.
- **Wall thickness.** Use the wall types when printed. Otherwise assume one
  (for example 4 1/2" for a 2x4 partition with drywall, 6 1/2" for a 2x6
  exterior wall before cladding) and record it as an assumption.
- **Openings.** Take sizes from the schedule or callouts (`3068` is 3'-0" by
  6'-8"), positions from printed dimensions, and only then from `measure`
  (to the opening's centre). Head heights not shown are assumptions.
- **Regions.** Enlarged plans, details, and key-plan insets are drawn at other
  scales. Calibrate each with its own `--region x0,y0,x1,y1,label`, and
  measure only within one region.

### Framing, rafter, and truss plans

- **Ridge direction** sets the roof's `ridgeAxis`: the model axis the ridge
  runs along (`y` for a ridge running north-south in an unrotated model).
- **Pitch and span set the ridge.** The renderer rises from
  `eaveElevationMm` at the footprint edge to `ridgeElevationMm` at the middle,
  so compute the run from the model footprint's width across the ridge:
  `run = width / 2`, `rise = run × pitch`. Show the arithmetic. For a 6:12
  pitch over a 24'-0" (7315 mm) wide footprint with the eave at 9'-0"
  (2743 mm): run = 7315 / 2 = 3657.5 mm, rise = 3657.5 × 6 / 12 = 1829 mm,
  `ridgeElevationMm` = 2743 + 1829 = 4572 (15'-0"). The viewer then reports
  the same 6:12.
- **Overhang.** A printed overhang is usually horizontal. If it is measured
  along the slope, convert it: `horizontal = sloped × 12 / √(144 + p²)` for a
  p:12 pitch.
- **Beams.** Only truly horizontal members become `beams`: ridge beams,
  girders, and headers, each at one `topElevationMm`. A header over a modelled
  door or window goes in that opening's `headers` instead. Use a printed top
  elevation; otherwise derive it and record how.
- **Everything else is a note.** Rafters, trusses, spacing, member sizes, and
  any roof form the renderer cannot draw (it draws one axis-aligned
  rectangular gable: no hips, valleys, dormers, or second gables) become
  assumptions and handoff items, for example `Rafters 2x10 @ 16" o.c. per
  framing plan (source:framing@1.1), not modelled`. Never model a rafter or
  truss as a sloping beam.

### Elevations

- Heights only: floor levels, plate or eave, ridge, sill and head heights,
  grade. Printed elevation markers are used as written; relate them to the
  model's datum.
- Calibrate on a printed vertical dimension and cross-check with a horizontal
  one.
- Horizontal positions come from plans. Never set north on an elevation or
  place it.

### Photos

- Context only: cladding, roof and window types, condition, trees,
  neighbours, the feel of the slope. Add them with `--kind photo` so they are
  on record.
- Never calibrate them; the script refuses. A drawing photographed at an
  angle (converging edges, a curved page) is a photo: ask for a flat scan or
  export.

### Sketches

- Sketches are rarely to scale. Measure from one only with a trusted
  calibration dimension: one the user wrote on it or confirms.
- Cross-check with a second dimension. If they disagree by more than 5 %,
  treat the sketch as not to scale: use only its written numbers and its
  layout (which room is next to which).

## Worked example

The user sends `lot-aerial.png`, 2400 × 1800 px, from a web map. It has a
100 ft scale bar at the lower left and no north arrow. You view it at full
size.

```text
import-image.mjs add <project> lot-aerial.png --kind satellite --id aerial --notes "Web map export"
import-image.mjs calibrate <project> aerial --method scale-bar --from 180.5,1702 --to 582.5,1702 --distance 100ft --seen 2400x1800 --uncertainty-px 3 --provenance "100 ft graphic scale bar, lower left, full bar"
import-image.mjs north <project> aerial --deg 0 --source assumed --note "Map export, assumed north-up"
import-image.mjs measure <project> aerial --from 900,820 --to 1093,820 --seen 2400x1800 --uncertainty-px 3
```

The bar is 402 px for 30480 mm, so 75.8 mm/px with a relative uncertainty of
2 × 3 / 402 ≈ 1.5 %. The roof's south edge is 193 px, 14633 mm (48.0 ft);
its uncertainty is √(1.5 %² + (6 / 193)²) ≈ 3.4 %, about ± 1.7 ft. Record
the north-up assumption in `brief.json`, then tell the user:

> From the aerial, the roof is about 48 ft ± 2 ft long east to west
> (estimated from the 100 ft scale bar). That is the roof edge, so the walls
> are shorter by the overhang. I assumed the image is north-up; when was it
> taken? For a tighter figure, open the Sources tab in the viewer, click the
> two ends of a distance you know, type it, press Copy calibration, and paste
> the text to me.
