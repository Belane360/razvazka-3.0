import test from 'node:test';
import assert from 'node:assert/strict';
import { HexRoadGraph } from '../src/core/roads/HexRoadGraph.ts';
import { DistrictManager } from '../src/core/districts/DistrictManager.ts';
import { HexMap } from '../src/core/hex/HexMap.ts';
import { complexLayout } from '../src/core/districts/ServiceYard.ts';
import { GameState } from '../src/core/GameState.ts';
import { hexKey, hexToWorld, neighbor } from '../src/core/hex/HexCoords.ts';
const a = { q: 2, r: 4 }, b = neighbor(a, 0);
function fixture(delta = 0) {
  const g = new GameState();
  g.map.get(a)!.elevation = 4;
  g.map.get(b)!.elevation = 4 + delta;
  assert.ok(g.build(a, 'Warehouse', 'ground', 0, 3));
  return g;
}
test('duplex earthwork accepts exactly 6m, flattens both pads and charges once', () => {
  const g = fixture(6), budget = g.budget;
  assert.ok(g.build(b, 'Warehouse', 'ground', 0, 3));
  const c = g.districts.clusters.find(c => c.tiles.some(t => hexKey(t) === hexKey(a)))!;
  assert.equal(c.shape, 'duo');
  assert.equal(c.sharedEdge?.edge, 0);
  assert.equal(c.externalEdges.length, 10);
  assert.equal(g.map.height(b), 4);
  assert.equal(g.budget, budget - 120 - 150);
  for (const h of [a, b]) {
    const p = hexToWorld(h.q, h.r);
    assert.equal(g.map.tileSurfaceAt(h, p.x + 6, p.z + 2), 4);
  }
  void g.districts.clusters;
  assert.equal(g.budget, budget - 270);
});
test('flat merger costs no earthwork; >6m leaves two independent level-one buildings', () => {
  for (const delta of [0, 6.001, -6.001]) {
    const g = fixture(delta), budget = g.budget;
    assert.ok(g.build(b, 'Warehouse', 'ground', 0, 3));
    const c = g.districts.clusters.find(c => c.tiles.some(t => hexKey(t) === hexKey(a)))!;
    assert.equal(c.shape, delta === 0 ? 'duo' : 'single');
    assert.equal(g.budget, budget - 120);
    assert.equal(g.map.height(b), 4 + delta);
    if (delta)
      assert.equal(c.level, 1);
  }
});
test('unfunded earthwork is atomic and does not place or flatten dependent tile', () => {
  const g = fixture(5);
  g.budget = 269;
  assert.equal(g.build(b, 'Warehouse', 'ground', 0, 3), false);
  assert.equal(g.budget, 269);
  assert.equal(g.map.height(b), 9);
  assert.equal(g.districts.zones.has(hexKey(b)), false);
});
test('a third industrial tile never expands an existing pair and demolition resets survivor', () => {
  const g = fixture();
  g.build(b, 'Warehouse', 'ground', 0, 3);
  const third = neighbor(b, 0);
  g.build(third, 'Warehouse', 'ground', 0, 3);
  assert.equal(g.districts.clusters.find(c => c.id === hexKey(a))!.tiles.length, 2);
  g.districts.zones.get(hexKey(b))!.progress = 100;
  assert.ok(g.build(a, 'demolish', 'ground', 0, 3));
  const survivor = g.districts.clusters.find(c => c.tiles.some(t => hexKey(t) === hexKey(b)))!;
  assert.equal(survivor.shape, 'single');
  assert.equal(survivor.level, 1);
  assert.equal(survivor.tiles.length, 1);
});
function connected() {
  const g = fixture();
  g.build(b, 'Warehouse', 'ground', 0, 3);
  const ra = neighbor(a, 2), rb = neighbor(b, 1), middle = neighbor(a, 1);
  g.build(ra, 'road', 'ground', 0, 3);
  g.build(middle, 'road', 'ground', 0, 3, ra);
  g.build(rb, 'road', 'ground', 0, 3, middle);
  return { g, ra, rb };
}
test('duplex service A* only crosses IN to OUT and the yard stays horizontal', () => {
  const { g } = connected();
  const c = g.districts.clusterAt(a)!;
  assert.equal(hexKey(c.ports.IN!.tile), hexKey(a));
  assert.equal(hexKey(c.ports.OUT!.tile), hexKey(b));
  const service = [...g.roads.lanes.values()].filter(l => l.serviceId === c.id && l.servicePart === 'yard');
  assert.equal(service.length, 2);
  assert.ok(g.roads.successors(service[0]).some(l => l.id === service[1].id));
  assert.ok(!g.roads.successors(service[1]).some(l => l.id === service[0].id));
  for (const l of service)
    for (let i = 0;i <= 10;i++) {
      assert.equal(l.sample(l.length * i / 10).position.y, 4);
      assert.equal(l.sample(l.length * i / 10).grade, 0);
    }
  const route = g.districts.routeTrip({ q: -3, r: -1 }, a);
  // This isolated local street is not connected to the starter network.
  assert.equal(route.length, 0);
  const reverse = g.roads.routeLanes([service[1]], [service[0].id], new Set([c.id]));
  assert.ok(!reverse.length || reverse.some(l => l.servicePart === "connector"), "return to IN requires leaving the yard via the public road");
});
test('arrivals traverse both yard halves and departures start at OUT', () => {
  const { g, ra } = connected();
  const home = neighbor(ra, 2);
  g.build(home, 'Home', 'ground', 0, 3);
  const arriving = g.districts.routeTrip(home, a), departing = g.districts.routeTrip(a, home);
  assert.ok(arriving.length);
  assert.equal(arriving.filter(l => l.servicePart === 'yard').length, 2);
  assert.ok(departing.length);
  assert.equal(departing[0].servicePart, 'yard');
  assert.ok(departing[0].id.endsWith(':OUT'));
  for (const route of [arriving, departing])
    for (let i = 1;i < route.length;i++) {
      const p = route[i - 1].sample(route[i - 1].length).position, q = route[i].sample(0).position;
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-5, `discontinuous ${route[i - 1].id} -> ${route[i].id}`);
    }
  const v = g.sim.spawnTrip(home, a, 'truck');
  assert.ok(v);
  for (let i = 0;i < 1800;i++)
    g.sim.step(1 / 30);
  assert.equal(g.sim.deliveries, 1);
});
test('demolishing either member repairs active arrivals and removes service lanes atomically', () => {
  for (const removed of [a, b]) {
    const { g, ra } = connected(), home = neighbor(ra, 2);
    g.build(home, 'Home', 'ground', 0, 3);
    const v = g.sim.spawnTrip(home, a, 'truck')!;
    assert.ok(v);
    const survivor = hexKey(removed) === hexKey(a) ? b : a;
    const id = g.districts.clusterAt(a)!.id;
    assert.ok(g.build(removed, 'demolish', 'ground', 0, 3));
    assert.ok(g.sim.vehicles.includes(v));
    assert.equal(v.destination, hexKey(survivor));
    assert.ok(![...g.roads.lanes.values()].some(l => l.serviceId === id));
    for (let i = 0;i < 1800;i++)
      g.sim.step(1 / 30);
    assert.equal(g.sim.deliveries, 1);
  }
});
test('merged mesh is centered once, has four docks and hides shared grid edge', async () => {
  const { HexMeshBuilder } = await import('../src/render/HexMeshBuilder.ts');
  const g = fixture(6);
  g.map.get(neighbor(b, 0))!.elevation = 8;
  g.build(b, 'Warehouse', 'ground', 0, 3);
  const builder = new HexMeshBuilder();
  builder.build(g);
  const complex = builder.root.getObjectByName(`complex:${hexKey(a)}`);
  assert.ok(complex);
  const pa = hexToWorld(a.q, a.r), pb = hexToWorld(b.q, b.r);
  assert.equal(complex.position.x, (pa.x + pb.x) / 2);
  assert.equal(complex.position.z, (pa.z + pb.z) / 2);
  let docks = 0, singles = 0, walls = 0;
  builder.root.traverse(o => {
    if (o.name.startsWith(`dock:${hexKey(a)}:`))
      docks++;
    if (o.name === `building:${hexKey(a)}` || o.name === `building:${hexKey(b)}`)
      singles++;
    if (o.name.startsWith('retaining:'))
      walls++;
  });
  assert.equal(docks, 4);
  assert.equal(singles, 0);
  assert.ok(walls > 0);
  const apron = builder.root.getObjectByName(`apron:${hexKey(a)}`) as import('three').Mesh;
  assert.ok(apron);
  const positions = apron.geometry.getAttribute('position');
  for (let i = 0;i < positions.count;i++)
    assert.ok(Math.abs(positions.getY(i) - 4.16) < 1e-5);
});
test('factory duo has exactly four shed roof sections', async () => {
  const { HexMeshBuilder } = await import('../src/render/HexMeshBuilder.ts');
  const g = new GameState();
  g.build(a, 'Factory', 'ground', 0, 3);
  g.build(b, 'Factory', 'ground', 0, 3);
  const builder = new HexMeshBuilder();
  builder.build(g);
  const complex = builder.root.getObjectByName(`complex:${hexKey(a)}`)!;
  assert.ok(complex);
  assert.equal(complex.children.filter(o => o.name.startsWith('shed:')).length, 4);
});
test('all six pair orientations retain A/B order and keep service paths outside the building', () => {
  for (let edge = 0;edge < 6;edge++) {
    const map = new HexMap(4), roads = new HexRoadGraph(), districts = new DistrictManager(roads, () => map);
    const g = { map, roads, districts }, x = { q: 0, r: 0 }, y = neighbor(x, edge);
    districts.place(x, 'Factory');
    districts.place(y, 'Factory');
    const c = g.districts.clusterAt(x)!;
    assert.equal(c.shape, 'duo');
    assert.equal(hexKey(c.tiles[0]), hexKey(x));
    assert.equal(c.sharedEdge!.edge, edge);
    // Put roads on the outer ends, exercising gates behind the roof as well.
    for (const h of [neighbor(x, (edge + 3) % 6), neighbor(y, edge)])
      roads.addRoad({ ...h, level: 'ground' });
    assert.ok(g.districts.clusterAt(x)!.ports.IN);
    assert.ok(g.districts.clusterAt(x)!.ports.OUT);
    const layout = complexLayout(g.districts.clusterAt(x)!, g.map.height(x));
    for (const l of g.roads.lanes.values())
      if (l.serviceId === c.id && l.servicePart === 'yard')
        for (let i = 0;i <= 100;i++) {
          const p = layout.local(l.sample(l.length * i / 100).position);
          assert.ok(!(Math.abs(p.x) < 12 && p.z > -4.4 && p.z < 0.7), 'service lane intersects production hall');
        }
  }
});
test('degrade while inside yard reroutes without stale service lanes or double rewards', () => {
  for (const removed of [a, b]) {
    const { g, ra } = connected(), home = neighbor(ra, 2);
    g.build(home, 'Home', 'ground', 0, 3);
    const v = g.sim.spawnTrip(home, a, 'truck')!;
    v.laneIndex = v.route.findIndex(l => l.servicePart === 'yard');
    v.u = 2;
    assert.ok(g.build(removed, 'demolish', 'ground', 0, 3));
    assert.ok(g.sim.vehicles.includes(v));
    assert.ok(v.route.slice(v.laneIndex).every(l => g.roads.lanes.has(l.id)));
    for (let i = 0;i < 1800;i++)
      g.sim.step(1 / 30);
    assert.equal(g.sim.deliveries, 1);
  }
});
test('removed gate road pauses an arrival and restored road allows completion', () => {
  const { g, ra, rb } = connected(), home = neighbor(ra, 2);
  g.build(home, 'Home', 'ground', 0, 3);
  const v = g.sim.spawnTrip(home, a, 'truck')!;
  g.build(rb, 'demolish', 'ground', 0, 3);
  g.build(neighbor(a, 1), 'demolish', 'ground', 0, 3);
  g.sim.step(1);
  assert.ok(g.sim.vehicles.includes(v));
  assert.equal(g.sim.deliveries, 0);
  g.build(neighbor(a, 1), 'road', 'ground', 0, 3, ra);
  g.build(rb, 'road', 'ground', 0, 3, neighbor(a, 1));
  for (let i = 0;i < 1800;i++)
    g.sim.step(1 / 30);
  assert.equal(g.sim.deliveries, 1);
});
test('gates use a common road hex or two nonadjacent road hexes', () => {
  const map = new HexMap(4), roads = new HexRoadGraph(), d = new DistrictManager(roads, () => map);
  const x = { q: 0, r: 0 }, y = { q: 1, r: 0 };
  d.place(x, 'Warehouse');
  d.place(y, 'Warehouse');
  roads.addRoad({ q: 0, r: 1, level: 'ground' });
  roads.addRoad({ q: 1, r: 1, level: 'ground' });
  let ports = d.clusterAt(x)!.ports;
  assert.equal(hexKey(ports.IN!.road), hexKey(ports.OUT!.road), 'adjacent external gate roads must consolidate into their common road hex');
  roads.addRoad({ q: -1, r: 1, level: 'ground' });
  ports = d.clusterAt(x)!.ports;
  assert.equal(hexKey(ports.IN!.road), '-1,1');
  assert.equal(hexKey(ports.OUT!.road), '1,1');
});
test('a vehicle in a demolished yard can wait for survivor access and resume later', () => {
  const { g, ra, rb } = connected(), home = neighbor(ra, 2);
  g.build(home, 'Home', 'ground', 0, 3);
  const v = g.sim.spawnTrip(home, a, 'truck')!;
  v.laneIndex = v.route.findIndex(l => l.servicePart === 'yard');
  v.u = 1;
  g.build(rb, 'demolish', 'ground', 0, 3);
  g.build(neighbor(a, 1), 'demolish', 'ground', 0, 3);
  g.build(a, 'demolish', 'ground', 0, 3);
  assert.ok(g.sim.vehicles.includes(v));
  assert.ok(!v.route.some(l => l.servicePart === 'yard'), 'no references to deleted service lanes');
  g.build(neighbor(a, 1), 'road', 'ground', 0, 3, ra);
  g.build(rb, 'road', 'ground', 0, 3, neighbor(a, 1));
  for (let i = 0;i < 1800;i++)
    g.sim.step(1 / 30);
  assert.equal(g.sim.deliveries, 1);
});
