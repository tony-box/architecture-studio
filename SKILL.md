---
name: architecture-studio
description: Brainstorm close-to-accurate building concepts with drafted plans, elevations, and sections, conceptual plumbing, electrical, and mechanical layouts, advisory local-code research, and an interactive 3D walkthrough. Use when someone wants to explore a house, workshop, cabin, studio, or other small building before hiring an architect or engineer.
license: MIT
metadata:
  author: Tony Box
  version: "0.3.0"
---

# Architecture Studio

Use this skill when the user wants to explore a building concept before
handing it to a licensed architect or engineer. Produce internally consistent,
real-unit geometry and make every drawing and 3D view derive from one canonical
building model.

This workflow creates concept documents, not construction documents. Never
claim that an output is code compliant, permit ready, structurally adequate,
survey accurate, or professionally engineered.

## Requirements

- Node.js 20 or newer. The scripts use only Node built-ins; there is nothing
  to install.
- In the commands below, `<skill>` is the folder that contains this file and
  `<project>` is the user's project folder.

## Workflow

1. **Set up the project.** Ask where the project should live; default to a new
   folder named after the project inside the current working directory. Run
   `node <skill>/scripts/init.mjs <project>`. Use one folder per building.
   If the folder is already a project, continue in it: read `brief.json` and
   `models/building.json` before asking anything.
2. **Gather the brief.** Follow `references/intake.md`: ask in short rounds,
   write answers to `brief.json` (see `references/brief.schema.json`), and get
   the user's confirmation of the summary and every assumption. Do not model
   until the brief is confirmed. Import every image the user supplies with
   `node <skill>/scripts/import-image.mjs add` and follow
   `references/image-intake.md`: estimate its scale from what is printed on
   it, report each estimate with its ± and method, and offer the viewer's
   manual calibration. The viewer (step 8) can start during intake for this;
   its Sources tab works before a model exists.
3. **Read the contracts.** Read `references/coordinate-contract.md`,
   `references/building.schema.json`, `references/model-validation.md`, and
   `references/drafting-standard.md` before authoring geometry, and
   `references/curves.md` before authoring anything curved.
4. **Write the model.** Write one active model to `models/building.json`.
   Store complete alternative concepts under `models/variants/`; do not
   maintain separate plan, elevation, or 3D geometry sources. Add section
   definitions for the cuts the handoff needs. When the construction is known,
   add a `materials` catalog and assign wall and slab `layers`, opening
   `headers`, `beams`, `columns`, `foundations`, and site `surfaces` so the
   drawings hatch by material; never invent a material the brief does not
   support, and leave unknown elements without one. Draw walks, paths, and
   drives as surface `path`s (a centreline, a width, and corner radii), bowed
   edges and curved decks, rooms, and walls with `bulge`, and only free-form
   beds with Bezier controls. Anchor any point that should line up with a door,
   window, or wall instead of typing its coordinates. Follow
   `references/curves.md` for every curved shape and every curve edit: it turns
   requests like "curve it more", "move it east", or "line it up with the door"
   into numbers. When the site matters, add the property
   line, setbacks, contours, a grading limit, and `plants` with `plantings`;
   the model then draws a site plan, L-101. Lot lines, setbacks, and existing
   trees come from a survey or the user, never from imagery or a guess;
   `references/image-intake.md` covers reading surveys and site images.
5. **Validate.** Check model references, polygons, hosted openings, vertical
   datums, stairs, and system connectivity. `export-drawings.mjs` (step 9)
   prints every validation error and writes nothing until they are fixed.
   Resolve every error before handoff. Preserve warnings and advisories in the
   diagnostics and assumptions outputs. After adding or changing a curved
   element, run `node <skill>/scripts/inspect.mjs --project <project> --id <id>`
   and check its width, radii, bounds, and clearances as numbers; never judge a
   curve by guessing how it looks. When the project has images, run
   `node <skill>/scripts/import-image.mjs check <project>` and resolve
   everything it lists.
6. **Research the code.** If the user allowed network research, research
   adopted building codes and local amendments from official sources
   following `references/code-research.md`. Otherwise inspect user-provided
   documents in `sources/`. Write `reviews/code-findings.json` and
   `reviews/code-review.md`. Record citations and uncertainty; never invent a
   code finding.
7. **Lay out systems.** Stabilize the architectural envelope, then place and
   route conceptual plumbing, electrical, and mechanical systems according to
   `references/mep-concept-rules.md`.
8. **Show the studio.** Start the viewer as a background process, because it
   keeps running: `node <skill>/scripts/serve.mjs <project>`. It opens the
   user's default browser and prints the URL; always pass the URL on to the
   user, since the browser cannot open from remote or sandboxed sessions. The
   page reloads itself whenever the model, brief, sources, reviews, or
   exports change, so leave it running while you iterate. Start it once per
   session.
9. **Export the drawings.** Run
   `node <skill>/scripts/export-drawings.mjs --project <project>`. It renders
   every sheet with the same code as `index.html` and writes
   `exports/**/*.svg` plus `exports/manifest.json`. Rerun it after every model
   change; never hand-write or edit the SVG files. The viewer's Download
   drawing set button packages these files.
10. **Apply approvals.** If the user returns a `reviews/approvals.json` (the
    viewer's Approve button exports it with the drawing set), set each listed
    entity's evidence to `source: "user"` and `status: "accepted"`, keep its
    confidence, and note the approval date. Ignore entries whose
    `modelFingerprint` predates edits to that entity and ask the user to
    re-approve. An approval is the owner's sign-off on the concept, never a
    professional or code approval.
11. **Hand off.** Run the cross-view checklist in `references/checklist.md`,
    then write `ASSUMPTIONS.md` and `HANDOFF.md` for the architect and
    engineering team. Rerun the export last so the manifest lists both
    handoff files.
12. **Share (optional).** To send the concept to someone without the skill,
    run `node <skill>/scripts/bundle.mjs <project>`. It writes one
    self-contained HTML file to `exports/` that opens with a double-click.

To move an existing project to a newer version of this skill's viewer, run
`node <skill>/scripts/init.mjs <project> --update`. It replaces only
`index.html` and `architecture-studio.json`.

## Output Contract

```text
architecture-studio.json          # written by init.mjs
index.html                        # the studio viewer, written by init.mjs
brief.json                        # the confirmed intake brief
sources/                          # user-supplied sketches, photos, documents
sources/sources.json              # image scale and placement, written by import-image.mjs
models/building.json
models/variants/*.json            # optional complete alternatives
exports/manifest.json             # written by export-drawings.mjs
exports/site/site-plan.svg        # L-101 site plan, when the model has site content
exports/plans/*.svg               # A-1xx floor plans
exports/elevations/*.svg          # A-2xx exterior elevations
exports/sections/*.svg            # A-3xx building sections
exports/systems/*.svg             # M-1xx systems coordination plans
exports/<project-id>-studio.html  # optional, written by bundle.mjs
reviews/code-findings.json
reviews/code-review.md
reviews/approvals.json            # optional, exported by the viewer
ASSUMPTIONS.md
HANDOFF.md
```

The handoff must distinguish measured, user-supplied, inferred, researched,
and generated facts. It must list unresolved code questions and all MEP,
structural, site, and survey decisions that require professional verification.
