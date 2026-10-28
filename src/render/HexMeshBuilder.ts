import { buildRoadTileMesh } from "./RoadTileMeshes.ts";
import { createIndustrialComplex } from "./IndustrialComplexMesh.ts";
import * as THREE from "three";
import {
  hexKey,
  HEX_SIZE,
  HEX_STEP,
  hexToWorld,
  neighbor,
} from "../core/hex/HexCoords.ts";
import type { GameState } from "../core/GameState.ts";
import type { RoadCell } from "../core/roads/HexRoadGraph.ts";
import { edgeDirection, laneGeometry } from "../core/roads/geometry.ts";
import { complexLayout } from "../core/districts/ServiceYard.ts";
import type { DistrictCluster } from "../core/districts/DistrictManager.ts";
import type { Zone } from "../core/districts/DistrictManager.ts";
type RenderState = Pick<GameState, "map" | "roads" | "districts" | "terrainAt">;
export const PALETTE = {
  grass: 0x5cd68d,
  side: 0x3fa368,
  rock: 0xe8926b,
  rockSide: 0xb86544,
  pine: 0x1f6e6c,
  pineLight: 0x2a8582,
  asphalt: 0x4a475c,
  concrete: 0xc5c6b6,
  mark: 0xf4f4f0,
  paper: 0xefe9dc,
  ink: 0x1e2224,
  accent: 0xe06d3b,
};
const gridMaterial = new THREE.LineBasicMaterial({
  color: 0x435e4b,
  transparent: true,
  opacity: 0.16,
});
const terrainMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 1,
});
const materials = new Map<number, THREE.MeshStandardMaterial>();
export function material(color: number): THREE.MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      shadowSide: THREE.DoubleSide,
    });
    materials.set(color, m);
  }
  return m;
}
export function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cylinder(
  parent: THREE.Object3D,
  rt: number,
  rb: number,
  h: number,
  x: number,
  y: number,
  z: number,
  color: number,
  sides = 6,
): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(rt, rb, h, sides),
    material(color),
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function disposeGroup(group: THREE.Object3D): void {
  const temporaryMaterials = new Set<THREE.Material>();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments)
      o.geometry.dispose();
    if (o instanceof THREE.Mesh)
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (m instanceof THREE.MeshBasicMaterial) temporaryMaterials.add(m);
  });
  for (const m of temporaryMaterials) m.dispose();
  group.clear();
}
/** Refine asphalt in both axes so curved terrain cannot poke through a wide strip. */
function drape(
  geometry: THREE.BufferGeometry,
  height: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const pos = geometry.getAttribute("position"),
    idx = geometry.index,
    out: number[] = [];
  const vertex = (i: number) => [pos.getX(i), pos.getZ(i)];
  const triangle = (a: number[], b: number[], c: number[], depth: number) => {
    if (
      depth < 5 &&
      Math.max(
        Math.hypot(a[0] - b[0], a[1] - b[1]),
        Math.hypot(b[0] - c[0], b[1] - c[1]),
        Math.hypot(c[0] - a[0], c[1] - a[1]),
      ) > 1.2
    ) {
      const mid = (u: number[], v: number[]) => [
        (u[0] + v[0]) / 2,
        (u[1] + v[1]) / 2,
      ];
      const ab = mid(a, b),
        bc = mid(b, c),
        ca = mid(c, a);
      triangle(a, ab, ca, depth + 1);
      triangle(ab, b, bc, depth + 1);
      triangle(ca, bc, c, depth + 1);
      triangle(ab, bc, ca, depth + 1);
    } else for (const [x, z] of [a, b, c]) out.push(x, height(x, z), z);
  };
  for (let i = 0;i < (idx?.count ?? pos.count);i += 3)
    triangle(
      vertex(idx ? idx.getX(i) : i),
      vertex(idx ? idx.getX(i + 1) : i + 1),
      vertex(idx ? idx.getX(i + 2) : i + 2),
      0,
    );
  geometry.dispose();
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  result.computeVertexNormals();
  return result;
}
export class HexMeshBuilder {
  readonly root = new THREE.Group();
  readonly pickables: THREE.Object3D[] = [];
  readonly signals: { mesh: THREE.Mesh; nodeId: string; edge: number }[] = [];
  build(game: RenderState, paper = false): void {
    disposeGroup(this.root);
    this.pickables.length = 0;
    this.signals.length = 0;
    const treePositions: THREE.Vector3[] = [];
    const clusters = game.districts.clusters;
    const complexes = new Map<string, DistrictCluster>();
    for (const c of clusters) if (c.shape !== "single") for (const t of c.tiles) complexes.set(hexKey(t), c);
    for (const t of game.map.tiles.values()) {
      const p = hexToWorld(t.q, t.r, game.map.height(t));
      const water = t.biome === "water";
      // Every boundary vertex samples the same world-space field. No tile gaps.
      const vertices: number[] = [],
        colors: number[] = [];
      const emit = (points: number[][]) => {
        for (const [x, z] of points) {
          const bed = game.terrainAt(t, x, z),
            y = Math.max(game.map.seaLevel, bed);
          vertices.push(x, y, z);
          const c = new THREE.Color(
            paper
              ? PALETTE.paper
              : bed < game.map.seaLevel
                ? 0x589b9f
                : bed < 1.3
                  ? 0xb9b18b
                  : bed > 18
                    ? 0xa69c7d
                    : bed > 11
                      ? 0x7e9566
                      : 0x7da879,
          );
          if (!paper && bed >= 1.3) {
            c.set(0x7da879);
            c.lerp(
              new THREE.Color(0xa69c7d),
              Math.max(0, Math.min(1, (bed - 8) / 17)),
            );
          }
          colors.push(c.r, c.g, c.b);
        }
      };
      const subdivisions = 10;
      for (let edge = 0;edge < 6;edge++) {
        const a = ((edge + 0.5) * Math.PI) / 3,
          b = ((edge + 1.5) * Math.PI) / 3;
        const point = (i: number, j: number) => [
          p.x + (HEX_SIZE * (i * Math.cos(a) + j * Math.cos(b))) / subdivisions,
          p.z + (HEX_SIZE * (i * Math.sin(a) + j * Math.sin(b))) / subdivisions,
        ];
        for (let i = 0;i < subdivisions;i++)
          for (let j = 0;j < subdivisions - i;j++) {
            emit([point(i, j), point(i, j + 1), point(i + 1, j)]);
            if (i + j < subdivisions - 1)
              emit([point(i + 1, j), point(i, j + 1), point(i + 1, j + 1)]);
          }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(colors, 3),
      );
      geometry.computeVertexNormals();
      const cap = new THREE.Mesh(geometry, terrainMaterial);
      cap.receiveShadow = true;
      cap.userData.hex = t;
      this.root.add(cap);
      this.pickables.push(cap);
      const outline: number[] = [];
      for (let e = 0;e < 6;e++) {
        // Outline index e spans the actual neighbor edge e+1.
        const c = complexes.get(hexKey(t));
        if (c && c === complexes.get(hexKey(neighbor(t, (e + 1) % 6)))) continue;
        for (let i = 0;i < 10;i++)
          for (const u of [i / 10, (i + 1) / 10]) {
            const a = ((e + 0.5) * Math.PI) / 3,
              b = ((e + 1.5) * Math.PI) / 3,
              x = p.x + HEX_SIZE * ((1 - u) * Math.cos(a) + u * Math.cos(b)),
              z = p.z + HEX_SIZE * ((1 - u) * Math.sin(a) + u * Math.sin(b));
            outline.push(x, Math.max(0, game.terrainAt(t, x, z)) + 0.025, z);
          }
      }
      const lines = new THREE.BufferGeometry();
      lines.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(outline, 3),
      );
      const grid = new THREE.LineSegments(lines, gridMaterial);
      grid.name = `grid:${hexKey(t)}`;
      this.root.add(grid);

      // Only the region perimeter needs a retaining wall down to the sea bed.
      for (let edge = 0;edge < 6;edge++) {
        const adjacent = game.map.get(neighbor(t, edge));
        const engineered = game.map.flattened.has(hexKey(t));
        const sameComplex = complexes.has(hexKey(t)) && complexes.get(hexKey(t)) === complexes.get(hexKey(neighbor(t, edge)));
        if (sameComplex) continue;
        if (!engineered && adjacent &&
          (game.map.flattened.has(hexKey(adjacent)) || !game.map.isCliff(t, edge) || game.map.height(t) <= game.map.height(adjacent))) continue;
        const side: number[] = [];
        const a = ((edge - 0.5) * Math.PI) / 3,
          b = ((edge + 0.5) * Math.PI) / 3;
        for (let i = 0;i < 10;i++) {
          const at = (u: number) => [
            p.x + HEX_SIZE * ((1 - u) * Math.cos(a) + u * Math.cos(b)),
            p.z + HEX_SIZE * ((1 - u) * Math.sin(a) + u * Math.sin(b)),
          ];
          const [x, z] = at(i / 10),
            [xx, zz] = at((i + 1) / 10),
            y = Math.max(0, game.terrainAt(t, x, z)),
            yy = Math.max(0, game.terrainAt(t, xx, zz)),
            bottom = adjacent
              ? Math.max(0, game.terrainAt(adjacent, x, z))
              : -8,
            nextBottom = adjacent
              ? Math.max(0, game.terrainAt(adjacent, xx, zz))
              : -8;
          side.push(
            x,
            y,
            z,
            xx,
            yy,
            zz,
            x,
            bottom,
            z,
            xx,
            yy,
            zz,
            xx,
            nextBottom,
            zz,
            x,
            bottom,
            z,
          );
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(side, 3));
        g.computeVertexNormals();
        if (engineered && side.every((_, i) => i % 18 !== 1 || Math.abs(side[i] - side[i + 6]) < 1e-5)) { g.dispose(); continue; }
        const wallMaterial = material(engineered ? PALETTE.concrete : 0x81715c);
        if (engineered) wallMaterial.side = THREE.DoubleSide;
        const wall = new THREE.Mesh(g, wallMaterial);
        if (engineered) wall.name = `retaining:${hexKey(t)}:${edge}`;
        wall.castShadow = true;
        wall.receiveShadow = true;
        wall.userData.hex = t;
        this.root.add(wall);
      }
      const vacant =
        !game.roads.get({ ...t, level: "ground" }) &&
        !game.roads.get({ ...t, level: "elevated" }) &&
        !game.districts.zones.has(`${t.q},${t.r}`);
      if (vacant && t.biome === "forest")
        for (let i = 0;i < 3;i++)
          treePositions.push(
            new THREE.Vector3(
              p.x + (i - 1) * 3,
              game.map.surfaceAt(p.x + (i - 1) * 3, p.z + (i % 2) * 3 - 1),
              p.z + (i % 2) * 3 - 1,
            ),
          );
      if (water && !paper) {
        for (let i = 0;i < 2;i++)
          box(
            this.root,
            3,
            0.04,
            0.16,
            p.x - 2 + i * 5,
            game.map.seaLevel + 0.04,
            p.z + i * 2,
            0xa8d7c9,
          );
      }
    }
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.35, 0.5, 2, 5),
      material(0x9b6c4a),
      treePositions.length,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.7, 6, 6),
      material(paper ? 0x718575 : PALETTE.pine),
      treePositions.length,
    );
    const matrix = new THREE.Matrix4();
    treePositions.forEach((p, i) => {
      matrix.makeTranslation(p.x, p.y + 1, p.z);
      trunks.setMatrixAt(i, matrix);
      matrix.makeTranslation(p.x, p.y + 4.5, p.z);
      crowns.setMatrixAt(i, matrix);
    });
    crowns.castShadow = true;
    trunks.castShadow = true;
    this.root.add(trunks, crowns);
    for (const n of game.roads.nodes.values()) {
      // Service access is painted separately as a single directed lane.
      const connectionsMask = game.roads.streetEdges(n.id).reduce((mask, e) => mask | (1 << e), 0);
      this.road(game, { ...n, connectionsMask }, paper);
    }
    for (const z of game.districts.zones.values())
      if (!complexes.has(hexKey(z))) this.building(game, z, paper);
    for (const c of clusters) if (c.shape !== "single") this.complex(game, c, paper);
  }
  private deckBody(top: THREE.BufferGeometry): void {
    const pos = top.getAttribute("position"),
      idx = top.index,
      vertices: number[] = [],
      edges = new Map<string, { a: number[]; b: number[]; count: number }>();
    const point = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const key = (p: number[]) => p.map((v) => Math.round(v * 10000)).join(",");
    for (let i = 0;i < (idx?.count ?? pos.count);i += 3) {
      const tri = [0, 1, 2].map((k) => point(idx ? idx.getX(i + k) : i + k));
      for (const p of [tri[2], tri[1], tri[0]])
        vertices.push(p[0], p[1] - 0.45, p[2]);
      for (let k = 0;k < 3;k++) {
        const a = tri[k],
          b = tri[(k + 1) % 3],
          id = [key(a), key(b)].sort().join("|"),
          old = edges.get(id);
        if (old) old.count++;
        else edges.set(id, { a, b, count: 1 });
      }
    }
    for (const { a, b, count } of edges.values())
      if (count === 1) {
        const aa = [a[0], a[1] - 0.45, a[2]],
          bb = [b[0], b[1] - 0.45, b[2]];
        for (const p of [a, aa, b, b, aa, bb]) vertices.push(...p);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    const body = new THREE.Mesh(geo, material(0x747a70));
    body.castShadow = true;
    body.receiveShadow = true;
    this.root.add(body);
  }
  private road(game: RenderState, n: RoadCell, paper: boolean): void {
    const p = hexToWorld(n.q, n.r);
    const asphalt = paper ? 0x5a5c54 : PALETTE.asphalt;
    const isJunction =
      (n.connectionsMask.toString(2).match(/1/g) ?? []).length > 2;
    const hubRadius = isJunction ? 6.3 : 3.4;
    const height = (x: number, z: number) =>
      game.roads.heightAt(n, x, z) + 0.16;
    const edges = Array.from({ length: 6 }, (_, e) => e).filter(
      (e) => n.connectionsMask & (1 << e),
    );
    if (n.level === "ground" && !n.rampId) {
      this.root.add(buildRoadTileMesh(n, game.roads.roadTile(n), height, asphalt));
      if (n.signal) for (const e of edges) {
        const d = edgeDirection(e), x = p.x + d.x * 6 - d.z * 3.7,
          z = p.z + d.z * 6 + d.x * 3.7, y = height(x,z);
        box(this.root, .22, 2.8, .22, x, y+1.4, z, PALETTE.ink);
        box(this.root, .7, 1.2, .7, x, y+3, z, PALETTE.ink);
        const light = new THREE.Mesh(new THREE.SphereGeometry(.42,10,8), new THREE.MeshBasicMaterial({color:0x45b678}));
        light.position.set(x,y+3.92,z); this.root.add(light);
        this.signals.push({mesh:light,nodeId:n.id,edge:e});
      }
      return;
    }
    if (edges.length <= 2) {
      this.curvedRoad(game, n, edges, asphalt);
      return;
    }
    // A radial fan and fixed-width straight arms avoid polygon boolean operations.
    const hub = new THREE.BufferGeometry(),
      verts: number[] = [];
    for (let i = 0;i < 12;i++) {
      const a = (i * Math.PI) / 6,
        b = ((i + 1) * Math.PI) / 6;
      for (const [x, z] of [
        [p.x, p.z],
        [p.x + hubRadius * Math.cos(b), p.z + hubRadius * Math.sin(b)],
        [p.x + hubRadius * Math.cos(a), p.z + hubRadius * Math.sin(a)],
      ])
        verts.push(x, height(x, z), z);
    }
    hub.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    hub.computeVertexNormals();
    const center = new THREE.Mesh(drape(hub, height), material(asphalt));
    center.receiveShadow = true;
    center.castShadow = true;
    this.root.add(center);
    if (n.level === "elevated") this.deckBody(center.geometry);
    for (let e = 0;e < 6;e++)
      if (n.connectionsMask & (1 << e)) {
        const d = edgeDirection(e),
          side = { x: -d.z, z: d.x };
        const positions: number[] = [],
          indices: number[] = [];
        const segments = n.rampId ? 16 : 1;
        for (let i = 0;i <= segments;i++) {
          const u = ((HEX_STEP / 2) * i) / segments;
          for (const sign of [-1, 1]) {
            const x = p.x + d.x * u + side.x * 3.1 * sign,
              z = p.z + d.z * u + side.z * 3.1 * sign;
            positions.push(x, height(x, z), z);
          }
        }
        for (let i = 0;i < segments;i++) {
          const a = i * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3),
        );
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const road = new THREE.Mesh(drape(geometry, height), material(asphalt));
        road.receiveShadow = true;
        road.castShadow = true;
        this.root.add(road);
        if (n.level === "elevated") this.deckBody(road.geometry);
        for (let u = 4;u < HEX_STEP / 2;u += 2.4) {
          const x = p.x + d.x * u,
            z = p.z + d.z * u;
          const mark = box(
            this.root,
            0.16,
            0.04,
            1.2,
            x,
            height(x, z) + 0.035,
            z,
            PALETTE.mark,
          );
          mark.rotation.y = Math.atan2(d.x, d.z);
        }
        if (!isJunction)
          for (const sign of [-1, 1])
            for (let i = 0;i < 4;i++) {
              const u = 3.7 + ((HEX_STEP / 2 - 3.7) * (i + 0.5)) / 4,
                len = (HEX_STEP / 2 - 3.7) / 4 + 0.02,
                x = p.x + d.x * u + side.x * 3.3 * sign,
                z = p.z + d.z * u + side.z * 3.3 * sign;
              const curb = box(
                this.root,
                0.35,
                0.42,
                len,
                x,
                height(x, z) + 0.17,
                z,
                PALETTE.concrete,
              );
              curb.rotation.y = Math.atan2(d.x, d.z);
              const u0 = u - len / 2,
                u1 = u + len / 2;
              curb.rotation.x = -Math.atan2(
                height(
                  p.x + d.x * u1 + side.x * 3.3 * sign,
                  p.z + d.z * u1 + side.z * 3.3 * sign,
                ) -
                height(
                  p.x + d.x * u0 + side.x * 3.3 * sign,
                  p.z + d.z * u0 + side.z * 3.3 * sign,
                ),
                len,
              );
            }
        if (n.signal) {
          const x = p.x + d.x * 6 + side.x * 3.7,
            z = p.z + d.z * 6 + side.z * 3.7,
            y = height(x, z);
          box(this.root, 0.22, 2.8, 0.22, x, y + 1.4, z, PALETTE.ink);
          box(this.root, 0.7, 1.2, 0.7, x, y + 3, z, PALETTE.ink);
          const light = new THREE.Mesh(
            new THREE.SphereGeometry(0.42, 10, 8),
            new THREE.MeshBasicMaterial({ color: 0x45b678 }),
          );
          // Keep the lamp above the housing instead of burying it inside the opaque box.
          light.position.set(x, y + 3.92, z);
          this.root.add(light);
          this.signals.push({ mesh: light, nodeId: n.id, edge: e });
        }
      }
    if (n.level === "elevated") {
      const ground = game.roads.get({ ...n, level: "ground" });
      let count = 0;
      for (let i = 0;i < 6 && count < 2;i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3,
          x = p.x + 6.5 * Math.cos(a),
          z = p.z + 6.5 * Math.sin(a);
        let clear = true;
        if (ground)
          for (let e = 0;e < 6;e++)
            if (ground.connectionsMask & (1 << e)) {
              const d = edgeDirection(e);
              if (
                (x - p.x) * d.x + (z - p.z) * d.z > 0 &&
                Math.abs((x - p.x) * d.z - (z - p.z) * d.x) < 4.2
              )
                clear = false;
            }
        const h = height(x, z) - game.map.surfaceAt(x, z);
        if (clear && h > 3) {
          box(
            this.root,
            1.2,
            h,
            1.2,
            x,
            game.map.surfaceAt(x, z) + h / 2 - 0.2,
            z,
            PALETTE.concrete,
          );
          count++;
        }
      }
    }
  }
  private curvedRoad(
    game: RenderState,
    n: RoadCell,
    edges: number[],
    color: number,
  ): void {
    const height = (x: number, z: number) =>
      game.roads.heightAt(n, x, z) + 0.16;
    if (!edges.length) {
      const p = hexToWorld(n.q, n.r);
      cylinder(
        this.root,
        2.9,
        2.9,
        0.25,
        p.x,
        height(p.x, p.z),
        p.z,
        color,
        24,
      );
      return;
    }
    const curve = laneGeometry(
      n,
      edges.length === 1 ? -1 : edges[0],
      edges.length === 1 ? edges[0] : edges[1],
      height,
      0,
    );
    const at = (u: number, offset: number, raise = 0) => {
      const sample = curve.sample(u),
        p = sample.position,
        t = sample.tangent,
        len = Math.hypot(t.x, t.z);
      const x = p.x - (t.z / len) * offset,
        z = p.z + (t.x / len) * offset;
      return new THREE.Vector3(x, height(x, z) + raise, z);
    };
    const ribbon = (
      start: number,
      end: number,
      left: number,
      right: number,
      raise: number,
    ) => {
      const positions: number[] = [],
        indices: number[] = [],
        steps = Math.max(2, Math.ceil((end - start) / 0.6));
      for (let i = 0;i <= steps;i++) {
        const u = start + ((end - start) * i) / steps;
        for (const side of [left, right]) {
          const p = at(u, side, raise);
          positions.push(p.x, p.y, p.z);
        }
      }
      for (let i = 0;i < steps;i++) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return drape(geo, (x, z) => height(x, z) + raise);
    };
    const surface = new THREE.Mesh(
      ribbon(0, curve.length, -3.1, 3.1, 0),
      material(color),
    );
    surface.castShadow = true;
    surface.receiveShadow = true;
    this.root.add(surface);
    if (n.level === "elevated") this.deckBody(surface.geometry);
    if (edges.length === 1) {
      const c = hexToWorld(n.q, n.r),
        vertices: number[] = [];
      for (let i = 0;i < 48;i++)
        for (const a of [null, ((i + 1) * Math.PI) / 24, (i * Math.PI) / 24]) {
          const x = c.x + (a === null ? 0 : 3.3 * Math.cos(a)),
            z = c.z + (a === null ? 0 : 3.3 * Math.sin(a));
          vertices.push(x, height(x, z) + 0.015, z);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      const cap = new THREE.Mesh(
        drape(g, (x, z) => height(x, z) + 0.015),
        material(color),
      );
      cap.castShadow = true;
      cap.receiveShadow = true;
      this.root.add(cap);
      if (n.level === "elevated") this.deckBody(cap.geometry);
    }
    // Continuous rails follow the same analytical curve as the driving lanes.
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        ribbon(
          0,
          curve.length,
          side < 0 ? -3.2 : 2.95,
          side < 0 ? -2.95 : 3.2,
          0.22,
        ),
        material(PALETTE.concrete),
      );
      rail.castShadow = true;
      this.root.add(rail);
    }
    for (let u = 0.6;u < curve.length - 0.6;u += 3.5)
      this.root.add(
        new THREE.Mesh(
          ribbon(u, Math.min(u + 1.5, curve.length - 0.3), -0.09, 0.09, 0.035),
          material(PALETTE.mark),
        ),
      );
    if (n.level === "elevated") {
      const lower = game.roads.lanesAt({ ...n, level: "ground" });
      for (const [fraction, side] of [
        [0.3, -2.5],
        [0.7, 2.5],
      ]) {
        const p = at(curve.length * fraction, side),
          ground = game.map.surfaceAt(p.x, p.z);
        const blocked = lower.some((l) =>
          Array.from(
            { length: 17 },
            (_, i) => l.sample((l.length * i) / 16).position,
          ).some((v) => Math.hypot(v.x - p.x, v.z - p.z) < 3.4),
        );
        if (!blocked && p.y - ground > 3)
          box(
            this.root,
            1,
            p.y - ground,
            1,
            p.x,
            (p.y + ground) / 2 - 0.15,
            p.z,
            PALETTE.concrete,
          );
      }
    }
    if (n.signal)
      for (const e of edges) {
        const d = edgeDirection(e),
          c = hexToWorld(n.q, n.r),
          x = c.x + d.x * 6 - d.z * 3.8,
          z = c.z + d.z * 6 + d.x * 3.8,
          y = height(x, z);
        box(this.root, 0.2, 3, 0.2, x, y + 1.5, z, PALETTE.ink);
        const light = new THREE.Mesh(
          new THREE.SphereGeometry(0.3, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0x45b678 }),
        );
        light.position.set(x, y + 3, z);
        this.root.add(light);
        this.signals.push({ mesh: light, nodeId: n.id, edge: e });
      }
  }
  private complex(game: RenderState, cluster: DistrictCluster, paper: boolean): void {
    const elevation = game.map.height(cluster.tiles[0]);
    if (cluster.shape === "superhex_7") {
      this.root.add(createIndustrialComplex(cluster, elevation));
      this.servicePaths(game, cluster);
      return;
    }
    const layout = complexLayout(cluster, elevation);
    const group = new THREE.Group();
    group.name = `complex:${cluster.id}`;
    group.position.set(layout.center.x, elevation, layout.center.z);
    group.rotation.y = -Math.atan2(layout.axis.z, layout.axis.x);
    group.scale.z = layout.axis.x * layout.front.z - layout.axis.z * layout.front.x;
    this.root.add(group);
    const pavement: number[] = [];
    for (const t of cluster.tiles) {
      const center = hexToWorld(t.q, t.r);
      for (let e = 0;e < 6;e++) {
        const a = (e + 0.5) * Math.PI / 3, b = (e + 1.5) * Math.PI / 3;
        pavement.push(center.x, elevation + 0.16, center.z, center.x + HEX_SIZE * Math.cos(b), elevation + 0.16, center.z + HEX_SIZE * Math.sin(b), center.x + HEX_SIZE * Math.cos(a), elevation + 0.16, center.z + HEX_SIZE * Math.sin(a));
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pavement, 3));
    geometry.computeVertexNormals();
    const apron = new THREE.Mesh(geometry, material(paper ? 0xb8b4a9 : PALETTE.asphalt));
    apron.name = `apron:${cluster.id}`;
    apron.receiveShadow = true;
    this.root.add(apron);
    const warehouse = cluster.type === "Warehouse", shop = cluster.type === "Shop";
    const large = false;
    const width = large ? 32 : 14, depth = large ? 13 : 7;
    const height = large ? 9 : 6.5, centerZ = large ? -6.5 : -2;
    const front = centerZ + depth / 2;
    const body = box(group, width, height, depth, 0, height / 2 + 0.25, centerZ,
      warehouse ? 0xe5ae62 : shop ? 0xeedcb9 : PALETTE.concrete);
    body.name = `body:${cluster.id}`;
    if (shop) {
      box(group, width + 0.4, 0.45, depth + 0.4, 0, height + 0.45, centerZ, 0x3aafa9);
      for (let i = 0; i < 6; i++) {
        const x = -5.5 + i * 2.2;
        box(group, 1.9, 3.2, 0.15, x, 2.3, front + 0.1, 0x96c8d8).name = `shopfront:${i}`;
        box(group, 2.1, 0.22, 1.5, x, 4.1, front + 0.6, i % 2 ? PALETTE.paper : PALETTE.accent);
      }
    } else if (warehouse) {
      const slope = 0.22, half = depth / 2 + 0.3, ridge = height + 0.35 + Math.tan(slope) * half;
      for (const side of [-1, 1]) {
        const y = ridge - Math.tan(slope) * half / 2, z = centerZ + side * half / 2;
        const roof = box(group, width + 0.7, 0.18, half / Math.cos(slope), 0, y, z, PALETTE.asphalt);
        roof.name = `roof:${cluster.id}:${side}`;
        roof.rotation.x = side * slope;
        for (let x = -width / 2; x <= width / 2; x += 1.25) {
          const seam = box(group, 0.055, 0.08, half / Math.cos(slope), x, y + 0.13, z, 0x666575);
          seam.rotation.x = side * slope;
        }
        for (const x of [-width / 3, 0, width / 3]) {
          const skylight = box(group, 2.4, 0.12, half * 0.45, x, y + 0.22, z, 0x96c8d8);
          skylight.rotation.x = side * slope;
          skylight.name = `skylight:${cluster.id}:${x}:${side}`;
        }
      }
    } else {
      const shedWidth = width / 4;
      for (let i = 0; i < 4; i++) {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0); shape.lineTo(shedWidth, 0); shape.lineTo(shedWidth, 2); shape.closePath();
        const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: depth + 0.5, bevelEnabled: false }), material(PALETTE.asphalt));
        roof.name = `shed:${cluster.id}:${i}`;
        roof.position.set(-width / 2 + i * shedWidth, height + 0.25, centerZ - depth / 2 - 0.25);
        roof.castShadow = true; group.add(roof);
        box(group, 0.12, 1.1, depth * 0.7, -width / 2 + (i + 1) * shedWidth + 0.03, height + 1.4, centerZ, 0x96c8d8);
      }
      for (const [i, x] of [-3, 0, 3].entries()) {
        const stackHeight = 16 + i;
        cylinder(group, 0.65, 0.9, stackHeight, x, stackHeight / 2 + 0.25, centerZ - 2, 0xb86544, 12).name = `stack:${cluster.id}:${i}`;
        cylinder(group, 0.78, 0.78, 0.6, x, stackHeight, centerZ - 2, PALETTE.paper, 12);
      }
    }
    if (!shop) for (let i = 0, count = large ? 6 : 4; i < count; i++) {
      const x = (i - (count - 1) / 2) * (width - 5) / (count - 1);
      const dock = box(group, 2.8, 3.8, 0.22, x, 2.15, front + 0.15, 0x272d31);
      dock.name = `dock:${cluster.id}:${i}`;
      box(group, 3.3, 0.22, 1.2, x, 0.4, front + 0.6, PALETTE.concrete);
      box(group, 3.5, 0.22, 1.7, x, 4.2, front + 0.7, warehouse ? PALETTE.accent : 0x747a70);
      for (const dx of [-1.65, 1.65]) {
        box(group, 0.13, 0.035, 4.2, x + dx, 0.265, front + 2.3, 0xe3bb53);
        cylinder(group, 0.17, 0.17, 1.2, x + dx, 0.85, front + 0.6, 0xe3bb53, 8);
        cylinder(group, 0.18, 0.18, 0.3, x + dx, 1.05, front + 0.6, PALETTE.ink, 8);
      }
    }
    this.servicePaths(game, cluster);
  }
  private servicePaths(game: RenderState, cluster: DistrictCluster): void {
    // Draw the very same sampled access paths that the simulator uses.
    for (const lane of game.roads.lanes.values())
      if (lane.serviceId === cluster.id) {
        if (cluster.shape === "superhex_7" && (lane.servicePart === "yard" || lane.nodeId.startsWith("frontage:"))) continue;
        const verts: number[] = [], indices: number[] = [];
        const count = Math.max(8, Math.ceil(lane.length / 0.5));
        for (let i = 0;i <= count;i++) {
          const s = lane.sample(lane.length * i / count), n = Math.hypot(s.tangent.x, s.tangent.z) || 1;
          for (const side of [-1, 1])
            verts.push(s.position.x - s.tangent.z / n * 1.5 * side, s.position.y + 0.18, s.position.z + s.tangent.x / n * 1.5 * side);
          if (i < count) {
            const k = i * 2;
            indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        const strip = new THREE.Mesh(geo, material(PALETTE.asphalt));
        strip.name = `service:${lane.id}`;
        strip.receiveShadow = true;
        this.root.add(strip);
        if (lane.servicePart === "yard") for (let u = 1.5; u < lane.length - 0.8; u += 3.5) {
          const sample = lane.sample(u), mark = box(this.root, 0.12, 0.025, 1.4,
            sample.position.x, sample.position.y + 0.22, sample.position.z, PALETTE.mark);
          mark.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);
        }
        if (cluster.shape !== "superhex_7" && (lane.servicePart === "yard" || (lane.inEdge === -1 || lane.outEdge === -1))) {
          const sample = lane.sample(lane.length * 0.65), arrow = new THREE.Group();
          arrow.name = `direction:${lane.id}`;
          arrow.position.set(sample.position.x, sample.position.y + 0.24, sample.position.z);
          arrow.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);
          box(arrow, 0.13, 0.025, 1.3, 0, 0, 0, PALETTE.mark);
          for (const sign of [-1, 1]) {
            const head = box(arrow, 0.13, 0.025, 0.65, sign * 0.2, 0, 0.4, PALETTE.mark);
            head.rotation.y = -sign * 0.7;
          }
          this.root.add(arrow);
        }
      }
  }
  private building(game: RenderState, z: Zone, paper: boolean): void {
    const p = hexToWorld(z.q, z.r, game.map.height(z));
    const footprint = Array.from({ length: 24 }, (_, i) =>
      game.map.surfaceAt(
        p.x + 7.4 * Math.cos((i * Math.PI) / 12),
        p.z + 7.4 * Math.sin((i * Math.PI) / 12),
      ),
    );
    const bottom = Math.min(p.y, ...footprint),
      top = Math.max(p.y, ...footprint);
    p.y = top;
    const group = new THREE.Group();
    group.name = `building:${hexKey(z)}`;
    group.position.set(p.x, p.y, p.z);
    this.root.add(group);
    const depth = top - bottom + 0.25;
    cylinder(
      group,
      7.4,
      7.4,
      depth,
      0,
      0.275 - depth / 2,
      0,
      paper ? 0xd9d0b9 : 0xb8cb91,
    );
    for (const access of game.districts.access(z)) {
      const a = hexToWorld(access.q, access.r),
        dx = (a.x - p.x) / HEX_STEP,
        dz = (a.z - p.z) / HEX_STEP;
      const vertices: number[] = [];
      for (const [along, side] of [
        [0, -1.25],
        [0, 1.25],
        [HEX_STEP / 2, -1.25],
        [HEX_STEP / 2, 1.25],
      ])
        vertices.push(
          p.x + dx * along - dz * side,
          0,
          p.z + dz * along + dx * side,
        );
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      geometry.setIndex([0, 1, 2, 1, 3, 2]);
      this.root.add(
        new THREE.Mesh(
          drape(geometry, (x, zz) => {
            const u = Math.max(
              0,
              Math.min(
                1,
                ((x - p.x) * dx + (zz - p.z) * dz - 6) / (HEX_STEP / 2 - 6),
              ),
            );
            const ground = game.map.surfaceAt(x, zz);
            return Math.max(ground, p.y * (1 - u) + ground * u) + 0.3;
          }),
          material(PALETTE.concrete),
        ),
      );
    }
    const level =
      game.districts.clusters.find((c) =>
        c.tiles.some((t) => t.q === z.q && t.r === z.r),
      )?.level ?? 1;
    if (z.type === "Home") {
      for (const x of [-2.4, 2.4]) {
        box(group, 3.5, 3.7, 4, x, 2, 0, 0xf0e3c6);
        const roof = cylinder(group, 3.1, 3.1, 4.6, x, 4.3, 0, 0xd95b52, 3);
        roof.rotation.z = Math.PI / 2;
        roof.rotation.x = Math.PI / 2;
        box(group, 0.8, 1.6, 0.12, x, 1.2, 2.05, PALETTE.pine);
        for (const dx of [-1, 1])
          box(group, 0.65, 0.8, 0.12, x + dx, 2.8, 2.06, 0x96c8d8);
      }
    } else if (z.type === "Shop") {
      box(group, 7, 4 + Math.min(level, 3), 5, 0, 2.5, 0, 0xeedcb9);
      box(group, 7.5, 0.5, 5.5, 0, 5.2, 0, 0x3aafa9);
      box(group, 5, 2, 0.15, 0, 2, 2.6, 0x96c8d8);
      for (let i = 0;i < 6;i++)
        box(group, 1, 0.25, 1.5, -2.5 + i, 3.5, 3, i % 2 ? 0xf4f4f0 : 0xe06d3b);
    } else if (z.type === "Factory") {
      box(group, 7, 4, 5, 0, 2, 0, 0xc5c6b6);
      for (let i = 0;i < 3;i++) {
        const roof = box(group, 2.3, 1.1, 5, -2.3 + i * 2.3, 4.3, 0, 0x4a475c);
        roof.rotation.z = -0.25;
      }
      for (const x of [-2, 2]) {
        cylinder(group, 0.6, 0.8, 6, x, 5, -1.4, 0xb86544, 8);
        cylinder(group, 0.8, 0.8, 0.5, x, 8, -1.4, 0xefe9dc, 8);
      }
      box(group, 2, 2, 0.15, 0, 1.1, 2.55, 0x4a475c);
    } else {
      box(group, 7, 4, 5, 0, 2, 0, 0xf2a950);
      box(group, 7.6, 0.5, 5.6, 0, 4.2, 0, 0x4a475c);
      for (const x of [-2, 1.5])
        box(group, 2.3, 2.5, 0.15, x, 1.4, 2.55, 0xc5c6b6);
      for (let i = 0;i < 3;i++)
        box(group, 1.5, 1.5, 1.5, -3 + i * 1.8, 0.75, 4.2, 0xe06d3b);
    }
  }
  updateSignals(game: GameState): void {
    for (const s of this.signals) {
      const state = game.roads.signalState(s.nodeId, s.edge, game.sim.time);
      (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(
        state === "green"
          ? 0x70e489
          : state === "yellow"
            ? 0xffd557
            : state === "red"
              ? 0xf15c4b
              : 0x626a62,
      );
    }
  }
}
