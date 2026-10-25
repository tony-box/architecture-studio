# Drafting Standard

Every drawing the studio produces (plans, elevations, sections, systems
overlays, and the exported SVG set) follows one of two convention profiles.
The renderer in `assets/studio-template.html` implements this file; when the
two disagree, fix the renderer.

The profile is selected by `project.coordinates.displayUnits`:

| `displayUnits` | Profile | Informed by |
|---|---|---|
| `feet-inches` | Imperial | US National CAD Standard (NCS) plotting and annotation conventions; NCS Uniform Drawing System discipline designators for the site plan |
| `metric` | Metric | ISO 128 (line types and widths), ISO 129 (dimensioning), ISO 5455 (scales); ISO 11091 (landscape drawing practice) for the site plan |

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

- Elevations share one scale: the largest at which every face fits, so the
  four faces compare directly. Each face is still centred on its own sheet.
- The building sets the scale of elevations and sections. An elevation's
  extent is the walls plus the roof overhang, from the lower of zero and the
  site datum to the top of walls, eave, or ridge. A section's extent is the
  building elements it cuts or sees beyond (walls, slabs, foundations,
  stairs, beams, columns, roof) plus 3000 mm of site each side along the cut,
  no wider than everything the section draws; vertically it is the
  building, the ground inside that span, the site datum, and any earth band
  (Materials, Site). Plants, ground,
  and site surfaces beyond that frame are clipped at the drawing's edge
  instead of shrinking the drawing: at the sides of the frame, so they stay
  clear of the dimensions to the left and the datum labels to the right, and
  at the top and bottom of the drawing area. A section that meets no building
  element spans the whole cut line and everything on it.

