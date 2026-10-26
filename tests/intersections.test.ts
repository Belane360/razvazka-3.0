import test from "node:test";
import assert from "node:assert/strict";
import { HexRoadGraph } from "../src/core/roads/HexRoadGraph.ts";
import { neighbor } from "../src/core/hex/HexCoords.ts";
import { TrafficSim } from "../src/core/simulation/TrafficSim.ts";
const center = { q: 0, r: 0, level: "ground" as const };
function junction(order = [3, 0, 4, 1]) {
  const g = new HexRoadGraph(
    () => 0,
    () => true,
    false,
  );
  g.addRoad(center);
  for (const e of order) {
    const h = { ...neighbor(center, e), level: "ground" as const };
    g.addRoad(h);
    g.connect(center, h);
  }
  return g;
}
function lane(g: HexRoadGraph, i: number, o: number) {
  return g.lanesAt(center).find((l) => l.inEdge === i && l.outEdge === o)!;
}
function trip(g: HexRoadGraph, i: number, o: number) {
  const a = { ...neighbor(center, i), level: "ground" as const },
    b = { ...neighbor(center, o), level: "ground" as const };
  return [
    g.lanesAt(a).find((l) => l.inEdge === -1)!,
    lane(g, i, o),
    g.lanesAt(b).find((l) => l.outEdge === -1)!,
  ];
}
test("main road follows connection age, manual settings survive rebuilds, levels are independent", () => {
  const g = junction([4, 1, 3, 0]);
  assert.equal(g.mainRoadMask(center), (1 << 4) | (1 << 1));
  g.configureJunction(center, { mainRoadMask: (1 << 0) | (1 << 3) });
  g.addRoad({ q: 7, r: 7, level: "ground" });
  assert.equal(g.mainRoadMask(center), 9);
  g.addRoad({ ...center, level: "elevated" });
  assert.equal(
    g.junctionSettings({ ...center, level: "elevated" }).mainRoadMask,
    null,
  );
  g.configureJunction(center, { mainRoadMask: null });
  assert.equal(g.mainRoadMask(center), 18);
});
test("left turn requires permission, bends are not intersections", () => {
  const g = junction();
  assert.equal(g.movementAllowed(lane(g, 3, 4)), false);
  const detour = g.route(
    { ...neighbor(center, 3), level: "ground" },
    { ...neighbor(center, 4), level: "ground" },
  );
  assert.ok(detour.length);
  assert.ok(detour.every((l) => g.movementAllowed(l)));
  assert.ok(detour.some((l) => l.inEdge >= 0 && l.inEdge === l.outEdge));
  g.configureJunction(center, { allowLeft: true });
  assert.ok(g.movementAllowed(lane(g, 3, 4)));
  assert.ok(
    g.route(
      { ...neighbor(center, 3), level: "ground" },
      { ...neighbor(center, 4), level: "ground" },
    ).length,
  );
  const bend = junction([3, 4]);
  assert.ok(bend.movementAllowed(lane(bend, 3, 4)));
});
test("signals override road priority but preserve yielding to oncoming traffic", () => {
  const g = junction();
  g.configureJunction(center, { allowLeft: true, mainRoadMask: 9 });
  assert.ok(g.mustYield(lane(g, 4, 1), lane(g, 3, 0)));
  g.configureJunction(center, { mode: "paired" });
  assert.equal(g.mustYield(lane(g, 4, 1), lane(g, 3, 0)), false);
  assert.ok(g.mustYield(lane(g, 3, 4), lane(g, 0, 3)));
  assert.equal(g.signalState(center, 3, 0), "green");
  assert.equal(g.signalState(center, 4, 0), "red");
  assert.equal(g.signalState(center, 3, 6.5), "yellow");
  assert.equal(g.signalState(center, 4, 7.5), "red");
  assert.equal(g.signalState(center, 4, 8.5), "green");
  g.configureJunction(center, { mode: "individual" });
  assert.notEqual(g.signalState(center, 3, 0), g.signalState(center, 0, 0));
});
test("main-road traffic wins simultaneous approach regardless of spawn order", () => {
  const g = junction(),
    sim = new TrafficSim(g);
  const minor = sim.spawn(trip(g, 4, 1), "car")!,
    major = sim.spawn(trip(g, 3, 0), "car")!;
  assert.ok(minor && major);
  let first = 0;
  for (let i = 0; i < 900; i++) {
    sim.step(1 / 30);
    for (const v of sim.vehicles) if (v.laneIndex === 1 && !first) first = v.id;
  }
  assert.equal(first, major.id);
  assert.equal(sim.deliveries, 2);
});
test("oncoming straight vehicle goes before left turn under green, even if turn spawned first", () => {
  const g = junction(),
    sim = new TrafficSim(g);
  g.configureJunction(center, { mode: "paired", allowLeft: true });
  const left = sim.spawn(trip(g, 3, 4), "car")!,
    straight = sim.spawn(trip(g, 0, 3), "car")!;
  let first = 0;
  for (let i = 0; i < 1200; i++) {
    sim.time = 0;
    sim.step(1 / 30);
    for (const v of sim.vehicles) if (v.laneIndex === 1 && !first) first = v.id;
  }
  assert.equal(first, straight.id);
  assert.equal(sim.deliveries, 2);
  assert.ok(left);
});
test("red stops front bumper; phase releases queued cars and active crossings clear", () => {
  const g = junction(),
    sim = new TrafficSim(g);
  g.configureJunction(center, { mode: "paired", allowLeft: true });
  const v = sim.spawn(trip(g, 4, 1), "truck")!;
  for (let i = 0; i < 600; i++) {
    sim.time = 0;
    sim.step(1 / 30);
  }
  assert.equal(v.laneIndex, 0);
  assert.ok(v.u + v.length / 2 < v.route[0].length);
  for (let i = 0; i < 1200 && sim.vehicles.length; i++) {
    sim.time = v.laneIndex === 0 ? 8.5 : 0;
    sim.step(1 / 30);
  }
  assert.equal(sim.deliveries, 1);
});
test("disabling left turns reroutes an existing trip through a legal turnaround", () => {
  const g = junction(),
    sim = new TrafficSim(g);
  g.configureJunction(center, { allowLeft: true });
  const v = sim.spawn(trip(g, 3, 4), "car")!;
  assert.ok(v);
  g.configureJunction(center, { allowLeft: false });
  for (let i = 0; i < 600; i++) {
    sim.step(1 / 30);
    assert.ok(v.route.slice(v.laneIndex).every((l) => g.movementAllowed(l)));
  }
  g.configureJunction(center, { allowLeft: true });
  for (let i = 0; i < 1200; i++) sim.step(1 / 30);
  assert.equal(sim.deliveries, 1);
});
test("green minor road moves while older main road is held red", () => {
  const g = junction(),
    sim = new TrafficSim(g);
  g.configureJunction(center, { mode: "paired" });
  const main = sim.spawn(trip(g, 3, 0), "car")!,
    minor = sim.spawn(trip(g, 4, 1), "car")!;
  for (let i = 0; i < 900; i++) {
    sim.time = 8.5;
    sim.step(1 / 30);
  }
  assert.equal(sim.deliveries, 1);
  assert.equal(main.laneIndex, 0);
  assert.ok(!sim.vehicles.includes(minor));
});
test("invalid settings do not partially mutate the intersection", () => {
  const g = junction(),
    before = g.junctionSettings(center);
  assert.throws(() =>
    g.configureJunction(center, { mode: "paired", greenSeconds: 0 }),
  );
  assert.deepEqual(g.junctionSettings(center), before);
  assert.equal(g.get(center)!.signal, false);
});
test("live rerouting preserves a truck rear still occupying the previous junction", async () => {
  const { spiral } = await import("../src/core/hex/HexCoords.ts");
  const g = new HexRoadGraph();
  for (const h of spiral({ q: 0, r: 0 }, 3))
    g.addRoad({ ...h, level: "ground" });
  for (const n of g.nodes.values()) g.configureJunction(n, { allowLeft: true });
  const route = g.route(
      { q: -3, r: 0, level: "ground" },
      { q: 2, r: -2, level: "ground" },
    ),
    sim = new TrafficSim(g);
  const v = sim.spawn(route, "truck")!;
  v.laneIndex = 2;
  v.u = 0.1;
  const occupied = route[1].nodeId,
    travelled = sim.travelled(v);
  g.configureJunction(g.nodes.get(route[3].nodeId)!, { allowLeft: false });
  sim.step(1 / 300);
  assert.equal(v.route[v.laneIndex - 1].nodeId, occupied);
  assert.ok(
    sim.travelled(v) >= travelled && sim.travelled(v) < travelled + 0.01,
  );
  assert.ok(v.route.slice(v.laneIndex + 1).every((l) => g.movementAllowed(l)));
});
test("road chronology updates on replacement and resets with a deleted node", () => {
  const g = junction();
  const oldest = { ...neighbor(center, 3), level: "ground" as const };
  g.removeRoad(oldest);
  g.addRoad(oldest);
  g.connect(center, oldest);
  assert.equal(g.mainRoadMask(center), (1 << 0) | (1 << 4));
  g.configureJunction(center, {
    allowLeft: true,
    mode: "individual",
    mainRoadMask: 9,
  });
  g.removeRoad(center);
  g.addRoad(center);
  assert.equal(g.junctionSettings(center).mode, "off");
  assert.equal(g.junctionSettings(center).allowLeft, false);
});
