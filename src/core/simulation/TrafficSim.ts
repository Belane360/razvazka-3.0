import { hexKey } from "../hex/HexCoords.ts";
import type { Hex } from "../hex/HexCoords.ts";
import type { DistrictManager } from "../districts/DistrictManager.ts";
import { HexRoadGraph } from "../roads/HexRoadGraph.ts";
import type { DirectedLane } from "../roads/HexRoadGraph.ts";
import { CAR, TRUCK, idm } from "./idm.ts";
import { updateLogisticsTick } from "./Logistics.ts";
import { logisticsConfig } from "../districts/types.ts";
import type { LogisticsConfig, DistrictFacility } from "../districts/types.ts";
export { updateLogisticsTick } from "./Logistics.ts";
export interface Vehicle {
  shipment?: { sourceId: string; destinationId: string; payload: number };

  id: number;
  kind: "car" | "truck";
  route: DirectedLane[];
  laneIndex: number;
  u: number;
  speed: number;
  length: number;
  destination?: string;
  source?: Hex;
  reroutePending?: boolean;
  parkedAt?: Hex;
}
export class TrafficSim {
  vehicles: Vehicle[] = [];
  time = 0;
  income = 0;
  deliveries = 0;
  private serial = 0;
  private conflictCache = new Map<string, boolean>();
  private graphRevision = -1;
  private waiting = new Map<number, { lane: string; since: number }>();
  private graph: HexRoadGraph;
  private districts?: DistrictManager;
  onDelivery?: (destination: string | undefined, reward: number) => void;
  config: LogisticsConfig;
  constructor(graph: HexRoadGraph, districts?: DistrictManager, config: Partial<LogisticsConfig> = {}) {
    this.graph = graph;
    this.districts = districts;
    this.config = logisticsConfig(config);
    districts?.resetLogistics(this.config);
    if (districts) districts.onFacilityRemoved = f => this.cancelFacility(f);

  }
  spawn(
    route: DirectedLane[],
    kind: "car" | "truck",
    destination?: string,
  ): Vehicle | undefined {
    if (
      !route.length ||
      route.some(
        (l) => !this.graph.lanes.has(l.id) || !this.graph.movementAllowed(l),
      )
    )
      return;
    route = route.map((l) => this.graph.lanes.get(l.id)!);
    const first = route[0];
    if (this.vehicles.some((v) => !v.parkedAt && v.route[v.laneIndex].nodeId === first.nodeId))
      return;
    const v: Vehicle = {
      id: ++this.serial,
      kind,
      route,
      laneIndex: 0,
      u: 0,
      speed: 0,
      length: kind === "truck" ? 4.4 : 2.8,
      destination,
    };
    this.vehicles.push(v);
    return v;
  }
  spawnTrip(source: Hex, destination: Hex, kind: "car" | "truck"): Vehicle | undefined {
    const route = this.districts?.routeTrip(source, destination) ?? [];
    const v = this.spawn(route, kind, hexKey(destination));
    if (v)
      v.source = { q: source.q, r: source.r };
    return v;
  }
  reset(config: Partial<LogisticsConfig> = {}): void {
    this.config = logisticsConfig(config);
    this.vehicles = [];
    this.waiting.clear();
    this.time = this.income = this.deliveries = this.serial = 0;
    this.graphRevision = -1;
    this.districts?.resetLogistics(this.config);
  }
  private settle(v: Vehicle, delivered: boolean): void {
    const shipment = v.shipment;
    if (!shipment) return;
    v.shipment = undefined;
    const source = this.districts?.facilities.get(shipment.sourceId);
    const target = this.districts?.facilities.get(shipment.destinationId);
    const payload = shipment.payload;
    if (source?.type === "warehouse") {
      source.state.reservedStock = Math.max(0, source.state.reservedStock - payload);
      if (delivered) source.state.stock -= payload;
    } else if (!delivered && source?.type === "factory") {
      source.state.productionBuffer = Math.min(source.state.bufferLimit, source.state.productionBuffer + payload);
    }
    if (target?.type === "shop") {
      target.state.inFlightTrucks = Math.max(0, target.state.inFlightTrucks - 1);
      if (delivered) target.state.stock = Math.min(target.state.maxStock, target.state.stock + payload);
    } else if (target?.type === "warehouse") {
      target.state.incomingTrucks = Math.max(0, target.state.incomingTrucks - 1);
      if (delivered) target.state.stock = Math.min(target.state.capacity, target.state.stock + payload);
    }
  }
  private cancelWhere(predicate: (v: Vehicle) => boolean): void {
    this.vehicles = this.vehicles.filter(v => {
      if (!predicate(v)) return true;
      this.settle(v, false);
      this.waiting.delete(v.id);
      return false;
    });
  }
  private cancelFacility(f: DistrictFacility): void {
    const keys = new Set(f.tiles.map(hexKey));
    this.cancelWhere(v => v.shipment?.sourceId === f.id || v.shipment?.destinationId === f.id ||
      !!v.destination && keys.has(v.destination) || !!v.source && keys.has(hexKey(v.source)) ||
      v.route.some(l => l.serviceId === f.id));
  }
  reconcileRoutes(): void {
    if (!this.districts)
      return;
    for (const v of this.vehicles) {
      if (!v.source || !v.destination)
        continue;
      const target = this.districts.zones.get(v.destination);
      if (!target)
        continue;
      if (v.parkedAt) {
        const at = v.parkedAt;
        let fresh: DirectedLane[] = [];
        if (hexKey(at) === v.destination) {
          const terminal = this.districts.access(at).flatMap(a => this.graph.lanesAt(a)).find(l => !l.serviceId && l.outEdge === -1);
          if (terminal)
            fresh = [terminal];
        }
        else
          fresh = this.districts.routeTrip(at, target);
        if (!fresh.length)
          continue;
        v.route = fresh;
        v.laneIndex = 0;
        v.u = 0;
        v.parkedAt = undefined;
        v.reroutePending = false;
      }
      const old = v.route[v.laneIndex], current = old && this.graph.lanes.get(old.id);
      if (!current) {
        v.reroutePending = true;
        v.speed = 0;
        continue;
      }
      const alternative = this.districts.routeTrip(v.source, target, current);
      if (alternative.length) {
        v.u = Math.min(current.length, v.u / old.length * current.length);
        v.route = [...v.route.slice(0, v.laneIndex), ...alternative];
        v.reroutePending = false;
      }
      else {
        v.reroutePending = true;
        v.speed = 0;
      }
    }
  }
  cancelDestination(destination: string): void { this.cancelWhere(v => v.destination === destination); }
  sample(v: Vehicle) {
    if (v.parkedAt)
      return { position: this.districts!.position(v.parkedAt), tangent: { x: 1, y: 0, z: 0 }, grade: 0 };
    return v.route[v.laneIndex].sample(v.u);
  }
  travelled(v: Vehicle): number {
    return (
      v.route.slice(0, v.laneIndex).reduce((s, l) => s + l.length, 0) + v.u
    );
  }
  get freeFlow(): number {
    return this.vehicles.length
      ? this.vehicles.reduce(
        (s, v) =>
          s +
          Math.min(
            1,
            v.speed / (v.kind === "truck" ? TRUCK : CAR).desiredSpeed,
          ),
        0,
      ) / this.vehicles.length
      : 1;
  }
  step(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0 || dt > 10)
      throw new RangeError("Simulation dt must be 0..10 seconds");
    let remaining = dt;
    while (remaining > 1e-9) {
      const h = Math.min(1 / 30, remaining);
      this.tick(h);
      remaining -= h;
    }
  }
  private conflicts(a: DirectedLane, b: DirectedLane): boolean {
    if (a.nodeId !== b.nodeId) return false;
    const key = [a.id, b.id].sort().join("|");
    const cached = this.conflictCache.get(key);
    if (cached !== undefined) return cached;
    // Swept centerline envelopes. Opposing straight lanes are 2.3 m apart,
    // wider than the 2.05 m envelope; crossing/merging paths reserve together.
    for (let i = 0;i <= 24;i++) {
      const p = a.sample((a.length * i) / 24).position;
      for (let j = 0;j <= 24;j++) {
        const q = b.sample((b.length * j) / 24).position;
        if (Math.hypot(p.x - q.x, p.z - q.z) < 2.05) {
          this.conflictCache.set(key, true);
          return true;
        }
      }
    }
    this.conflictCache.set(key, false);
    return false;
  }
  private tick(dt: number): void {
    this.time += dt;
    const changed = this.graphRevision !== this.graph.revision;
    if (changed) {
      this.graphRevision = this.graph.revision;
      this.conflictCache.clear();
      this.reconcileRoutes();
    }
    this.cancelWhere(v => !!v.shipment && !!v.reroutePending ||
      !v.reroutePending && !v.route.slice(v.laneIndex).every(l => this.graph.lanes.has(l.id)));
    if (this.districts) updateLogisticsTick(dt, [...this.districts.facilities.values()], this.config,
      (from, to, payload) => {
        if (this.vehicles.length >= 80) return false;
        const v = this.spawnTrip(from.center, to.center, "truck");
        if (!v) return false;
        v.shipment = { sourceId: from.id, destinationId: to.id, payload };
        return true;
      });

    if (changed)
      for (const v of this.vehicles) {
        if (v.source || v.reroutePending) continue;
        const old = v.route[v.laneIndex],
          fraction = v.u / old.length;
        v.route = v.route.map((l, i) =>
          i < v.laneIndex ? l : this.graph.lanes.get(l.id)!,
        );
        v.u = fraction * v.route[v.laneIndex].length;
        if (
          v.route
            .slice(v.laneIndex + 1)
            .some((l) => !this.graph.movementAllowed(l))
        ) {
          const current = v.route[v.laneIndex],
            start = this.graph.nodes.get(current.nodeId)!,
            target = this.graph.nodes.get(v.route.at(-1)!.nodeId)!;
          const alternative = this.graph.route(start, target, current);
          if (alternative.length) {
            v.route = [...v.route.slice(0, v.laneIndex), ...alternative];
          }
        }
      }
    const states = this.vehicles.filter(v => !v.parkedAt).map((v) => ({ ...v }));
    const owners = new Map<string, { id: number; lane: DirectedLane }[]>();
    const reserve = (id: number, lane: DirectedLane) => {
      const list = owners.get(lane.nodeId) ?? [];
      if (!list.some((v) => v.id === id)) list.push({ id, lane });
      owners.set(lane.nodeId, list);
    };
    const junction = (id: string) => this.graph.isJunction(id);
    const controlled = (id: string) =>
      junction(id) || !!this.graph.nodes.get(id)?.signal;
    for (const v of states) {
      const current = v.route[v.laneIndex];
      if (controlled(current.nodeId)) reserve(v.id, current);
      if (v.laneIndex > 0 && v.u < v.length / 2 + 0.5) {
        const previous = v.route[v.laneIndex - 1];
        if (controlled(previous.nodeId)) reserve(v.id, previous);
      }
    }
    type Approach = {
      id: number;
      lane: DirectedLane;
      distance: number;
      since: number;
    };
    const approaches: Approach[] = [];
    const present = new Set<number>();
    for (const v of states) {
      let distance = v.route[v.laneIndex].length - v.u;
      for (let i = v.laneIndex + 1;i < v.route.length && distance <= 18;i++) {
        const lane = v.route[i];
        if (controlled(lane.nodeId)) {
          const previous = this.waiting.get(v.id);
          const wait =
            previous?.lane === lane.id
              ? previous
              : { lane: lane.id, since: this.time };
          this.waiting.set(v.id, wait);
          present.add(v.id);
          approaches.push({ id: v.id, lane, distance, since: wait.since });
          break;
        }
        distance += lane.length;
      }
    }
    for (const id of this.waiting.keys())
      if (!present.has(id)) this.waiting.delete(id);
    // Only the front vehicle of each entry competes; FIFO followers cannot reserve through it.
    const fronts = approaches.filter(
      (a) =>
        !approaches.some(
          (b) =>
            b.id !== a.id &&
            b.lane.nodeId === a.lane.nodeId &&
            b.lane.inEdge === a.lane.inEdge &&
            (b.distance < a.distance ||
              (b.distance === a.distance && b.id < a.id)),
        ),
    );
    let pending = fronts
      .filter(
        (a) =>
          this.graph.isGreen(a.lane, this.time) &&
          this.graph.movementAllowed(a.lane) &&
          !(owners.get(a.lane.nodeId) ?? []).some(
            (o) => o.id !== a.id && this.conflicts(a.lane, o.lane),
          ),
      )
      .sort((a, b) => a.since - b.since || a.id - b.id);
    const granted = new Set<number>();
    while (pending.length) {
      // Resolve priority before iteration order. A circular equal-priority wait uses arrival order.
      const winner =
        pending.find(
          (a) =>
            !pending.some(
              (b) =>
                a.id !== b.id &&
                this.conflicts(a.lane, b.lane) &&
                this.graph.mustYield(a.lane, b.lane),
            ),
        ) ?? pending[0];
      granted.add(winner.id);
      reserve(winner.id, winner.lane);
      pending = pending.filter(
        (a) => a.id !== winner.id && !this.conflicts(a.lane, winner.lane),
      );
    }
    for (const v of this.vehicles) {
      if (v.reroutePending) continue;
      const lane = v.route[v.laneIndex];
      let gap = Infinity,
        leaderSpeed = 0,
        travel = -v.u;
      for (let i = v.laneIndex;i < v.route.length && travel < 90;i++) {
        const ahead = v.route[i];
        if (i > v.laneIndex) {
          const blocked =
            !this.graph.movementAllowed(ahead) ||
            !this.graph.isGreen(ahead, this.time) ||
            (controlled(ahead.nodeId) &&
              ((travel <= 18 && !granted.has(v.id)) ||
                (owners.get(ahead.nodeId) ?? []).some(
                  (owner) =>
                    owner.id !== v.id && this.conflicts(ahead, owner.lane),
                )));
          const stopDistance = travel - v.length / 2 - 0.6;
          if (blocked && stopDistance < gap) {
            gap = Math.max(0, stopDistance);
            leaderSpeed = 0;
          }
        }
        for (const other of states) {
          if (other.id === v.id) continue;
          const ol = other.route[other.laneIndex];
          // Same exit corridor also detects a vehicle on a terminal half-lane.
          if (ol.nodeId === ahead.nodeId) {
            let front = Infinity;
            if (ol.outEdge === ahead.outEdge)
              front = travel + ahead.length - (ol.length - other.u);
            else if (ol.inEdge >= 0 && ol.inEdge === ahead.inEdge)
              front = travel + other.u;
            const clearance = (other.length + v.length) / 2;
            if (front > 0 && front - clearance < gap) {
              gap = Math.max(0, front - clearance);
              leaderSpeed = other.speed;
            }
          }
        }
        travel += ahead.length;
      }
      const params = v.kind === "truck" ? TRUCK : CAR;
      const p = {
        ...params,
        desiredSpeed: Math.min(params.desiredSpeed, lane.speedLimit),
      };
      const acceleration = idm(
        v.speed,
        gap,
        leaderSpeed,
        p,
        this.sample(v).grade,
      );
      const speed = Math.max(0, v.speed + acceleration * dt);
      let move = (v.speed + speed) * 0.5 * dt;
      // Hard non-penetration guard complements IDM under emergency close gaps.
      move = Math.min(move, Math.max(0, gap - 0.1));
      v.speed = move + 1e-8 < (v.speed + speed) * 0.5 * dt ? 0 : speed;
      v.u += move;
      while (v.u >= v.route[v.laneIndex].length) {
        v.u -= v.route[v.laneIndex].length;
        v.laneIndex++;
        if (v.laneIndex === v.route.length) {
          this.settle(v, true);
          const reward = v.kind === "truck" ? 32 : 12;
          this.deliveries++;
          this.income += reward;
          this.onDelivery?.(v.destination, reward);
          break;
        }
      }
    }
    this.vehicles = this.vehicles.filter((v) => v.parkedAt || v.laneIndex < v.route.length);
  }
}
