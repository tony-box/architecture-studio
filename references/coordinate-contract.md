# Coordinate Contract

The building model is the only geometric source of truth. Plans, elevations,
sections, schedules, measurements, and 3D meshes must derive from it.

## Domain Space

- Use a right-handed local architectural coordinate system.
- `x` increases east/right on an unrotated plan.
- `y` increases north/up on an unrotated plan.
- `z` increases vertically from the project datum.
- Store every coordinate and length as an integer millimeter.
- Store true north as clockwise decimal degrees from positive `y`.
- Keep the project origin and site datum explicit in `project.coordinates`.

Do not encode page rotation, screen pixels, renderer axes, SVG inversion, or
display-unit formatting in model coordinates.

## Renderer Adapters

Plan SVG maps domain `(x, y)` to sheet `(x, -y)` before fit/zoom transforms.
Elevations project domain points onto the selected view axis and map `z` to
negative sheet `y`. The built-in WebGL2 renderer maps domain `(x, y, z)` to world `(x, z, -y)` in
meters by multiplying millimeters by `0.001`.

Every renderer must expose inverse transforms for pointer inspection and
coordinate readouts. A view may rotate or mirror its presentation, but entity
coordinates remain unchanged.

Drawings then map sheet coordinates onto paper millimetres at a standard plot
scale (see `drafting-standard.md`). Pen widths and lettering are authored in
paper millimetres, never in model millimetres.

## Exterior Elevations

Locate each cardinal elevation's visible wall face from the wall centerline
bounds, not the combined room and roof footprint bounds. Roof edges and room
boundaries may extend past those centerlines and must not hide hosted doors
or windows. Project openings from their host wall at the authored offset,
width, sill, and height, including the level elevation and wall base offset.

## Curves

Boundaries (`spaces`, `slabs`, `foundations`, `surfaces`, planting areas, the
property line, the grading limit) and contour paths are lists of vertices. A
vertex describes the segment that **starts** at it and ends at the next vertex;
the last vertex of a closed boundary describes the closing segment, and the
last vertex of an open path carries no segment.

- `{ x, y }`: a straight segment. Every straight polygon is still valid.
- `bulge`: a circular arc, as in DXF. `bulge = tan(sweep / 4)`, where `sweep`
  is the included angle. Positive is counter-clockwise in model coordinates,
  so the arc bows to the right of its chord direction; negative bows left.
  `bulge = 1` is a semicircle; two vertices with `bulge: 1` make a circle.
  Boundaries allow `|bulge|` up to 3.7 (about 299°); zero is invalid (use a
  straight vertex) and an arc chord must be at least 10 mm.
- `c1`, `c2`: a cubic Bezier with absolute control points. Both are required,
  and they may not appear with `bulge` on the same vertex.

Walls, the property line, and the grading limit take straight segments and
arcs only, so every edge has a bearing or a radius.

Geometry (validation, areas, containment, section cuts, triangulation,
quantities) tessellates curves at one model tolerance: a chord stays within
1 mm of the true curve. Results never depend on a drawing's scale. Plan
linework is drawn with exact SVG arcs and curves; on paper y runs down, so a
counter-clockwise model arc is an SVG arc with sweep flag 0. Tessellated points
remember the authored edge they lie on, so per-edge data (setbacks, property
line labels) always refers to the model's edges.

## Paths

A surface may have a `path` instead of a `boundary`: a `centerline` of at
least two points, a `widthMm`, and a `cornerRadiusMm` (default 0) that each
interior point may override with its own `radiusMm`.

- The centreline is straight between its points. At an interior point that
  turns by `θ` (signed, positive to the left) with radius `R > 0`, it follows
  a circular fillet tangent to both straights, starting `R × tan(|θ| / 2)`
  before the point and ending the same distance after it. `R = 0` is a sharp
  corner, and collinear points have no fillet.
- The outline is the centreline offset by half the width to each side: lines
  stay lines, and each fillet becomes two concentric arcs with the same sweep
  (radius `R - w/2` inside the turn, `R + w/2` outside). The ends are square
  to the centreline at its first and last points. Derived vertices round to
  the millimetre, and the arcs are written as `bulge` vertices, so the outline
  obeys every rule in Curves and renders, cuts, and extrudes like any other
  boundary.
