# Pull logistics and large facilities implementation plan

**Goal:** Replace generated cargo trips with deterministic demand-driven shipments and replace duplex facilities with atomic 1/3/7-tile facilities.
**Spec:** User request of 2026-10-27 in this chat, based on commit 344e309.
**Architecture:** DistrictManager owns unique facility IDs, occupied tiles and persistent facility state. Pure logistics ticking handles timers and confirmed orders; TrafficSim owns shipment completion/cancellation. Shared ServiceYard layout drives routing and rendered meshes.
**Tech:** Strict TypeScript, Three.js, node:test, offline PLAY.html.

## Rulings
- New topology supersedes duplex rules. Adapt duplex tests instead of preserving an incompatible old production mode; keep road/terrain/intersection regressions.
- Home single, Shop single/triad, Warehouse triad/superhex, Factory superhex. Default Shop single, Warehouse triad. Select footprint in building UI.
- Preserve existing 120 Cr placement price; charge 150 Cr for each actually changed dependent cell. Validate all cells and budget before mutation.
- Every tile must be within 6m of base and every internal neighboring pair within 6m before flattening. Reject entire placement otherwise.
- Timers retain residual time. Deterministic sorted supplier candidates, try another supplier if routing/spawn fails. Reservations only on confirmed spawn.
- Warehouse outgoing stock stays physically reserved until delivery, then stock and reservation decrease together. Cancellation releases reservation; factory cancellation returns cargo if source survives. Delivery/cancellation settles each shipment exactly once.
- Goods start full in shops, empty in warehouses/factories. Passenger trips stay separate and capped; factories/warehouses never participate in periodic passenger dispatch.
- New facilities have stable opposing gate locations independent of later road edits. Missing road means no shipment spawn.

## Tasks
- [ ] Types/config and pure logistics tick with deterministic unit tests (delegated).
- [ ] Atomic facility topology, occupancy, gates, earthwork, removal; directed internal routes and tests.
- [ ] Shipments integrated into TrafficSim, bookkeeping and GameState demand tick; cancellation and completion tests.
- [ ] Large procedural meshes and mesh tests using shared layout (delegated).
- [ ] Footprint selectors, placement preview and starter city matching new footprints.
- [ ] Complete test suite, offline build, browser verification and code review.

## Review focus
Time partition invariance; in-flight inventory and no duplicate dispatch; unreachable nearest suppliers; demolition during shipment; all cells atomic on collision/height/budget failure; gates never reversed; roads stay outside reserved footprint.
