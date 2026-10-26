import { HEX_STEP, hexToWorld, neighbor } from "../hex/HexCoords.ts";
import type { Hex, Vec3 } from "../hex/HexCoords.ts";
export const LANE_OFFSET = 1.15;
export interface LaneSample {
  position: Vec3;
  tangent: Vec3;
  grade: number;
}
export interface LaneGeometry {
  length: number;
  sample: (u: number) => LaneSample;
}
export function edgeDirection(edge: number): { x: number; z: number } {
  const h = neighbor({ q: 0, r: 0 }, edge),
    p = hexToWorld(h.q, h.r);
  return { x: p.x / HEX_STEP, z: p.z / HEX_STEP };
}
export function laneGeometry(
  h: Hex,
  inEdge: number,
  outEdge: number,
  height: (x: number, z: number) => number,
  offset = LANE_OFFSET,
): LaneGeometry {
  const c = hexToWorld(h.q, h.r),
    A = HEX_STEP / 2;
  const edge = inEdge < 0 ? outEdge : inEdge,
    d = edgeDirection(edge);
  const ti = inEdge < 0 ? d : { x: -d.x, z: -d.z };
  const out = outEdge < 0 ? ti : edgeDirection(outEdge);
  const start =
    inEdge < 0
      ? { x: c.x - ti.z * offset, z: c.z + ti.x * offset }
      : {
          x: c.x + d.x * A - ti.z * offset,
          z: c.z + d.z * A + ti.x * offset,
        };
  const end =
    outEdge < 0
      ? { x: c.x - out.z * offset, z: c.z + out.x * offset }
      : {
          x: c.x + out.x * A - out.z * offset,
          z: c.z + out.z * A + out.x * offset,
        };
  let planar: (t: number) => { x: number; z: number };
  const cross = ti.x * out.z - ti.z * out.x;
  if (Math.abs(cross) < 1e-8) {
    planar = (t) => ({
      x: start.x + (end.x - start.x) * t,
      z: start.z + (end.z - start.z) * t,
    });
  } else {
    const n1 = { x: -ti.z, z: ti.x },
      n2 = { x: -out.z, z: out.x };
    const dx = end.x - start.x,
      dz = end.z - start.z;
    const k = (dx * n2.z - dz * n2.x) / (n1.x * n2.z - n1.z * n2.x);
    const center = { x: start.x + k * n1.x, z: start.z + k * n1.z };
    const radius = Math.abs(k);
    const a0 = Math.atan2(start.z - center.z, start.x - center.x),
      a1 = Math.atan2(end.z - center.z, end.x - center.x);
    const sign = k > 0 ? 1 : -1;
    let sweep = a1 - a0;
    if (sign > 0 && sweep < 0) sweep += Math.PI * 2;
    if (sign < 0 && sweep > 0) sweep -= Math.PI * 2;
    planar = (t) => ({
      x: center.x + radius * Math.cos(a0 + sweep * t),
      z: center.z + radius * Math.sin(a0 + sweep * t),
    });
  }
  return sampledGeometry(planar, height);
}
export function deadEndGeometry(
  h: Hex,
  edge: number,
  height: (x: number, z: number) => number,
): LaneGeometry {
  const c = hexToWorld(h.q, h.r),
    d = edgeDirection(edge),
    side = { x: -d.z, z: d.x };
  const radius = LANE_OFFSET,
    offset = 0.6,
    straight = HEX_STEP / 2 - offset,
    total = 2 * straight + Math.PI * radius;
  return sampledGeometry((t) => {
    const u = t * total;
    let along: number, lateral: number;
    if (u < straight) {
      along = HEX_STEP / 2 - u;
      lateral = -radius;
    } else if (u <= straight + Math.PI * radius) {
      const a = (u - straight) / radius;
      along = offset - radius * Math.sin(a);
      lateral = -radius * Math.cos(a);
    } else {
      along = offset + u - straight - Math.PI * radius;
      lateral = radius;
    }
    return {
      x: c.x + d.x * along + side.x * lateral,
      z: c.z + d.z * along + side.z * lateral,
    };
  }, height);
}
function sampledGeometry(
  planar: (t: number) => { x: number; z: number },
  height: (x: number, z: number) => number,
): LaneGeometry {
  const point = (t: number): Vec3 => {
    const p = planar(t);
    return { ...p, y: height(p.x, p.z) };
  };
  // Arc length table includes vertical travel; reparameterize by 3D distance, not time.
  const resolution = 128,
    lengths = [0];
  let prev = point(0);
  for (let i = 1; i <= resolution; i++) {
    const p = point(i / resolution);
    lengths.push(
      lengths[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z),
    );
    prev = p;
  }
  const length = lengths[resolution];
  return {
    length,
    sample(u) {
      const s = Math.max(0, Math.min(length, u));
      let low = 0,
        high = resolution;
      while (low + 1 < high) {
        const m = (low + high) >> 1;
        if (lengths[m] < s) low = m;
        else high = m;
      }
      const t =
        (low + (s - lengths[low]) / (lengths[high] - lengths[low] || 1)) /
        resolution;
      const p = point(t),
        a = point(t - 1e-5),
        b = point(t + 1e-5);
      const norm = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
      return {
        position: p,
        tangent: {
          x: (b.x - a.x) / norm,
          y: (b.y - a.y) / norm,
          z: (b.z - a.z) / norm,
        },
        grade: (b.y - a.y) / (Math.hypot(b.x - a.x, b.z - a.z) || 1),
      };
    },
  };
}
