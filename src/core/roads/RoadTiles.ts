import type { Hex } from '../hex/HexCoords.ts';
import { laneGeometry } from './geometry.ts';
import type { LaneGeometry } from './geometry.ts';

export type RoadTileKind = 'straight' | 'turn_60' | 'turn_120' | 't_junction' | 'junction' | 'pocket' | 'decel_ramp' | 'terminal';
export interface RoadTileSpec { kind: RoadTileKind; edges: number[]; width: number; pocketSide: 1 | -1 }
export type RoadTileDecoration = 'pocket' | 'decel_ramp';
export function roadTileSpec(mask: number, decoration?: RoadTileDecoration, pocketSide: 1 | -1 = 1): RoadTileSpec {
  const edges = Array.from({ length: 6 }, (_, e) => e).filter(e => mask & (1 << e));
  let kind: RoadTileKind = edges.length < 2 ? 'terminal' : edges.length === 3 ? 't_junction' : 'junction';
  if (edges.length === 2) {
    const d = Math.min((edges[1] - edges[0] + 6) % 6, (edges[0] - edges[1] + 6) % 6);
    kind = d === 3 ? 'straight' : d === 2 ? 'turn_60' : 'turn_120';
  }
  if (decoration === 'pocket' && kind === 'straight') kind = decoration;
  if (decoration === 'decel_ramp' && edges.length === 3) kind = decoration;
  return { kind, edges, width: 6, pocketSide };
}
/** Uses the exact circular centreline underlying vehicle lanes; edge tangents are normal to hex edges. */
export function roadTileCenterline(h: Hex, spec: RoadTileSpec, height: (x: number, z: number) => number): LaneGeometry {
  return laneGeometry(h, spec.edges.length < 2 ? -1 : spec.edges[0], spec.edges.at(-1) ?? 1, height, 0);
}
/** Four metres of extra waiting space, smoothly tapered back to standard mouths. */
export function pocketWidening(t: number): number {
  const ramp = Math.min(1, Math.max(0, Math.min(t, 1 - t) / .32));
  return 4 * ramp * ramp * (3 - 2 * ramp);
}
