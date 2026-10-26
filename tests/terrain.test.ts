import test from "node:test";
import assert from "node:assert/strict";
import { HexMap } from "../src/core/hex/HexMap.ts";
import { hexToWorld, neighbor } from "../src/core/hex/HexCoords.ts";
import { HexRoadGraph } from "../src/core/roads/HexRoadGraph.ts";
import { TrafficSim } from "../src/core/simulation/TrafficSim.ts";
test("seeded terrain has sea, hills and continuous finite slopes", () => {
  const map = new HexMap(),
    same = new HexMap(),
    other = new HexMap(14, 71);
  assert.deepEqual([...map.tiles], [...same.tiles]);
  assert.notDeepEqual([...map.tiles], [...other.tiles]);
  const heights = [...map.tiles.values()].map((h) => map.height(h));
  assert.ok(Math.min(...heights) < map.seaLevel);
  assert.ok(Math.max(...heights) > 15);
  for (const h of map.tiles.values()) {
    const p = hexToWorld(h.q, h.r);
    assert.ok(Math.abs(map.surfaceAt(p.x, p.z) - map.height(h)) < 1e-8);
    for (let e = 0; e < 6; e++) {
      const n = neighbor(h, e);
      if (!map.get(n) || map.isCliff(h, e)) continue;
      const b = hexToWorld(n.q, n.r),
        x = (p.x + b.x) / 2,
        z = (p.z + b.z) / 2;
      assert.ok(
        Math.abs(map.surfaceAt(x + 1e-5, z) - map.surfaceAt(x - 1e-5, z)) <
          1e-4,
      );
    }
  }
});
test("roads and vehicles follow sloping terrain across every face, including ramps", () => {
  const surface = (x: number, z: number) => 5 + x * 0.05 + z * 0.03;
  const g = new HexRoadGraph(
    (h) => {
      const p = hexToWorld(h.q, h.r);
      return surface(p.x, p.z);
    },
    () => true,
    true,
    surface,
  );
  const a = { q: 0, r: 0, level: "ground" as const };
  g.addRoad(a);
  for (let e = 0; e < 6; e++) {
    const b = { ...neighbor(a, e), level: "ground" as const };
    g.addRoad(b);
    g.connect(a, b);
    const route = g.route(a, b);
    assert.ok(route.length);
    for (let i = 1; i < route.length; i++) {
      const p = route[i - 1].sample(route[i - 1].length).position,
        q = route[i].sample(0).position;
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-5);
    }
  }
  const ramp = g.addRamp({ q: 5, r: 0 }, 0, 4);
  g.addRoad({ q: 10, r: 0, level: "elevated" });
  const route = g.route(
    { q: 5, r: 0, level: "ground" },
    { q: 10, r: 0, level: "elevated" },
  );
  assert.ok(route.length);
  for (let i = 1; i < route.length; i++)
    assert.ok(
      Math.abs(
        route[i - 1].sample(route[i - 1].length).position.y -
          route[i].sample(0).position.y,
      ) < 1e-5,
    );
  assert.ok(ramp.low > 0);
  const sim = new TrafficSim(g);
  sim.spawn(route, "car");
  for (let i = 0; i < 2400; i++) sim.step(1 / 30);
  assert.equal(sim.deliveries, 1);
});
test("steep profiles fail atomically even with equal endpoint heights", () => {
  const surface = (x: number) =>
    15 * Math.sin((x / 17.32050807568877) * Math.PI) ** 2;
  const g = new HexRoadGraph(
    () => 0,
    () => true,
    false,
    surface,
  );
  const a = { q: 0, r: 0, level: "ground" as const },
    b = { q: 1, r: 0, level: "ground" as const };
  g.addRoad(a);
  g.addRoad(b);
  assert.throws(() => g.connect(a, b), /крутой/);
  assert.equal(g.get(a)!.connectionsMask, 0);
  const before = g.nodes.size;
  assert.throws(() => g.addRamp({ q: 4, r: 0 }, 0, 3), /крутой|рельеф/);
  assert.equal(g.nodes.size, before);
});
test("a ramp may climb relative to descending land without resetting world height", () => {
  const surface = (x: number) => 30 - x * 0.22;
  const g = new HexRoadGraph(
    (h) => surface(hexToWorld(h.q, h.r).x),
    () => true,
    true,
    surface,
  );
  const r = g.addRamp({ q: 0, r: 0 }, 0, 4);
  assert.equal(r.high - r.low, 8);
  const last = g.get({ q: 4, r: 0, level: "elevated" })!;
  const p = hexToWorld(4, 0);
  assert.ok(Math.abs(g.heightAt(last, p.x, p.z) - r.high) < 1e-6);
});