- Imperial ladder (architect's scales): 1" = 1'-0" (1:12), 3/4" (1:16),
  1/2" (1:24), 3/8" (1:32), 1/4" (1:48), 3/16" (1:64), 1/8" (1:96),
  3/32" (1:128), 1/16" (1:192), 1/32" (1:384).
- Metric ladder: 1:20, 1:25, 1:50, 1:100, 1:200, 1:500, 1:1000.
- Site plan (L-101) ladders. Imperial (engineer's scales): 1" = 10' (1:120),
  20' (1:240), 30' (1:360), 40' (1:480), 50' (1:600), 60' (1:720), 100'
  (1:1200). Metric: 1:100, 1:200, 1:250, 1:500, 1:1000.

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
| Property line (phantom) | 12, 1.5, 2, 1.5, 2, 1.5 at `profile` | Lot boundary on the site plan |
| Setback | 4, 1.5 at `thin` | Setback lines on the site plan |
| Limit of grading | 6, 1.5, 1, 1.5 at `thin` | Grading limit on the site plan |
| Existing contour | 2, 1 at `fine` (index contour `thin`) | Existing ground; existing grade in sections uses 3, 1.5 at `fine` |
| Proposed contour | solid at `thin` (index contour `medium`) | Finished grade |
| Existing plant | 1, 0.6 | Canopies of existing plants to remain or to remove |

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
  right edge of the sheet, on a paper backing so hatching and linework never
  run through it. It is centred on the line when that spot is clear of walls,
  openings, hard surfaces, and other lettering. Otherwise it slides along the
  line (to 35%, 65%, 20%, then 80% of its length, staying clear of the
  terminators), and if no spot is clear the whole string steps 4 mm farther
  out, up to 16 mm (studio rule). A dimension with no clear spot keeps the
  centre and raises a `dimension.placement` warning.
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

Cut elements are hatched by material. The conventions below are informed by
the sources in "Material sources" and are not a claim of conformance. Where a
rule is the studio's own choice rather than a published convention, it is
marked as a studio rule. Tests check that the renderer follows this section;
they cannot check that this section matches the named standards.

**When materials are drawn (studio rule).** A sheet carries material detail
when the model has a `materials` catalog, the sheet is a floor plan or a
building section, and the plot scale is at or larger than the profile's
1:100-class scale: 1/8" = 1'-0" (1:96) imperial, 1:100 metric. This is a
plotting policy: DIN 1356-1 practice reserves detailed hatching for 1:100 and
larger (secondary source), and NCS has no equivalent single threshold.
Elevations, systems sheets, and smaller scales keep solid poché. Elements
without a material on a material sheet stay in poché and appear in the key as
"Material not specified".

**Material key.** Every sheet with material detail lists, in the title block
under "Materials", a 12 x 4 mm swatch and the catalog name of each material it
draws, in drawing order. Nothing appears in the key that the sheet does not
draw. When the title block has no room for an entry, the key ends with "+N
drawn but not keyed" and the sheet raises a `material.key-overflow` warning
naming the missing materials; it never drops them silently.

**Hatching.** Hatch linework uses the `fine` pen and is authored in paper
millimetres, so spacing is the same at every scale. 45° means rising to the
right on the sheet.

| Category | Imperial (NCS-informed) | Metric (ISO/DIN-informed) | Basis |
|---|---|---|---|
| `earth` | Groups of three short lines, alternating direction, at 45° | Same | B, C |
| `gravel` | Small open pebbles of varying size | Same | B, C |
| `sand` | Fine dense stipple | Same | B, C |
| `concrete` | Stipple with small open triangles (aggregate) | Same | B, C |
| `reinforced-concrete` | Same as concrete; reinforcement is a note, not a hatch | Concrete stipple plus 45° lines at 2 mm | B (metric), C (imperial) |
| `concrete-masonry` | 45° lines at 2 mm with sparse stipple | Same | D |
| `brick` | 45° lines at 1 mm | Same | A, B |
| `steel` | Solid black | Solid black (thin-section blackening) | A, C |
| `wood-framing` | Along a layer: wavy grain lines. A member cut across: an X corner to corner | Along a layer: wavy grain lines. A member cut across: growth rings | B (metric), C (imperial) |
| `engineered-wood` | Laminations parallel to the long side | Same | D |
| `insulation-batt` | Continuous wave touching both faces | Same | B, C |
| `insulation-rigid` | Zig-zag X between the faces | 45° crosshatch at 1.2 mm | B (metric), C (imperial) |
| `gypsum` | Sparse fine stipple | Same | C |
| `generic` | Solid poché | Same | D |
| `lawn` | Grass tufts of three short strokes on a staggered 5 mm grid | Same | F, D |
| `mulch` | Short random strokes with dots (bark) | Same | D |
| `asphalt` | Dense fine stipple, heavier than sand | Same | D |
| `unit-pavers` | Running bond, 4 x 2 mm on paper | Same | D |
| `flagstone` | Irregular joint network (crazy paving) | Same | D |
| `water` | Short horizontal ripples | Same | F, D |
| `decking` | Parallel board lines 1.4 mm apart | Same | D |

Landscape categories (`lawn` through `decking`) describe ground cover, not
building assemblies; using one in a wall layer, header, beam, or column raises
the `material.category-use` advisory. Their tiles are paper-sized and do not
show true paver or board sizes.

A region thinner than 0.6 mm on paper is outlined but not hatched, except
steel, which stays solid (studio rule). Directional symbols (grain, batt,
zig-zag) run along the longer side of their region; on a non-rectangular
region they are clipped to its outline.

### Material sources

| Key | Source | Kind | Confidence |
|---|---|---|---|
| A | ISO 128-3:2022, *Technical product documentation, General principles of representation, Part 3: Views, sections and cuts*. Thin 45° hatching of cut areas, blackening of thin sections, and a key for hatches that encode material. Catalogue scope only; the text was not reviewed. | Primary (scope only) | Medium |
| B | DIN 1356-1:2024-04 hatch conventions as summarised by cad-markt.de, "DIN 1356-1 Schraffurdarstellungen von Baumaterialien", accessed 2026-10-19. The standard itself was not reviewed. | Secondary | Low to medium |
| C | US practice as summarised from *Architectural Graphic Standards* and the NCS Uniform Drawing System, Module 6 (Symbols), whose content listing is at nationalcadstandard.org/ncs6/content.php (accessed 2026-10-19). The symbol sheets themselves were not reviewed. | Secondary | Low to medium |
| D | Studio convention: no source located; chosen to keep categories distinguishable. | Studio rule | n/a |
| E | ISO 11091:1994, *Construction drawings, Landscape drawing practice*. Catalogue title and number only; the text was not reviewed, and the metric site plan follows none of its symbols specifically. | Primary (title only) | Low |
| F | US and European landscape drafting practice as generally taught (grass tufts, water ripples, scalloped deciduous and spiked evergreen canopies, plant keys with a schedule), and the NCS Uniform Drawing System discipline designators (L for landscape). From general knowledge; no document was reviewed for this release. | Secondary (unreviewed) | Low |

Before relying on a profile difference (reinforced concrete, rigid insulation,
timber end grain) in a handoff, confirm it against the licensed standard or
the receiving office's own material legend.

**Assemblies.** `layers` on a wall follow its `layerOrder`: `left-to-right`
(the default) lists them from the wall's left face looking from start to end;
`interior-to-exterior` starts at the face toward the centre of the level's
walls, so reversing a wall's direction does not flip its assembly. Slab layers
run from top to bottom. Every layer has an `id`, stable within its wall or
slab, that headers reference. Each layer is its own region with a `fine`
boundary line, inside the `cut` outline of the whole element. In plan, where
two walls meet at their ends (within half the other wall's thickness), both
are mitered on the line through their inner and outer face intersections;
collinear walls butt square. A wall that ends part way along another wall
stops at that wall's face.

**Structural members (studio rule).** A column the plan cut plane passes
through is drawn cut, in its profile (rectangle, wide-flange I, or hollow
section), with the `cut` pen. Beams on a plan's level show their two edges as
hidden lines when they are above the cut plane. In section, a beam crossing the
plane at more than about 45° is drawn cut, in profile; members cut along their
length, and members beyond the plane, are drawn in outline (with flange lines
for wide-flange beams), as a member seen in elevation.

**Headers.** A header sits in the wall layer its `layerId` names (or the whole
wall when the wall has no layers). Its kind sets only its shape; its material
comes from `materialId`, and without one it is unspecified and draws in poché.
In section, a header occupies its layer from the opening head up by its depth,
replacing that layer, and extends past each jamb by its bearing. Sawn and
built-up lumber draw one end-grain symbol per ply; engineered lumber draws
laminations; a steel beam header draws its I profile; a steel angle lintel
draws an L whose vertical leg sits on the layer face named by `face` (`inner`,
toward the wall centre, by default, or `outer`), and leaves the layer it
carries in place. Two angles on different faces may share a layer; any other
header has its layer to itself. Reinforcement is never drawn: the model has no
bar sizes, counts, or cover.

**Site.** With `site.groundMaterialId`, sections hatch earth below the ground
line down to 300 mm under the deepest cut element (at least 600 mm), with no
outline (studio rule). The earth is left out when including it would drop the
sheet below the material detail scale. With terrain, the earth follows the
ground profile. Foundations and site surfaces may be any simple polygon,
including curves; sections cut every interval the plane crosses. In plan,
surfaces on the level are hatched with a `thin` outline; surfaces that follow
grade draw first, then flat surfaces from low to high, and a flat surface
wholly inside a higher flat one is not drawn.

**Curved elements.** Curved boundaries and arc walls follow
`coordinate-contract.md` (Curves, Arc Walls). Plan outlines are exact SVG arcs
and curves. An arc wall's layers are concentric bands; directional symbols
(batt, grain, zig-zag, laminations) follow the arc. Windows draw concentric
glazing lines, and a door leaf swings radially from its hinge and closes on the
chord to the far jamb. A radius note (`R 10'-10 3/4"`, `R 3270`) sits outside
the arc at the first clear point along it, never on a section line. In
elevation, an arc wall facing the viewer shows vertical lines where it meets
the walls at its ends, and its openings project at their true jamb positions,
so they read foreshortened.

## Site and Landscape

A model draws a site plan, `L-101`, when it records site content: a property
line, setbacks, a grading limit, contours, spot elevations, or plantings. The
ground material alone is not site content. The sheet is informed by ISO 11091
(metric) and NCS Uniform Drawing System practice for L sheets (imperial); it is
not a claim of conformance (sources E and F above).

**Framing.** L-101 frames the whole site: the property line, grading limit,
contours, plantings (with their canopies), and the building. It uses the site
ladders (Scales) and reserves an 88 mm column on the right of the drawing area
for the plant schedule. When a model has site content, floor plans frame on
the building plus 2000 mm instead; site surfaces and section lines are cropped
at that frame, and the site plan shows the rest. Those floor plans draw only
hard surfaces (walks, patios, decks, drives, gravel); lawn, mulch beds, and
water appear only on the site plan. A surface's `onFloorPlans` overrides this
either way.

**Hatching (studio rule).** Site surfaces on L-101 are hatched at every site
scale, because the tiles are drawn in paper millimetres and stay legible.
Building materials on the other sheets keep the material detail scale.

**Building.** The roof outline (with overhang) over the lowest level's slabs,
in light poché (`#e2e2e2`) with a `profile` outline, labelled with the finished
floor: `FF EL. 0.00'` imperial, `FFL +0.000` metric.

**Property line.** Phantom line at `profile`. Each straight edge is labelled
with its quadrant bearing from true north (`N 12°00'00" W`) outside the lot and
its length inside: decimal feet imperial (`100.00'`), metres metric
(`30.00 m`). Arc edges carry their radius and arc length (`R=250.90'`,
`L=60.14'`). Text reads from the bottom or the right of the sheet.

**Setbacks.** Each setback offsets its property line edge inward by its
distance: a straight edge becomes a line clipped to the lot, an arc edge a
concentric arc. Labelled with the distance and label (`20.00' FRONT
SETBACK`).

**Grading.** The limit of grading is labelled `LIMIT OF GRADING` at the first
clear edge from the top of the sheet. Contours are labelled with their
elevation (feet imperial, metres metric) near their middle, on a paper ground
so the line reads as broken under the label; index contours are bold. Spot
elevations are a cross with their value; existing values are italic and
prefixed `EX`.

**Plants.** Canopies are drawn at `canopyDiameterMm`, or the plant's mature
spread, with a minimum paper size so small plants stay visible:

| Kind | Proposed | Existing to remain | To remove |
|---|---|---|---|
| Deciduous tree | Scalloped canopy, `thin`, solid trunk dot | Dashed scalloped canopy, open trunk circle | Dashed canopy crossed out |
| Evergreen tree | Spiked canopy, `thin` | Dashed spiked canopy, open trunk circle | Dashed canopy crossed out |
| Shrub | Small scalloped circle, `fine`, centre dot | Dashed | Dashed, crossed out |
| Groundcover, perennial, grass (single) | Circle, `fine`, centre dot | Dashed | Dashed, crossed out |

Massed plantings are their boundary with a texture of small circles. Each
planting carries a tag with its plant key (`AR`), `EX AR` when existing,
`AR REMOVE` when to be removed, and `48 PT` (quantity and key) for a massed
planting, placed clear of other annotation with a `fine` leader when it sits
away from its plant.

**Plant schedule.** Columns: symbol, key, botanical name (italic) over common
name and status, size, quantity. One row per plant and status, ordered trees,
shrubs, groundcover, then by key. Quantities are derived: one per single
planting, and `ceil(area / (spacing² × 0.866))` for a massed planting
(triangular spacing). Rows that do not fit end the table with "+N rows not
shown" and raise a `site.schedule-overflow` warning; rows are never dropped
silently.

**Hidden layers (viewer only).** The viewer can hide trees, shrubs and
groundcover (including massed plantings), surfaces, grading (contours, spot
elevations, limit of grading), and property lines with setbacks. Hidden items
also leave the plant schedule and the material key, so the sheet never lists
what it does not draw. The scale, framing, and schedule column stay as they
are, and the exported L-101 always draws every layer.

**Plants in other views.** Elevations show plants up to 9 m in front of the
face, standing on the elevation ground line, and sections show plants up to
9 m beyond the cut, on the ground: trunk lines and a canopy outline (a lobed
ellipse, or a triangle for evergreens) at `thin`, with no fill, so the building
behind stays legible. Plants marked for removal are left out. Both views use
the plant's `heightMm` or mature height. Plants never set the scale: a tall
tree is clipped at the drawing's edge (Scales).

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

## Systems Symbols

Systems sheets (M-1xx) draw each device as a symbol in its system's
discipline colour (see Colour). The symbol follows the node's `kind`; the
vocabulary is the one in `mep-placement-guide.md`, Modeling Devices. Kinds
not listed here, such as `panel`, `circuit-end`, `fixture-connection`, and
`vertical-stack`, keep the plain 2.2 mm node dot.

**Size and pen.** Symbols are a fixed paper size at every scale: a 2.8 mm
circle for most devices, 3.4 mm for two-letter lettered circles, 3.6 mm for
ceiling lights, at the `thin` pen. Tags are 1.8 mm bold lettering beyond the
symbol. Floor plans (A-1xx) draw no device symbols.

**Mounting.** A `wall` or `any` device whose position lies within 300 mm of a
wall face on its level sits on that wall: the symbol grows from the device
position into the room, square to the wall, and follows arc walls. A `wall`
device with no wall in reach is drawn free-standing. `ceiling` and `floor`
devices are centred on their position. Place wall devices at the finished
face (`mep-placement-guide.md`).

| Kind | Symbol | Tag | Mount |
|---|---|---|---|
| `receptacle` | Circle with two parallel lines square to the wall | | wall |
| `receptacle-gfci` | Duplex receptacle | `GFCI` | wall |
| `receptacle-weather` | Duplex receptacle | `WP` | wall |
| `receptacle-dedicated` | Duplex receptacle | `DED` | wall |
| `receptacle-240v` | Circle, the half toward the wall filled | `240V` | wall |
| `floor-receptacle` | Duplex receptacle inside a square | | floor |
| `future-receptacle` | Duplex receptacle, dashed | `FUT` | any |
| `switch`, `switch-3way`, `switch-4way`, `dimmer` | Letter `S`, subscript `3`, `4`, or `D` | | wall |
| `light-ceiling` | Circle with a cross through it | | ceiling |
| `light-recessed`, `light-pendant` | Circle lettered `R` or `P` | | ceiling |
| `light-wall` | Crossed circle on a stem from the wall | | wall |
| `light-exterior` | Wall light | `WP` | wall |
| `light-undercabinet` | Strip along the wall | `UC` | wall |
| `ceiling-fan` | Filled hub with four blades | | ceiling |
| `smoke-alarm`, `co-alarm`, `smoke-co-alarm` | Circle lettered `SD`, `CO`, or `SC` | | ceiling |
| `junction-box` | Circle lettered `J` | | any |
| `thermostat` | Circle lettered `T` | | wall |
| `supply-register` | Rectangle with both diagonals | | any |
| `return-grille` | Rectangle with one diagonal | | any |
| `transfer-grille` | Return grille | `TG` | any |
| `exhaust-fan` | Square with an inscribed circle | `EF` | ceiling |
| `range-hood` | Dashed (overhead) rectangle lettered `RH` | | any |
| `dryer-exhaust` | Circle lettered `DV` | | any |
| `exhaust-termination` | Arrow out of the wall | `EX` | wall |
| `outdoor-air-intake` | Arrow into the wall | `OA` | wall |
| `ductless-head` | Strip along the wall | `DH` | wall |
| `cleanout` | Circle with a filled centre | `CO` | any |
| `floor-drain` | Circle with a cross | `FD` | floor |
| `hose-bibb` | Valve on a stem through the wall | `HB` | wall |
| `main-shutoff`, `gas-shutoff` | Valve: two triangles tip to tip | `MAIN`, `G` | any |
| `fixture-shutoff` | Valve | | any |
| `vent-terminal` | Small circle | `VTR` | ceiling |

`SD` (smoke alarm, lettered circle) and `S` subscript `D` (dimmer, no circle)
differ by the circle; `CO` lettered in a circle is a CO alarm, and a `CO` tag
beside a dotted circle is a cleanout. The symbol key spells each one out.

**Equipment tags.** On systems sheets, equipment of these kinds carries a tag
in its discipline colour, inside the outline when it fits clear of system
points and otherwise on the first clear side: `electrical-panel` `EP` (with
the panelboard symbol, the outline half filled along a diagonal), `meter` `M`,
`service-disconnect` `DS`, `ev-charger` `EV`, `water-heater` `WH`,
`sump-pump` `SP`, `furnace` `F`, `boiler` `B`, `air-handler` `AHU`,
`heat-pump` `HP`, `outdoor-unit` `CU`, `erv` `ERV`. A tag shows only when its
discipline is shown.

**Symbol key.** The title block lists, under Symbols, every device symbol and
equipment tag the sheet draws and nothing else, in the table's order, with
icons at 80%. When one column cannot hold them it wraps into two. Rows that
still do not fit are counted on the sheet and raise `symbol.key-overflow`.

**3D.** Each device with a symbol shows as a 90 mm marker in its discipline
colour at the same coordinates, so plan and 3D agree.

**Source.** The shapes follow common US residential drafting practice as
summarised from *Architectural Graphic Standards* and the NCS Uniform Drawing
System, Module 6 (Symbols) (source C under Materials: the symbol sheets
themselves were not reviewed). Confidence is medium for the receptacle,
switch, ceiling light, supply, and return symbols, which are near universal,
and low for the tags and the 240 V, floor, and ductless shapes, which vary by
office. The 300 mm mounting reach, the paper sizes, and the tags are studio
rules. A receiving office may substitute its own symbol legend.

## Title Block

Fields, top to bottom. Every field comes from the model; nothing is invented.

1. Project name and project ID.
2. Location from `project.jurisdiction`.
3. Status: `CONCEPT - NOT FOR CONSTRUCTION`.
4. Drawing title (for example `GROUND FLOOR PLAN`).
5. Scale, profile, and units.
6. Legend and symbol key (systems sheets only) or material key (sheets with
   material detail, and the site plan when it draws site surfaces).
7. Date: `UNDATED CONCEPT`. The renderer never stamps the current date.
8. Sheet number.

There are no revision, approval, seal, or signature fields.

## Sheet Numbers

| Sheet | Number |
|---|---|
| Site plan (models with site content) | `L-101` |
| Floor plans | `A-101`, `A-102`, … in level order |
| Exterior elevations | `A-201` north, `A-202` east, `A-203` south, `A-204` west |
| Building sections | `A-301`, `A-302`, … in model order |
| Systems coordination | `M-101`, `M-102`, … in level order |
