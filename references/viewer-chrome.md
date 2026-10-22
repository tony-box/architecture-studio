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
  when `sources/sources.json` lists images or cannot be read.
- **Toolbar**: one shared toolbar for every view; only the controls for the
  active view are shown. The view's sheet dropdown (Level, Face, or Section)
  comes first. Related buttons are fused into one segmented control (zoom,
  camera mode, system toggles) so each group reads as a single tool. The
  primary "Download drawing set" sits at the far right on the drawing views
  (Plans, Elevations, Sections, Systems, Site) only; the 3D model, Code
  review, Assumptions, and Sources views do not show it.
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
  Type that distance, and Copy it for your agent. Below a hairline, "Named
  features" (with the count at the right) lists the draft's reference points
  and areas; the tools themselves live only in the toolbar. With marks, a
  note says they come from Reference point and Area in the toolbar and go to
  the agent with the calibration; without, a hint names those tools. The
  marks read as a schedule, like the plant schedule on L-101:
  a ruled table with the mark's symbol, an inline label field ("Name it"
  until named), where it is (the pixel position rounded, or the area's
  corner count, in data type), and a quiet × to remove it. An area's size,
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
  line" and can still be copied. Photos take labelled areas but never a size.
  The inspector lists the recorded areas with their current sizes. The
  draft draws in the accent, as the current selection. Under the distance, a
  note gives the resulting scale; when it is more than 5% off the image's
  automatic estimate, the note turns to the warning colour and says that the
  distance overrides the estimate and what the estimate makes the line. It
  never blocks the copy: a manual calibration is a deliberate override.
  "Copy calibration"
  copies the text the agent applies; if the browser refuses, the text appears
  selected in a read-only box. A file whose hash or size no longer matches
  its import turns calibration off and says to re-import it. `?view=sources`
  and `?source=<id>` restore the place.
- **Source-only mode**: when the model is missing or invalid but source images
  exist, the tabs stay live. Every drawing and review view still shows its
  "Model unavailable" or "Resolve model errors" message, and the Sources view
  works, because calibration does not need the model. Placements wait for a
  valid model.
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
- **Findings on the Code review page**: a card with a coloured severity word
  and topic, same clickable rule.
- **Sheet entities** are focusable; Enter or Space inspects, Escape clears.
  Focus and selection draw the entity in the accent.
- **Status**: loading, empty, and error states replace the canvas with a short
  serif headline and one sentence that names the next step. The download
  result appears in a polite live region.

## Do's and Don'ts

- Do keep one focal point: the sheet.
- Do name the action on every control ("Fit sheet", "Download drawing set").
- Do keep every claim in the interface honest: concept only, no compliance.
- Don't add eyebrow labels above headings.
- Don't use the accent for text, data, or decoration.
- Don't style anything as clickable unless it does something.
- Don't add motion beyond 160ms colour transitions on controls.
