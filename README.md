# Architecture Studio

Architecture Studio is a portable OpenDesign plugin for exploring
dimensionally consistent building ideas before professional design begins. One
structured coordinate model drives drafted plan, elevation, section, and
systems sheets, an exportable SVG drawing set, and an interactive 3D view.

## Scope

The plugin is intended for programming, option studies, spatial coordination,
and professional handoff. It is not a substitute for a survey, licensed
architect, structural engineer, MEP engineer, energy professional, or authority
having jurisdiction.

“Close to accurate” means that model coordinates are real units and that every
derived view agrees within the declared tolerance. It does not imply structural
adequacy, engineered system sizing, permit readiness, or construction accuracy.

## Install and Apply

From the OpenDesign repository:

```bash
corepack pnpm exec od plugin validate ./plugins/community/architecture-studio --no-daemon
corepack pnpm exec od plugin install ./plugins/community/architecture-studio
corepack pnpm exec od plugin apply architecture-studio \
  --input project_name="Workshop residence" \
  --input jurisdiction="Town, County, State, US" \
  --input building_program="Workshop below, two-bedroom residence above" \
  --input levels=2 \
  --input display_units=feet-inches
```

The plugin requests file read/write and network capabilities. File access lets
the agent stage the studio, model schema, and generated outputs. Network access
is used only to research current official jurisdiction sources. A trusted local
installation receives the requested capabilities; other install sources remain
restricted until the user reviews and grants them.

## Canonical Outputs

```text
index.html
models/building.json
models/variants/*.json
exports/manifest.json
exports/plans/*.svg
exports/elevations/*.svg
exports/sections/*.svg
exports/systems/*.svg
reviews/code-findings.json
reviews/code-review.md
ASSUMPTIONS.md
HANDOFF.md
```

Open `index.html` through OpenDesign to inspect the model. WebGL content uses
the existing powered-preview path. The studio also accepts a development model
override:

```text
assets/studio-template.html?model=../examples/lakeside-barn-residence/building.json
```

Other query parameters: `view` (`plan`, `elevation`, `section`, `systems`,
`model`, `code`, `assumptions`), `level`, and `section`.

## Drawings

Every drawing is a drafted sheet with a border, title block, view title,
graphic scale bar, and (on plans) a north arrow. Linework weight, lettering,
dimensions, and symbols follow `references/drafting-standard.md`:

- `feet-inches` models use an NCS-informed imperial profile: ANSI B sheets,
  architect's scales, architectural tick terminators.
- `metric` models use an ISO-informed metric profile: A3 sheets, ISO scales,
  arrow terminators, dimensions in millimetres.

The profiles are informed by those standards; the drawings never claim
conformance to them, and every title block reads "Concept - not for
construction".

The viewer around the sheets (tabs, toolbar, inspector, Code and Assumptions
pages) follows `references/viewer-chrome.md`.

## Exported Drawing Set

`scripts/export-drawings.ts` renders every sheet with the same code the viewer
runs and writes standalone SVG files plus `exports/manifest.json`:

```bash
node --experimental-strip-types scripts/export-drawings.ts --project <project-dir>
```

The script refuses to write anything while the model has validation errors.
The manifest records a model fingerprint, so the viewer can tell when the
exported drawings are older than the model. The viewer's **Download drawing
set** button packages the files listed in the manifest into one ZIP; it does
not render anything itself.

## Included Fixture

`examples/lakeside-barn-residence/building.json` is synthetic. It exercises a
two-level workshop/residence, hosted openings, stairs, roof geometry, all three
MEP disciplines, evidence metadata, and handoff assumptions. It contains no
private address, satellite imagery, photographs, or construction documents.

## Development Validation

```bash
node --experimental-strip-types --test plugins/community/architecture-studio/tests/studio-template.test.ts
corepack pnpm exec od plugin validate ./plugins/community/architecture-studio --no-daemon
node --experimental-strip-types plugins/community/architecture-studio/scripts/build-preview.ts --check
corepack pnpm guard
corepack pnpm --filter @open-design/plugin-runtime typecheck
```

Visual acceptance must confirm that plan, elevation, section, systems, and 3D
views all use the same openings, levels, stair, roof, and system coordinates.

`preview/index.html` is generated from the studio template with the example
model embedded; regenerate it with `scripts/build-preview.ts` after changing
either file.

Slabs must be axis-aligned rectangles, and the active model may contain one
axis-aligned rectangular gable roof. The studio blocks unsupported or invalid
geometry instead of approximating it.
