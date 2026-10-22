# Architecture Studio

An [Agent Skill](https://agentskills.io) for exploring building concepts with
the coding agent you already use. Describe a house, workshop, cabin, or studio,
and your agent builds one real-unit coordinate model that drives:

- drafted site plans with property lines, setbacks, contours, landscaping, and
  a plant schedule, plus floor plans, elevations, sections, and systems sheets,
- an exportable SVG drawing set,
- conceptual plumbing, electrical, and mechanical layouts,
- advisory, cited local building-code research,
- an interactive 3D orbit and walkthrough,
- an assumptions list and a handoff for your architect and engineers.

[Open the live demo](https://raw.githack.com/tony-box/architecture-studio/main/preview/index.html)
(the included example model in the real viewer).

> **Concept only.** Architecture Studio produces concept documents for
> programming, option studies, and professional handoff. It is not a substitute
> for a survey, licensed architect, structural engineer, MEP engineer, energy
> professional, or authority having jurisdiction. Nothing it produces is code
> compliant, permit ready, or engineered.

## Requirements

- A coding agent that supports Agent Skills: Claude Code, GitHub Copilot (CLI,
  VS Code, cloud agent), OpenAI Codex, Cursor, Gemini CLI, OpenCode, and others.
- Node.js 20 or newer. The scripts use only Node built-ins; there is nothing to
  `npm install`.
- A browser with WebGL2 for the 3D view.

## Install

**Any supported agent** (uses the [skills CLI](https://github.com/vercel-labs/skills)):

```bash
npx skills add tony-box/architecture-studio        # this project only
npx skills add tony-box/architecture-studio -g     # every project
```

**Manual install:** clone the repository into your agent's skills folder.

| Agent | Personal skills folder | Project skills folder |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| GitHub Copilot | `~/.copilot/skills/` | `.github/skills/` |
| OpenAI Codex | `~/.codex/skills/` | `.agents/skills/` |
| Others | see your agent's docs | `.agents/skills/` is widely supported |

```bash
git clone https://github.com/tony-box/architecture-studio ~/.claude/skills/architecture-studio
```

Update later with `git pull` (manual install) or `npx skills update`.

## Use

Ask your agent for a building concept, for example:

> Design a two-level 36 by 48 foot workshop residence in upstate New York, with
> a fabrication shop below and a two-bedroom home above.

The agent then:

1. **Creates a project folder** for the building (`scripts/init.mjs`). Each
   building gets its own folder; design alternatives live inside it under
   `models/variants/`.
2. **Interviews you in short rounds** following
   [`references/intake.md`](references/intake.md): basics, room program, site,
   systems preferences, and source materials. Answers are saved to
   `brief.json`, so a later session resumes where you left off. Nothing is
   modeled until you confirm the brief and every assumption.
3. **Builds the model**, researches the local code (only with your
   permission), and lays out conceptual systems.
4. **Opens the studio in your default browser** (`scripts/serve.mjs`). The
   page reloads itself as the agent edits the model. If the browser cannot
   open (SSH, containers, cloud agents), the agent gives you the URL.
5. **Exports the drawing set** and writes `ASSUMPTIONS.md` and `HANDOFF.md`.

## Bring your own images

Images help the agent get sizes and positions right. Useful ones:

- satellite or aerial views of the lot,
- surveys and plats,
- site plans and floor plans,
- framing, rafter, or truss plans,
- elevations,
- sketches with at least one dimension you trust,
- photos of the site or an existing building.

The agent imports each image into the project's `sources/` folder
(`scripts/import-image.mjs`) and reads it. Numbers printed on a drawing are
used exactly as written. For anything not dimensioned, the agent estimates the
image's scale from what is printed on it (a scale bar, a dimension string, a
stated scale on a scan whose resolution you confirm) and tells you the result
with its uncertainty, for example "about 48 ft ± 2 ft, estimated from the
scale bar".

To make it precise, calibrate the image yourself in the studio's **Sources**
tab, which works before there is a model: click the two ends of a distance you
know, type the distance, press **Copy calibration**, and paste the text to the
agent. You can also mark labelled points, such as house corners, to help it
place the image, and outline labelled areas, such as a garden bed, with the
Area tool: the viewer shows each area's size from the image's scale. (Scale
region is only for part of a sheet drawn at its own scale, such as a detail.)
A calibrated, placed plan or site image can be shown under
the floor plan or site plan in the viewer, with an Underlay toggle and an
opacity slider (`?underlay=0` turns it off). The exported drawings never
include it.

What images can't do:

- Imagery never sets property lines, setbacks, or existing trees. Those come
  from a survey, a plat, or you. A satellite view can suggest drives and trees
  for you to confirm.
- Photos are context only; they are never measured.
- Elevations give heights only and are not shown as underlays.
- A car, door, or parking stall is used for scale only if you accept it as an
  assumption.

Supported formats are PNG, JPEG, and WebP. Export PDFs to PNG, HEIC photos to
JPEG, and TIFF scans to PNG first, at full resolution and without cropping off
the scale bar or north arrow.

## Project folder

```text
my-workshop/
  architecture-studio.json   skill version that created the project
  index.html                 the studio viewer
  brief.json                 your confirmed answers
  sources/                   sketches, photos, and documents you supplied
  sources/sources.json       scale and placement of each image
  models/building.json       the single source of truth
  models/variants/           complete alternative concepts
  exports/                   SVG drawing set and manifest.json
  reviews/                   code findings, code review, your approvals
  ASSUMPTIONS.md
  HANDOFF.md
```

The folder is self-contained: zip it, put it under version control, or open it
on another machine without the skill.

## Scripts

All scripts live in `scripts/` and run with plain `node`.

| Command | What it does |
| --- | --- |
| `node scripts/init.mjs <project>` | Create a project folder. `--update` replaces only the viewer with this skill's version. |
| `node scripts/serve.mjs <project>` | Serve the project on `127.0.0.1` and open the default browser. Live reload is on by default. Options: `--port`, `--no-open`, `--no-watch`, `--json`. |
| `node scripts/export-drawings.mjs --project <project>` | Validate the model and write `exports/**/*.svg` plus `exports/manifest.json`. Writes nothing while the model has errors. |
| `node scripts/inspect.mjs --project <project> --id <id>` | Report one element as numbers (size, area, path width and radii, clearance to the building and the lot, its findings), so the agent can check a curve edit without looking at a drawing. For a door or window it lists the jamb and centre points anchors can use. Without `--id` it lists the elements. |
| `node scripts/bundle.mjs <project>` | Write one self-contained HTML file to `exports/` for sharing. It opens with a double-click and needs no server. |
| `node scripts/import-image.mjs <command> <project> ...` | Import images into `sources/` and record their scale and placement in `sources/sources.json`: `add`, `calibrate`, `uncalibrate`, `north`, `reference`, `place`, `measure`, `to-model`, `apply` (a calibration pasted from the viewer), `check`, `list`. See [`references/image-intake.md`](references/image-intake.md). |

`serve.mjs` picks a port derived from the project path, so a project always
opens at the same address and keeps the approvals the viewer stores in the
browser.

The viewer accepts query parameters: `view` (`plan`, `elevation`, `section`,
`systems`, `site`, `model`, `code`, `assumptions`), `level`, `section`,
`elevation`, `hide` (site plan layers to hide: `trees`, `plants`, `surfaces`,
`grading`, `lot`), and `model` (a path to an alternative model file). The Site
tab appears only for models with site content; its toolbar toggles show or
hide trees, shrubs and groundcover, surfaces, grading, and property lines in
the viewer. The exported L-101 always shows everything.

## Drawings

Every drawing is a drafted sheet with a border, title block, view title,
graphic scale bar, and (on plans) a north arrow. Linework weight, lettering,
dimensions, and symbols follow
[`references/drafting-standard.md`](references/drafting-standard.md):

- `feet-inches` models use an NCS-informed imperial profile: ANSI B sheets,
  architect's scales, architectural tick terminators.
- `metric` models use an ISO-informed metric profile: A3 sheets, ISO scales,
  arrow terminators, dimensions in millimetres.

The profiles are informed by those standards; the drawings never claim
conformance to them, and every title block reads "Concept - not for
construction".

When the model has a material catalog, plans and sections at 1/8" = 1'-0"
(imperial) or 1:100 (metric) and larger hatch every cut element by material,
with a material key in the title block: wall and slab layers, headers over
openings (sawn, built-up, and engineered lumber, steel angles and beams,
concrete lintels, bond beams), steel and timber beams and columns,
foundations, site surfaces such as gravel and concrete walks, and earth below
grade. The hatch conventions, their sources, and how confident each one is are
listed in `references/drafting-standard.md`. Three conventions differ by
profile (reinforced concrete, rigid insulation, timber end grain); confirm
those against the licensed standard before relying on them. Without a catalog,
cut elements stay in solid poché.

When the model records a property line, setbacks, contours, a grading limit,
or plantings, the set starts with a site plan, L-101, at engineer's scales
(imperial) or 1:100 to 1:1000 (metric). It shows the lot with bearings and
distances, setbacks, existing and proposed contours, spot elevations, the
building footprint, lawn, beds, walks, drives, decks, and water in their
hatches, trees and shrubs (existing, proposed, or to remove), and a plant
schedule with derived quantities. Contours build an existing and a proposed
ground surface: sections cut the terrain, lawns and walks can drape on it,
and the 3D view shows the ground and the plants. Curved walks, beds, decks,
and rooms use arc (`bulge`) or Bezier vertices, and walls can curve too. Walks,
paths, and drives are best drawn as a centreline with a width and corner
radii; the outline is derived exactly, so asking the agent to "curve the walk
more" or "move it east" changes a radius or a point, never the width. Points
can be anchored to a door, window, or wall, so "make the walk as wide as the
door" or "start the patio edge at the door jamb" lines up exactly and follows
the door if it moves.
[`references/curves.md`](references/curves.md) is the agent's guide to
turning such requests into numbers.

Selecting an element in any drawing opens its review details: key dimensions,
a small detail drawing for stairs, openings, and roofs, the decisions the
concept leaves open, and its evidence. You can approve an element there.
Approvals are exported as `reviews/approvals.json` with the drawing set; they
record your sign-off on the concept, not a professional approval.

## Limits

- A model may contain one axis-aligned rectangular gable roof; curved roofs
  are not supported yet. Slabs, foundations, site surfaces, and rooms may be
  any simple outline, straight or curved, and walls may be straight or arcs.
  The studio blocks unsupported or invalid geometry instead of approximating
  it.
- Property lines, setbacks, and existing trees must come from a survey, a plat,
  or the user. Terrain is triangulated from the contours you give it and is
  concept-level; it is not a grading or drainage design.
- Beam, column, and header sizes are concept placeholders that drive the
  drawings. They are never structural design.
- "Close to accurate" means model coordinates are real units and every derived
  view agrees within the declared tolerance. It does not imply structural
  adequacy, engineered system sizing, permit readiness, or construction
  accuracy.

## Development

```bash
node --test                                              # run the test suite
node scripts/build-preview.mjs                           # regenerate preview/index.html
node scripts/build-preview.mjs --check                   # fail if the preview is stale
node examples/build-mixed-material-workshop.mjs          # regenerate both mixed-material examples
node examples/build-mixed-material-workshop.mjs --check  # fail if either is stale
node examples/build-hillside-garden-house.mjs            # regenerate both site examples
node examples/build-hillside-garden-house.mjs --check    # fail if either is stale
```

The tests freeze the drawing sets of the four examples that predate site plans
and curves (`tests/golden/legacy-drawing-sets.json`), and check that no
lettering on any example sheet overlaps other lettering
(`tests/legibility.test.mjs`). After an intended change to those drawings,
rewrite the hashes with
`UPDATE_GOLDEN=1 node --test tests/legacy-output.test.mjs`.

`preview/index.html` is the studio template with the example model embedded.
Regenerate it after changing either file. The examples in `examples/` are
synthetic and contain no private addresses, imagery, or construction
documents:

| Example | Units | Exercises |
| --- | --- | --- |
| `lakeside-barn-residence` | feet-inches | The live demo: two levels, stair, systems, sections |
| `compact-metric-studio` | metric | Crowded labels, an L-shaped room, sections through openings |
| `mixed-material-workshop` | feet-inches | Material hatching: CMU, brick veneer, wood frame, insulation, steel and glulam members, seven header types, footings, gravel, concrete, an L-shaped walk, earth. Generated by `examples/build-mixed-material-workshop.mjs`; edit the generator, not the JSON |
| `mixed-material-workshop-metric` | metric | The same layout in metric sizes, from the same generator, for comparing the two hatching profiles |
| `hillside-garden-house` | feet-inches | Site plan and landscaping: a sloping lot with a curved frontage, setbacks, existing and proposed contours, a graded pad, a curved bay wall, a curved deck, draped lawn, beds, and walks, a pond, trees to keep, remove, and plant, shrubs, and massed plantings. Generated by `examples/build-hillside-garden-house.mjs` |
| `hillside-garden-house-metric` | metric | The same site on a 300 mm module, from the same generator |

## License

[MIT](LICENSE)
