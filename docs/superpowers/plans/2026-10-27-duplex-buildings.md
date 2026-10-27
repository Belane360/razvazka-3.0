# Duplex buildings implementation plan

**Goal:** Implement the user's 27 October specification: stable two-hex industrial complexes, directed service yards, earthwork and safe degradation.
**Architecture:** DistrictManager owns persistent pairs, port selection and service geometry. HexMap owns flattened pads; GameState owns the build transaction and its cost. Road graph carries a directed service overlay consumed by A* and TrafficSim. HexMeshBuilder uses the same layout for buildings and yards.
**Tech stack:** TypeScript, Three.js, node:test; no new runtime dependencies.
**Spec:** User request in this chat, 2026-10-27, including the four supplied concept sheets.

## Constraints
- Merge only Warehouse/Factory pairs; existing Home/Shop neighborhood behavior stays compatible.
- Earlier building is base A; B adopts A elevation for differences <= 6 m. Nonzero earthwork costs 150 Cr once. Above 6 m both remain independent level 1.
- Two tiles maximum; a third tile cannot consume an existing pair.
- Arrival through A/IN, departure through B/OUT; no reverse yard edges or public traffic shortcuts.
- Deletion resets survivor to level 1 and redirects active complex trips; no reward for demolished standalone destinations.

## Tasks
- [x] Add failing core tests for pairing, height threshold, transaction cost, insufficient budget, stable pairing and degradation.
- [x] Implement pair metadata, terrain flattening and budget integration.
- [x] Add failing routing tests for IN/OUT, horizontal service geometry, road edits and active demolition.
- [x] Implement directed service overlay, endpoint A* and traffic repair.
- [x] Add mesh tests for one centered complex, four docks/sheds, horizontal apron and concrete retaining walls.
- [x] Implement procedural merged geometry using the service layout; suppress individual meshes and internal grid edge.
- [x] Run complete tests, typecheck/build, inspect rendered output and document behavior.

## Review focus
- Flat vs exactly 6 m vs >6 m, both cut and fill.
- Unfunded placement leaves terrain, budget, clusters and graph untouched.
- Missing/replaced gate road never silently redirects into the wrong gate.
- Deletion of either member while travelling on roads or inside the yard.
- All six pair orientations and third adjacent building remain deterministic.

## Completed verification

- 63/63 tests pass (`npm test`), including 14 duplex tests.
- `npm run build` passes typecheck, Vite build and standalone PLAY.html generation.
- `git diff --check` passes.
- Independent core review: missing-access demolition defect reproduced and fixed; follow-up review found no remaining substantive issues.
- User steering applied: same road hex or nonadjacent gate roads only; service access rendered as separate one-way lanes.
- Browser screenshot: `output/building-concepts/05-implemented-duplex.png`.
