# Drafting Standard

Every drawing the studio produces (plans, elevations, sections, systems
overlays, and the exported SVG set) follows one of two convention profiles.
The renderer in `assets/studio-template.html` implements this file; when the
two disagree, fix the renderer.

The profile is selected by `project.coordinates.displayUnits`:

| `displayUnits` | Profile | Informed by |
|---|---|---|
| `feet-inches` | Imperial | US National CAD Standard (NCS) plotting and annotation conventions |
| `metric` | Metric | ISO 128 (line types and widths), ISO 129 (dimensioning), ISO 5455 (scales) |

These profiles are informed by the named standards. They are not a claim of
conformance, and a drawing must never describe itself as NCS or ISO compliant.
Layer naming (NCS layer guidelines, ISO 13567) applies to CAD files and is out
of scope for SVG output.

## Sheet

Every drawing is a sheet: a fixed paper rectangle in paper millimetres.

| | Imperial | Metric |
|---|---|---|
| Sheet | ANSI B, 431.8 × 279.4 mm, landscape | ISO A3, 420 × 297 mm, landscape |
| Border inset | 10 mm all sides | 10 mm all sides (20 mm binding edge optional, not used) |
| Title block | Vertical strip on the right edge, 64 mm wide | Same |
| Drawing area | Inside the border, left of the title block, 6 mm clear margin | Same |

Linework, text, symbols, and the title block are authored in paper
millimetres. Model geometry is mapped onto the sheet by the plot scale. Viewer
zoom never changes paper sizes, pen widths, or the stated scale.

## Scales

Pick the largest standard scale at which the view, plus its annotation band,
fits the drawing area.

