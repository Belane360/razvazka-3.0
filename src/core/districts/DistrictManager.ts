import { hexKey, neighbor } from "../hex/HexCoords.ts";
import type { Hex } from "../hex/HexCoords.ts";
import { HexRoadGraph } from "../roads/HexRoadGraph.ts";
import type { RoadAddress } from "../roads/HexRoadGraph.ts";
export type ZoneType = "Home" | "Shop" | "Factory" | "Warehouse";
export interface Zone extends Hex {
  type: ZoneType;
  progress: number;
}
export interface DistrictCluster {
  id: string;
  type: ZoneType;
  tiles: Zone[];
  level: number;
  progress: number;
}
export class DistrictManager {
  readonly zones = new Map<string, Zone>();
  private graph: HexRoadGraph;
  constructor(graph: HexRoadGraph) {
    this.graph = graph;
  }
  place(h: Hex, type: ZoneType): void {
    if (
      this.graph.get({ ...h, level: "ground" }) ||
      this.graph.get({ ...h, level: "elevated" })
    )
      throw new Error("Гекс занят дорогой");
    if (this.zones.has(hexKey(h))) throw new Error("Зона уже существует");
    this.zones.set(hexKey(h), { ...h, type, progress: 0 });
  }
  remove(h: Hex): void {
    this.zones.delete(hexKey(h));
  }
  get clusters(): DistrictCluster[] {
    const pending = new Set(this.zones.keys()),
      clusters: DistrictCluster[] = [];
    while (pending.size) {
      const id = pending.values().next().value!;
      const first = this.zones.get(id)!,
        tiles: Zone[] = [],
        queue = [first];
      pending.delete(id);
      while (queue.length) {
        const z = queue.pop()!;
        tiles.push(z);
        for (let e = 0; e < 6; e++) {
          const k = hexKey(neighbor(z, e)),
            other = this.zones.get(k);
          if (pending.has(k) && other?.type === first.type) {
            pending.delete(k);
            queue.push(other);
          }
        }
      }
      const progress = tiles.reduce((s, z) => s + z.progress, 0);
      clusters.push({
        id,
        type: first.type,
        tiles,
        progress,
        level: 1 + Math.floor(Math.sqrt(progress / 12)),
      });
    }
    return clusters;
  }
  access(h: Hex): RoadAddress[] {
    const result: RoadAddress[] = [];
    for (let e = 0; e < 6; e++) {
      const a = { ...neighbor(h, e), level: "ground" as const };
      const road = this.graph.get(a);
      if (road && !road.rampId) result.push(a);
    }
    return result;
  }
  deliver(key: string): void {
    const z = this.zones.get(key);
    if (z) z.progress++;
  }
}
