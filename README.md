# Architecture Studio

An [Agent Skill](https://agentskills.io) for exploring building concepts with
the coding agent you already use. Describe a house, workshop, cabin, or studio,
and your agent builds one real-unit coordinate model that drives:

- drafted floor plans, elevations, sections, and systems sheets,
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

## Project folder

```text
my-workshop/
  architecture-studio.json   skill version that created the project
  index.html                 the studio viewer
  brief.json                 your confirmed answers
  sources/                   sketches, photos, and documents you supplied
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
| `node scripts/bundle.mjs <project>` | Write one self-contained HTML file to `exports/` for sharing. It opens with a double-click and needs no server. |

`serve.mjs` picks a port derived from the project path, so a project always
opens at the same address and keeps the approvals the viewer stores in the
browser.

The viewer accepts query parameters: `view` (`plan`, `elevation`, `section`,
`systems`, `model`, `code`, `assumptions`), `level`, `section`, `elevation`,
and `model` (a path to an alternative model file).

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

Selecting an element in any drawing opens its review details: key dimensions,
a small detail drawing for stairs, openings, and roofs, the decisions the
concept leaves open, and its evidence. You can approve an element there.
Approvals are exported as `reviews/approvals.json` with the drawing set; they
record your sign-off on the concept, not a professional approval.

## Limits

- Slabs must be axis-aligned rectangles, and a model may contain one
  axis-aligned rectangular gable roof. The studio blocks unsupported or invalid
  geometry instead of approximating it.
- "Close to accurate" means model coordinates are real units and every derived
  view agrees within the declared tolerance. It does not imply structural
  adequacy, engineered system sizing, permit readiness, or construction
  accuracy.

## Development

```bash
node --test                            # run the test suite
node scripts/build-preview.mjs         # regenerate preview/index.html
node scripts/build-preview.mjs --check # fail if the preview is stale
```

`preview/index.html` is the studio template with the example model embedded.
Regenerate it after changing either file. The examples in `examples/` are
synthetic and contain no private addresses, imagery, or construction
documents.

## License

[MIT](LICENSE)