- Errors: fewer than two points, coincident consecutive points, a turn of
  nearly 180°, a radius too close to half the width for the inner edge to keep
  a 10 mm arc, or neighbouring fillets that
  need more of a straight than it has. The messages give the largest radius
  that fits.

## Anchors

A surface outline vertex or a path centreline point may carry an `anchor`
instead of `x` and `y`. It is resolved from the model before any geometry:

- `openingId` with `at`: the opening's centre (`center`, the default), or the
  jamb at its `start` or `end`, at `offsetMm` and `offsetMm + widthMm` along
  the host wall's centreline from the wall's start (along the arc for an arc
  wall).
- `wallId` with `alongMm`: that distance along the wall's centreline.
- The point lies on the wall's `exterior` face (default) or `interior` face.
  The interior side is the side with a room on it, tested just past each face
  at the wall's midpoint (on the arc for a curved wall); when neither or both
  sides have a room, an exterior wall falls back to the side toward the centre
  of the level's walls, and any other wall is an error. It
  then moves `offsetMm` straight out from that face (the face normal, pointing
  away from the wall), and rounds to the millimetre.
- `matchWidth: true` on a path's first or last point, anchored at an
  opening's centre, sets the path width to the opening width; the path then
  has no `widthMm`. Its edges meet the jambs exactly. Openings in curved walls
  do not support `matchWidth`.

Anchors are resolved on every render, so a surface follows its opening or
wall. An anchor that names a missing opening or wall, or an `alongMm` beyond
the wall, is an error. A path end anchored to an opening whose next point is
not straight out from the face raises `surface.anchor-angle`, with
coordinates for that point.

## Arc Walls

A wall with `bulge` follows a circular arc from `start` to `end`, with
`|bulge| <= 1`, and a centreline radius that exceeds half its thickness by at
least 50 mm. The straight-wall frame carries over: `along` is distance along
the centreline arc, and `side` is the offset to the left looking from start to
end. Layers are concentric bands; `offsetMm` and `widthMm` of openings, and
header bearing, are measured along the centreline arc.

Joins that involve an arc use the true faces: each wall's faces are named left
and right looking from the joint into the wall, a corner pairs one wall's left
face with the other's right face (and right with left), and each pair meets at
the face intersection nearest the joint (line with line, line with circle, or
circle with circle). Both walls are cut on the line through the two corner
points. Ends that meet tangentially butt square; ends whose faces have no
intersection within three wall thicknesses also butt square and raise a
`wall.join-fallback` advisory. A wall that ends part way along an arc wall
stops at that wall's near face.

## Terrain

Contours (`site.contours`) and spot elevations (`site.spotElevations`) define
two ground surfaces, existing and proposed, each a triangulated surface:

- Contour paths are sampled every 1000 mm (more widely when a site would
  exceed 2,500 samples), and every spot elevation is a sample. Samples are
  sorted by `(x, y)` and triangulated by Bowyer-Watson with a fixed
  super-triangle, so the same model always gives the same surface. Contour
  segments are then recovered as triangle edges by edge flips, in contour
  order. A segment that cannot be recovered raises
  `terrain.constraint-failed`, and the ground near it is interpolated without
  it.
- Two samples at the same point with different elevations are an error
  (`terrain.conflicting-sample`), and so are contours of different elevation
  that cross (`terrain.crossing-contours`).
- Existing ground uses existing contours and spot elevations. Proposed ground
  starts from existing ground: inside `site.gradingLimit`, existing samples
  are dropped and replaced by the proposed contours and spot elevations, with
  the limit itself sampled at existing grade, so finished grade ties back to
  existing grade along the limit. Proposed contours and spot elevations must
  lie inside the limit; an open proposed contour may end on the limit only
  where existing grade is within 50 mm of its elevation.
- Ground elevation at a plan point is linear on its triangle. Outside the
  triangulated area it holds the value of the nearest hull edge. A model with
  no contours or spot elevations is flat at `siteDatumMm`, and so is one whose
  samples all lie on a line (`terrain.degenerate` warning).
- Flat triangles where every corner lies on one contour (hilltops, valley
  floors) are accepted; terrain is concept-level.

Surfaces with `followsGrade: true` drape on the proposed ground: their top is
the ground plus `gradeOffsetMm` (default 0), and `thicknessMm` is measured
vertically. Their `topElevationMm` is not used.

