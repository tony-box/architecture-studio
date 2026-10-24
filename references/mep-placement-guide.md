# MEP Placement Guide

Where to put fixtures, receptacles, switches, lights, alarms, and HVAC parts in
a dwelling concept. `mep-concept-rules.md` covers sequence, routing, and
coordination; this file covers placement. Read both before laying out systems,
and read this one whenever the user asks to add or move a device.

Placement here is concept guidance. It never sizes circuits, conductors,
pipes, ducts, or equipment, and it never makes the concept code compliant.

## Two Kinds of Rule

Every rule below is one of two kinds. Keep them apart in the model and in the
handoff.

- **Code baseline.** A requirement summarized from a widely adopted US model
  code, with its section. Sections and values follow NEC 2023 (NFPA 70), IRC
  2021, and NFPA 72 unless noted; other editions renumber or change them, and
  states and cities amend them. A baseline tells the agent where to look and
  gives a reasonable starting position. It is not a cited finding.
- **Design practice.** A conventional choice from trade practice and the NKBA
  kitchen and bath planning guidelines. It has no code status, the owner may
  override it, and it never raises a code conflict.

How the two connect to `code-research.md`:

1. Place elements using the baseline and design practice. Record evidence as
   `source: "heuristic"`, `status: "needs-review"`, and put the rule ID from
   this file plus the model-code section in `evidence.reference`, for example
   `"MEP-E4; NEC 2023 210.52(C)"`.
2. When `reviews/code-findings.json` has a verified finding for the same topic
   in the project's jurisdiction, the finding wins. Move the element to suit
   it, switch its evidence to `source: "code-source"`, and cite the finding ID.
3. A baseline value becomes a numeric check in the coverage report only
   through a cited finding. Without one, the topic stays **Unresolved** and is
   listed in `HANDOFF.md`.
4. Outside the United States these baselines do not apply. Canada (CSA C22.1
   and the provincial building and plumbing codes), the UK (BS 7671 and the
   Approved Documents), Australia and New Zealand (AS/NZS 3000 and the NCC),
   and the EU each set different zones, heights, and protection rules. Use
   design practice only and research the local code.

Edition-sensitive topics deserve an explicit research question: kitchen
island receptacles, the GFCI location list, AFCI locations, the bathtub and
shower receptacle zone, emergency service disconnects, and range-hood makeup
air. Local amendments most often change these.

## When the User Asks to Add Something

1. Read `brief.json`, the jurisdiction, and `reviews/code-findings.json`.
   State which code edition governs, or that it is unknown.
2. Ask only what changes placement, in one short round:
   - furniture that fixes walls: bed headboard, sofa, TV, desk, dining table;
   - appliances and their fuel: range or cooktop (gas or electric), wall oven,
     dryer (gas or electric), water heater type, EV charger, hot tub, shop
     tools, generator, solar;
   - lighting character: recessed, surface, pendants, fans, dimming;
   - control preferences: smart switches, occupancy sensors, switched
     receptacles in living rooms.
3. Place in this order: furniture and appliances, plumbing fixtures,
   equipment, receptacles, lights, switches, alarms, HVAC terminals,
   thermostats.
4. Connect every device to its conceptual circuit or system (see Modeling
   Devices) and run the validation in `model-validation.md`.
5. Report what was placed by rule ID, what came from design practice, and
   which topics remain unresolved for the electrician, plumber, or mechanical
   designer.

## Modeling Devices

- Plumbing fixtures and fixed appliances that occupy floor area are
  `fixtures`: `toilet`, `lavatory`, `sink`, `kitchen-sink`, `bathtub`,
  `shower`, `washer`, `dryer`, `range`, `cooktop`, `dishwasher`,
  `refrigerator`.
- Serviceable equipment is `equipment`: `electrical-panel`, `meter`,
  `service-disconnect`, `water-heater`, `furnace`, `air-handler`,
  `heat-pump`, `outdoor-unit`, `erv`, `boiler`, `sump-pump`, `ev-charger`.
