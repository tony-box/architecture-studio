---
name: Architecture Studio viewer
description: The working interface around the drafted sheets, in the voice of a drafting room.
colors:
  paper: "#f3f0e8"
  sheet: "#fbfaf6"
  panel: "#ebe7dd"
  ink: "#1f2420"
  muted: "#4f5650"
  line: "#d3d0c6"
  control-line: "#767b75"
  accent: "#b64b34"
  canvas: "#dcdad3"
  error: "#a22e2e"
  warning: "#7d5208"
  advisory: "#3f5660"
  disclaimer-bg: "#f7edda"
  disclaimer-ink: "#5a4420"
typography:
  heading:
    fontFamily: "Iowan Old Style, Palatino Linotype, Georgia, serif"
    fontWeight: 600
    lineHeight: 1.15
  body:
    fontFamily: "Aptos, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  meta:
    fontFamily: "Aptos, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
  data:
    fontFamily: "IBM Plex Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 600
rounded:
  control: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "20px"
components:
  button:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.control}"
    height: "36px"
  button-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
  tab:
    textColor: "{colors.muted}"
    height: "52px"
  tab-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  inspector:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    padding: "20px"
---

# Architecture Studio viewer

This file governs the interface around the drawings: masthead, view tabs,
toolbar, inspector, and the Code review, Assumptions, and Sources pages. The drawing
sheets themselves are governed only by `drafting-standard.md`; nothing here
applies inside a sheet, including its title block.

## Overview

North star: **the drafting room**. A quiet working surface of warm paper,
graphite ink, and one terracotta mark, with the sheet as the thing on the
table. The interface is an Operate surface: people come here to inspect a
building model, compare views, and hand it off. Familiar controls beat novel
ones; the sheet is always the focal point.

Design read: a technical review tool for owners and their design team, in a
drafting-room visual language, dial ENERGY 1 / RHYTHM 1 / MOTION 1. The calm
dials are deliberate: the drawings carry the visual interest, and the chrome
stays out of their way.

## Colors

- `paper`, `sheet`, and `panel` are three warm neutrals that separate the
  application background, raised surfaces, and the inspector.
- `ink` carries all text and the primary action. `muted` is secondary text and
  passes 4.5:1 on every neutral surface.
- `control-line` outlines every control at 3:1 or better against `paper` and
  `sheet`; `line` is only for passive dividers.
- `accent` (terracotta) marks exactly two things: the selected tab and the
  selected or focused drawing entity (on the Sources view, the calibration
  being drawn and the centre crosshair). It is never used for text and never
  reused for data.
- Discipline colours (plumbing blue, electrical magenta, mechanical green) are
  drawing data owned by `drafting-standard.md`. The interface only repeats them
  as swatches on the system toggles.
- `error`, `warning`, and `advisory` colour the severity word of a finding; the
  word is always present, so meaning never depends on colour.

## Typography

One sans family for every control, label, and paragraph. The serif appears
only in headings (project name, inspector heading, page headings), which keeps
the drafting-room voice without turning labels into display type. Monospace is
reserved for measured values in the inspector. The scale is three steps:
12px meta, 14px body and controls, serif headings from 18px up. Labels are
sentence case; uppercase belongs to the drawing lettering, not the interface.

## Layout

- Desktop: masthead with project name and a horizontal tablist; below it the
  stage (toolbar plus canvas) and a 320px inspector on the right.
- At 900px and below the masthead stacks, the tablist scrolls horizontally,
  the stage takes 62vh, and the inspector follows below. Controls grow to
  44px. Coarse pointers get 44px controls at any width.
- The sheet sits on a darker `canvas` so the paper edge reads. It fits the
  stage on load and on view change; zoom and pan never change the drawing.

## Elevation & Depth

Flat. Surfaces separate by tone and 1px dividers. The only shadow is the
offset, softly blurred one under the drawing sheet, which says "paper on a
table".

## Shapes

4px radius on controls and finding cards; tabs and panels are square.

## Components

- **Tabs**: real `tablist` semantics, roving tabindex, arrow keys, Home and
  End. The selected tab gets a 3px accent underline and the paper background.
  The drawing tabs (Plans, Elevations, Sections, Systems, and Site when the
  model has site content) lead on the left; a hidden Site tab is skipped by the
  arrow keys, Home, and End, and `?view=site` falls back to Plans. On the Site
  view the toolbar shows one pressed toggle per site category the model draws
  (Trees, Shrubs and groundcover, Surfaces, Grading, Property lines), styled
  like the system toggles; the hidden set is kept in `?hide=`.
  3D model, Code review, and Assumptions sit together at the right edge behind a
  divider, because they are not drawing sheets. A Sources tab joins them, last,
  when `sources/sources.json` lists images or cannot be read, and always when
  the page can write (below), so the first image can be added there.