## Section Views

A section definition is a vertical cutting plane through `start` and `end`.

- Let `d` be the unit vector from `start` to `end`. The look direction `n` is
  `d` rotated 90° counter-clockwise for `lookDirection: "left"` and clockwise
  for `"right"`.
- The horizontal drawing axis `h` runs to the viewer's right: `h = t` for
  `left` and `h = -t` for `right`, where `t` is distance along `d` from
  `start`. Vertical is `z`.
- The signed depth of a point `p` is `s = (p - start) · n`. Geometry with
  `s < 0` is behind the viewer and omitted. The far clip is the far edge of
  the building extent.
- An element is **cut** when the cutting segment crosses it. Cut elements draw
  last with the `cut` pen and poché, or with material hatching when the sheet
  carries material detail (`drafting-standard.md`, Materials):
  - Walls: the wall rectangle (centreline ± half thickness) crossed by the
    segment, from base to top; an arc wall's curved band may be crossed
    twice, and each crossing is cut. If the crossing falls inside a hosted
    opening, only the wall below the sill and above the head is cut. Each wall
    layer is the crossed interval of its own band, in the wall's `layerOrder`;
    a header replaces the layer its `layerId` names from the head up by its
    depth wherever the crossing falls within the opening plus its bearing (a
    steel angle draws over its layer instead).
  - Slabs: every crossed interval from `elevation - thickness` to
    `elevation`, split into layers from the top down.
  - Foundations and site surfaces: every interval the segment spends inside
    the polygon, from `topElevationMm - depthMm` (or `- thicknessMm`) to
    `topElevationMm`. A surface that follows grade is a band of its thickness
    under the proposed ground along each interval.
  - Beams crossing the plane at more than about 45°: the member profile,
    centred on the crossed interval, from `topElevationMm - depthMm` up.
  - Roofs: the roof surface profile along the crossed interval, including
    overhangs, as a cut line. No roof assembly thickness is invented.
  - Stairs: the stepped profile projected onto the plane.
- Elements with `s > 0` that are not cut are **beyond**. They are projected
  onto the plane and drawn back to front (largest `s` first) with a paper fill
  so nearer elements hide farther ones: walls and their openings at `medium`
  when within 1 m of the plane and `thin` otherwise, fixtures and equipment at
  `thin`, the roof silhouette at `thin`. Columns, and beams the plane cuts
  along their length, are drawn as beyond elements at depth 0. Plants beyond
  the plane, up to 9 m away, are drawn in outline at full height.
- Every level contributes a datum line. Without terrain, the ground line runs
  across the full drawing at `z = siteDatumMm`. With terrain, the ground line
  follows the proposed ground, broken under the lowest level's slabs, where
  the ground meets the slab underside; existing ground is drawn dashed where
  it differs from proposed ground by more than 30 mm. With
  `site.groundMaterialId`, earth is hatched below the ground line.
- The drawing spans the building plus 3000 mm of site each side along the
  cut, no wider than everything the section draws. The building is every cut
  or beyond element except site surfaces and fixtures or equipment. Ground,
  plants, and other drawing past that span stop at the drawing's edge and
  never set the scale (`drafting-standard.md`, Scales). A section that meets
  no building element spans the whole cut line.

## Precision

- Geometry computations use integer millimeters where practical.
- Derived floating-point intersections round to the nearest millimeter before
  entering validation or exported coordinates.
- Default comparison tolerance is 3 mm.
- Feet/inches display rounds to the nearest configured fraction, defaulting to
  1/8 inch. Display strings are never used as inputs to geometry.
- Metric drawing dimensions use millimeters. Site distances and elevations
  use meters; areas use square meters. Display formatting does not change
  the stored unit.

## Source Images

Images the user supplies are recorded in `sources/sources.json`
(`sources.schema.json`) by `scripts/import-image.mjs`. That manifest, not
`brief.json`, is authoritative for an image's scale and placement.

### Pixel frame

- Pixels are taken after EXIF orientation, including the mirrored
  orientations. `pixels.width` and `pixels.height` are the oriented size; a
  browser reports the same values as `naturalWidth` and `naturalHeight`.
- The origin is the top-left corner of the top-left pixel. `x` runs right and
  `y` runs down, in continuous units: the centre of pixel `(i, j)` is
  `(i + 0.5, j + 0.5)`.