- Wall, ceiling, and floor devices are nodes in their discipline's system,
  positioned at the finished face. `z` is absolute, so a device's `z` is the
  level elevation plus its mounting height. Use these node kinds:
  - electrical: `receptacle`, `receptacle-gfci`, `receptacle-240v`,
    `receptacle-dedicated`, `receptacle-weather`, `floor-receptacle`,
    `future-receptacle`, `switch`, `switch-3way`, `switch-4way`, `dimmer`,
    `light-ceiling`, `light-recessed`, `light-pendant`, `light-wall`,
    `light-undercabinet`, `light-exterior`, `ceiling-fan`, `smoke-alarm`,
    `co-alarm`, `smoke-co-alarm`, `junction-box`, `panel`, `circuit-end`;
  - mechanical: `supply-register`, `return-grille`, `transfer-grille`,
    `exhaust-fan`, `range-hood`, `dryer-exhaust`, `exhaust-termination`,
    `outdoor-air-intake`, `thermostat`, `ductless-head`;
  - plumbing: `fixture-connection`, `vertical-stack`, `vent-terminal`,
    `cleanout`, `main-shutoff`, `fixture-shutoff`, `hose-bibb`,
    `floor-drain`, `gas-shutoff`.
- Every node must be reached by an edge. Chain receptacles and lights on a
  conceptual circuit back to a `panel` node; connect a switch to the lights it
  controls with a switch-leg edge. Name the circuit group in the edge note
  (for example "kitchen small-appliance circuit 1"), never a breaker size.
- Name nodes by room and function, such as `e-kitchen-counter-1` or
  `m-bed2-supply`, so diagnostics point at a findable device.
- Each node kind and equipment kind above has a standard symbol or tag on the
  systems sheets (`drafting-standard.md`, Systems Symbols). A wall device
  sits on its wall only when its position is within 300 mm of the wall face,
  so put it at the finished face. Invent no other kinds: an unlisted kind
  draws as a plain dot with no key entry.

## Electrical

### Service and Panel

- **MEP-E1 Working space (code baseline, NEC 110.26).** Keep a clear space in
  front of the panel at least 30 in (762 mm) wide or the panel's width,
  whichever is greater, 36 in (914 mm) deep, and 6.5 ft (1981 mm) high. Keep
  the zone above the panel free of ducts and pipes. Model the space as an
  equipment clearance and flag any door swing, fixture, or storage in it.
- **MEP-E2 Prohibited locations (code baseline, NEC 240.24).** No panel in a
  bathroom, a clothes closet, or over stair steps.
- **MEP-E3 Disconnects (code baseline, NEC 230.70 and 230.85).** The service
  disconnect sits at a readily accessible point nearest the service entry.
  Recent editions add an outdoor emergency disconnect for one- and two-family
  dwellings. The utility sets meter location; record it as an assumption.
- **Design practice.** Put the panel in a garage, utility, or mechanical room
  near the service entry and close to the heaviest loads (kitchen, laundry,
  HVAC, EV). Keep it on a wall that has no plumbing and no exterior glazing,
  and leave room for a second panel or a transfer switch.

### Receptacles

- **MEP-E4 General wall spacing (code baseline, NEC 210.52(A)).** In living
  rooms, bedrooms, dining rooms, dens, and similar rooms, no point along the
  floor line of any wall 2 ft (610 mm) or wider may be more than 6 ft
  (1829 mm) from a receptacle, so receptacles fall at most 12 ft (3658 mm)
  apart along the wall. Count fixed glass panels as wall. Receptacles over
  5.5 ft (1676 mm) high or inside cabinets do not count. A floor receptacle
  counts only within 18 in (457 mm) of the wall.
