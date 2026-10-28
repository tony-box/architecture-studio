# Architecture Studio

An [Agent Skill](https://agentskills.io) for exploring building concepts with
the coding agent you already use. Describe a house, workshop, cabin, or studio,
and your agent builds one real-unit coordinate model that drives:

- drafted site plans with property lines, setbacks, contours, landscaping, and
  a plant schedule, plus floor plans, elevations, sections, and systems sheets,
- an exportable SVG drawing set,
- conceptual plumbing, electrical, and mechanical layouts,
- composed facades and rooms: doors, windows, sinks, and lights follow a
  symmetric, balanced, or bay-rhythm layout, with exact suggested positions,
  while code, structure, and function come first,
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

For a manual clone, check for local changes before `git pull --ff-only`.
For a skills CLI installation, `npx skills update` can update other installed
skills too; review that scope before running it. Start a new agent session
after either update.

### Updating existing projects

When the skill starts, it checks whether a newer skill version is available
and offers an update for your approval. For an existing project, it also
checks whether its saved viewer is older than the installed skill. Nothing
is upgraded without your approval. After updating the installed skill, start
a new agent session to load its new instructions.

You can also check directly:

```bash
node <skill>/scripts/check-updates.mjs --project <project>
```

The check reads the version from `package.json` on this repository's `main`
branch (the installation source, not a tagged-release feed). It sends no
project data, waits at most five seconds for the request, and reports failures
without blocking the skill's normal workflow. `--offline` skips the network
and checks only the project against the installed skill; `--json` produces
structured results. Version checks detect version bumps, not changes made
under the same version number.

With your approval, the agent preserves a backup or version-control
checkpoint, runs `init.mjs <project> --update`, and regenerates the drawings
and any shared HTML bundle. The refresh replaces `index.html` and
`architecture-studio.json`, including any custom edits to those files, but
does not change the model, brief, images, variants, or reviews. It is a viewer
upgrade, not an automatic model-schema migration. A newer viewer will not
invent model data needed by new features.

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
   permission), and lays out conceptual systems. Fixtures, receptacles,
   switches, lights, alarms, and HVAC terminals are placed with
   [`references/mep-placement-guide.md`](references/mep-placement-guide.md),
   which keeps US model-code baselines (NEC, IRC, NFPA 72) apart from design
   practice and lets cited local findings override them.
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
(`scripts/import-image.mjs`) and reads it. You can also add images yourself
in the studio's **Sources** tab: drag an image onto it, or click **Add
image**, choose what kind of image it is, and import it. Numbers printed on a
drawing are used exactly as written. For anything not dimensioned, the agent
estimates the image's scale from what is printed on it (a scale bar, a
dimension string, a stated scale on a scan whose resolution you confirm) and
tells you the result with its uncertainty, for example "about 48 ft ± 2 ft,
estimated from the scale bar".

To make it precise, calibrate the image yourself in the studio's **Sources**
tab, which works before there is a model: click the two ends of a distance you
know, type the distance, and press **Save calibration**. It is saved to the
project, where the agent reads it. A page served by a plain static server
offers **Copy calibration** instead; paste that text to the agent. A
single-file bundle omits source images and their manifest, so share the
complete project for image review. You can also mark labelled points, such as
house corners, to help it place the image, and outline labelled areas, such as a garden bed, with the
Area tool: the viewer shows each area's size from the image's scale. Each
image has one scale. If a sheet mixes scales, such as a plan with an enlarged
detail or a plat with a vicinity map, crop each part into its own PNG and
import each separately.
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
  Open Studio.cmd            double-click to open the viewer (Windows)
  Open Studio.command        double-click to open the viewer (macOS)
  open-studio.mjs            the small local server both of them run
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

The folder carries its viewer and data: zip it or put it under version
control. Browsers do not let `index.html` opened straight from disk read the
files beside it, so it shows how to open the project instead. To open it,
double-click Open Studio (or run `node open-studio.mjs` in the folder). It
needs only Node.js 20 or newer, not the skill. It serves the folder
read-only on `127.0.0.1`, at the same address `serve.mjs` uses for that
folder, so browser approvals stay with the project. Keep its window open
while you work. The Sources tab's image import and calibration saving still
need `serve.mjs`. `bundle.mjs` gives a single double-clickable file instead.

### Sharing formats

