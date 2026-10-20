# Model Validation

Run validation before rendering and again before handoff. Only `error` findings
block handoff; `warning` and `advisory` findings remain visible in diagnostics,
`ASSUMPTIONS.md`, and `HANDOFF.md`.

## Errors

- Every entity ID is unique and every referenced ID resolves.
- Each level elevation is unique and levels sort bottom to top.
- Space, slab, and roof-footprint polygons contain at least three distinct
  points, close without self-intersection, and have non-zero area.
- A wall centerline has non-zero length, positive thickness, and positive
  height.
- A hosted opening fits within its wall length and wall height after sill,
  width, and head clearance are applied.
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
- Foundation and site surface boundaries are simple polygons (the same checks
  as spaces), with positive depth or thickness.

## Warnings

- A sheet's material key has no room for every material the sheet draws
  (`material.key-overflow`).
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
- Site dimensions are not based on a survey.
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
- Opening offsets, widths, sill heights, and head heights agree in every view.
- Stair geometry and roof profiles agree in every view.
- A 2D MEP symbol and its 3D object share an entity ID and coordinates.
- Every displayed dimension is computed from coordinates, never copied from a
  label stored elsewhere.
- Selecting a model variant replaces the entire model for every view.
