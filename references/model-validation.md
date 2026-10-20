# Model Validation

Run validation before rendering and again before handoff. Only `error` findings
block handoff; `warning` and `advisory` findings remain visible in diagnostics,
`ASSUMPTIONS.md`, and `HANDOFF.md`.

## Errors

- Every entity ID is unique and every referenced ID resolves.
- Each level elevation is unique and levels sort bottom to top.
- Space, slab, and roof-footprint polygons contain at least three distinct
  points, close without self-intersection, and have non-zero area. Space and
  slab boundaries may be curved; they are checked on their tessellation.
- Curve vertices (`coordinate-contract.md`, Curves) have integer coordinates;
  a `bulge` is non-zero and at most 3.7 in magnitude with a chord of at least
  10 mm; Bezier controls come as a pair and never with a `bulge`; the last
  vertex of an open path carries no curve; consecutive vertices differ.
  Property lines and grading limits take arcs but no Bezier segments.
- A wall centerline has non-zero length, positive thickness, and positive
  height. An arc wall has `0 < |bulge| <= 1` and a radius more than 50 mm
  above half its thickness.
- A hosted opening fits within its wall length (the arc length for an arc
  wall) and wall height after sill, width, and head clearance are applied, and
  does not overlap another opening in the same wall.
- A stair has positive width, connects two existing levels, and its total rise
  equals the level-elevation difference within 3 mm.
- Every system edge references two nodes in the same system.
- Every fixture or equipment connection references an existing system node.
- Derived dimensions reference existing entities or explicit model points.
- Every `materialId` (walls, wall and slab layers, slabs, stairs, headers,
  beams, columns, foundations, surfaces, `site.groundMaterialId`) resolves to a
  catalog material with a known category.
- A wall or slab uses `materialId` or `layers`, not both. Every layer has an
  `id` unique within its wall or slab, its thicknesses sum to the element's
  thickness within tolerance, and a wall's `layerOrder` is `left-to-right` or
  `interior-to-exterior`.
- A header names a known kind, a positive depth, and, in a layered wall, the
  `layerId` of a layer that exists. A layer holds one header, or up to two
  steel angles on different faces; only steel angles take a `face`. Built-up
  lumber has two or more plies, a steel angle has a leg thickness smaller than
  its depth, and a steel beam header has flange and web thicknesses. The
  header's top stays within the wall height and its bearing stays within the
  wall length.
- A beam or column shape has positive width and depth. Wide-flange shapes
  carry flange and web thicknesses that fit; hollow sections carry a wall
  thickness that fits. Beams have length; columns have a top above the base.
- Foundation and site surface boundaries are simple polygons, curved or not
  (the same checks as spaces), with positive depth or thickness. A surface has
  an integer `topElevationMm` unless `followsGrade` is `true`; `gradeOffsetMm`
  is an integer.
- Setbacks name an existing property line edge and a positive distance.
- Contours have a valid path, an integer elevation on `contourIntervalMm`
  (within tolerance; the interval may be fractional, such as 304.8), and an
  `existing` or `proposed` status. Spot elevations have an integer position,
  elevation, and status.
- Proposed contours and spot elevations need a `gradingLimit` and lie inside
  it; an open proposed contour ends only where existing grade is within 50 mm
  of its elevation.
- Terrain samples at one point agree (`terrain.conflicting-sample`), and
  contours of different elevation do not cross (`terrain.crossing-contours`).
- Plants have a unique key (one to five uppercase letters or digits), a known
  kind, and positive mature height and spread. A planting references a plant,
  has a known status, and has either a `position` or a `boundary`, never both;
  a massed planting's plant has `spacingMm`.
- Property lines, grading limits, setbacks, contours, spot elevations, plants,
  and plantings carry evidence.

## Warnings

- A sheet's material key has no room for every material the sheet draws
  (`material.key-overflow`).
- The plant schedule on L-101 has no room for every row
  (`site.schedule-overflow`).
- A contour segment could not be kept as a terrain edge
  (`terrain.constraint-failed`).
- The contours and spot elevations lie on one line, so no ground surface can
  be built and the ground stays at the site datum (`terrain.degenerate`).
- Space boundaries overlap or leave an unintended gap inside an occupied
  envelope.
- Doors collide with walls, fixtures, equipment, or another door swing.
- A route intersects an opening, stair volume, primary structural reference,
  or equipment service zone.
- Plumbing waste routes rise between nodes or lack an identified stack/exit.
- Supply and return terminals exist without conceptual mechanical equipment.
- Electrical devices exist without a panel or conceptual circuit assignment.
- Vertical risers intended to align differ by more than 25 mm between levels.
- A required circulation, egress, fixture, or equipment clearance has not been
  checked against a cited rule.

## Advisories

- An entity confidence is below 0.75 or has `needs-review` status.
- Site dimensions are not based on a survey. A property line without accepted
  user, attachment, or code-source evidence raises `site.survey`.
- A landscape material (lawn, mulch, asphalt, pavers, flagstone, water,
  decking) is used in a wall, header, beam, or column
  (`material.category-use`).
- Two walls meet where an arc's faces have no clean miter; the end is drawn
  square (`wall.join-fallback`).
- The 3D site is large enough that terrain and draped surfaces use a grid
  coarser than 250 mm (`scene.reduced-detail`).
- Structural member sizes, connections, loads, or foundations are unresolved.
  Any header, beam, or column raises one `structure.review` advisory: their
  sizes are concept placeholders.
- A catalog material has no evidence (`material.evidence`): its name may carry
  a grade nobody sourced.
- Pipe, duct, conductor, breaker, equipment-capacity, or penetration sizing is
  unresolved.
- Code research is unavailable, uses a secondary source, or has conditional
  applicability.

## Cross-View Invariants

- Plans, elevations, sections, and 3D use the same level elevations.
- Opening offsets, widths, sill heights, and head heights agree in every view;
  on an arc wall, offsets and widths are measured along the centreline arc.
- Stair geometry and roof profiles agree in every view.
- Terrain, draped surfaces, and plant bases come from the same ground surface
  in sections and 3D.
- A 2D MEP symbol and its 3D object share an entity ID and coordinates.
- Every displayed dimension is computed from coordinates, never copied from a
  label stored elsewhere.
- Selecting a model variant replaces the entire model for every view.