- **Toolbar**: one shared toolbar for every view; only the controls for the
  active view are shown. The view's sheet dropdown (Level, Face, or Section)
  comes first. Related buttons are fused into one segmented control (zoom,
  camera mode, system toggles) so each group reads as a single tool. The
  primary "Share" (the tray-with-up-arrow share icon and its name) sits at
  the far right on every view, including a page whose model is blocked, so
  a broken project can still move. It is a menu button (`aria-haspopup`,
  `aria-expanded`) that opens a small menu below it, right-aligned, and
  left-aligned on narrow screens. Each item has a name and a one-line note:
  "Export project" ("Back up, restore, or share with another Architecture
  Studio user") and "Download drawings" ("Only the drawing sheets, as
  SVG."). Download drawings draws every sheet from the loaded model with
  the same code as `export-drawings.mjs`, so it works on any page and never
  needs an `exports/` folder, and packages the SVG sheets and nothing else
  in a `<project-id>-drawings/` folder; the manifest, approvals, and handoff
  notes travel with Export project. Download drawings is left out while the
  model is blocked. Export
  project packages the project files when `serve.mjs` lists them. Otherwise
  it rebuilds a reopenable project from the page: `index.html` from the page
  as loaded (embedded data emptied), `architecture-studio.json` from the
  `architecture-studio-version` meta, the model, code findings, and
  approvals. With a valid model, `exports/` is drawn fresh in both cases,
  byte for byte what `export-drawings.mjs` writes. Enter, Space, or
  ArrowDown opens the menu on its first item and ArrowUp on its last; the
  arrows wrap, Home and End jump; Escape closes it back onto Share; Tab or a
  press elsewhere closes it. Choosing an item closes the menu. Both items
  then open the browser's save dialog (`showSaveFilePicker`, in Chrome and
  Edge) before packaging anything, while the click still counts as a user
  gesture, suggesting `<project-id>-project.zip` or
  `<project-id>-drawings.zip`. Without the dialog the browser downloads the
  file as usual. Cancelling saves nothing and clears the status toast.
  Otherwise the toast names the saved file, "Saved barn.zip.", and clears
  itself after 4 seconds; a failure, or a project export with unreadable
  files, stays until the next message. Browsers do
  not reveal the folder the user picked, so it gives no location; only the
  fallback download adds "to your browser's downloads folder". The menu is the
  chrome's only shadow, because it floats over the drawing. On the Sources view
  of a page that can write, "Add image" (a sheet-with-plus icon in the
  drafting-symbol style) follows the Image select.
- **Structure only**: on the Elevations and Sections views, when the model has
  plants, fixtures, equipment, or site surfaces, the toolbar adds a "Structure
  only" toggle (`aria-pressed`, off by default, `?structure=1` to start on).
  On, the sheet leaves out plants (in front of an elevation, beyond a
  section), fixtures and equipment beyond a section cut, and cut or beyond
  site surfaces such as patios and walks, so walls, openings, slabs,
  foundations, framing, the roof, and stairs read on their own. The ground
  line, earth, datums, and dimensions stay, and the sheet keeps its scale.
  It is a viewer-only filter: exported drawings always carry everything.
- **Underlay**: on the Plans, Systems, and Site views, when a placed source
  image applies to the sheet, the toolbar adds an "Underlay" toggle
  (`aria-pressed`) and an Opacity slider (default 0.5). `?underlay=0` starts
  hidden. The image draws beneath all linework, clipped to the drawing area
  (on the site plan, short of the plant schedule column), and only in the
  viewer: exported sheets never carry it. A stale file or placement is not
  drawn and adds a Source image note.
