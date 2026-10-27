import {
  hexKey,
  hexToWorld,
  spiral,
  neighbor,
  worldToHex,
  HEX_STEP,
} from "./HexCoords.ts";
import { HEIGHT_UNIT } from "./HeightUnits.ts";
import type { Hex } from "./HexCoords.ts";
export type Biome = "valley" | "plateau" | "water" | "forest";
export interface Tile extends Hex {
  occupiedBy?: string;
  elevation: number;
  biome: Biome;
}
const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** One world-space height field: zero is sea level, not the base of each tile. */
export class HexMap {
  readonly tiles = new Map<string, Tile>();
  readonly seaLevel = 0;
  readonly seed: number;
  readonly flattened = new Set<string>();
  private corners = new Map<string, number>();
  private heights = new Map<string, number>();
  constructor(radius = 14, seed = 23) {
    this.seed = seed;
    for (const h of spiral({ q: 0, r: 0 }, radius)) {
      const p = hexToWorld(h.q, h.r),
        elevation = this.generatedHeight(p.x, p.z);
      const biome: Biome =
        elevation < this.seaLevel
          ? "water"
          : elevation > 15
            ? "plateau"
            : Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r)) > 5 &&
                this.noise(p.x / 25, p.z / 25) > 0.55
              ? "forest"
              : "valley";
      this.tiles.set(hexKey(h), { ...h, elevation, biome });
    }
  }
  private hash(x: number, z: number): number {
    let n =
      Math.imul(x, 374761393) ^
      Math.imul(z, 668265263) ^
      Math.imul(this.seed, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  private noise(x: number, z: number): number {
    const a = Math.floor(x),
      b = Math.floor(z),
      u = smooth(x - a),
      v = smooth(z - b);
    return (
      (this.hash(a, b) * (1 - u) + this.hash(a + 1, b) * u) * (1 - v) +
      (this.hash(a, b + 1) * (1 - u) + this.hash(a + 1, b + 1) * u) * v
    );
  }
  private generatedHeight(x: number, z: number): number {
    const r = z / 15,
      q = x / (Math.sqrt(3) * 10) - r / 2;
    // A small level settlement area blends into the generated landscape.
    const edge = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
    const blend = smooth((edge - 8) / 4);
    const hills =
      5 +
      24 * this.noise(x / 115, z / 115) +
      5 * this.noise(x / 52 + 8, z / 52 - 4);
    const riverZ = -151 + 18 * Math.sin(x / 78 + this.seed * 0.13);
    const river = 1 - smooth(Math.abs(z - riverZ) / 42);
    const raw = 4 + (hills - 4) * blend - (hills + 3) * river * blend;
    return raw > 10 ? 4 + Math.round((raw - 4) / 8) * 8 : raw;
  }
  flatten(tiles: Hex[], elevation: number): void {
    for (const h of tiles) {
      const t = this.get(h);
      if (t) { t.elevation = elevation; this.flattened.add(hexKey(h)); }
    }
    this.corners.clear();
  }
  isCliff(h: Hex, edge: number): boolean {
    return (
      Math.abs(this.height(h) - this.height(neighbor(h, edge))) > HEIGHT_UNIT
    );
  }
  private cornerHeight(h: Hex, edge: number): number {
    edge = (edge + 6) % 6;
    const key = `${hexKey(h)}:${edge}`;
    const cached = this.corners.get(key);
    if (cached !== undefined) return cached;
    const values = [
      this.height(h),
      this.height(neighbor(h, edge)),
      this.height(neighbor(h, (edge + 1) % 6)),
    ];
    const component = new Set([0]);
    for (let pass = 0; pass < 3; pass++)
      for (let i = 0; i < 3; i++)
        if (
          [...component].some(
            (j) => Math.abs(values[i] - values[j]) <= HEIGHT_UNIT,
          )
        )
          component.add(i);
    const result =
      [...component].reduce((sum, i) => sum + values[i], 0) / component.size;
    this.corners.set(key, result);
    return result;
  }
  /** Tile-local sampling retains two different lips along a cliff face. */
  tileSurfaceAt(h: Hex, x: number, z: number): number {
    if (this.flattened.has(hexKey(h))) return this.height(h);
    const c = hexToWorld(h.q, h.r),
      dx = x - c.x,
      dz = z - c.z,
      base = this.height(h);
    if (Math.hypot(dx, dz) < 1e-8) return base;
    const angle = Math.atan2(dz, dx),
      edge = (Math.round(angle / (Math.PI / 3)) + 6) % 6;
    const a = (edge * Math.PI) / 3,
      dot = dx * Math.cos(a) + dz * Math.sin(a),
      rho = Math.min(1, dot / (HEX_STEP / 2));
    const along = (-dx * Math.sin(a) + dz * Math.cos(a)) / (rho || 1) / 5;
    const midpoint = this.isCliff(h, edge)
      ? base
      : (base + this.height(neighbor(h, edge))) / 2;
    const corner = this.cornerHeight(h, along >= 0 ? edge : edge - 1);
    const boundary = midpoint + (corner - midpoint) * smooth(Math.abs(along));
    return base + (boundary - base) * smooth((rho - 0.25) / 0.75);
  }
  surfaceAt(x: number, z: number): number {
    return this.tileSurfaceAt(worldToHex(x, z), x, z);
  }
  /** Deck reference is the water surface over submerged river beds. */
  roadSurfaceAt(x: number, z: number): number {
    return Math.max(this.seaLevel, this.surfaceAt(x, z));
  }
  get(h: Hex): Tile | undefined {
    return this.tiles.get(hexKey(h));
  }
  height(h: Hex): number {
    const key = hexKey(h),
      tile = this.tiles.get(key);
    if (tile) return tile.elevation;
    let y = this.heights.get(key);
    if (y === undefined) {
      const p = hexToWorld(h.q, h.r);
      y = this.generatedHeight(p.x, p.z);
      this.heights.set(key, y);
    }
    return y;
  }
  slopeAt(x: number, z: number): number {
    const d = 0.05;
    return Math.hypot(
      (this.surfaceAt(x + d, z) - this.surfaceAt(x - d, z)) / (2 * d),
      (this.surfaceAt(x, z + d) - this.surfaceAt(x, z - d)) / (2 * d),
    );
  }
}