- Imperial ladder (architect's scales): 1" = 1'-0" (1:12), 3/4" (1:16),
  1/2" (1:24), 3/8" (1:32), 1/4" (1:48), 3/16" (1:64), 1/8" (1:96),
  3/32" (1:128), 1/16" (1:192), 1/32" (1:384).
- Metric ladder: 1:20, 1:25, 1:50, 1:100, 1:200, 1:500, 1:1000.

The annotation band reserves 24 mm of paper around the geometry for
dimensions, datums, and tags.

The scale is printed in the title block and under the view title, and a
graphic scale bar is drawn, because an SVG may be printed at any size.

## Pens (line widths, paper mm)

Plotted linework is black. Weight, not colour, carries the hierarchy.

| Pen | Imperial | Metric | Used for |
|---|---|---|---|
| `cut` | 0.70 | 0.70 | Elements cut by the view plane: walls in plan, walls, slabs and roof in section |
| `profile` | 0.50 | 0.50 | Elevation outline, ground line companion, stair cut edge |
| `medium` | 0.35 | 0.35 | Openings, door leaves, stairs, elements beyond the cut close to it |
| `thin` | 0.25 | 0.25 | Fixtures, equipment, treads, window glazing, far elements |
| `fine` | 0.18 | 0.13 | Dimensions, extension lines, leaders, datums, door swing arcs, hatch, material layer boundaries |
| `ground` | 1.00 | 1.00 | Ground line in elevation and section |

## Line types (dash lengths in paper mm)

| Type | Pattern | Used for |
|---|---|---|
| Continuous | solid | Visible edges |
| Hidden | 3, 1.5 | Overhead elements in plan (roof overhang, overhead doors) |
| Centre / datum | 8, 1.5, 1.5, 1.5 | Level datums, centre lines |
| Section cut line | 12, 2, 2, 2 at `fine` | Section line between the section marks on plans |

## Lettering

Drafting lettering is uppercase sans-serif, set in
`"Helvetica Neue", Helvetica, Arial, sans-serif`. Width is estimated as
0.62 × height per character for layout.

| Role | Imperial | Metric |
|---|---|---|
| Notes, dimensions, datums | 2.4 mm (3/32") | 2.5 mm |
| Room names | 3.2 mm (1/8") | 3.5 mm |
| View titles | 4.8 mm (3/16") | 5.0 mm |
| Sheet number | 8.0 mm | 7.0 mm |

Text never sits on linework. Labels that cannot be placed at their anchor move
to the next candidate position; if they leave their element they get a `fine`
leader back to the anchor.

## Dimensions

- Dimension strings sit outside the building footprint. The authored
  `offsetMm` sets the distance; the renderer chooses the side away from the
  footprint centre and enforces at least 8 mm of paper clearance.
- Extension lines start 1.5 mm from the measured point and run 2 mm past the
  dimension line.
- Text sits 1 mm above the dimension line, reading from the bottom or the
  right edge of the sheet.
- Imperial terminators: architectural ticks, 2.5 mm, 45°, `medium` pen.
  Values in feet and inches to the nearest 1/8".
- Metric terminators: filled arrowheads, 2.5 mm long, 15° half angle. Values
  in millimetres without the unit symbol (ISO building practice).

## Colour

Architectural linework plots black (`#1b1b1b`) on white paper (`#ffffff`).
Cut walls in plan and section are filled with dark poché (`#4d4d4d`) unless
the sheet carries material detail (see Materials).

Colour is reserved for the systems overlay, where discipline is the
information. The architectural background is screened to grey (`#9a9a9a`
lines, `#e2e2e2` poché) so the systems read first. Screened lettering stays at
`#666666` so it keeps 4.5:1 contrast on white paper.

| Discipline | Colour | Line type |
|---|---|---|
| Plumbing | `#1d5fa8` blue | Continuous |
| Electrical | `#9c2f8f` magenta | Dash-dot 6, 1.5, 1, 1.5 |
| Mechanical | `#1f7a4d` green | Dashed 5, 2 |

The viewer's interface accent must never reuse a discipline colour.

## Materials

Cut elements are hatched by material, following the conventions below. They
are informed by ISO 128-3 (general principles for hatching cut areas: thin
lines, 45° to the outline, a key on the sheet) and common European building
practice in DIN 1356-1 for the metric profile, and by the NCS Uniform Drawing
System material indications and *Architectural Graphic Standards* for the
imperial profile. They are not a claim of conformance.

**When materials are drawn.** A sheet carries material detail when the model
has a `materials` catalog, the sheet is a floor plan or a building section,
and the plot scale is 1:100 (1/8" = 1'-0") or larger. Elevations, systems
sheets, and sheets at smaller scales keep solid poché, as both profiles reduce
walls to solid fill at small scales. Elements without a material on a
material sheet stay in poché and appear in the key as "Material not
specified".

**Material key.** Every sheet with material detail lists, in the title block
under "Materials", a 12 x 4 mm swatch and the catalog name of each material it
draws, in drawing order. Nothing appears in the key that the sheet does not
draw.

**Hatching.** Hatch linework uses the `fine` pen and is authored in paper
millimetres, so spacing is the same at every scale. 45° means rising to the
right on the sheet.

| Category | Imperial (NCS-informed) | Metric (ISO/DIN-informed) |
|---|---|---|
| `earth` | Groups of three short lines, alternating direction, at 45° | Same |
| `gravel` | Small open pebbles of varying size | Same |
| `sand` | Fine dense stipple | Same |
| `concrete` | Stipple with small open triangles (aggregate) | Same |
| `reinforced-concrete` | Same as concrete; reinforcement is a note, not a hatch | Concrete stipple plus 45° lines at 2 mm |
| `concrete-masonry` | 45° lines at 2 mm with sparse stipple | Same |
| `brick` | 45° lines at 1 mm | Same |
| `steel` | Solid black | Solid black (thin-section blackening) |
| `wood-framing` | Along a layer: wavy grain lines. A member cut across: an X corner to corner | Along a layer: wavy grain lines. A member cut across: growth rings |
| `engineered-wood` | Laminations parallel to the long side | Same |
| `insulation-batt` | Continuous wave touching both faces | Same |
| `insulation-rigid` | Zig-zag X between the faces | 45° crosshatch at 1.2 mm |
| `gypsum` | Sparse fine stipple | Same |
| `generic` | Solid poché | Same |

A region thinner than 0.6 mm on paper is outlined but not hatched, except
steel, which stays solid. Directional symbols (grain, batt, zig-zag) run along
the longer side of their region.

**Assemblies.** `layers` on a wall run from its left face to its right face,
looking from start to end; on a slab, from top to bottom. Each layer is its own
region with a `fine` boundary line, inside the `cut` outline of the whole
element. In plan, where two walls meet at their ends (within half the other
wall's thickness), both are mitered on the line through their inner and outer
face intersections; collinear walls butt square. A wall that ends part way
along another wall stops at that wall's face.

**Structural members.** A column the plan cut plane passes through is drawn
cut, in its profile (rectangle, wide-flange I, or hollow section), with the
`cut` pen. Beams on a plan's level show their two edges as hidden lines when
they are above the cut plane. In section, a beam crossing the plane at more
than about 45° is drawn cut, in profile; members cut along their length, and
members beyond the plane, are drawn in outline (with flange lines for
wide-flange beams), as a member seen in elevation.

**Headers.** In section, a header occupies its wall layer from the opening
head up by its depth, replacing that layer, and extends past each jamb by its
bearing. Sawn and built-up lumber draw one end-grain symbol per ply; engineered
lumber draws laminations; a steel beam header draws its I profile; a steel
angle lintel draws an L at the inner edge of its layer and leaves the layer it
carries in place; concrete lintels and bond beams add two reinforcing bars
near the bottom.

**Site.** With `site.groundMaterialId`, sections hatch earth below the ground
line down to 300 mm under the deepest cut element (at least 600 mm), with no
outline. The earth is left out when including it would drop the sheet below
1:100, so it never costs a section its material detail. Foundations and site
surfaces are cut like slabs. In plan, surfaces
on the level are hatched with a `thin` outline; higher surfaces draw over lower
ones, and a surface wholly under a higher one is not drawn.

## Symbols

- **North arrow** (plans): 14 mm circle, arrow rotated by `trueNorthDeg`
  clockwise from sheet up, lettered `N`. A note reads "Project north is sheet
  up" when `trueNorthDeg` is not 0.
- **Graphic scale bar**: four alternating segments with a round model length
  per segment, labelled at 0 and each segment end.
- **View title**: 10 mm circle with the view number, the title in view-title
  lettering, a `profile` rule beneath, and the scale below the rule.
- **Room tag** (plans): room name in room lettering, area beneath in note
  lettering (`SF` imperial, `m²` metric).
- **Doors** (plans): leaf drawn open at 90° in `medium`, swing arc in `fine`.
  `left`/`right` place the hinge at the start or end of the opening along the
  wall; the leaf swings to the interior side. `double` draws two leaves,
  `sliding` draws two offset panels, `none` draws the gap only.
- **Overhead doors** (plans): opening gap with the door panel shown overhead
  by a hidden line across the opening.
- **Windows** (plans): jamb lines plus two glazing lines across the wall at
  `thin`.
- **Stairs** (plans): treads in `thin`, outline in `medium`, a diagonal break
  line where the cut plane (1200 mm above the floor) crosses the run,
  treads above the break hidden, and a direction arrow labelled `UP` from the
  lower level or `DN` on the level above.
- **Section mark** (plans): section cut line between two 10 mm bubbles at its
  ends; each bubble holds the section letter over the sheet number, and a
  filled triangle points in the look direction.
- **Level datum** (elevations, sections): centre line across the drawing with
  a 4 mm quartered circle at the right end, the level name above and its
  elevation below.

## Title Block

Fields, top to bottom. Every field comes from the model; nothing is invented.

1. Project name and project ID.
2. Location from `project.jurisdiction`.
3. Status: `CONCEPT - NOT FOR CONSTRUCTION`.
4. Drawing title (for example `GROUND FLOOR PLAN`).
5. Scale, profile, and units.
6. Legend (systems sheets only) or material key (sheets with material detail).
7. Date: `UNDATED CONCEPT`. The renderer never stamps the current date.
8. Sheet number.

There are no revision, approval, seal, or signature fields.

## Sheet Numbers

| Sheet | Number |
|---|---|
| Floor plans | `A-101`, `A-102`, … in level order |
| Exterior elevations | `A-201` north, `A-202` east, `A-203` south, `A-204` west |
| Building sections | `A-301`, `A-302`, … in model order |
| Systems coordination | `M-101`, `M-102`, … in level order |
