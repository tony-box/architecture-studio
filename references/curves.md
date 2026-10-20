# Authoring Curves

Read this before writing or changing any curved geometry. Curves are authored
as numbers, so turn every request into a measurable change (a point, a
radius, a width, how far an edge bows out) rather than guessing control
points. Then check the result with `scripts/inspect.mjs`.

## Pick the tool

| What the user describes | Use | Why |
|---|---|---|
| A walk, path, drive, or anything else of constant width | Surface `path` | You set the centreline, width, and corner radii; the outline is derived exactly, so the width never drifts |
| An edge that bows out or in: a curved lawn edge, a rounded patio, a curved deck, a bay | `bulge` on that edge | One number from how far the middle of the edge moves |
| A circle (pond, tree ring) | Two vertices, both `bulge: 1` | Exact circle |
| A rounded corner of an outline | Two vertices around the corner, the first with a `bulge` | Exact fillet of a chosen radius |
| A curved wall | Wall `bulge`, at most 1 | Same bow rule as an edge |
| A free-form, organic bed with no straight edge or constant width | Bezier `c1`/`c2` | Last resort: hardest to predict and to set out on site |

Prefer the first rows. Arcs and fillets can be set out on site with a tape and
a stake; Beziers cannot.

## Paths (walks, drives, garden paths)

```json
{
  "id": "surface-walk", "name": "Entry Walk", "levelId": "level-ground",
  "path": {
    "centerline": [{ "x": 9220, "y": 8961 }, { "x": 9220, "y": 6096 }, { "x": 7163, "y": 3962 }, { "x": 7163, "y": 1219 }],
    "widthMm": 1219,
    "cornerRadiusMm": 2438
  },
  "followsGrade": true, "thicknessMm": 102, "materialId": "mat-concrete", "evidence": { ... }
}
```

- The centreline runs from one end to the other. Its first and last points
  are the middle of each end; the ends are square to the centreline. Start a
  walk at the middle of the door it serves and end it where it meets the
  street or another surface.
- **Lead-in points.** Each end is square to the straight that leaves it, so
  the point next to each end decides the angle at which the walk meets the
  door or kerb. Put that point in line with the end, on the perpendicular to
  what it meets (straight out from the door, straight in from the kerb), at
  least one corner radius away. Shape the walk only with the points between
  the two lead-in points; never move a lead-in point sideways, or the end
  will meet the door or kerb at a slant.
- Between the points the centreline is straight. At every interior point it
  turns on a circular arc of `cornerRadiusMm`, or of that point's own
  `radiusMm`. `radiusMm: 0` is a sharp corner.
- Place interior points where the straights would meet if the corner were
  sharp, not on the curve itself.
- A radius must be at least half the width, or the inner edge folds.
- Each corner uses `radius × tan(turn / 2)` of the straight on each side of
  its point; two corners must fit on the straight between them. Validation
  names the largest radius that fits when they do not.
- Sizes to start from when the user gives none (studio defaults, not code
  minimums; accessibility routes need a code check):

  | Kind | Width | Corner radius |
  |---|---|---|
  | Garden or stepping-stone path | 900 mm (3 ft) | 2 to 3 m (6 to 10 ft) |
  | Entry walk | 1200 to 1500 mm (4 to 5 ft) | 2.4 to 4.5 m (8 to 15 ft) |
  | Single drive | 3000 to 3600 mm (10 to 12 ft) | 6 m (20 ft) or more |

### Turning requests into edits

| Request | Edit |
|---|---|
| "Curve it more" / "make the curve tighter" | Reduce the radius at that point |
| "Make it gentler" / "softer curve" | Increase the radius, as far as validation allows; or move the points so the turn angle is smaller |
| "Move the curve east by 3 ft" | Move the points between the lead-in points east by 914 mm. If the walk has none (only lead-ins), add one where the bend should be |
| "Make it an S-curve" | Two interior points turning opposite ways, with a straight between them |
| "Straighten it" | Remove the interior points |
| "Wider" / "narrower" | Change `widthMm`; check the radii are still at least half of it |
| "Start it at the side door" | Move the first point to the middle of that door's opening, just outside the wall |

## Bowed edges (`bulge`)

`bulge = 2 × s / c`, where `c` is the straight distance between the edge's two
vertices (the chord) and `s` is how far the middle of the edge moves away from
that straight line (the sagitta).

- Example: a 6000 mm edge whose middle should bow out 600 mm has
  `bulge = 2 × 600 / 6000 = 0.2`.
- Sign: on an outline listed counter-clockwise (the usual order), a positive
  bulge bows the edge outward and a negative one bows it inward. On a
  clockwise outline it is the other way round. When unsure, compute the
  signed area of the outline: positive is counter-clockwise.
- The arc's radius is `c / 2 × (1 + b²) / (2b)` for bulge `b`; quote it to the
  user when they ask for "a 20 ft radius edge" and solve for `b` instead:
  `b = (2R − √(4R² − c²)) / c` for an arc under a semicircle.
- `bulge: 1` is a semicircle. Keep walls at 1 or below and outlines at 3.7 or
  below.

## Rounded corners on an outline

To round a corner of turn `θ` (the change of direction, 90° for a square
corner) with radius `R`:

1. Set back `t = R × tan(θ / 2)` from the corner along both edges.
2. Replace the corner vertex with the two set-back points.
3. Give the first of them `bulge = tan(θ / 4)` (0.4142 for a square corner),
   positive on a counter-clockwise outline.

## Beziers

Use only for free-form shapes. Put `c1` on the line the curve should leave
along, about a third of the way to the next vertex, and `c2` on the line it
should arrive along, about a third of the way back. Moving a control point
farther out makes that end of the curve fuller. Never use Beziers for
property lines, grading limits, or walls.

## Check every curve edit

1. Run `node <skill>/scripts/export-drawings.mjs --project <project>`. It
   refuses to write while there are errors, and path errors give the numbers
   to fix.
2. Run `node <skill>/scripts/inspect.mjs --project <project> --id <id>` for
   each element you changed. Check:
   - `path.widthMm` and `path.corners` match what the user asked for;
   - `path.ends` headings are unchanged by the edit (or square to the door
     and kerb: 0, 90, 180, or 270 when those are axis-aligned), so the walk
     still meets them squarely;
   - `clearanceToBuildingMm` is not negative (the shape does not run under
     the building), unless it is meant to meet the wall;
   - `clearanceToPropertyLineMm` is not negative (it stays on the lot);
   - `bounds` moved the way the request said ("east" means `minX` and
     `maxX` grew);
   - `findings` is empty, or every finding is explained to the user.
3. Tell the user what changed in their terms: "the walk now curves east on
   two 10 ft radius curves and stays 4 ft wide."
