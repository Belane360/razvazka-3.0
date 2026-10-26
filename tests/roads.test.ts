import test from "node:test";
import assert from "node:assert/strict";
import { HexRoadGraph, nodeKey } from "../src/core/roads/HexRoadGraph.ts";
import { neighbor } from "../src/core/hex/HexCoords.ts";
const node = (q: number, r = 0, level: "ground" | "elevated" = "ground") => ({
  q,
  r,
  level,
});
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
test("independent levels and reciprocal masks; removal only affects selected level", () => {
  const g = new HexRoadGraph();
  for (const level of ["ground", "elevated"] as const) {
    g.addRoad(node(0, 0, level));
    g.addRoad(node(1, 0, level));
  }
  assert.equal(g.get(node(0))?.connectionsMask, 1);
  assert.equal(g.get(node(1))?.connectionsMask, 8);
  assert.equal(g.route(node(0), node(1, 0, "elevated")).length, 0);
  g.removeRoad(node(0));
  assert.equal(g.get(node(1))?.connectionsMask, 0);
  assert.equal(g.get(node(0, 0, "elevated"))?.connectionsMask, 1);
});
test("ramp spans 2..6 are accepted, other values are rejected atomically", () => {
  for (const span of [1, 2, 3, 4, 5, 6, 7, 2.5]) {
    const g = new HexRoadGraph();
    if (Number.isInteger(span) && span >= 2 && span <= 6) {
      g.addRamp({ q: 0, r: 0 }, 0, span);
      assert.ok(g.route(node(0), node(span, 0, "elevated")).length);
    } else {
      assert.throws(() => g.addRamp({ q: 0, r: 0 }, 0, span));
      assert.equal(g.nodes.size, 0);
    }
  }
});
test("occupied ramp corridor fails without partial mutation", () => {
  const g = new HexRoadGraph();
  g.addRoad(node(1, 0, "elevated"));
  const before = JSON.stringify([...g.nodes]);
  assert.throws(() => g.addRamp({ q: 0, r: 0 }, 0, 3));
  assert.equal(JSON.stringify([...g.nodes]), before);
});
test("all six orientations generate continuous lanes and valid arc tangents", () => {
  for (let d = 0; d < 6; d++) {
    const g = new HexRoadGraph();
    const c = node(0);
    g.addRoad(c);
    for (let e = 0; e < 6; e++)
      g.addRoad({ ...neighbor(c, e), level: "ground" });
    const lanes = g.lanesAt(c).filter((l) => l.inEdge >= 0 && l.outEdge >= 0);
    assert.equal(lanes.length, 30);
    for (const lane of lanes) {
      assert.ok(lane.length > 0);
      for (const u of [0, lane.length / 2, lane.length]) {
        const p = lane.sample(u);
        assert.ok(Number.isFinite(p.position.x + p.position.y + p.position.z));
        near(Math.hypot(p.tangent.x, p.tangent.y, p.tangent.z), 1);
      }
    }
    const next = { ...neighbor(c, d), level: "ground" as const };
    const route = g.route(c, next);
    assert.ok(route.length >= 2);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1].sample(route[i - 1].length),
        b = route[i].sample(0);
      near(a.position.x, b.position.x);
      near(a.position.z, b.position.z);
      near(a.position.y, b.position.y);
      near(a.tangent.x, b.tangent.x);
      near(a.tangent.z, b.tangent.z);
    }
  }
});
test("elevated lanes permit only straight and 60-degree turns, never U-turns", () => {
  const g = new HexRoadGraph();
  const c = node(0, 0, "elevated");
  g.addRoad(c);
  for (let e = 0; e < 6; e++)
    g.addRoad({ ...neighbor(c, e), level: "elevated" });
  const lanes = g.lanesAt(c).filter((l) => l.inEdge >= 0 && l.outEdge >= 0);
  assert.equal(lanes.length, 18);
  for (const l of lanes)
    assert.ok([2, 3, 4].includes((l.outEdge - l.inEdge + 6) % 6));
});
test("A* uses a smooth ramp, descending route works, deleting it disconnects levels", () => {
  const g = new HexRoadGraph();
  g.addRoad(node(-1));
  g.addRamp({ q: 0, r: 0 }, 0, 4);
  g.addRoad(node(5, 0, "elevated"));
  const route = g.route(node(-1), node(5, 0, "elevated"));
  assert.ok(route.length > 4);
  let last = -Infinity;
  for (const l of route) {
    for (let i = 0; i <= 20; i++) {
      const s = l.sample((l.length * i) / 20);
      assert.ok(s.position.y >= last - 1e-6);
      last = s.position.y;
    }
  }
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1].sample(route[i - 1].length),
      b = route[i].sample(0);
    near(a.position.y, b.position.y);
    near(a.position.x, b.position.x);
    near(a.position.z, b.position.z);
    near(a.tangent.y, b.tangent.y);
  }
  assert.ok(g.route(node(5, 0, "elevated"), node(-1)).length);
  g.removeRoad(node(2, 0, "elevated"));
  assert.equal(g.route(node(-1), node(5, 0, "elevated")).length, 0);
  assert.ok(g.nodes.has(nodeKey(node(-1))));
});
test("ramp rejects terrain intersecting its leading tile boundary atomically", () => {
  const g = new HexRoadGraph((h) => (h.q >= 1 ? 4 : 0));
  assert.throws(() => g.addRamp({ q: 0, r: 0 }, 0, 2), /рельеф/);
  assert.equal(g.nodes.size, 0);
  assert.equal(g.ramps.size, 0);
});

test("explicit network keeps adjacent streets separate and closes only drawn edges", () => {
  const g = new HexRoadGraph(
    () => 0,
    () => true,
    false,
  );
  for (const h of [node(0), node(1), node(1, -1)]) g.addRoad(h);
  g.connect(node(0), node(1));
  g.connect(node(1), node(1, -1));
  assert.equal(g.get(node(0))!.connectionsMask, 1);
  assert.equal(g.get(node(1, -1))!.connectionsMask, 2);
  assert.equal(
    g.lanesAt(node(1)).filter((l) => l.inEdge >= 0 && l.outEdge >= 0).length,
    2,
  );
  assert.ok(g.route(node(0), node(1, -1)).length);
  g.removeRoad(node(1));
  g.addRoad(node(1));
  assert.equal(g.get(node(1))!.connectionsMask, 0);
});
test("district access on a sharp corner starts on its through lane, not in the grass", () => {
  const g = new HexRoadGraph(
      () => 0,
      () => true,
      false,
    ),
    c = node(0),
    a = node(1),
    b = node(0, 1);
  [c, a, b].forEach((h) => g.addRoad(h));
  g.connect(c, a);
  g.connect(c, b);
  const lanes = g.lanesAt(c),
    through = lanes.find((l) => l.inEdge === 1 && l.outEdge === 0)!,
    depart = lanes.find((l) => l.inEdge === -1 && l.outEdge === 0)!;
  const p = through.sample(through.length / 2).position,
    q = depart.sample(0).position;
  near(p.x, q.x);
  near(p.z, q.z);
});
