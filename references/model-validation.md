# Model Validation

Run validation before rendering and again before handoff. Only `error` findings
block handoff; `warning` and `advisory` findings remain visible in diagnostics,
`ASSUMPTIONS.md`, and `HANDOFF.md`.

## What Runs Automatically

`export-drawings.mjs`, `inspect.mjs`, and `compose.mjs` use the project's
`index.html` when present, otherwise the installed template. `--page` selects
an explicit viewer. An old project therefore keeps its old checks until an
approved viewer refresh.

The runtime checks below cover geometry and selected references. They do not
execute the full JSON Schema, check building-code compliance, or perform
collision detection for every object. Check authored JSON against
`building.schema.json` too; the repository's schema tests cover every example.
Sheet warnings arise during rendering, and source-image checks require
`import-image.mjs check`. A successful export is not a completed handoff.

## Geometry and Schema Errors

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
  does not overlap another opening in the same wall. Openings may share part
  of their span along the wall when one sits wholly above the other (a
  clerestory over a window).
- A stair has positive width and tread depth, connects two existing levels
  upward, and has enough run for `(riserCount - 1) * treadDepthMm` within
  tolerance. Rise per riser derives from the level-elevation difference;
  code geometry, landings, guards, and headroom remain manual checks.
- Every system edge references two nodes in the same system.
- Each edge path starts and ends at its referenced node positions within
  model tolerance, and every node participates in an edge. This does not
  prove that the whole network reaches the service entry or equipment.
- Every fixture or equipment connection references an existing system node.
- Dimensions have distinct explicit `from` and `to` model points; the current
  schema does not support dimensions attached by entity reference.
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
  exactly one of `boundary` and `path`; a path passes the checks in
  `coordinate-contract.md` (Paths) and its derived outline is a simple
  polygon. Every anchor names an existing opening or wall, with `alongMm`
  inside the wall, and a wall with a single exterior side (an exterior wall,
  or one with a room on only one side). `matchWidth` sits only on a path end
  anchored at the centre of an opening in a straight wall, never together with
  `widthMm`. A surface has
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

## Automatic Warnings

- A sheet's material key has no room for every material the sheet draws
  (`material.key-overflow`), or a systems sheet's symbol key has no room for
  every symbol it draws (`symbol.key-overflow`).
- An exterior opening spans the end of an interior wall below its head
  (`composition.partition-conflict`), a composition exception names an
  element not in the model (`composition.exception`), or a facade uses the
  rhythm strategy without `bayMm` (`composition.rhythm`).
- A dimension value has no clear position off walls, openings, hard
  surfaces, and other lettering (`dimension.placement`).
- The plant schedule on L-101 has no room for every row
  (`site.schedule-overflow`).
- A ground-level surface or proposed planting extends past the property line
  (`site.outside-lot`), or a surface runs under, or a proposed planting sits
  inside, the building footprint (`surface.under-building`,
  `planting.under-building`). Outlines are compared edge to edge, so a narrow
  walk cutting straight through the house is caught.
- A path end anchored to a door leaves it at a slant; the message gives
  coordinates for a square lead-in point (`surface.anchor-angle`).
- A contour segment could not be kept as a terrain edge
  (`terrain.constraint-failed`).
- The contours and spot elevations lie on one line, so no ground surface can
  be built and the ground stays at the site datum (`terrain.degenerate`).
- Stairs always retain a `stair.code` warning, and incomplete jurisdiction
  research retains `code.status`.

## Manual Coordination Checks

The agent must inspect these and record unresolved findings in the handoff.
They are not implemented as automatic runtime warnings:

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
- A receptacle, switch, light, or alarm sits inside a door swing, a bathtub or
  shower wet zone, or an equipment working space (`mep-placement-guide.md`,
  MEP-E1, MEP-E7, MEP-E17).
- A room in the placement guide's Room Checklist lacks an item the checklist
  lists for it, with no note explaining the omission.

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
- Keep unresolved sizing, secondary or conditional code sources, and
  unconfirmed placement baselines as manual review notes. The runtime does
  not evaluate those engineering or code questions. Each baseline-derived
  device names its rule ID in evidence and stays `needs-review`.
- A visible element breaks the composition (`composition-guide.md`): a row
  does not follow its facade strategy (`composition.symmetry`,
  `composition.thirds`, `composition.rhythm`), an upper opening does not stack
  over the one below (`composition.stacking`), matching openings on opposite
  facades do not line up (`composition.cross-facade`), heads in a row differ
  (`composition.head-alignment`), a sink is off the centre of the window over
  it (`composition.fixture-centering`), or ceiling lights are off an even grid
  (`composition.light-grid`). Each finding carries a suggested model value;
  `compose.mjs` gathers them into one proposed layout. Elements listed in
  `composition.exceptions` are skipped.

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
