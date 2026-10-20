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

Do not encode page rotation, screen pixels, Three.js axes, SVG inversion, or
display-unit formatting in model coordinates.

## Renderer Adapters

Plan SVG maps domain `(x, y)` to sheet `(x, -y)` before fit/zoom transforms.
Elevations project domain points onto the selected view axis and map `z` to
negative sheet `y`. Three.js maps domain `(x, y, z)` to world `(x, z, -y)` in
meters by multiplying millimeters by `0.001`.

Every renderer must expose inverse transforms for pointer inspection and
coordinate readouts. A view may rotate or mirror its presentation, but entity
coordinates remain unchanged.

Drawings then map sheet coordinates onto paper millimetres at a standard plot
scale (see `drafting-standard.md`). Pen widths and lettering are authored in
paper millimetres, never in model millimetres.

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
  no contours or spot elevations is flat at `siteDatumMm`.
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
  across the full drawing at `z = siteDatumMm`. With terrain, the drawing
  spans the whole cut line and the ground line follows the proposed ground,
  broken under the lowest level's slabs, where the ground meets the slab
  underside; existing ground is drawn dashed where it differs from proposed
  ground by more than 30 mm. With `site.groundMaterialId`, earth is hatched
  below the ground line.

## Precision

- Geometry computations use integer millimeters where practical.
- Derived floating-point intersections round to the nearest millimeter before
  entering validation or exported coordinates.
- Default comparison tolerance is 3 mm.
- Feet/inches display rounds to the nearest configured fraction, defaulting to
  1/8 inch. Display strings are never used as inputs to geometry.
- Metric display defaults to millimeters below 10 m and meters above 10 m.

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
