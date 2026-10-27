import { hexKey, neighbor, hexToWorld, HEX_STEP, distance } from "../hex/HexCoords.ts";
import type { Hex } from "../hex/HexCoords.ts";
import { HexRoadGraph } from "../roads/HexRoadGraph.ts";
import { serviceNetwork } from "./ServiceYard.ts";
import type { DirectedLane } from "../roads/HexRoadGraph.ts";
import type { RoadAddress } from "../roads/HexRoadGraph.ts";
import type { HexMap } from "../hex/HexMap.ts";
export type ZoneType = "Home" | "Shop" | "Factory" | "Warehouse";
export interface Zone extends Hex {
  type: ZoneType;
  progress: number;
  accessEdge?: number;
}
export interface DistrictEdge {
  tile: Hex;
  edge: number;
  road?: RoadAddress;
}
export interface AccessPort extends DistrictEdge {
  role: "IN" | "OUT";
  road: RoadAddress;
}
export interface DistrictCluster {
  shape: "single" | "duo";
  sharedEdge?: DistrictEdge;
  externalEdges: DistrictEdge[];
  ports: {
    IN?: AccessPort;
    OUT?: AccessPort;
  };
  id: string;
  type: ZoneType;
  tiles: Zone[];
  level: number;
  progress: number;
}
export class DistrictManager {
  readonly zones = new Map<string, Zone>();
  private graph: HexRoadGraph;
  private terrain?: () => HexMap;
  private pairs = new Map<string, string>();
  revision = 0;
  constructor(graph: HexRoadGraph, terrain?: () => HexMap) {
    this.graph = graph;
    this.terrain = terrain;
    graph.onRoadChange = () => this.syncNetwork();
  }
  private mergeBase(h: Hex, type: ZoneType): Zone | undefined {
    if (type !== "Warehouse" && type !== "Factory")
      return;
    // Insertion order determines the base, never a later BFS or road rebuild.
    return [...this.zones.values()].find(z => z.type === type &&
      !this.pairs.has(hexKey(z)) && ![...this.pairs.values()].includes(hexKey(z)) &&
      Array.from({ length: 6 }, (_, e) => hexKey(neighbor(z, e))).includes(hexKey(h)) &&
      Math.abs((this.terrain?.().height(z) ?? 0) - (this.terrain?.().height(h) ?? 0)) <= 6);
  }
  place(h: Hex, type: ZoneType, available = Infinity): number {
    if (this.graph.get({ ...h, level: "ground" }) ||
      this.graph.get({ ...h, level: "elevated" }))
      throw new Error("Гекс занят дорогой");
    if (this.zones.has(hexKey(h)))
      throw new Error("Зона уже существует");
    const base = this.mergeBase(h, type), map = this.terrain?.();
    const cost = base && map && Math.abs(map.height(base) - map.height(h)) > 1e-8 ? 150 : 0;
    if (available < cost)
      throw new Error("Недостаточно средств для земляных работ (+150 Cr)");
    this.zones.set(hexKey(h), { ...h, type, progress: 0 });
    if (base) {
      this.pairs.set(hexKey(base), hexKey(h));
      map?.flatten([base, h], map.height(base));
    }
    this.revision++;
    this.syncNetwork();
    return cost;
  }
  remove(h: Hex): string | undefined {
    const key = hexKey(h);
    let survivor: string | undefined;
    for (const [a, b] of this.pairs)
      if (a === key || b === key) {
        survivor = a === key ? b : a;
        this.pairs.delete(a);
        const z = this.zones.get(survivor);
        if (z) {
          z.progress = 0;
          const cluster = this.clusterAt(survivor);
          z.accessEdge = cluster?.externalEdges.find(e => hexKey(e.tile) === survivor && e.road)?.edge;
        }
        break;
      }
    this.zones.delete(key);
    this.revision++;
    this.syncNetwork();
    return survivor;
  }
  get clusters(): DistrictCluster[] {
    const pending = new Set(this.zones.keys()), clusters: DistrictCluster[] = [];
    while (pending.size) {
      const id = pending.values().next().value!;
      const first = this.zones.get(id)!, tiles: Zone[] = [], queue = [first];
      pending.delete(id);
      const mate = this.pairs.get(id);
      if (mate && pending.has(mate)) {
        queue.push(this.zones.get(mate)!);
        pending.delete(mate);
      }
      while (queue.length) {
        const z = queue.shift()!;
        tiles.push(z);
        for (let e = 0;e < 6;e++) {
          const k = hexKey(neighbor(z, e)), other = this.zones.get(k);
          if (first.type !== "Factory" && first.type !== "Warehouse" && pending.has(k) && other?.type === first.type) {
            pending.delete(k);
            queue.push(other);
          }
        }
      }
      const progress = tiles.reduce((s, z) => s + z.progress, 0);
      const duo = !!mate;
      const externalEdges: DistrictEdge[] = [];
      let sharedEdge: DistrictEdge | undefined;
      for (const tile of tiles)
        for (let edge = 0;edge < 6;edge++) {
          const n = neighbor(tile, edge);
          if (tiles.some(t => hexKey(t) === hexKey(n))) {
            if (hexKey(tile) === id)
              sharedEdge = { tile, edge };
            continue;
          }
          const road = this.graph.get({ ...n, level: "ground" });
          externalEdges.push({ tile, edge, road: road && !road.rampId ? { ...n, level: "ground" } : undefined });
        }
      const ports: DistrictCluster["ports"] = {};
      if (duo) {
        const a = hexToWorld(first.q, first.r), b = hexToWorld(tiles.find(t => hexKey(t) === mate)!.q, tiles.find(t => hexKey(t) === mate)!.r);
        const front = { x: -(b.z - a.z) / HEX_STEP, z: (b.x - a.x) / HEX_STEP };
        const score = (e: DistrictEdge) => {
          const p = hexToWorld(e.tile.q, e.tile.r), n = hexToWorld(neighbor(e.tile, e.edge).q, neighbor(e.tile, e.edge).r);
          return ((n.x - p.x) * front.x + (n.z - p.z) * front.z) / HEX_STEP;
        };
        const candidates = externalEdges.filter(e => e.road);
        const sign = candidates.reduce((s, e) => s + score(e), 0) < -1e-6 ? -1 : 1;
        const ins = candidates.filter(e => hexKey(e.tile) === id), outs = candidates.filter(e => hexKey(e.tile) === mate);
        const pairs = ins.flatMap(input => outs.map(output => ({ input, output })))
          .filter(p => distance(p.input.road!, p.output.road!) !== 1)
          .sort((a, b) => {
            const rank = (p: typeof a) => sign * (score(p.input) + score(p.output)) + 0.15 * distance(p.input.road!, p.output.road!);
            return rank(b) - rank(a);
          });
        const pair = pairs[0];
        if (pair) {
          ports.IN = { ...pair.input, road: pair.input.road!, role: "IN" };
          ports.OUT = { ...pair.output, road: pair.output.road!, role: "OUT" };
        }
      }
      clusters.push({
        shape: duo ? "duo" : "single", sharedEdge: duo ? sharedEdge : undefined, externalEdges, ports,
        id,
        type: first.type,
        tiles,
        progress,
        level: duo ? 2 : 1 + Math.floor(Math.sqrt(progress / 12)),
      });
    }
    return clusters;
  }
  position(h: Hex) { return hexToWorld(h.q, h.r, this.terrain?.().height(h) ?? 0); }
  syncNetwork(): void {
    const lanes: DirectedLane[] = [], ports: {
      nodeId: string;
      edge: number;
    }[] = [];
    for (const c of this.clusters) {
      if (c.shape === "single" && (c.type === "Factory" || c.type === "Warehouse")) {
        const zone = c.tiles[0], available = c.externalEdges.filter(e => e.road);
        if (!available.some(e => e.edge === zone.accessEdge))
          zone.accessEdge = available[0]?.edge;
      }
      if (c.shape !== "duo")
        continue;
      const network = serviceNetwork(c, this.graph, this.terrain?.().height(c.tiles[0]) ?? 0);
      lanes.push(...network.lanes);
      ports.push(...network.ports);
    }
    this.graph.setServiceNetwork(lanes, ports);
  }
  private endpoints(h: Hex, role: "IN" | "OUT"): DirectedLane[] {
    const c = this.clusterAt(h);
    if (!c)
      return [];
    if (c.shape === "duo") {
      if (!c.ports.IN || !c.ports.OUT)
        return [];
      return [...this.graph.lanes.values()].filter(l => l.serviceId === c.id &&
        (role === "OUT" ? l.id === `yard:${c.id}:OUT` : l.servicePart === "connector" && l.inEdge >= 0 && l.outEdge === -1));
    }
    return this.access(h).flatMap(a => this.graph.lanesAt(a).filter(l => !l.serviceId && (role === "OUT" ? l.inEdge === -1 : l.outEdge === -1)));
  }
  routeTrip(source: Hex, destination: Hex, entry?: DirectedLane): DirectedLane[] {
    const from = this.clusterAt(source), to = this.clusterAt(destination);
    if (!to || (!entry && !from))
      return [];
    const allowed = new Set([from?.id, to.id].filter((id): id is string => !!id));
    if (entry?.serviceId)
      allowed.add(entry.serviceId);
    return this.graph.routeLanes(entry ? [entry] : this.endpoints(source, "OUT"), this.endpoints(destination, "IN").map(l => l.id), allowed);
  }
  clusterAt(h: Hex | string): DistrictCluster | undefined {
    const key = typeof h === "string" ? h : hexKey(h);
    return this.clusters.find(c => c.tiles.some(t => hexKey(t) === key));
  }
  access(h: Hex, role?: "IN" | "OUT"): RoadAddress[] {
    const cluster = this.clusterAt(h);
    if (cluster?.shape === "duo") {
      const port = cluster.ports[role ?? "IN"];
      return port ? [port.road] : [];
    }
    const result: RoadAddress[] = [];
    for (let e = 0;e < 6;e++) {
      const a = { ...neighbor(h, e), level: "ground" as const };
      const road = this.graph.get(a);
      if (road && !road.rampId) {
        const zone = this.zones.get(hexKey(h));
        if (zone?.accessEdge === e)
          result.unshift(a);
        else
          result.push(a);
      }
    }
    const type = this.zones.get(hexKey(h))?.type;
    return type === "Factory" || type === "Warehouse" ? result.slice(0, 1) : result;
  }
  deliver(key: string): void {
    const z = this.zones.get(key);
    if (z)
      z.progress++;
  }
}