| Format | Includes | Does not include |
| --- | --- | --- |
| Complete project folder | Viewer, model, brief, sources, reviews, exports, and handoff files that exist | Nothing is generated merely by zipping the folder |
| Share, then Export project, served by `serve.mjs` | The project files (`architecture-studio.json`, viewer, brief, `models/`, `sources/`, `reviews/`, `ASSUMPTIONS.md`, `HANDOFF.md`) in one `<project-id>/` folder, with browser approvals as `reviews/approvals.json` and `exports/` drawn fresh from the current model | Dotfiles, symbolic links, and other files in the folder, such as version control |
| Share, then Export project, elsewhere (the preview, a bundle, a page opened from disk) | A reopenable project rebuilt from the page: `architecture-studio.json`, the viewer, the model, code findings, browser approvals, and `exports/` drawn fresh | Brief, source images, variants, and handoff notes, because the page cannot read the folder |
| Share, then Download drawings | Every drawing sheet as SVG, drawn from the current model, in one `<project-id>-drawings/` folder. Works on any page, with or without an `exports/` folder | Manifest, approvals, handoff files, model, viewer, and source images; use Export project for those |
| `bundle.mjs` HTML | Viewer with the model and code-findings JSON embedded | Source images and manifest, drawing ZIP, brief, approvals, and Markdown handoff files |

Both Share options ask where to save the ZIP in browsers with a save dialog
(Chrome and Edge); other browsers save it to their downloads folder.

To reopen an exported project, extract the ZIP and double-click Open Studio
in the extracted folder, or run `node scripts/serve.mjs <extracted>/<project-id>`.
Approvals stored in a
browser belong to the address that saved them, so the export carries them
as `reviews/approvals.json`; they replace a saved copy of that file. The
drawings in `exports/` are drawn by the same code as `export-drawings.mjs`,
so they match the model in the archive.

The bundle renders drawings and 3D, and its Share, then Download drawings,
draws every sheet as SVG from the embedded model. Review source images for
sensitive information before sharing the full folder or a project export.

## Scripts

All scripts live in `scripts/` and run with plain `node`.

