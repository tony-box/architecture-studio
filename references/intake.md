# Intake: Gathering the Brief

The brief is everything the user knows before any geometry exists. Gather it
before writing `models/building.json`, save it to `brief.json` (validated by
`brief.schema.json`), and resume from it on later sessions.

## How to ask

- Ask in rounds of two to four questions. Never send the whole list at once.
- Use the agent's structured question tool when one exists (for example a
  multiple-choice prompt). Otherwise ask in plain chat.
- Offer concrete choices with a sensible default wherever the answer is a
  choice. Leave free-form answers for names, places, and the room program.
- Skip any question the user's first message already answered. Confirm it in
  the round summary instead of asking again.
- If `brief.json` already exists, read it first and ask only for missing or
  `needs-review` fields.
- After each round, write what you learned to `brief.json` so an interrupted
  session can resume.

## Round 1: Project basics (required)

| Field | Question | Notes |
| --- | --- | --- |
| `project.name` | What should we call this project? | Default: "Untitled building concept". |
| `project.use` | What is the building for? | Residence, workshop, accessory dwelling, studio, mixed use, other. |
| `location` | Where will it be built? | Locality, county, state or region, country. Drives code research and climate. Never ask for or store a street address unless the user offers it; the schema has no address field, so keep an offered address in source notes only when needed. |
| `levels` | How many levels, including any basement or loft? | Integer of at least 1. |
| `units` | Feet and inches, or metric? | `feet-inches` or `metric`. Selects the drafting profile. |

## Round 2: Program (required)

| Field | Question | Notes |
| --- | --- | --- |
| `program` | Which rooms and spaces do you need? | List each with quantity, an approximate size if known, and a preferred level. |
| `targetArea` | Is there a target total area or footprint? | Record the value and unit, or mark it `derive-from-program`. |
| `occupants` | Who will use it day to day? | Household size, employees, vehicles, equipment. |
| `priorities` | What matters most? | For example views, budget, workshop clearance, aging in place. |

## Round 3: Site and constraints (ask; assumptions allowed)

| Field | Question | Notes |
| --- | --- | --- |
| `site.lot` | Do you know the lot size or buildable area? | Approximate is fine. |
| `site.setbacks` | Do you know the required setbacks? | Never infer them; mark unknown setbacks for code research. |
| `site.orientation` | Which way does the main view or street face? | Sets `trueNorthDeg`. |
| `site.slope` | Is the site flat or sloped? | Direction and rough grade change. A topographic survey or contours the user supplies become `site.contours`; never invent contours beyond a stated concept slope, and mark generated ones `needs-review`. |
| `site.survey` | Do you have a survey, plat, or tree survey? | Import an image of it with `import-image.mjs add --kind survey` and follow `image-intake.md`: read bearings and distances as printed, estimate the scale for anything undimensioned, and offer the viewer's calibration. A PDF must be exported to PNG first. Property lines, setbacks, and existing trees come only from a survey, a plat, or the user; satellite imagery can orient the site and suggest candidates the user confirms, but never sets them. |
| `site.landscape` | Should the concept include landscaping? | Lawns, beds, walks, drive, patio, trees to keep or remove, new planting. Adds a site plan (L-101) and a plant schedule. |
| `site.utilities` | Municipal water and sewer, or well and septic? | Affects plumbing concept. |
| `site.access` | How do people and vehicles reach the building? | Driveway side, garage doors. |

## Round 4: Building and systems preferences (ask; assumptions allowed)

| Field | Question | Notes |
| --- | --- | --- |
| `preferences.roof` | Any roof preference? | The renderer supports one axis-aligned rectangular gable roof. Say so if the user wants something else, and record it as a handoff item. |
| `preferences.construction` | Any construction preference? | Wood frame, post frame, steel, masonry, unknown. Also ask about cladding (brick, siding, stucco) and foundation type (slab, crawlspace, basement) when known; these seed the material catalog. |
| `preferences.heating` | How should it be heated and cooled? | Heat pump, furnace, radiant, wood, undecided. |
| `preferences.water` | Water heating preference? | Tank, tankless, heat pump, undecided. |
| `preferences.accessibility` | Any accessibility needs? | Step-free entry, main-level bedroom, wider doors. |
| `preferences.appliances` | Which major appliances, and gas or electric? | Range or cooktop, wall oven, dryer, water heater, EV charger, hot tub, shop tools, generator, solar. Sets dedicated circuits, gas lines, and vents per `mep-placement-guide.md`. |
| `preferences.lighting` | Any lighting or control preferences? | Recessed or surface lights, pendants, ceiling fans, dimming, smart switches, switched receptacles in living rooms. Default: design practice in `mep-placement-guide.md`. |
| `preferences.style` | Which look should doors, windows, and fixtures follow? | Symmetric or traditional (mirrored about the centre), balanced or modern (rule of thirds), utilitarian or rhythmic (repeat the structural bays), or no preference. Default: symmetric. Sets `composition.strategy` per `composition-guide.md`; code and function still come first. |

## Round 5: Sources and research

| Field | Question | Notes |
| --- | --- | --- |
| `sources` | Do you have satellite views, site or floor plans, framing or truss plans, elevations, photos, sketches, or code documents? | Import each image with `node <skill>/scripts/import-image.mjs add` (PNG, JPEG, or WebP) and follow `image-intake.md`: estimate its scale from what is printed on it, report each estimate with its ± and method, and offer the viewer's manual calibration (start `serve.mjs` now if the user wants it; the Sources tab works before a model exists). Photos are context only. A sketch used for dimensions needs at least one trusted calibration dimension. Copy code documents and other files into `sources/`. |
| `research.network` | May I look up the adopted building code online? | If no, use supplied official code documents. Mark research `unavailable` only when neither permitted online sources nor supplied documents establish it. |

## Before modeling

1. Show a short summary of the brief: the required fields, then every
   assumption you would make for the fields the user left open.
2. Ask the user to confirm or correct it. Record each accepted assumption in
   `assumptions` with `acceptedByUser: true`.
3. Do not write `models/building.json` until every required field is filled
   and every open field is either answered or an accepted assumption.
4. Carry the accepted assumptions into `ASSUMPTIONS.md`.
