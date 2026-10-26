import test from "node:test";
import assert from "node:assert/strict";
import {
  neighbor,
  distance,
  ring,
  spiral,
  hexToWorld,
  worldToHex,
  toCube,
} from "../src/core/hex/HexCoords.ts";
test("six neighbors are unique, reciprocal and one step away", () => {
  const h = { q: 3, r: -2 };
  const ns = Array.from({ length: 6 }, (_, i) => neighbor(h, i));
  assert.equal(new Set(ns.map((n) => `${n.q},${n.r}`)).size, 6);
  ns.forEach((n, i) => {
    assert.equal(distance(h, n), 1);
    assert.deepEqual(neighbor(n, (i + 3) % 6), h);
  });
});
test("world conversion and cube invariant throughout region", () => {
  for (const h of spiral({ q: 0, r: 0 }, 18)) {
    const p = hexToWorld(h.q, h.r, 3);
    assert.deepEqual(worldToHex(p.x, p.z), h);
    const c = toCube(h);
    assert.equal(c.x + c.y + c.z, 0);
    assert.equal(p.y, 3);
  }
});
test("rings and spiral have exact counts and radii", () => {
  for (let r = 0; r < 8; r++) {
    const xs = ring({ q: 2, r: 3 }, r);
    assert.equal(xs.length, r ? 6 * r : 1);
    xs.forEach((h) => assert.equal(distance(h, { q: 2, r: 3 }), r));
    assert.equal(spiral({ q: 0, r: 0 }, r).length, 1 + 3 * r * (r + 1));
  }
});
