---
name: architecture-studio
description: Use this plugin to brainstorm close-to-accurate architecture concepts with drafted plans, elevations, and sections, conceptual MEP layouts, advisory local-code research, and an interactive 3D walkthrough.
license: MIT
metadata:
  author: OpenDesign Community
  version: "0.2.0"
---

# Architecture Studio

Use this plugin when the user wants to explore a building concept before
handing it to a licensed architect or engineer. Produce internally consistent,
real-unit geometry and make every drawing and 3D view derive from one canonical
building model.

This workflow creates concept documents, not construction documents. Never
claim that an output is code compliant, permit ready, structurally adequate,
survey accurate, or professionally engineered.

## Workflow

1. Gather the project location, use, approximate size, levels, site constraints,
   room program, preferred units, and source materials. If a sketch or image is
   dimensional evidence, require at least one trusted calibration dimension.
2. Read `references/coordinate-contract.md`,
   `references/building.schema.json`, `references/model-validation.md`, and
   `references/drafting-standard.md` before authoring geometry.
3. Write one active model to `models/building.json`. Store complete alternative
   concepts under `models/variants/`; do not maintain separate plan, elevation,
   or 3D geometry sources.
4. Validate model references, polygons, hosted openings, vertical datums,
   stairs, and system connectivity. Resolve every error before handoff. Preserve
   warnings and advisories in the diagnostics and assumptions outputs.
5. Research adopted building codes and local amendments from official sources
   when network access is available. Otherwise inspect user-provided source
   documents. Record citations and uncertainty; never invent a code finding.
6. Stabilize the architectural envelope, then place and route conceptual
   plumbing, electrical, and mechanical systems according to
   `references/mep-concept-rules.md`.
7. Copy `assets/studio-template.html` to `index.html`. It renders drafted
   plan, elevation, section, and systems sheets plus a conceptual 3D model
   from `models/building.json`, following `references/drafting-standard.md`
   (NCS-informed for feet-inches models, ISO-informed for metric models). Add
   section definitions for the cuts the handoff needs.
8. Export the drawing set: copy `scripts/export-drawings.ts` into the project
   and run `node --experimental-strip-types export-drawings.ts --project .`.
   It renders every sheet with the same code as `index.html` and writes
   `exports/**/*.svg` plus `exports/manifest.json`. Rerun it after every model
   change; never hand-write or edit the SVG files. If the script cannot run
   (no Node 24), say so in `HANDOFF.md` instead of producing drawings another
   way. The viewer's Download drawing set button packages these files.
9. Run the cross-view checklist in `references/checklist.md`, then write
   `ASSUMPTIONS.md` and `HANDOFF.md` for the architect and engineering team.
   Rerun the export last so the manifest lists both handoff files.

## Output Contract

```text
index.html
models/building.json
models/variants/*.json            # optional complete alternatives
exports/manifest.json             # written by export-drawings.ts
exports/plans/*.svg               # A-1xx floor plans
exports/elevations/*.svg          # A-2xx exterior elevations
exports/sections/*.svg            # A-3xx building sections
exports/systems/*.svg             # M-1xx systems coordination plans
reviews/code-findings.json
reviews/code-review.md
ASSUMPTIONS.md
HANDOFF.md
```

The handoff must distinguish measured, user-supplied, inferred, researched,
and generated facts. It must list unresolved code questions and all MEP,
structural, site, and survey decisions that require professional verification.