| Command | What it does |
| --- | --- |
| `node scripts/check-updates.mjs [--project <project>]` | Check upstream skill and local viewer versions without changing files. Options: `--offline`, `--json`. Failures produce warnings and exit nonzero; an available update is not an error. |
| `node scripts/init.mjs <project>` | Create the viewer, version marker, Open Studio launcher, and project directories. It does not write a brief or model. `--update` replaces `index.html`, `architecture-studio.json`, and the launcher files, not design data. |
| `node scripts/serve.mjs <project>` | Serve the project on `127.0.0.1` and open the default browser. Live reload is on by default. The Sources tab imports images and saves calibrations through it; nothing else is written. It also lists the project files for the viewer's Export project. Options: `--port`, `--no-open`, `--no-watch`, `--json`. |
| `node scripts/export-drawings.mjs --project <project>` | Validate the model and write `exports/**/*.svg` plus `exports/manifest.json`. Writes nothing while the model has errors. |
| `node scripts/inspect.mjs --project <project> --id <id>` | Report one element as numbers (size, area, path width and radii, clearance to the building and the lot, its findings), so the agent can check a curve edit without looking at a drawing. For a door or window it lists the jamb and centre points anchors can use. Without `--id` it lists the elements. |
| `node scripts/compose.mjs --project <project>` | Report each facade as seen (centreline, third lines, every opening's centre from the left corner), the composition findings, and one proposed layout with exact `offsetMm`, `sillMm`, and fixture or light positions. It never writes the model. `--json` for machine-readable output. |
| `node scripts/bundle.mjs <project>` | Write one self-contained HTML file to `exports/` for sharing. It opens with a double-click and needs no server. |
| `node scripts/import-image.mjs <command> <project> ...` | Import images into `sources/` and record their scale and placement in `sources/sources.json`: `add`, `calibrate`, `uncalibrate`, `north`, `reference`, `place`, `measure`, `to-model`, `apply` (a calibration pasted from the viewer), `check`, `list`. See [`references/image-intake.md`](references/image-intake.md). |

`serve.mjs` picks a port derived from the project path, so a project always
tries the same address and keeps browser-local approvals when that address
is available. If the port is occupied it tries subsequent ports; use the URL
it prints. In remote environments, forward the port before opening it locally.
Source writes require a localhost or `127.0.0.1` origin; a hosted preview URL
does not provide the same write access.

The export, inspection, and composition scripts use the project's saved
`index.html` before falling back to the installed template. Their `--page`
option selects a viewer explicitly, and `--model` selects an alternative JSON
file relative to the project. `inspect.mjs` always prints JSON; export and
composition use `--json` for structured output.

The viewer accepts query parameters: `view` (`plan`, `elevation`, `section`,
`systems`, `site`, `model`, `code`, `assumptions`, `sources`), `level`, `section`,
`elevation`, `hide` (site plan layers to hide: `trees`, `plants`, `surfaces`,
`grading`, `lot`), and `model` (a path to an alternative model file). The Site
tab appears only for models with site content; its toolbar toggles show or
hide trees, shrubs and groundcover, surfaces, grading, and property lines in
the viewer. `source=<id>` selects a source image, `code=<path>` selects a code
findings file, `underlay=0` hides image underlays, and `structure=1` starts
elevations and sections in Structure only mode. These visibility controls
affect the viewer, not exports. The exported L-101 always shows everything.

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
and rooms use arc (`bulge`) or Bezier vertices, and walls can curve too.
Constant-width walks, paths, and drives use a centreline with a width and
corner radii; the outline is derived exactly, so asking the agent to "curve the walk
more" or "move it east" changes a radius or a point, never the width. Points
can be anchored to a door, window, or wall, so "make the walk as wide as the
door" or "start the patio edge at the door jamb" lines up exactly and follows
the door if it moves. Variable-width landings and aprons use an anchored
boundary instead.
[`references/curves.md`](references/curves.md) is the agent's guide to
turning such requests into numbers.

Selecting an element in any drawing opens its review details: key dimensions,
a small detail drawing for stairs, openings, and roofs, the decisions the
concept leaves open, and its evidence. You can approve an element there.
Approvals are exported as `reviews/approvals.json` by Share, then Export
project; they
record your sign-off on the concept, not a professional approval.
They stay in that browser until exported, and the viewer does not
automatically clear them after a model edit. Review changed elements again
before exporting approvals. The agent checks the project and whole-model
fingerprint before applying them; there is no per-entity approval fingerprint.

## Composition

The agent gives you a composed starting point, not a scatter of openings.
During intake it asks which look you want:

- **Symmetric**: rows of openings mirror about each facade's centre. This is
  the default when you have no preference.
- **Balanced**: openings sit on the centre or a third line.
- **Rhythmic**: openings repeat with the structural bays.

Across every facade, windows stack over the windows below, matching openings
on opposite facades line up, and heads in a row share one height. Sinks centre
on the window above them, and ceiling lights sit on an even grid. Hidden
pipes, wires, and ducts never chase symmetry; they take short runs and shared
stacks.

`scripts/compose.mjs` turns those rules into exact model values. The studio's
review queue shows the same findings as notes. When code, structure, or
function keeps an element off the pattern, such as an overhead door placed for
a lift bay or an entry facing the house, the model records an exception with
the reason, and the handoff lists it. See
[`references/composition-guide.md`](references/composition-guide.md).

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
- Validation covers selected geometry, references, and system endpoints.
  Device coverage, route collisions, clearances, and code applicability still
  need the agent's manual review. Recorded code-check results are not
  recomputed by the viewer when a model changes.
- Composition proposals cover cardinal straight facades, sinks near windows,
  and rectangular-room light grids. Curved facades, irregular rooms, counters,
  and other visible devices still need manual composition review.
- "Close to accurate" means model coordinates are real units and every derived
  view agrees within the declared tolerance. It does not imply structural
  adequacy, engineered system sizing, permit readiness, or construction
  accuracy.

## Try an Example

From this repository in PowerShell, create a separate example project so
exports and viewer files do not land in the checked-in example directory:

```powershell
node scripts\init.mjs ..\studio-demo
Copy-Item examples\lakeside-barn-residence\building.json ..\studio-demo\models\building.json
node scripts\compose.mjs --project ..\studio-demo
node scripts\export-drawings.mjs --project ..\studio-demo
node scripts\serve.mjs ..\studio-demo
```

Choose a new destination instead of overwriting an existing model. On macOS
or Linux, use `/` path separators and `cp` instead of `Copy-Item`. Substitute
any example below to try its capabilities. The copied model is a synthetic
study, not a confirmed brief: complete intake before adapting it to a real
site.

## Development

```bash
node --test                                              # run the test suite
node scripts/build-preview.mjs                           # regenerate preview/index.html
node scripts/build-preview.mjs --check                   # fail if the preview is stale
node examples/build-lakeside-barn-residence.mjs          # regenerate the workshop residence
node examples/build-lakeside-barn-residence.mjs --check  # fail if the model is stale
node examples/build-mixed-material-workshop.mjs          # regenerate both mixed-material examples
node examples/build-mixed-material-workshop.mjs --check  # fail if either is stale
node examples/build-hillside-garden-house.mjs            # regenerate both site examples
node examples/build-hillside-garden-house.mjs --check    # fail if either is stale
```

The tests keep drawing-set snapshots for the four original building examples
(`tests/golden/legacy-drawing-sets.json`), and check that no
lettering on any example sheet overlaps other lettering
(`tests/legibility.test.mjs`). After an intended change to those drawings,
rewrite the hashes with
`UPDATE_GOLDEN=1 node --test tests/legacy-output.test.mjs`.
In PowerShell use `$env:UPDATE_GOLDEN='1'; node --test
tests\legacy-output.test.mjs; Remove-Item Env:\UPDATE_GOLDEN`.
Review the changed sheets before accepting new hashes.

`preview/index.html` is the studio template with the example model embedded.
Regenerate it after changing either file. The examples in `examples/` are
synthetic and contain no private addresses, imagery, or construction
documents:

| Example | Units | Exercises |
| --- | --- | --- |
| `lakeside-barn-residence` | feet-inches | The live demo: a 36 x 48 ft workshop with a two-bedroom home above, an exterior stair and 8 ft deep deck landing, layered 2x6 exterior walls (gypsum, batt cavity, sheathing, and siding whose type is not yet chosen) and 2x4 partitions, furnished rooms, separate bath and laundry, stacked openings, water supply, lighting, switches, outlets, alarms, dwelling-only HVAC, and separate exhaust routes. Generated by `examples/build-lakeside-barn-residence.mjs`; edit the generator, not the JSON |
| `compact-metric-studio` | metric | Crowded labels, an L-shaped room, sections through openings, stacked studio glazing, a centred kitchen sink with connected supply, a floor-box symbol, a wall-mounted ductless head, and layered timber-frame walls and floors with an open cladding choice |
| `mixed-material-workshop` | feet-inches | Material hatching: CMU, brick veneer, wood frame, insulation, steel and glulam members, seven header types, footings, gravel, concrete, a variable-width L-shaped landing/walk with wall-face anchors, earth, and stacked east/west openings. Generated by `examples/build-mixed-material-workshop.mjs`; edit the generator, not the JSON |
| `mixed-material-workshop-metric` | metric | The same layout in metric sizes, from the same generator, for comparing the two hatching profiles |
| `hillside-garden-house` | feet-inches | Site plan and landscaping: synthetic lot, setbacks, contours, graded pad, curved bay wall and deck, draped surfaces, pond, trees and massed plantings. The entry path anchors to the door and derives its width from it; composition exceptions preserve room and access requirements. Generated by `examples/build-hillside-garden-house.mjs` |
| `hillside-garden-house-metric` | metric | The same site on a 300 mm module, from the same generator |

Every example uses the current building schema and an explicit composition
strategy. Tests require no unresolved composition findings and preserve
generator freshness, supported device symbols, connected routes, numeric
path widths, and drawing legibility. The set covers capabilities collectively;
each model does not need every optional feature. Material and landscape
studies explicitly omit full MEP design, and the systems examples show
selected devices rather than complete room coverage. Their fictional
jurisdictions are unresearched, and survey, structural, and sizing assumptions
remain visible.

The barn's residence has its own exterior entrance, reached from the stair
and deck, with no internal opening through the workshop ceiling. The example
checks room access around furniture and fixtures, stair-to-landing geometry,
and exposed access structures in elevations. Deck guard lines and posts are
illustrative, not a complete guard design. Handrails, infill, foundations,
fire separation, accessibility, and engineered systems remain unresolved.

The hillside entry is 914 mm wide in the imperial example and 900 mm in the
metric example because it matches its door. To request a 4 ft walk, retain
the door-centre anchor, remove `matchWidth`, and set `widthMm: 1219`; do not
widen the door just to change the walk. Image import and calibration are
exercised with synthetic images generated by tests, not invented survey
attachments in the example folders.

## License

[MIT](LICENSE)
