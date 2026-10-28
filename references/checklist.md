# Architecture Acceptance Checklist

## P0: Required Before Handoff

- [ ] `models/building.json` parses and all stable IDs/references resolve.
- [ ] No `error` findings remain in studio diagnostics.
- [ ] Manual coordination checks in `model-validation.md` are complete or
      explicitly unresolved; an error-free export was not treated as a full
      schema, clash, device-placement, or code review.
- [ ] Every plan, elevation, section, schedule, and 3D object derives from the
      active model; no renderer contains a competing geometry constant table.
- [ ] Opening offsets, widths, sill heights, and head heights agree in plan,
      visible elevations, sections, and 3D.
- [ ] Level, floor-to-floor, stair, eave, and ridge datums agree in every view.
- [ ] Every displayed dimension is computed from coordinates.
- [ ] Each fixture/equipment connection resolves to a system node.
- [ ] Each system edge connects nodes in its own discipline.
- [ ] System paths appear at matching coordinates in 2D and 3D.
- [ ] Plumbing, electrical, and mechanical layers can be isolated.
- [ ] Every room passes the Room Checklist in `mep-placement-guide.md`, and
      each placed device's evidence names its rule ID or code finding.
- [ ] `compose.mjs` reports no unresolved composition findings: each was
      applied or has a `composition.exceptions` entry whose reason names the
      code, structure, function, or owner choice that wins, and no
      `composition.partition-conflict` warning remains.
- [ ] Code findings cite sources or explicitly report research as unavailable.
- [ ] Recorded code check results and coverage were re-evaluated after the
      last relevant model edit; the viewer does not recompute them.
- [ ] Diagnostics, Code, Assumptions, and Handoff surfaces all state that the
      work is conceptual and requires professional verification.
- [ ] `exports/` was written by `export-drawings.mjs` after the last model
      change: `exports/manifest.json` lists every sheet and its model fingerprint
      matches the active model. No SVG was hand-written or edited.
- [ ] When the project has images, `import-image.mjs check <project>` reports
      nothing to resolve: no stale source, no entity whose
      `evidence.reference` predates its source, and no placement built on an
      old calibration.

## P1: Interaction and Legibility

- [ ] Plan and system layers remain legible at laptop and mobile widths.
- [ ] Rooms, openings, fixtures, equipment, routes, and diagnostics are
      inspectable by stable entity ID.
- [ ] Elevations include level datums and a clear view direction.
- [ ] Orbit and fly modes render a nonblank model without WebGL errors.
- [ ] Variant selection, when present, swaps the complete model in every view.
- [ ] Labels may move for legibility, but leaders retain the true model anchor.
- [ ] Sheets follow `drafting-standard.md` for the model's display units:
      standard scale, pen hierarchy, dimension terminators, title block, and
      no `label.placement` warnings left unresolved.
- [ ] Every section definition renders a section sheet with cut elements in
      poché or material hatching, and its section marks appear on the plans.
- [ ] On sheets with material detail, the material key lists exactly the
      materials drawn, and no element the brief leaves open carries an
      invented material.
- [ ] When the model has site content, L-101 shows the property line with
      bearings and distances, setbacks, contours, and every planting; its
      plant schedule shows every row with derived quantities; and the property
      line and existing trees trace to a survey or the user.
- [ ] Curved walls, slabs, and surfaces agree in plan, section, elevation, and
      3D, and no `wall.join-fallback` advisory is left unexplained.
- [ ] Changed paths and anchored surfaces were checked with `inspect.mjs`
      for requested widths, radii, end headings, and numeric clearances.

## Professional Handoff

- [ ] `ASSUMPTIONS.md` separates user facts, calibrated attachments,
      heuristics, code sources, and generated choices.
- [ ] `HANDOFF.md` identifies the selected concept, rejected alternatives,
      unresolved decisions, code coverage, and questions by discipline, and
      lists every composition exception with its reason.
- [ ] `HANDOFF.md` lists every image-derived dimension with its source image,
      its method (printed, manual, control points, or an estimated scale bar,
      dimension, stated scale, or map metadata), and its ± uncertainty, and
      marks which are estimated.
- [ ] Survey, zoning/site, structural, envelope/energy, fire/life safety,
      accessibility, plumbing, electrical, and mechanical follow-up is explicit.
- [ ] The package never describes itself as permit ready, engineered,
      construction ready, or code compliant.
- [ ] Browser approvals were reviewed against the correct project and model
      revision before applying them. Changed elements were re-approved.
- [ ] The sharing format includes what the recipient needs: the HTML bundle
      omits source images, the exported drawing ZIP, and handoff files.
