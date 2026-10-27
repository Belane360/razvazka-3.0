import test from "node:test";
import assert from "node:assert/strict";
import { HexRoadGraph } from "../src/core/roads/HexRoadGraph.ts";
import { DistrictManager } from "../src/core/districts/DistrictManager.ts";
import { idm, CAR } from "../src/core/simulation/idm.ts";
import { TrafficSim } from "../src/core/simulation/TrafficSim.ts";
const n = (q: number, r = 0, level: "ground" | "elevated" = "ground") => ({
  q,
  r,
  level,
});
const line = () => {
  const g = new HexRoadGraph();
  for (let q = 0; q < 7; q++) g.addRoad(n(q));
  return g;
};
test("homes remain separate and connect only to adjacent ground roads", () => {
  const g = new HexRoadGraph();
  g.addRoad(n(0, 0, "elevated"));
  const d = new DistrictManager(g);
  d.place({ q: 0, r: 1 }, "Home");
  d.place({ q: 1, r: 1 }, "Home");
  assert.equal(d.clusters.length, 2);
  assert.equal(d.clusters[0].tiles.length, 1);
  assert.equal(d.access({ q: 0, r: 1 }).length, 0);
  g.addRoad(n(0));
  assert.equal(d.access({ q: 0, r: 1 }).length, 1);
  d.remove({ q: 0, r: 1 });
  assert.equal(d.clusters[0].tiles.length, 1);
});
test("IDM accelerates freely and brakes for approaching stationary leader", () => {
  assert.ok(idm(0, Infinity, 0, CAR) > 0);
  assert.ok(idm(8, 5, 0, CAR) < 0);
  assert.ok(idm(5, Infinity, 0, CAR, 0.12) < idm(5, Infinity, 0, CAR, 0));
});
test("agents traverse both levels and delivery is counted exactly once", () => {
  const g = new HexRoadGraph();
  g.addRoad(n(-1));
  g.addRamp({ q: 0, r: 0 }, 0, 4);
  g.addRoad(n(5, 0, "elevated"));
  const sim = new TrafficSim(g);
  const route = g.route(n(-1), n(5, 0, "elevated"));
  assert.ok(route.length);
  assert.ok(sim.spawn(route, "truck", "cargo"));
  let maxY = 0;
  for (let i = 0; i < 1800; i++) {
    sim.step(1 / 30);
    for (const v of sim.vehicles)
      maxY = Math.max(maxY, sim.sample(v).position.y);
  }
  assert.ok(maxY > 7.9);
  assert.equal(sim.deliveries, 1);
  assert.ok(sim.income > 0);
  const income = sim.income;
  sim.step(1);
  assert.equal(sim.income, income);
  assert.equal(sim.vehicles.length, 0);
});
test("red signal holds vehicle before node and green releases it", () => {
  const g = line();
  g.setSignal(n(2), true);
  const sim = new TrafficSim(g);
  sim.spawn(g.route(n(0), n(6)), "car");
  // Hold the all-red clearance interval of the sole active signal phase.
  for (let i = 0; i < 900; i++) {
    sim.time = 7.2;
    sim.step(1 / 30);
  }
  assert.equal(sim.vehicles.length, 1);
  const v = sim.vehicles[0];
  assert.ok(sim.sample(v).position.x < 26);
  assert.ok(v.speed < 0.1);
  for (let i = 0; i < 900; i++) {
    sim.time = 0;
    sim.step(1 / 30);
  }
  assert.equal(sim.deliveries, 1);
});
test("follower brakes for leader across lane boundary without overlap", () => {
  const g = line(),
    sim = new TrafficSim(g),
    route = g.route(n(0), n(6));
  const lead = sim.spawn(route, "truck");
  assert.ok(lead);
  lead.laneIndex = 1;
  lead.u = 2;
  lead.speed = 0;
  const follow = sim.spawn(route, "car");
  assert.ok(follow);
  follow.speed = 8;
  for (let i = 0; i < 100; i++) {
    sim.step(1 / 30);
    assert.ok(
      sim.travelled(lead) - sim.travelled(follow) >= lead.length - 0.01,
    );
  }
});
test("removing a ramp cancels its trip without delivery or invalid geometry", () => {
  const g = new HexRoadGraph();
  g.addRamp({ q: 0, r: 0 }, 0, 3);
  const sim = new TrafficSim(g);
  sim.spawn(g.route(n(0), n(3, 0, "elevated")), "car");
  g.removeRoad(n(1, 0, "elevated"));
  sim.step(1 / 30);
  assert.equal(sim.vehicles.length, 0);
  assert.equal(sim.deliveries, 0);
});
test("through vehicle brakes for a leader ending its trip on the shared entry corridor", () => {
  const g = line(),
    sim = new TrafficSim(g);
  const lead = sim.spawn(g.route(n(0), n(2)), "truck");
  assert.ok(lead);
  lead.laneIndex = 2;
  lead.u = 1;
  const follower = sim.spawn(g.route(n(0), n(4)), "car");
  assert.ok(follower);
  follower.laneIndex = 1;
  follower.u = follower.route[1].length - 4;
  follower.speed = 8;
  sim.step(0.3);
  assert.ok(follower.speed < 8);
  const a = sim.sample(lead).position,
    b = sim.sample(follower).position;
  assert.ok(
    Math.hypot(a.x - b.x, a.z - b.z) >= (lead.length + follower.length) / 2,
  );
});