- **MEP-E5 Kitchen countertops (code baseline, NEC 210.52(C) and 210.11(C)(1)).**
  Every counter 12 in (305 mm) or wider gets a receptacle, and no point along
  the wall line may be more than 24 in (610 mm) from one, so receptacles fall
  at most 4 ft (1219 mm) apart. Sinks, ranges, and refrigerators split the
  counter into separate spaces. Receptacles sit no more than 20 in (508 mm)
  above the counter. At least two 20 A small-appliance circuits serve the
  kitchen, pantry, and dining counter and wall receptacles.
- **MEP-E6 Islands and peninsulas (code baseline, edition sensitive).** NEC
  2023 210.52(C)(2) no longer requires an island or peninsula receptacle but
  requires provision for a future one; model a `future-receptacle` node. NEC
  2020 and earlier require at least one. A receptacle on an island goes on or
  above the work surface, or in a listed countertop assembly, never on the
  cabinet face below.
- **MEP-E7 Bathrooms (code baseline, NEC 210.52(D), 210.11(C)(3), 406.9(C)).**
  At least one receptacle within 3 ft (914 mm) of the outside edge of each
  basin, on the adjacent wall or on the vanity side or face no more than
  12 in (305 mm) below the countertop. Feed bathroom receptacles from a 20 A
  bathroom circuit. No receptacle inside a zone 3 ft (914 mm) horizontally
  and 8 ft (2438 mm) vertically from a bathtub rim or shower threshold.
- **MEP-E8 Laundry (code baseline, NEC 210.52(F), 210.11(C)(2)).** At least
  one receptacle on a 20 A laundry circuit. Add a 240 V receptacle for an
  electric dryer, or a 120 V receptacle and a gas connection for a gas dryer.
- **MEP-E9 Garage, basement, accessory buildings (code baseline, NEC
  210.52(G), 210.11(C)(4)).** At least one receptacle in each vehicle bay,
  no higher than 5.5 ft (1676 mm), and in each unfinished part of a
  basement. Detached garages and accessory buildings with power get at least
  one. A 20 A garage circuit serves garage receptacles.
- **MEP-E10 Outdoors (code baseline, NEC 210.52(E)).** At least one
  receptacle at the front and one at the back of a one-family dwelling,
  accessible from grade and no higher than 6.5 ft (1981 mm). Each balcony,
  deck, or porch reached from inside gets one, no higher than 6.5 ft above
  its walking surface.
- **MEP-E11 Halls and foyers (code baseline, NEC 210.52(H) and (I)).** A
  hallway 10 ft (3048 mm) or longer gets at least one receptacle. A foyer
  over 60 sq ft (5.6 m²) gets one on each wall 3 ft (914 mm) or wider.
- **MEP-E12 HVAC service receptacle (code baseline, NEC 210.63).** A
  receptacle on the same level within 25 ft (7620 mm) of heating, cooling,
  and refrigeration equipment, including rooftop and attic units.
- **MEP-E13 Protection (code baseline, NEC 210.8(A), 210.12, 406.12).** Mark
  each receptacle that needs GFCI protection: bathrooms, kitchens, garages
  and accessory buildings, outdoors, crawl spaces, basements, laundry areas,
  within 6 ft (1829 mm) of a sink, tub, or shower, and indoor damp or wet
  locations. Recent editions extend GFCI to 240 V receptacles in those
  locations and to dishwashers and some outdoor equipment. AFCI protection
  covers 120 V, 15 and 20 A circuits in nearly every habitable room, hallway,
  closet, kitchen, and laundry. Dwelling receptacles are tamper resistant.
  These lists vary more by edition and amendment than anything else here;
  record them as `receptacle-gfci` or a note, never as breaker selections.
