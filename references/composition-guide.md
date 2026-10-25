# Composition Guide

How to lay out what people see: doors, windows, walls, counters, fixtures,
ceiling lights, and other visible devices. Read it before placing openings or
visible items, and again whenever the user asks to add or move one.
`mep-concept-rules.md` covers what people do not see.

Composition is design practice. It has no code status, the owner may
override it, and it never raises a code conflict.

## Precedence

Decide in this order, and never let a lower item override a higher one:

1. **Code, life safety, and structure.** Examples include egress openings,
   door clearances and landings, stair rules, required jambs, trim returns and
   header bearing, shear or bracing panels near corners, and fire separation.
2. **Program and function.** Examples include vehicle and lift clearances, a
   door that faces the approach, privacy of wet rooms, and benches, appliances,
   and equipment that need a wall.
3. **Visible composition.** This guide applies here.
4. **Hidden systems.** Pipes, wires, ducts, and their routes follow
   `mep-concept-rules.md`. They adapt to the architecture. If a hidden route
   would be much simpler with a visible element moved, ask the user rather
   than moving it.

When an item from 1 or 2 forces an element off the pattern, keep the element
where function puts it. Record an exception so the checker and the handoff
know the asymmetry is deliberate.

## Strategy

The brief's `preferences.style` picks the strategy, which is stored as
`composition.strategy` in the model. With no preference, use `symmetric`.

| Style answer | Strategy | What it means |
| --- | --- | --- |
| Symmetric or traditional, or no preference | `symmetric` | Each row of openings mirrors about the facade centreline (the ridge on a gable end). An odd opening sits on the centreline. |
| Balanced or modern | `balanced` | Each opening or group sits on the centreline or a third line. Put the dominant element on a third and balance it with lighter ones on the other side. |
| Utilitarian or rhythmic | `rhythm` | Openings follow the structural bay grid, such as post-frame bays or a steel frame, with equal spacing. Set `bayMm` and, if the grid does not start at the building corner, `bayOriginMm`. |

A facade may use its own strategy in `composition.facades.<side>`. For
example, a symmetric house can have a balanced gable end around its garage
door.

## Facade Rules

- **COMP-F1 Strategy.** Place each row of openings by the facade's strategy.
- **COMP-F2 Head heights.** Openings in one row share a head height. Windows
  in a row with a door take the door's head. An overhead door does not set the
  row's head.
- **COMP-F3 Stacking.** An upper row aligns over the row below. With equal
  counts, centres pair up in order. Otherwise, each upper opening centres over
  the opening it overlaps. Clerestories, upper-floor windows, and dormers sit
  over the openings beneath them.
- **COMP-F4 Opposite facades.** Openings of the same type and size on
  opposite facades line up in plan. Clerestories and high windows are seen
  together from inside, so misalignment shows.
- **COMP-F5 Few sizes.** Use three or fewer window sizes on a facade, and
  repeat them.
- **COMP-F6 Corners and gaps.** Keep openings at least the corner return,
  600 mm (about 2 ft) by default, from a building corner. Keep at least the
  minimum gap, 400 mm by default, between openings. Corner bracing, posts,
  king and jack studs, and trim need this room. A structural engineer's
  bracing layout overrides both.
- **COMP-F7 Clear alignment.** Line elements up exactly or offset them
  clearly. A near miss, such as a window 4 in off the centreline or a jamb
  2 in past the one below, reads as a mistake.
- **COMP-F8 Proportion.** Symmetric and traditional facades favour vertical
  windows. Balanced and modern facades may use horizontal bands. Rhythmic
  facades repeat one size per bay.
- **COMP-F9 Partitions.** An exterior opening must not land where an interior
  wall meets the exterior wall below the opening's head. Move the opening or
  the partition. The checker reports this as a warning.

## Interior Rules

- **COMP-I1 Sinks under windows.** Centre a sink, lavatory, or utility sink on
  the window above it. Without a window, centre it on its counter or wall.
- **COMP-I2 Counters.** Run counters wall to wall or end them at an aligned
  point, such as a window jamb, door casing, or cabinet module.
- **COMP-I3 Ceiling lights.** Place ceiling lights on the room centreline, or
  on an even grid with half spacing at the walls. A single light sits at the
  room centre.
- **COMP-I4 Terminals.** Centre registers, ductless heads, and wall lights on
  a window, wall, or bay. Never place them just off centre.
- **COMP-I5 Partitions and doors.** Align partitions with window jambs or
  structural bays. Centre a door in its wall or keep a consistent return of
  about 4 to 6 in from the corner for casing.

Visible devices such as receptacles, switches, and thermostats keep the
heights and clearances in `mep-placement-guide.md`. Within those, align them
with each other and with nearby openings.

## Model

```json
"composition": {
  "strategy": "symmetric",
  "facades": { "east": { "strategy": "balanced" } },
  "toleranceMm": 13,
  "minGapMm": 400,
  "cornerReturnMm": 600,
  "exceptions": [
    { "entityId": "opening-overhead-door", "reason": "Set by the lift bay and driveway approach." },
    { "entityId": "opening-window-s1", "rules": ["head-alignment"], "reason": "4 ft sill keeps the window above benches." }
  ]
}
```

- Every field is optional. Without the block, the checker uses the
  `symmetric` strategy and the defaults shown.
- `strategy` is `symmetric`, `balanced`, `rhythm`, or `none`. `none` turns off
  every composition check except partition conflicts.
- An exception without `rules` fixes the element in place. It is skipped by
  every rule, and other openings keep clear of it. An exception with `rules`
  skips only those rules: `symmetry`, `thirds`, `rhythm`, `stacking`,
  `cross-facade`, `head-alignment`, `partition-conflict`,
  `fixture-centering`, or `light-grid`.
- Each exception needs a `reason` that names the code, structure, or function
  that wins. A personal taste can be a reason too, if the owner asked for it.

## Checking and Applying

Run `node <skill>/scripts/compose.mjs --project <project>` after placing or
moving visible elements. Add `--json` for machine-readable output. It reports:

- Each facade as seen from outside, with its centreline, third lines, and each
  opening's centre measured from the left corner. Wall direction is already
  handled; a north wall drawn east to west reads correctly.
- Every finding with a suggested `offsetMm`, `sillMm`, or `position`.
- One proposed layout that resolves head heights, then the strategy, stacking,
  and opposite facades together, clear of corners, gaps, partitions, and fixed
  openings.

Apply the proposal to `models/building.json`. Move a fixture's or system
node's routes and connections with it. Then rerun `compose.mjs` and
`export-drawings.mjs`. Before handoff, resolve every finding by applying it or
recording an exception. The same findings show as notes in the viewer.

Never type a mirrored offset by hand. Openings are measured from their wall's
start point, so mirroring by eye on a wall that runs right to left is how
facades go wrong.

## Handoff

List every exception and its reason in `HANDOFF.md` under design decisions.
The architect sees which asymmetries are deliberate and which composition
choices remain open.
