export interface Hex {
  q: number;
  r: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export const HEX_SIZE = 10;
export const HEX_STEP = Math.sqrt(3) * HEX_SIZE;
export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];
export const hexKey = (h: Hex): string => `${h.q},${h.r}`;
export function neighbor(h: Hex, direction: number): Hex {
  if (!Number.isInteger(direction) || direction < 0 || direction > 5)
    throw new RangeError("Direction must be 0..5");
  const d = DIRECTIONS[direction];
  return { q: h.q + d.q, r: h.r + d.r };
}
export const toCube = (h: Hex) => ({ x: h.q, y: -h.q - h.r, z: h.r });
export const fromCube = (c: { x: number; y: number; z: number }): Hex => {
  if (Math.abs(c.x + c.y + c.z) > 1e-8)
    throw new RangeError("Invalid cube coordinates");
  return { q: c.x, r: c.z };
};
export const distance = (a: Hex, b: Hex): number =>
  Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs(a.q + a.r - b.q - b.r),
  );
export function ring(center: Hex, radius: number): Hex[] {
  if (!Number.isInteger(radius) || radius < 0)
    throw new RangeError("Invalid radius");
  if (!radius) return [{ ...center }];
  const result: Hex[] = [];
  let h = { q: center.q, r: center.r - radius };
  for (let d = 0; d < 6; d++)
    for (let s = 0; s < radius; s++) {
      result.push(h);
      h = neighbor(h, d);
    }
  return result;
}
export function spiral(center: Hex, radius: number): Hex[] {
  if (!Number.isInteger(radius) || radius < 0)
    throw new RangeError("Invalid radius");
  return Array.from({ length: radius + 1 }, (_, r) => ring(center, r)).flat();
}
export function hexToWorld(q: number, r: number, elevation = 0): Vec3 {
  return { x: HEX_STEP * (q + r / 2), y: elevation, z: 1.5 * HEX_SIZE * r };
}
export function worldToHex(x: number, z: number): Hex {
  const q = x / HEX_STEP - z / (3 * HEX_SIZE),
    r = z / (1.5 * HEX_SIZE),
    cy = -q - r;
  let rx = Math.round(q),
    ry = Math.round(cy),
    rz = Math.round(r);
  const dx = Math.abs(rx - q),
    dy = Math.abs(ry - cy),
    dz = Math.abs(rz - r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx === 0 ? 0 : rx, r: rz === 0 ? 0 : rz };
}

/** Rasterize a pointer stroke so fast movement cannot leave holes in the road. */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const count = distance(a, b);
  if (!count) return [{ ...a }];
  const p = hexToWorld(a.q, a.r),
    q = hexToWorld(b.q, b.r);
  return Array.from({ length: count + 1 }, (_, i) =>
    worldToHex(
      p.x + ((q.x - p.x) * i) / count,
      p.z + ((q.z - p.z) * i) / count,
    ),
  );
}