- **Design practice.**
  - General receptacles at 12-18 in (305-457 mm) to center above the floor;
    counter receptacles at 42-44 in (1067-1118 mm), about 6-8 in above a
    36 in counter; garage and shop receptacles at 42-48 in (1067-1219 mm)
    to clear benches.
  - Put a receptacle on each side of the bed headboard wall, at the TV wall
    (often 48-60 in, 1219-1524 mm, behind the screen), at the desk, and in
    a floor box under a sofa that floats in a large room.
  - Give the refrigerator, dishwasher, disposal, microwave, range or cooktop,
    wall oven, washer, dryer, sump pump, and freezer their own labeled
    receptacle or connection on the appliance's own circuit group.
  - Offer a 240 V circuit in the garage for an EV charger on the side of the
    bay that matches the vehicle's charge port, even when no EV exists yet.
  - Add a switched receptacle under the eaves for seasonal lighting, and one
    on each side of the house for tools.
  - Keep receptacles out of the back of base cabinets, behind fixed
    appliances other than the one they serve, and inside door swings.
  - Hot tubs, pools, generators, solar, and battery storage (NEC Articles
    680, 702, 705, 690, 706) go straight to the handoff as specialty items.

### Lighting and Switches

- **MEP-E14 Required lighting (code baseline, NEC 210.70(A)).** Every
  habitable room, kitchen, and bathroom gets at least one wall-switched
  lighting outlet. In habitable rooms other than kitchens and bathrooms, a
  wall-switched receptacle may stand in for it. Hallways, stairways,
  attached garages, and detached garages with power each get one. Each
  outdoor entrance with grade-level access gets a wall-switched light; a
  garage vehicle door does not count as an entrance.
- **MEP-E15 Stair switching (code baseline, NEC 210.70(A)(2)).** A stair
  with six or more risers gets a switch at each floor level, and at each
  landing that has an entry, for the stair lighting.
- **MEP-E16 Service spaces (code baseline, NEC 210.70).** Attics, crawl
  spaces, utility rooms, and basements that hold equipment get a light at or
  near the equipment, switched at the point of entry.
- **MEP-E17 Wet zones (code baseline, NEC 410.10(D), 404.4(C)).** No
  pendant, track, cord-hung, or ceiling-suspended fan within 3 ft (914 mm)
  horizontally and 8 ft (2438 mm) vertically of a tub rim or shower
  threshold. Lights in that zone are listed for damp or wet locations. No
  switch inside a tub or shower space.
- **MEP-E18 Closets (code baseline, NEC 410.16).** Closet lights stay out of
  the storage zone along the walls and shelves; the required separation
  depends on the luminaire type. Prefer enclosed LED fixtures on the ceiling
  above the door.
- **Design practice.**
  - Put a switch on the latch side of each door, 4-6 in (102-152 mm) from
    the casing, at 42-48 in (1067-1219 mm) to the top. Never behind the
    door swing.
  - Use three-way switches at both ends of halls, at each entrance of a room
    with two entrances that are more than about 10 ft (3 m) apart, at the top
    and bottom of stairs, and at the house and garage ends of a garage.
    Use four-way switches for a third location.
  - Gang switches at one location; order them from the door outward.
    Exterior lights switch from inside the door they serve.
  - Layer lighting: ambient (ceiling or recessed), task (under-cabinet,
    vanity, desk), accent (wall washers, art). Dim living, dining, and
    bedroom lighting.
  - Space recessed lights about one ceiling height apart down the room's
    center, or about half a ceiling height from walls when lighting the
    walls. Center a run over counters 18-24 in (457-610 mm) from the wall.
  - Hang pendants 30-36 in (762-914 mm) above an island or table. Mount
    vanity lights on both sides of the mirror at about 60-66 in
    (1524-1676 mm), or above it at 75-80 in (1905-2032 mm).
  - Keep ceiling-fan blades at least 7 ft (2134 mm) above the floor and
    18 in (457 mm) from walls (manufacturer limits govern).
  - Use occupancy or vacancy sensors in closets, laundry, pantry, and
    garage. Switch a walk-in closet light outside the door or with a jamb
    switch.

### Smoke and CO Alarms

