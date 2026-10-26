import test from "node:test";
import assert from "node:assert/strict";
import { HexRoadGraph } from "../src/core/roads/HexRoadGraph.ts";
import { TrafficSim } from "../src/core/simulation/TrafficSim.ts";
import { GameState } from "../src/core/GameState.ts";
const n = (q: number) => ({ q, r: 0, level: "ground" as const });
test("removing a road behind a trip does not delete its vehicle", () => {
  const g = new HexRoadGraph();
  for (let q = 0; q < 7; q++) g.addRoad(n(q));
  const sim = new TrafficSim(g),
    v = sim.spawn(g.route(n(0), n(6)), "car")!;
  v.laneIndex = 3;
  v.u = 4;
  g.removeRoad(n(0));
  sim.step(1 / 30);
  assert.ok(sim.vehicles.includes(v));
  for (let i = 0; i < 1800; i++) sim.step(1 / 30);
  assert.equal(sim.deliveries, 1);
});
test("demolishing a destination cancels deliveries instead of rewarding its replacement", () => {
  const g = new GameState(),
    destination = { q: -1, r: 4 };
  const target = g.districts.access(destination)[0],
    source = g.districts.access({ q: -4, r: 1 })[0];
  const route = g.roads.route(source, target);
  assert.ok(route.length);
  const v = g.sim.spawn(route, "truck", "-1,4")!;
  assert.ok(v);
  g.build(destination, "demolish", "ground", 0, 3);
  assert.ok(!g.sim.vehicles.includes(v));
  g.build(destination, "Shop", "ground", 0, 3);
  const budget = g.budget;
  g.sim.step(10);
  assert.equal(g.sim.income, 0);
  assert.equal(g.budget, budget);
  assert.equal(g.districts.zones.get("-1,4")!.progress, 0);
});
test("district level changes refresh the scene without requiring another construction", () => {
  const g = new GameState();
  for (let i = 0; i < 11; i++) g.sim.onDelivery?.("-1,4", 12);
  const before = g.revision;
  g.sim.onDelivery?.("-1,4", 12);
  assert.ok(g.revision > before);
});
test("scene cleanup releases transient preview materials but retains shared terrain materials", async () => {
  const THREE = await import("three");
  const { disposeGroup, material } =
    await import("../src/render/HexMeshBuilder.ts");
  const group = new THREE.Group(),
    temporary = new THREE.MeshBasicMaterial(),
    shared = material(0x112233);
  let temporaryDisposed = 0,
    sharedDisposed = 0;
  temporary.addEventListener("dispose", () => temporaryDisposed++);
  shared.addEventListener("dispose", () => sharedDisposed++);
  for (const m of [temporary, temporary, shared])
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
  disposeGroup(group);
  assert.equal(temporaryDisposed, 1);
  assert.equal(sharedDisposed, 0);
  assert.equal(group.children.length, 0);
});
test("converting signaled endpoints to a ramp removes invisible traffic controls", () => {
  const g = new HexRoadGraph();
  g.addRoad(n(-1));
  g.addRoad(n(0));
  const end = { q: 3, r: 0, level: "elevated" as const },
    after = { q: 4, r: 0, level: "elevated" as const };
  g.addRoad(end);
  g.addRoad(after);
  for (const h of [n(0), end])
    g.configureJunction(h, {
      mode: "paired",
      allowLeft: true,
      mainRoadMask: 9,
    });
  g.addRamp(n(0), 0, 3);
  for (const h of [n(0), end]) {
    assert.equal(g.get(h)!.signal, false);
    assert.equal(g.junctionSettings(h).mode, "off");
    assert.equal(g.junctionSettings(h).mainRoadMask, null);
  }
  const sim = new TrafficSim(g);
  sim.spawn(g.route(n(-1), after), "truck");
  for (let i = 0; i < 1800; i++) {
    sim.time = 7.5;
    sim.step(1 / 30);
  }
  assert.equal(sim.deliveries, 1);
});
