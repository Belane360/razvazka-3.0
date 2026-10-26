import test from "node:test";
import assert from "node:assert/strict";
import { GameState } from "../src/core/GameState.ts";
test("starter has connected districts, independent bridge and successful deliveries", () => {
  const g = new GameState();
  assert.ok(g.roads.get({ q: 0, r: 2, level: "ground" }));
  assert.ok(g.roads.get({ q: 0, r: 2, level: "elevated" }));
  for (let i = 0; i < 1800; i++) g.update(1 / 30);
  assert.ok(g.sim.deliveries > 0);
});
test("invalid build spends nothing and successful road is charged only once", () => {
  const g = new GameState(),
    before = g.budget;
  assert.equal(g.build({ q: 100, r: 100 }, "road", "ground", 0, 3), false);
  assert.equal(g.budget, before);
  assert.equal(g.build({ q: 3, r: 4 }, "road", "ground", 0, 3), true);
  assert.equal(g.budget, before - 40);
  g.build({ q: 3, r: 4 }, "road", "ground", 0, 3);
  assert.equal(g.budget, before - 40);
});
test("starter traffic continues delivering after five minutes without reservation deadlock", () => {
  const g = new GameState();
  for (let i = 0; i < 6000; i++) g.update(1 / 30);
  const before = g.sim.deliveries;
  for (let i = 0; i < 3000; i++) g.update(1 / 30);
  assert.ok(
    g.sim.deliveries > before,
    "intersection reservations must allow disjoint opposing lanes",
  );
});

test("drawn corner does not add the third side of an adjacent triangle", () => {
  const g = new GameState();
  const a = { q: 2, r: 4 },
    b = { q: 3, r: 4 },
    c = { q: 3, r: 3 };
  g.build(a, "road", "ground", 0, 3);
  g.build(b, "road", "ground", 0, 3, a);
  g.build(c, "road", "ground", 0, 3, b);
  assert.equal(g.roads.get({ ...a, level: "ground" })!.connectionsMask, 1);
  assert.equal(g.roads.get({ ...c, level: "ground" })!.connectionsMask, 2);
  const budget = g.budget;
  g.build(b, "road", "ground", 0, 3, c);
  assert.equal(g.budget, budget);
});
test("invalid side connection to a ramp creates no uncharged orphan road", () => {
  const g = new GameState(),
    target = { q: -5, r: 3 },
    budget = g.budget;
  assert.equal(g.build(target, "road", "ground", 0, 3, { q: -5, r: 2 }), false);
  assert.equal(g.roads.get({ ...target, level: "ground" }), undefined);
  assert.equal(g.budget, budget);
});