- **MEP-E19 Smoke alarms (code baseline, IRC R314.3 and R314.4).** One in
  each sleeping room, one outside each sleeping area near the bedrooms, and
  one on each story including basements and habitable attics. Keep each at
  least 3 ft (914 mm) horizontally from the door of a bathroom with a tub or
  shower. Alarms are interconnected.
- **MEP-E20 Smoke-alarm siting (code baseline, NFPA 72).** Keep alarms away
  from cooking appliances; the distance depends on alarm type (roughly 10 ft,
  3 m, in general, 20 ft, 6 m, for ionization, down to 6 ft, 1.8 m, for
  alarms listed for nuisance resistance). Keep 3 ft (914 mm) from supply
  registers and ceiling-fan blade tips. Ceiling mount at least 4 in
  (102 mm) from the wall, or wall mount with the top 4-12 in (102-305 mm)
  below the ceiling.
- **MEP-E21 CO alarms (code baseline, IRC R315).** Required when the house
  has a fuel-burning appliance or fireplace, or an attached garage that opens
  into the house. Place outside each sleeping area near the bedrooms, and in
  a bedroom that contains or adjoins a fuel-burning appliance. A combined
  `smoke-co-alarm` node may serve both rules at one spot.

## Plumbing

### Fixture Clearances

- **MEP-P1 Toilets and lavatories (code baseline, IRC R307.1 and P2705).**
  A toilet centerline is at least 15 in (381 mm) from any side wall, vanity,
  tub, or other fixture, with at least 21 in (533 mm) clear in front. A
  lavatory has at least 21 in (533 mm) clear in front. Jurisdictions on the
  UPC require 24 in (610 mm) in front of a toilet and 30 in (762 mm) between
  toilet centers.
- **MEP-P2 Showers and tubs (code baseline, IRC P2708.1 and R307.1).** A
  shower has at least 900 sq in (0.58 m²) inside and holds a 30 in (762 mm)
  circle; the entry is at least 22 in (559 mm) clear; hinged doors swing
  out; 24 in (610 mm) clear in front of the entry. A tub has 21 in (533 mm)
  clear along its open side.
- **MEP-P3 Bathroom ventilation (code baseline, IRC R303.3 and M1505.4).**
  An openable window of at least 3 sq ft (0.28 m²), half of it openable, or
  an exhaust fan to outdoors at 50 cfm (24 L/s) intermittent or 20 cfm
  (9.4 L/s) continuous. Place the fan between the shower and toilet.
- **Design practice (NKBA bath).**
  - Plan 30 in (762 mm) clear in front of fixtures and 18 in (457 mm) from a
    toilet centerline to the side; a 36 by 36 in (914 by 914 mm) shower or
    larger; 30 by 60 in (762 by 1524 mm) for a toilet compartment.
  - Space double-vanity basins about 36 in (914 mm) on center; vanity height
    32-43 in (813-1092 mm).
  - Keep the toilet out of the direct sightline from the bathroom door and
    from living spaces when the door is open.
  - Put a shower valve near the entry so the user can reach it without
    stepping into the spray.

### Kitchen and Laundry

- **MEP-P4 Laundry standpipe (code baseline, IRC P2706.2).** A washer
  standpipe extends 18-42 in (457-1067 mm) above its trap weir; model a
  washer box behind the washer.
- **Design practice (NKBA kitchen).**
  - Work triangle (sink, cooking surface, refrigerator): each leg 4-9 ft
    (1219-2743 mm), total 13-26 ft (3962-7925 mm), with no tall cabinet or
    island cutting a leg.
  - Landing space: 24 in (610 mm) on one side of the sink and 18 in
    (457 mm) on the other; 12 in (305 mm) and 15 in (381 mm) beside the
    cooktop; 15 in (381 mm) on the handle side of the refrigerator.
  - Work aisles 42 in (1067 mm) for one cook and 48 in (1219 mm) for two;
    walkways 36 in (914 mm).
  - Dishwasher within 36 in (914 mm) of the sink edge; no cooktop under an
    operable window.
  - An island sink needs an island vent or an air admittance valve; record
    which as an open plumbing item (see MEP-P8).
  - Put the laundry near the bedrooms, on an exterior wall for the dryer
    duct, with a floor drain or pan if it sits over finished space.