- A coordinate read from a resized copy is given with the size that was seen
  (`--seen <w>x<h>`) and rescaled by `width / seenWidth` and
  `height / seenHeight`. Coordinates read from a crop are not accepted.
- `north.deg` is clockwise degrees from image-up to true north, the same
  convention as `trueNorthDeg`. Its `source` says where it came from; an
  `assumed` north (a north-up satellite image) is also an assumption.

### Scale

- An image has one scale, and every calibration on it applies to the whole
  image. An image drawn at more than one scale (an enlarged detail, a
  location map inset) is cropped into one image per scale by the user and
  each part imported as its own source.
- `manual` and `control-points` calibrations are precise and
  replace every other method. Without them, the scale comes from the
  automatic methods, in the order `printed-dimension`, `scale-bar`,
  `stated-scale`, `map-metadata`, and then accepted `known-object` (only one
  `acceptedByUser: true`). The active scale is the inverse-variance mean of the
  chosen calibrations, weighted by `1 / relativeUncertainty²`; its relative
  uncertainty is `1 / sqrt(Σ 1 / u²)`.
- The calibrations disagree when the largest `mmPerPx` exceeds the
  smallest by more than 5 %. The calibrations compared are the precise ones
  when there are any, and otherwise every automatic one apart from
  `known-object`. Measuring from the image is then disabled until the user
  resolves it. Two calibrations within 30° of perpendicular that disagree
  point to uneven horizontal and vertical scaling.
- Calibration points, and the points of a placement pair, must be at least
  10 % of the image diagonal apart.
- A measured distance has a relative uncertainty of
  `sqrt(u_scale² + (2ε / L)²)`, where `ε` is the endpoint uncertainty in
  pixels and `L` the measured length in pixels.
- A labelled area measures `pixel area × mmPerPx²` with the active scale,
  with a relative uncertainty of `2 × u_scale`.
- `photo` sources are never calibrated: perspective is not a uniform scale.

### Placement

A placement maps image pixels to model millimetres with one similarity
transform and a y flip:

```text
model.x = a·px + c·py + e
model.y = b·px + d·py + f
a = s·cos θ,  b = s·sin θ,  c = s·sin θ,  d = -s·cos θ
```

`s` is `mmPerPx` and `θ` is `rotationDeg`, counter-clockwise. The active
calibration is the only scale: with it, two or more pairs fix `θ` and the
translation by least squares at that scale, and each pair reports its
residual. A residual above 2 % of the pair spacing, or above 150 mm, is a
warning. One pair and `north` fix `θ = north.deg − trueNorthDeg`. Without a
calibration, two or more pairs also fit `s`, and that is recorded as a
`control-points` calibration, never as a second scale. Recalibrating
recomputes the placement from its stored pairs.

Renderers draw a placed image as `pixel → model → sheet`, through the
sheet's own map, on every render. A source whose file no longer matches its
`contentHash`, or whose placement records an older `sourceRevision` or
`calibrationRevision`, is not drawn and is not measured.

### Evidence from images

An entity derived from an image sets `evidence.reference` to
`source:<id>@<revision>.<calibrationRevision>`, for example
`source:survey-plat@1.2`. `import-image.mjs check` lists entities whose
reference is older than the source. The default confidence is a policy
value, not an accuracy:

| Origin | `source` | `confidence` |
| --- | --- | --- |
| A value printed on the image, read as written | `attachment` | 0.7 |
| Measured with a `manual` or `control-points` scale | `attachment` | 0.6, lower when the uncertainty exceeds 2 % |
| Measured with an estimated scale | `attachment` | 0.4 |
| Measured with an accepted `known-object` scale | `heuristic` | 0.2 |

Image-derived entities stay `needs-review` until the user confirms them.

## Evidence

Each authored entity records an evidence object:

- `source`: `user`, `attachment`, `code-source`, `heuristic`, or `generated`.
- `confidence`: a value from 0 through 1.
- `status`: `accepted`, `needs-review`, or `rejected`.
- `note`: a short explanation of the origin or uncertainty.

Dimensions calibrated from an image must identify the trusted reference
dimension in the note. Satellite imagery may establish orientation and context,
but never legal boundaries or setbacks without survey evidence. A property line
whose evidence is not an accepted user, attachment, or code-source record
raises the `site.survey` advisory.