- **Sources view**: the inspector leads with the selected image: its id as
  the heading, its kind, path, and pixel size, and its scale as a status
  ("Not calibrated" in the warning colour, otherwise the active scale with
  its uncertainty and method) followed by any flag (Stale, Missing, Not
  verified, Placement out of date, Calibrations disagree). The calibration
  follows as three numbered steps, because the order matters: Mark a known
  distance (with the line's ends, length, and end accuracy once marked),
  Type that distance, and Save it for your agent (Copy it for your agent on a
  page that cannot write). Below a hairline, "Named
  features" (with the count at the right) lists the image's recorded
  reference points and areas first, then the draft's new ones; the tools
  themselves live only in the toolbar. With marks, a note says new ones come
  from Reference point and Area in the toolbar and any can be renamed or
  removed before saving; without, a hint names those tools. The
  marks read as a schedule, like the plant schedule on L-101:
  a ruled table with the mark's symbol, an inline label field, where it is
  (the pixel position rounded, or the area's corner count, in data type; a
  draft mark adds a muted "New"), and a quiet × to remove it. A new mark
  starts as "Point N" or "Area N", the smallest N no recorded or draft mark of
  that kind uses, focused with its label selected so typing renames it.
  Editing a recorded label renames it on save; its × strikes the label
  through with "Removed on save" and turns into Undo ("Keep <label>"), and the
  mark leaves the stage. The count leaves out removed marks. A problem with a
  label (empty, or the same as another mark of its kind) or an area still being
  outlined shows in the error colour directly under the table, with the
  input's border in the error colour, as well as by the Save button. Save
  closes an outline of 3 or more corners under its default label first; a
  shorter one blocks it. Start over drops the new marks and the renames and
  removals. An area's size,
  uncertainty, and perimeter sit on a muted line under its row. "Image details"
  is a closed disclosure with the revision, placement, north, the single
  scale, the calibrations, recorded areas, and the file check. The toolbar's
  Image select, first in the row like Level, Face, and Section, chooses the
  image; each option reads "id, kind" and names a warning such as stale.
  An image has one scale. When its calibrations
  disagree, the flag and the details suggest cropping each part of a
  mixed-scale sheet into its own image and importing it separately. The stage
  shows the image at natural pixel size with the sheet's pan and zoom, a pixel
  readout in the corner, and the recorded calibration lines, labelled
  reference points, and labelled areas on top, in ink. The toolbar holds the
  Image select, the zoom group ("Fit image"), and, set apart at the right
  behind a hairline under a muted "Mark" label, the calibration tools as
  pressed toggles, each with a drafting-symbol icon in `currentColor`: Scale
  line (a dimension line with extension lines and ticks), Reference point (a
  survey control target), and Area (an outline with corner dots). With a tool chosen, a click marks a
  point, and Enter on the focused stage marks the
  point under a centre crosshair, so every step works from the keyboard.
  Escape steps back. Area adds polygon corners: the outline previews in the
  accent, Backspace removes the last corner, Escape cancels it, and clicking
  the first corner (from 3 corners) or "Finish area" closes it. Each closed
  area takes a label and shows its size and perimeter in the project's units
  (sq ft to 0.1 with a feet-inches perimeter, or m² to 0.01 with a metric
  one), with ±, from the draft's scale line when it has one and otherwise the
  image's active scale; without a scale it reads "Not measured: add a scale
  line" and can still be saved or copied. Photos take labelled areas but never a size.
  The inspector lists the recorded areas with their current sizes. The
  draft draws in the accent, as the current selection. Under the distance, a
  note gives the resulting scale; when it is more than 5% off the image's
  automatic estimate, the note turns to the warning colour and says that the
  distance overrides the estimate and what the estimate makes the line. It
  never blocks the save or copy: a manual calibration is a deliberate override.
  On a page that can write, step 3 has "Save calibration" (primary) and
  "Start over", under the line "Saves to sources/sources.json. Your agent
  reads it from there." Saving shows "Saving...", clears the draft, and
  reloads (live reload normally does it; otherwise the page reloads itself
  after 1.5 s); after the reload a "Saved." line, with any note the server
  returned (such as the manual override of an estimate), sits under the
  image's heading until the next mark. A save refused as stale says "This
  image changed since the page loaded. Reload and mark it again." with a
  Reload button; any other refusal shows the server's message in the error
  colour. Everywhere else, "Copy calibration"
  copies the text the agent applies; if the browser refuses, the text appears
  selected in a read-only box. A file whose hash or size no longer matches
  its import turns calibration off and says to re-import it. `?view=sources`
  and `?source=<id>` restore the place.
- **Writing from the page**: `scripts/serve.mjs` puts a per-start write token
  in the page it serves (`<meta name="architecture-studio-write">`). With it,
  over http, the Sources view can add images and save calibrations; the
  single-file bundle, the preview, a plain static server, and `file://` have
  no token, so they hide Add image and keep "Copy calibration". "Add image",
  or dropping an image file on the stage, opens "Add an image" in place of
  the inspector panel: a dashed drop zone that is also the file picker
  (PNG, JPEG, or WebP; a PDF, HEIC, or TIFF is refused before upload with the
  advice to export it as PNG or JPEG), the chosen file's name and size, a
  required Type select (Satellite, Survey, Site plan, Floor plan, Framing
  plan, Elevation, Photo, Sketch, Other), an optional Name that becomes the
  id, then "Import image" (primary, enabled once a file and a type are
  chosen) and "Cancel" (or Escape). Importing shows "Importing..."; an id
  that exists offers "Replace it"; on success the page reloads on the new
  image and says "Imported <id>.". With no images yet, the Sources panel is
  this form under the heading "Source images", without Cancel, and the
  stage says to drop an image there.
- **Source-only mode**: when the model is missing or invalid but source images
  exist, the tabs stay live. Every drawing and review view still shows its
  "Model unavailable" or "Resolve model errors" message, and the Sources view
  works, because calibration does not need the model. Placements wait for a
  valid model.
- **Opened from disk**: a project page on `file://` with no embedded model
  cannot fetch its files, so instead of "Model unavailable" it is titled
  "Open this project with Open Studio" and says to double-click Open
  Studio.cmd (Windows) or Open Studio.command (macOS), which need Node.js.
- **3D model**: the scene is uploaded to the GPU once per build (model or
  system toggles), and each frame only sets the camera, so the view keeps
  up with the display. Faces are lit by a soft sky (brighter on upward
  faces), a sun from the south-east, and a weak fill from the north-west, so
  each side of a mass takes its own tone and corners and slopes read; lines
  (roofs, systems) stay flat. Each material category with a texture draws a
  procedural pattern at real size in the plane of the face: running-bond
  brick and block with joints, decking boards, unit pavers, irregular
  flagstone, and grain or speckle for concrete, wood, steel, gravel, sand,
  earth, mulch, asphalt, lawn (also grassed terrain), and water. Gypsum
  takes a faint orange-peel stipple, as painted board. Unspecified
  assemblies, insulation, and fixtures stay plain, and detail too
  fine to see fades to the material colour instead of shimmering. Stairs
  take their material's colour. Each wall face shows the layer it exposes,
  from the wall's resolved layer order: siding, brick, or block outside,
  gypsum inside, gypsum on both faces of a stud partition; tops, ends, and
  jambs show the exterior face's layer. Slabs keep the colour of their
  thickest layer other than insulation and gypsum. Walls are extruded from the same joined
  outlines as the plan (corners miter, tees stop at the face they meet,
  among the walls of one level), so corners are closed rather than notched,
  including the pieces above and below openings near a corner. Held keys
  move by elapsed time on a
  `requestAnimationFrame` loop, not by keyboard repeat. The camera buttons
  are Orbit and Fly. In Fly mode W and S fly along the line of sight at
  3 m/s (7 m/s with Shift), so aiming up or down climbs or dives; A and D
  strafe level; Q and E go straight down and up at 1.5 m/s (3.5 m/s with
  Shift). The eye can go from 8 m below the lowest point of the model (from
  the uploaded scene, so footings and graded sites count) up to 60 m, high
  enough to fly over the roof. Arrow keys turn
  and tilt in both modes. Drags,
  scrolling, and resizing ask for at most one draw per frame. Keys held when
  the window loses focus are released. Each mode keeps its own heading, so
  switching never hands Fly the orbit's downward aim. Fly opens outside the
  south face, level and centred on it, far enough back that the walls and
  roof fit a 60-degree view; Orbit opens above one corner. A "Reset view"
  button (circular-arrow icon) floats at the top right of the 3D view itself
  and restores both starting views without changing the Orbit or Fly mode.
- **Toggle buttons** use `aria-pressed`; pressed is ink-filled.
- **Inspector (default)**: "Needs your input". Findings are grouped into To
  check (errors as Fix, warnings as Check) and Notes (advisories), each with a
  heading and count. Codes become plain topics (Stair, Code research, Systems)
  and repeated findings merge. No model statistics. An entry that points at a
  model entity is a button that selects it; one that does not is not styled as
  clickable. The concept-only notice closes the panel as fine print.
- **Inspector (selected element)**: a detail callout. Type and title, a
  plain-language context line, a small not-to-scale detail drawing for
  stairs, openings, and roofs, a two-column grid of key dimensions in the
  model's units, the open items the concept does not decide (shown as a list,
  never as invented values), and a one-line evidence summary. An Approve
  button records the owner's sign-off (approved state shows a check and Undo);
  entities already accepted in the model say so instead.
  Approvals are browser-local and are not automatically invalidated by model
  edits. The exported approval file identifies the whole model at export
  time, not each entity at approval time. Re-review changed elements before
  handing those approvals to the agent.
- **Findings on the Code review page**: a card with a coloured severity word
  and topic, same clickable rule.
- **Sheet entities** are focusable; Enter or Space inspects, Escape clears.
  Focus and selection draw the entity in the accent.
- **Status**: loading, empty, and error states replace the canvas with a short
  serif headline and one sentence that names the next step. The download
  result appears in a polite live region.

## Do's and Don'ts

- Do keep one focal point: the sheet.
- Do name the action on every control ("Fit sheet", "Share").
- Do keep every claim in the interface honest: concept only, no compliance.
- Don't add eyebrow labels above headings.
- Don't use the accent for text, data, or decoration.
- Don't style anything as clickable unless it does something.
- Don't add motion beyond 160ms colour transitions on controls.