### Water Heating and Distribution

- **MEP-P5 Water heater (code baseline, IRC P2801, P2804, G2408, M1305.1).**
  A pan with a drain where a leak would cause damage; a relief-valve
  discharge to a safe point; a level working space at least 30 by 30 in
  (762 by 762 mm) on the control side; seismic strapping in seismic design
  categories D0-D2; a fuel-fired unit in a garage with its ignition source at
  least 18 in (457 mm) above the floor unless listed otherwise, and guarded
  from vehicle impact.
- **MEP-P6 Shutoffs (code baseline, IRC P2903.9, G2420.5).** A full-open
  main shutoff on the building supply near its entry, a shutoff at each
  fixture, and a gas shutoff within 6 ft (1829 mm) of each gas appliance.
- **Design practice.**
  - Center the water heater among the wet rooms to shorten hot-water runs,
    or plan a recirculation loop and say so.
  - A heat-pump water heater needs a large air volume, a condensate drain,
    and a place where its noise and cool exhaust are acceptable; follow the
    manufacturer.
  - A tankless gas unit needs a vent terminal on an exterior wall that meets
    MEP-M6; an electric tankless unit needs a large dedicated circuit.
  - Keep supply pipes out of exterior walls in cold climates. Put a
    frost-free hose bibb on at least two sides of the house.

### Drains and Vents

- **MEP-P7 Drain slope (code baseline, IRC P3005.3).** Horizontal drains
  2.5 in (64 mm) and smaller slope at least 1/4 in per ft (2%); 3 in (76 mm)
  and larger at least 1/8 in per ft (1%). Use this to reserve floor or
  ceiling depth; size stays `unverified`.
- **MEP-P8 Trap-to-vent distance (code baseline, IRC Table P3105.1).** The
  trap arm from a fixture trap to its vent is limited by trap size: about
  5 ft (1524 mm) for 1-1/4 in, 6 ft (1829 mm) for 1-1/2 in, 8 ft
  (2438 mm) for 2 in, 12 ft (3658 mm) for 3 in, and 16 ft (4877 mm) for
  4 in. Keep fixtures that close to a stack or a vent, or flag the gap.
  Air admittance valves (IRC P3114) are allowed in many IRC jurisdictions
  and restricted under the UPC; mark them as a research question.
- **MEP-P9 Vent terminals (code baseline, IRC P3103.1 and P3103.5).** A vent
  through the roof rises at least 6 in (152 mm) above it, or more where
  snow is deep. Keep each terminal at least 10 ft (3048 mm) horizontally
  from, or 3 ft (914 mm) above, any operable window, door, or air intake.
- **MEP-P10 Cleanouts (code baseline, IRC P3005.2).** At the base of each
  stack, at changes of direction greater than 45 degrees, at the upper end
  of horizontal drains, and near where the building drain leaves the house.
  Keep 18 in (457 mm) clear in front of cleanouts on 3 in (76 mm) and larger
  pipe and 12 in (305 mm) on smaller pipe.
- **Design practice.**
  - Stack bathrooms vertically and put wet rooms back to back on one wet
    wall. A wall carrying a 3 in stack needs about 6 in (152 mm) of framing
    depth.
  - Keep the toilet within a few feet of the stack; it has the largest drain
    and the least routing freedom.
  - Never route drains over electrical panels, through joists that bear a
    concentrated load, or above food-preparation areas without a review
    note.
  - Basements below the sewer need an ejector pit; slab basements in wet
    soils need a sump pit. Ask, then mark as assumptions.

