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

## Exterior Elevations

Locate each cardinal elevation's visible wall face from the wall centerline
bounds, not the combined room and roof footprint bounds. Roof edges and room
boundaries may extend past those centerlines and must not hide hosted doors
or windows. Project openings from their host wall at the authored offset,
width, sill, and height, including the level elevation and wall base offset.

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
  last with the `cut` pen and poché:
  - Walls: the wall rectangle (centreline ± half thickness) crossed by the
    segment, from base to top. If the crossing falls inside a hosted opening,
    only the wall below the sill and above the head is cut.
  - Slabs: the crossed interval from `elevation - thickness` to `elevation`.
  - Roofs: the roof surface profile along the crossed interval, including
    overhangs, as a cut line. No roof assembly thickness is invented.
  - Stairs: the stepped profile projected onto the plane.
- Elements with `s > 0` that are not cut are **beyond**. They are projected
  onto the plane and drawn back to front (largest `s` first) with a paper fill
  so nearer elements hide farther ones: walls and their openings at `medium`
  when within 1 m of the plane and `thin` otherwise, fixtures and equipment at
  `thin`, the roof silhouette at `thin`.
- Every level contributes a datum line. The ground line runs across the full
  drawing at `z = siteDatumMm`.

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
but never legal boundaries or setbacks without survey evidence.
