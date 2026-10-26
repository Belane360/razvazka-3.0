import test from "node:test";
import assert from "node:assert/strict";
import { HexRoadGraph } from "../src/core/roads/HexRoadGraph.ts";
import { GameState } from "../src/core/GameState.ts";
import { HexMap } from "../src/core/hex/HexMap.ts";
import { hexToWorld, neighbor } from "../src/core/hex/HexCoords.ts";
import { HEIGHT_UNIT, RISE_PER_STEP } from "../src/core/hex/HeightUnits.ts";
const node = (q: number, level: "ground" | "elevated" = "ground") => ({
  q,
  r: 0,
  level,
});
test("ramp steps set absolute deck elevation and extension retains it", () => {
  for (const span of [2, 3, 4, 5, 6]) {
    const g = new HexRoadGraph(
      () => 7,
      () => true,
      true,
      () => 7,
    );
    const r = g.addRamp(node(0), 0, span);
    assert.equal(r.high, 7 + span * RISE_PER_STEP);
    g.addRoad(node(span + 1, "elevated"));
    assert.equal(g.get(node(span + 1, "elevated"))!.height, r.high);
    assert.ok(g.route(node(0), node(span + 1, "elevated")).length);
  }
});
test("dead ends contain a smooth returning lane and extending them removes it", () => {
  const g = new HexRoadGraph();
  g.addRoad(node(0));
  g.addRoad(node(1));
  const turn = g
    .lanesAt(node(1))
    .find((l) => l.inEdge === 3 && l.outEdge === 3);
  assert.ok(turn);
  const start = turn.sample(0),
    end = turn.sample(turn.length);
  assert.ok(start.tangent.x > 0.99 && end.tangent.x < -0.99);
  for (let i = 0; i <= 100; i++)
    assert.ok(Number.isFinite(turn.sample((turn.length * i) / 100).position.y));
  g.addRoad(node(2));
  assert.equal(
    g.lanesAt(node(1)).some((l) => l.inEdge === l.outEdge),
    false,
  );
});
test("cliffs separate neighboring tile surfaces and ordinary ground roads cannot cross", () => {
  const map = new HexMap();
  let count = 0;
  const graph = new HexRoadGraph(
    (h) => map.height(h),
    () => true,
    false,
    (x, z) => map.roadSurfaceAt(x, z),
    (a, b) => Math.abs(map.height(a) - map.height(b)) > HEIGHT_UNIT,
  );
  for (const h of map.tiles.values())
    for (let e = 0; e < 6; e++) {
      const other = neighbor(h, e);
      if (!map.get(other)) continue;
      if (Math.abs(map.height(h) - map.height(other)) <= HEIGHT_UNIT) continue;
      assert.ok(map.isCliff(h, e));
      count++;
      const aa = { ...h, level: "ground" as const },
        bb = { ...other, level: "ground" as const };
      graph.addRoad(aa);
      graph.addRoad(bb);
      assert.throws(() => graph.connect(aa, bb), /уступ|высот/);
      const a = hexToWorld(h.q, h.r),
        b = hexToWorld(other.q, other.r),
        x = (a.x + b.x) / 2,
        z = (a.z + b.z) / 2;
      assert.ok(
        Math.abs(map.tileSurfaceAt(h, x, z) - map.tileSurfaceAt(other, x, z)) >
          HEIGHT_UNIT,
      );
    }
  assert.ok(count > 0);
});
test("terrain ramp connects two ground terraces and routes both ways", () => {
  const height = (h: { q: number }) => (h.q < 2 ? 4 : 12);
  const surface = (x: number) => (x < 25 ? 4 : 12);
  const g = new HexRoadGraph(
    height,
    () => true,
    false,
    surface,
    () => true,
  );
  const ramp = g.addRamp(node(0), 0, 4, "ground");
  assert.equal(ramp.high, 12);
  assert.equal(ramp.low, 4);
  const route = g.route(node(0), node(4));
  assert.ok(route.length);
  assert.ok(g.route(node(4), node(0)).length);
  for (let i = 1; i < route.length; i++)
    assert.ok(
      Math.abs(
        route[i - 1].sample(route[i - 1].length).position.y -
          route[i].sample(0).position.y,
      ) < 1e-5,
    );
});

test("ground ramp cuts terrain lips into a shared road corridor", () => {
  const game = new GameState();
  // Use a real generated cliff away from the starter streets.
  let found = false;
  outer: for (const h of game.map.tiles.values())
    for (let e = 0; e < 6; e++) {
      if (!game.map.isCliff(h, e)) continue;
      try {
        const ramp = game.roads.addRamp(h, e, 3, "ground");
        const n = neighbor(h, e),
          a = hexToWorld(h.q, h.r),
          b = hexToWorld(n.q, n.r),
          x = (a.x + b.x) / 2,
          z = (a.z + b.z) / 2;
        const y = game.terrainAt(h, x, z);
        assert.ok(Math.abs(y - game.terrainAt(n, x, z)) < 1e-6);
        assert.ok(
          Math.abs(
            y - game.roads.heightAt(game.roads.nodes.get(ramp.nodes[0])!, x, z),
          ) < 1e-6,
        );
        found = true;
        break outer;
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
      }
    }
  assert.ok(found);
});