## Mechanical

### Equipment

- **MEP-M1 Access (code baseline, IRC M1305.1).** Each appliance has a level
  working space at least 30 by 30 in (762 by 762 mm) on its control side and
  an access path large enough to remove its largest part.
- **MEP-M2 Attic equipment (code baseline, IRC M1305.1.3).** An opening at
  least 20 by 30 in (508 by 762 mm), a passageway at least 22 in (559 mm)
  wide and 30 in (762 mm) high and no more than 20 ft (6096 mm) long, solid
  flooring at least 24 in (610 mm) wide, a light switched at the entry, and
  a receptacle per MEP-E12. Crawl-space equipment follows similar limits.
- **MEP-M3 Garage equipment (code baseline, IRC G2408, R302.5).** Fuel-fired
  appliances with an ignition source sit at least 18 in (457 mm) above the
  garage floor unless listed otherwise and are protected from vehicles.
  Ducts through the garage-to-house separation are steel with no openings
  into the garage. No return air comes from the garage.
- **MEP-M4 Outdoor units (code baseline, NEC 440.14, 210.63).** A disconnect
  within sight of the unit and a service receptacle within 25 ft
  (7620 mm). Clearances to walls and overhead come from the manufacturer.
- **Design practice.**
  - Put the air handler or furnace near the middle of the zone it serves,
    inside conditioned space where the climate and budget allow.
  - Place outdoor units away from bedroom windows, patios, and the dryer
    exhaust, on a pad or stand above the expected snow depth, out from under
    roof drip lines, and close to the indoor unit for a short line set.
  - Plan a condensate route to a drain or outdoors for every cooling coil,
    heat-pump water heater, and high-efficiency furnace.

### Air Distribution

- **MEP-M5 Return air limits (code baseline, IRC M1602.2).** No return air
  from bathrooms, toilet rooms, kitchens, closets, garages, mechanical rooms,
  or unconditioned attics, and none near a fuel-burning appliance's draft
  hood in the same room.
- **Design practice.**
  - In heating-dominated climates, put supply registers low under windows
    on exterior walls. In cooling-dominated climates, use high sidewall or
    ceiling registers that throw toward exterior walls.
  - Give each bedroom a return, a transfer grille, or a jump duct so the
    room is not pressurized when the door closes. A central hall return
    works for open plans.
  - Keep registers clear of furniture walls, door swings, and the space
    under beds; keep them at least 3 ft (914 mm) from smoke alarms
    (MEP-E20).
  - Put a ductless head high on a wall with a clear throw down the room's
    long axis, not directly over a bed or desk, with its condensate route
    and line set path noted.
  - Put the thermostat on an interior wall at about 48-60 in
    (1219-1524 mm), away from supply registers, direct sun, kitchens, and
    exterior doors. Keep it at 48 in (1219 mm) or lower where accessible
    controls are a goal.

### Exhaust and Ventilation

- **MEP-M6 Combustion vents (code baseline, IRC G2427.8 and manufacturer).**
  A mechanical-draft vent terminal sits at least 4 ft (1219 mm) below or
  beside, or 1 ft (305 mm) above, any door, operable window, or gravity air
  inlet. Direct-vent terminals follow the manufacturer's shorter distances.
  Prefer sealed-combustion appliances. IRC G2406.2 generally keeps
  fuel-burning appliances out of bedrooms, bathrooms, and toilet rooms
  unless they are direct vent; treat any exception as a research question.
- **MEP-M7 Intakes and exhausts (code baseline, IRC R303.5 and M1504.3).**
  Outdoor-air intakes stay at least 10 ft (3048 mm) from plumbing vents,
  flues, exhaust outlets, driveways, and streets, unless 3 ft (914 mm) below
  the source. Exhaust terminations stay at least 3 ft (914 mm) from property
  lines and from operable openings. Exhaust never ends in an attic, soffit,
  or crawl space.
- **MEP-M8 Kitchen exhaust (code baseline, IRC M1505.4 and M1503.6).** At
  least 100 cfm (47 L/s) intermittent or 25 cfm (12 L/s) continuous to
  outdoors. A hood able to exhaust more than 400 cfm (189 L/s) needs makeup
  air in IRC 2021 when the house has a fuel-burning appliance that is not
  direct vent or power vented; amendments vary.
- **MEP-M9 Dryer exhaust (code baseline, IRC M1502).** An independent duct
  to outdoors no longer than 35 ft (10668 mm), less 2.5 ft (762 mm) per
  45 degree bend and 5 ft (1524 mm) per 90 degree bend, unless the
  manufacturer allows more. Terminate at least 3 ft (914 mm) from openings
  into the building unless the manufacturer says otherwise.
- **MEP-M10 Whole-house ventilation (code baseline, IRC R303.4 and
  M1505.4).** A dwelling tighter than 5 air changes per hour at 50 Pa needs
  whole-house mechanical ventilation. New construction usually lands there;
  place an ERV or HRV and its two exterior terminations per MEP-M7.
- **Design practice.**
  - Duct the range hood straight up or straight out; put the cooktop on an
    exterior wall or plan a ceiling chase.
  - Put the laundry on an exterior wall to keep the dryer duct short and
    straight.
  - Group exterior terminations on one or two facades and keep them off the
    front elevation when the design allows.

### Fireplaces and Stoves

- Clearances to combustibles, hearth extensions, chimney height, and
  outdoor combustion air come from IRC Chapter 10, M1414, and the listing.
  Model the hearth and chimney zone, and route every fireplace, stove, and
  chimney to the handoff.

## Room Checklist

Use this to make sure nothing is forgotten. Each item names the rules that
place it; `E5` means `MEP-E5`.

| Room | Electrical | Plumbing | Mechanical |
| --- | --- | --- | --- |
| Kitchen | Counter receptacles (E5, E6), appliance circuits, switched ceiling and under-cabinet lights (E14), GFCI (E13) | Sink, dishwasher, refrigerator water line, gas shutoff (P6), island vent (P8) | Range hood (M8), supply register, no return (M5) |
| Bathroom | Receptacle within 3 ft of each basin, outside the wet zone (E7), switched light and fan (E14, E17) | Toilet, lavatory, tub or shower clearances (P1, P2) | Exhaust fan (P3, M7), supply register, no return (M5) |
| Bedroom | Wall receptacles (E4), headboard and desk receptacles, switched light or receptacle (E14), smoke alarm (E19) | None | Supply register, return or transfer path |
| Living, dining, den | Wall receptacles (E4), floor box for floating furniture, switched light or receptacle (E14) | None | Supply register, return, thermostat |
| Hall, foyer, stair | Receptacle (E11), three-way switching (E15), smoke alarm outside bedrooms (E19), CO alarm (E21) | None | Central return |
| Laundry | 20 A receptacle and dryer receptacle (E8), light (E14) | Washer box (P4), floor drain or pan | Dryer exhaust (M9) |
| Garage | Receptacle per bay, EV circuit (E9), switched light at each door (E14) | Hose bibb, water heater if placed here (P5) | Elevated fuel appliances, sealed separation (M3) |
| Mechanical, utility, basement | Panel clearance (E1, E2), service receptacle (E12), light switched at entry (E16) | Main shutoff (P6), water heater (P5), cleanouts (P10), sump or ejector | Equipment access (M1), combustion and condensate routes (M6) |
| Attic, crawl space | Light at entry and equipment (E16), service receptacle (E12) | None | Access path and platform (M2) |
| Exterior | Front and back receptacles, deck receptacle (E10), entry lights (E14), disconnects (E3, M4) | Hose bibbs, vent terminals (P9) | Outdoor unit (M4), terminations and intakes (M6, M7) |
