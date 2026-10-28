import { roadTileSpec } from './RoadTiles.ts';
import type { RoadTileDecoration, RoadTileSpec } from './RoadTiles.ts';
import {
  HEIGHT_UNIT,
  RISE_PER_STEP,
  MIN_CLEARANCE,
} from "../hex/HeightUnits.ts";
import { DEFAULT_JUNCTION, isLeft, signalState } from "./JunctionControl.ts";
import type { JunctionSettings, SignalState } from "./JunctionControl.ts";
import { HEX_STEP, distance, hexToWorld, neighbor } from "../hex/HexCoords.ts";
import type { Hex } from "../hex/HexCoords.ts";
import { edgeDirection, laneGeometry, deadEndGeometry } from "./geometry.ts";
import type { LaneGeometry } from "./geometry.ts";
export type Level = "ground" | "elevated";
export interface RoadAddress extends Hex {
  level: Level;
}
export type RoadType = "street" | "avenue" | "overpass";
export interface RoadCell extends RoadAddress {
  id: string;
  type: RoadType;
  connectionsMask: number;
  tileDecoration?: RoadTileDecoration;
  pocketSide?: 1 | -1;
  signal: boolean;
  rampId?: string;
  height: number;
}
export interface Ramp {
  id: string;
  start: Hex;
  direction: number;
  rampSpan: number;
  nodes: string[];
  targetLevel: Level;
  low: number;
  high: number;
}
export interface DirectedLane extends LaneGeometry {
  id: string;
  nodeId: string;
  inEdge: number;
  outEdge: number;
  nextNode?: string;
  speedLimit: number;
  serviceId?: string;
  servicePart?: "connector" | "yard" | "frontage";
  /** Public street crossing reserved facility land, never a dock shortcut. */
  publicTransit?: boolean;
  reverseFromDistance?: number;
  serviceStops?: {distance:number;seconds:number;kind:"waiting"|"dock"}[];
  nextLanes?: string[];
}
export const nodeKey = (h: RoadAddress): string => `${h.q},${h.r},${h.level}`;
export const DECK_HEIGHT = HEIGHT_UNIT;
const opposite = (e: number) => (e + 3) % 6;
export class HexRoadGraph {
  readonly nodes = new Map<string, RoadCell>();
  readonly ramps = new Map<string, Ramp>();
  readonly lanes = new Map<string, DirectedLane>();
  private explicitLinks = new Map<string, Set<string>>();
  private autoConnect: boolean;
  private links = new Map<string, Map<number, string>>();
  private terrain: (h: Hex) => number;
  private inside: (h: Hex) => boolean;
  private surface?: (x: number, z: number) => number;
  private controls = new Map<string, JunctionSettings>();
  private edgeAge = new Map<string, Map<number, number>>();
  private connectionSerial = 0;
  private cliff?: (a: Hex, b: Hex) => boolean;
  revision = 0;
  onRoadChange?: () => void;
  private serviceIds = new Set<string>();
  private streetMasks = new Map<string, number>();
  setServiceNetwork(lanes: DirectedLane[], ports: {
    nodeId: string;
    edge: number;
  }[]): void {
    for (const id of this.serviceIds)
      this.lanes.delete(id);
    for (const [id, mask] of this.streetMasks) {
      const n = this.nodes.get(id);
      if (n)
        n.connectionsMask = mask;
    }
    this.streetMasks.clear();
    this.serviceIds.clear();
    for (const p of ports) {
      const n = this.nodes.get(p.nodeId);
      if (n) {
        if (!this.streetMasks.has(n.id))
          this.streetMasks.set(n.id, n.connectionsMask);
        n.connectionsMask |= 1 << p.edge;
      }
    }
    for (const l of lanes) {
      this.lanes.set(l.id, l);
      this.serviceIds.add(l.id);
    }
    this.revision++;
  }
  streetEdges(id: string): number[] {
    return [...(this.links.get(id)?.keys() ?? [])];
  }
  /** Open the road surface and curbs at both street links and facility gates. */
  roadTile(h: RoadAddress): RoadTileSpec {
    const n = this.get(h);
    if (!n) throw new Error('Дорожный гекс не найден');
    const mask = n.connectionsMask;
    return roadTileSpec(mask, n.tileDecoration, n.pocketSide);
  }
  setRoadTile(h: RoadAddress, decoration?: RoadTileDecoration, pocketSide: 1 | -1 = 1): void {
    const n = this.get(h);
    if (!n) throw new Error('Дорожный гекс не найден');
    const spec = this.roadTile(h);
    if (decoration === 'pocket' && !['straight', 'pocket'].includes(spec.kind))
      throw new Error('Карман требует двух противоположных подключений');
    if (decoration === 'decel_ramp' && spec.edges.length !== 3)
      throw new Error('Раструб требует трёх подключений');
    n.tileDecoration = decoration;
    n.pocketSide = pocketSide;
    this.revision++;
    this.onRoadChange?.();
  }
  constructor(
    terrain: (h: Hex) => number = () => 0,
    inside: (h: Hex) => boolean = () => true,
    autoConnect = true,
    surface?: (x: number, z: number) => number,
    cliff?: (a: Hex, b: Hex) => boolean,
  ) {
    this.surface = surface;
    this.cliff = cliff;
    this.autoConnect = autoConnect;
    this.terrain = terrain;
    this.inside = inside;
  }
  get(h: RoadAddress): RoadCell | undefined {
    return this.nodes.get(nodeKey(h));
  }
  addRoad(
    h: RoadAddress,
    type: RoadType = h.level === "elevated" ? "overpass" : "street",
    deckHeight?: number,
  ): void {
    this.validateAddress(h);
    if (!this.inside(h)) throw new Error("За пределами региона");
    const id = nodeKey(h);
    if (this.nodes.has(id)) return;
    // Interior ramp columns reserve both slots: there is not yet bridge clearance.
    if (
      [...this.ramps.values()].some((r) =>
        r.nodes.slice(1, -1).some((k) => {
          const n = this.nodes.get(k)!;
          return n.q === h.q && n.r === h.r;
        }),
      )
    )
      throw new Error("Коридор рампы занят");
    const height = deckHeight ?? this.proposedHeight(h);
    if (
      !Number.isFinite(height) ||
      (h.level === "elevated" && height - this.terrain(h) < MIN_CLEARANCE)
    )
      throw new Error("Недостаточный просвет над землёй");
    this.nodes.set(id, {
      ...h,
      id,
      type,
      connectionsMask: 0,
      signal: false,
      height,
    });
    this.rebuild();
  }
  proposedHeight(h: RoadAddress, previous?: RoadAddress): number {
    const existing = this.get(h);
    if (existing) return existing.height;
    if (h.level === "ground") return this.terrain(h);
    if (previous) {
      const p = this.get(previous);
      if (p?.level === "elevated") return p.height;
    }
    for (let e = 0;e < 6;e++) {
      const n = this.get({ ...neighbor(h, e), level: "elevated" });
      if (n && (!n.rampId || this.ramps.get(n.rampId)?.nodes.at(-1) === n.id))
        return n.height;
    }
    return this.terrain(h) + DECK_HEIGHT;
  }
  validateConnection(
    a: RoadAddress,
    b: RoadAddress,
    plannedHeight?: number,
  ): void {
    const from = this.get(a),
      to = this.get(b) ?? {
        ...b,
        id: nodeKey(b),
        type: "street" as const,
        signal: false,
        connectionsMask: 0,
        height: plannedHeight ?? this.proposedHeight(b, a),
      };
    if (!from || !to || a.level !== b.level || distance(a, b) !== 1)
      throw new Error("Соедините соседние гексы одного уровня");
    if (
      Math.abs(from.height - to.height) >
      (this.surface && a.level === "ground" ? HEX_STEP * 0.55 : 0.01)
    )
      throw new Error("Для перепада высот нужна рампа");
    if (a.level === "ground" && this.cliff?.(a, b))
      throw new Error("Скальный уступ: соедините уровни земли рампой");
    if (a.level === "elevated" && to.height - this.terrain(b) < MIN_CLEARANCE)
      throw new Error("Недостаточный просвет над землёй");
    if (this.surface && a.level === "ground") {
      const a = hexToWorld(from.q, from.r),
        b = hexToWorld(to.q, to.r);
      this.validateGrade(a.x, a.z, b.x, b.z, (x, z) => this.surface!(x, z));
    }
    const edge = Array.from({ length: 6 }, (_, e) => e).find((e) => {
      const h = neighbor(a, e);
      return h.q === b.q && h.r === b.r;
    })!;
    for (const [n, e] of [
      [from, edge],
      [to, opposite(edge)],
    ] as [RoadCell, number][]) {
      if (n.rampId) {
        const r = this.ramps.get(n.rampId)!;
        if (!(
          (n.id === r.nodes[0] && e === opposite(r.direction)) ||
          (n.id === r.nodes.at(-1) && e === r.direction)
        ))
          throw new Error("Подключайте рампу с торца");
      }
    }
  }
  connect(a: RoadAddress, b: RoadAddress): boolean {
    if (!this.get(a) || !this.get(b))
      throw new Error("Сначала разместите дорогу");
    this.validateConnection(a, b);
    const from = this.get(a)!,
      to = this.get(b)!;
    if (this.explicitLinks.get(from.id)?.has(to.id)) return false;
    for (const [u, v] of [
      [from.id, to.id],
      [to.id, from.id],
    ]) {
      const set = this.explicitLinks.get(u) ?? new Set<string>();
      set.add(v);
      this.explicitLinks.set(u, set);
    }
    this.rebuild();
    return true;
  }
  private validateGrade(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    height: (x: number, z: number) => number,
  ): void {
    const length = Math.hypot(bx - ax, bz - az),
      steps = Math.ceil(length / 0.5);
    let previous = height(ax, az);
    for (let i = 1;i <= steps;i++) {
      const t = i / steps,
        y = height(ax + (bx - ax) * t, az + (bz - az) * t);
      if (
        !Number.isFinite(y) ||
        Math.abs(y - previous) / (length / steps) > 0.7
      )
        throw new Error(
          "Слишком крутой склон: измените маршрут или длину рампы",
        );
      previous = y;
    }
  }
  private validateAddress(h: RoadAddress) {
    if (
      !Number.isInteger(h.q) ||
      !Number.isInteger(h.r) ||
      !["ground", "elevated"].includes(h.level)
    )
      throw new Error("Некорректный адрес дороги");
  }
  addRamp(
    start: Hex,
    direction: number,
    rampSpan: number,
    targetLevel: Level = "elevated",
  ): Ramp {
    if (!Number.isInteger(rampSpan) || rampSpan < 2 || rampSpan > 6)
      throw new RangeError("Рампа: 2–6 интервалов");
    this.validateAddress({ ...start, level: targetLevel });
    neighbor(start, direction);
    const path: RoadAddress[] = [{ ...start, level: "ground" }];
    for (let i = 1;i <= rampSpan;i++)
      path.push({ ...neighbor(path[i - 1], direction), level: targetLevel });
    const low = this.terrain(start),
      high =
        targetLevel === "ground"
          ? this.terrain(path[rampSpan])
          : low + rampSpan * RISE_PER_STEP;
    if (targetLevel === "ground" && Math.abs(high - low) < 0.1)
      throw new Error("Выберите площадки разной высоты");
    const id = `ramp:${nodeKey(path[0])}:${direction}`;
    if (this.ramps.has(id)) throw new Error("Рампа уже существует");
    for (let i = 0;i < path.length;i++) {
      const h = path[i],
        existing = this.get(h);
      if (!this.inside(h)) throw new Error("Рампа выходит за регион");
      if (
        existing?.rampId ||
        (i > 0 &&
          i < rampSpan &&
          (this.get({ ...h, level: "ground" }) ||
            this.get({ ...h, level: "elevated" })))
      )
        throw new Error("Коридор рампы занят");
      if (i === 0 && this.get({ ...h, level: "elevated" }))
        throw new Error("Начало рампы перекрыто эстакадой");
      if (i === rampSpan && existing && Math.abs(existing.height - high) > 0.01)
        throw new Error(
          "Высота выхода не совпадает: измените число шагов подъёма",
        );
      if (
        existing &&
        [...(this.links.get(existing.id)?.keys() ?? [])].some(
          (e) => e !== (i === 0 ? opposite(direction) : direction),
        )
      )
        throw new Error("Подключайте рампу с торца");
    }
    const p = hexToWorld(start.q, start.r),
      d = edgeDirection(direction),
      length = rampSpan * HEX_STEP;
    if ((Math.abs(high - low) * 1.5) / length > 0.7)
      throw new Error("Слишком крутой подъём: увеличьте длину рампы");
    const ramp: Ramp = {
      id,
      start: { ...start },
      direction,
      rampSpan,
      targetLevel,
      nodes: path.map(nodeKey),
      low,
      high,
    };
    if (targetLevel === "elevated") {
      this.validateGrade(
        p.x,
        p.z,
        p.x + d.x * length,
        p.z + d.z * length,
        (x, z) => this.rampHeight(ramp, x, z),
      );
      for (let i = 0;i <= rampSpan * 40;i++)
        for (const side of [-3.2, 0, 3.2]) {
          const t = i / (rampSpan * 40),
            x = p.x + d.x * length * t - d.z * side,
            z = p.z + d.z * length * t + d.x * side;
          const ground = this.surface
            ? this.surface(x, z)
            : this.terrain(
              path[Math.min(rampSpan, Math.floor(t * rampSpan + 0.5))],
            );
          const y = this.rampHeight(ramp, x, z);
          if (y < ground - 0.01)
            throw new Error(
              "Рампа пересекает рельеф: выберите соединение уровней земли",
            );
        }
      if (high - this.terrain(path[rampSpan]) < MIN_CLEARANCE)
        throw new Error("На выходе недостаточный просвет");
    }
    for (let i = 0;i < path.length;i++) {
      const h = path[i],
        key = nodeKey(h),
        t = i / rampSpan;
      this.controls.delete(key);
      this.nodes.set(key, {
        ...h,
        id: key,
        type: h.level === "ground" ? "street" : "overpass",
        connectionsMask: 0,
        signal: false,
        rampId: id,
        height: low + (high - low) * t * t * (3 - 2 * t),
      });
    }
    this.ramps.set(id, ramp);
    this.rebuild();
    return ramp;
  }
  removeRoad(h: RoadAddress): void {
    const n = this.get(h);
    if (!n) return;
    if (n.rampId) {
      const r = this.ramps.get(n.rampId)!;
      for (const k of r.nodes) this.nodes.delete(k);
      this.ramps.delete(r.id);
    } else this.nodes.delete(n.id);
    for (const [id, neighbors] of this.explicitLinks) {
      if (!this.nodes.has(id)) this.explicitLinks.delete(id);
      else
        for (const other of neighbors)
          if (!this.nodes.has(other)) neighbors.delete(other);
    }
    this.rebuild();
  }
  isJunction(id: string): boolean {
    const mask = this.nodes.get(id)?.connectionsMask ?? 0;
    return mask.toString(2).replaceAll("0", "").length > 2;
  }
  junctionSettings(h: RoadAddress | string): JunctionSettings {
    const id = typeof h === "string" ? h : nodeKey(h);
    return { ...DEFAULT_JUNCTION, ...this.controls.get(id) };
  }
  configureJunction(h: RoadAddress, patch: Partial<JunctionSettings>): void {
    const n = this.get(h);
    if (!n || n.rampId) throw new Error("Выберите дорогу вне рампы");
    const next = { ...this.junctionSettings(h), ...patch };
    if (
      !["off", "paired", "individual"].includes(next.mode) ||
      !Number.isInteger(next.greenSeconds) ||
      next.greenSeconds < 3 ||
      next.greenSeconds > 30 ||
      typeof next.allowLeft !== "boolean" ||
      (next.mainRoadMask !== null &&
        (!Number.isInteger(next.mainRoadMask) ||
          next.mainRoadMask < 0 ||
          next.mainRoadMask > 63))
    )
      throw new Error("Некорректные настройки перекрёстка");
    this.controls.set(n.id, next);
    n.signal = next.mode !== "off";
    this.revision++;
  }
  mainRoadMask(h: RoadAddress | string): number {
    const id = typeof h === "string" ? h : nodeKey(h),
      mask = this.nodes.get(id)?.connectionsMask ?? 0;
    const manual = this.junctionSettings(id).mainRoadMask;
    if (manual !== null) return manual & mask;
    return [...(this.edgeAge.get(id) ?? [])]
      .filter(([e]) => mask & (1 << e))
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2)
      .reduce((m, [e]) => m | (1 << e), 0);
  }
  movementAllowed(lane: DirectedLane): boolean {
    return (
      !this.isJunction(lane.nodeId) ||
      !isLeft(lane.inEdge, lane.outEdge) ||
      this.junctionSettings(lane.nodeId).allowLeft
    );
  }
  mustYield(a: DirectedLane, b: DirectedLane): boolean {
    if (
      a.nodeId !== b.nodeId ||
      a.inEdge < 0 ||
      b.inEdge < 0 ||
      a.inEdge === b.inEdge
    )
      return false;
    const settings = this.junctionSettings(a.nodeId);
    if (settings.mode === "off") {
      const mask = this.mainRoadMask(a.nodeId),
        am = !!(mask & (1 << a.inEdge)),
        bm = !!(mask & (1 << b.inEdge));
      if (am !== bm) return !am;
    }
    // Opposing straight/right traffic retains priority even with a green signal.
    if ((b.inEdge - a.inEdge + 6) % 6 === 3)
      return isLeft(a.inEdge, a.outEdge) && !isLeft(b.inEdge, b.outEdge);
    if (settings.mode !== "off") return false;
    return [4, 5].includes((b.inEdge - a.inEdge + 6) % 6);
  }
  setSignal(h: RoadAddress, on: boolean): void {
    const n = this.get(h);
    if (n && !n.rampId)
      this.configureJunction(h, { mode: on ? "paired" : "off" });
  }
  signalState(
    h: RoadAddress | string,
    edge: number,
    time: number,
  ): SignalState {
    const id = typeof h === "string" ? h : nodeKey(h);
    return signalState(
      this.junctionSettings(id),
      this.nodes.get(id)?.connectionsMask ?? 0,
      edge,
      time,
    );
  }
  isGreen(lane: DirectedLane, time: number): boolean {
    if (lane.inEdge < 0) return true;
    const state = this.signalState(lane.nodeId, lane.inEdge, time);
    return state === "green" || state === "off";
  }
  private rampHeight(r: Ramp, x: number, z: number): number {
    const p = hexToWorld(r.start.q, r.start.r),
      d = edgeDirection(r.direction),
      length = r.rampSpan * HEX_STEP;
    const along = (x - p.x) * d.x + (z - p.z) * d.z,
      t = Math.max(0, Math.min(1, along / length));
    let y = r.low + (r.high - r.low) * t * t * (3 - 2 * t);
    if (this.surface && r.targetLevel === "elevated") {
      const epsilon = 0.01;
      const slope =
        (this.surface(p.x + d.x * epsilon, p.z + d.z * epsilon) -
          this.surface(p.x - d.x * epsilon, p.z - d.z * epsilon)) /
        (2 * epsilon);
      const side = (x - p.x) * -d.z + (z - p.z) * d.x;
      const cross = this.surface(p.x - d.z * side, p.z + d.x * side) - r.low;
      y += slope * length * t * (1 - t) * (1 - t) + cross * (1 - t) * (1 - t);
    }
    return y;
  }
  heightAt(n: RoadCell, x: number, z: number): number {
    if (n.rampId) {
      const r = this.ramps.get(n.rampId)!,
        p = hexToWorld(r.start.q, r.start.r),
        d = edgeDirection(r.direction);
      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - p.x) * d.x + (z - p.z) * d.z) / (r.rampSpan * HEX_STEP),
        ),
      );
      const along = (x - p.x) * d.x + (z - p.z) * d.z;
      if (
        this.surface &&
        (along < 0 ||
          (along > r.rampSpan * HEX_STEP && r.targetLevel === "ground"))
      )
        return this.surface(x, z);
      return this.rampHeight(r, x, z);
    }
    if (n.level === "elevated") return n.height;
    if (this.surface) return this.surface(x, z);
    // Shared edge heights give matching surfaces even on discrete terrain steps.
    const p = hexToWorld(n.q, n.r);
    let y = n.height;
    const dx = x - p.x,
      dz = z - p.z;
    for (const [edge, key] of this.links.get(n.id) ?? []) {
      const other = this.nodes.get(key)!;
      const d = edgeDirection(edge);
      const projection = (dx * d.x + dz * d.z) / (HEX_STEP / 2);
      if (projection > 0) {
        const shared = (n.height + other.height) / 2;
        y += (shared - n.height) * Math.pow(projection, 4);
      }
    }
    return y;
  }
  private rebuild(): void {
    this.serviceIds.clear(); this.streetMasks.clear();
    this.links.clear();
    this.lanes.clear();
    for (const n of this.nodes.values()) {
      n.connectionsMask = 0;
      this.links.set(n.id, new Map());
    }
    const link = (a: string, e: number, b: string) => {
      this.links.get(a)!.set(e, b);
      this.links.get(b)!.set(opposite(e), a);
    };
    for (const n of this.nodes.values())
      for (let e = 0;e < 6;e++) {
        const o = this.get({ ...neighbor(n, e), level: n.level });
        if (!o) continue;
        const allowed = (v: RoadCell, edge: number) => {
          if (!v.rampId) return true;
          const r = this.ramps.get(v.rampId)!;
          return (
            (v.id === r.nodes[0] && edge === opposite(r.direction)) ||
            (v.id === r.nodes.at(-1) && edge === r.direction)
          );
        };
        if (
          (this.autoConnect || this.explicitLinks.get(n.id)?.has(o.id)) &&
          allowed(n, e) &&
          allowed(o, opposite(e)) &&
          Math.abs(n.height - o.height) <=
          (this.surface ? HEX_STEP * 0.55 : 0.01)
        ) {
          try {
            this.validateConnection(n, o);
            link(n.id, e, o.id);
          } catch {
            /* Steep or incompatible neighboring cells remain disconnected. */
          }
        }
      }
    for (const r of this.ramps.values())
      for (let i = 1;i < r.nodes.length;i++)
        link(r.nodes[i - 1], r.direction, r.nodes[i]);
    for (const id of this.edgeAge.keys())
      if (!this.nodes.has(id)) {
        this.edgeAge.delete(id);
        this.controls.delete(id);
      }
    for (const n of this.nodes.values()) {
      const links = this.links.get(n.id)!;
      const history = this.edgeAge.get(n.id) ?? new Map<number, number>();
      for (const e of history.keys()) if (!links.has(e)) history.delete(e);
      for (const e of links.keys())
        if (!history.has(e)) history.set(e, ++this.connectionSerial);
      this.edgeAge.set(n.id, history);
      const edges = [...links.keys()];
      for (const e of edges) n.connectionsMask |= 1 << e;
      const add = (inEdge: number, outEdge: number) => {
        let geom = laneGeometry(n, inEdge, outEdge, (x, z) =>
          this.heightAt(n, x, z),
        );
        if (inEdge >= 0 && inEdge === outEdge)
          geom = deadEndGeometry(n, inEdge, (x, z) => this.heightAt(n, x, z));
        if (edges.length === 2 && (inEdge < 0 || outEdge < 0)) {
          const realEdge = inEdge < 0 ? outEdge : inEdge,
            other = edges.find((e) => e !== realEdge)!;
          const full = laneGeometry(
            n,
            inEdge < 0 ? other : inEdge,
            outEdge < 0 ? other : outEdge,
            (x, z) => this.heightAt(n, x, z),
          );
          const start = inEdge < 0 ? full.length / 2 : 0;
          geom = {
            length: full.length / 2,
            sample: (u) =>
              full.sample(start + Math.max(0, Math.min(full.length / 2, u))),
          };
        }
        const lane: DirectedLane = {
          ...geom,
          id: `${n.id}:${inEdge}>${outEdge}`,
          nodeId: n.id,
          inEdge,
          outEdge,
          nextNode: links.get(outEdge),
          speedLimit: n.type === "street" ? 9 : 13,
        };
        this.lanes.set(lane.id, lane);
      };
      for (const e of edges) {
        add(-1, e);
        add(e, -1);
        if (edges.length === 1 && !n.rampId) add(e, e);
        for (const out of edges) {
          const delta = (out - e + 6) % 6;
          if (!delta) continue;
          if (n.level === "elevated" && ![2, 3, 4].includes(delta)) continue;
          if (n.rampId && delta !== 3) continue;
          add(e, out);
        }
      }
    }
    this.revision++;
    this.onRoadChange?.();
  }
  lanesAt(h: RoadAddress | string): DirectedLane[] {
    const id = typeof h === "string" ? h : nodeKey(h);
    return [...this.lanes.values()].filter((l) => l.nodeId === id);
  }
  successors(l: DirectedLane): DirectedLane[] {
    if (l.nextLanes) return l.nextLanes.map(id => this.lanes.get(id)).filter((v): v is DirectedLane => !!v);
    return l.nextNode
      ? this.lanesAt(l.nextNode).filter((n) => n.inEdge === opposite(l.outEdge))
      : [];
  }
  /** Query the directed courtyard; reverse entry is never an allowed movement. */
  serviceRoute(serviceId: string, from: "IN" | "OUT", to: "IN" | "OUT"): DirectedLane[] | null {
    if(from!=="IN" || to!=="OUT") return null;
    const start=this.lanes.get(`yard:${serviceId}:IN`), end=this.lanes.get(`yard:${serviceId}:OUT`);
    if(!start || !end) return null;
    const path=this.routeLanes([start],[end.id],new Set([serviceId]));
    return path.length ? path : null;
  }
  routeLanes(starts: DirectedLane[], targets: string[], allowedServices = new Set<string>()): DirectedLane[] {
    const goal = new Set(targets), open = new Set<string>(), cost = new Map<string, number>(), prev = new Map<string, string>();
    const targetPoints = targets.map(id => this.lanes.get(id)).filter((l): l is DirectedLane => !!l).map(l => l.sample(l.length).position);
    if (!targetPoints.length)
      return [];
    for (const l of starts)
      if (this.lanes.has(l.id)) {
        open.add(l.id);
        cost.set(l.id, l.length / 13);
      }
    const heuristic = (l: DirectedLane) => {
      const p = l.sample(l.length).position;
      return Math.min(...targetPoints.map(t => Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z))) / 13;
    };
    while (open.size) {
      let current = "", best = Infinity;
      for (const id of open) {
        const score = cost.get(id)! + heuristic(this.lanes.get(id)!);
        if (score < best) {
          best = score;
          current = id;
        }
      }
      open.delete(current);
      const lane = this.lanes.get(current)!;
      if (goal.has(current)) {
        const path = [lane];
        let key = current;
        while (prev.has(key)) {
          key = prev.get(key)!;
          path.unshift(this.lanes.get(key)!);
        }
        return path;
      }
      for (const next of this.successors(lane)) {
        if (next.serviceId && !next.publicTransit && !allowedServices.has(next.serviceId))
          continue;
        if (!this.movementAllowed(next))
          continue;
        const score = cost.get(current)! + next.length / 13;
        if (score < (cost.get(next.id) ?? Infinity)) {
          cost.set(next.id, score);
          prev.set(next.id, current);
          open.add(next.id);
        }
      }
    }
    return [];
  }
  route(
    from: RoadAddress,
    to: RoadAddress,
    entry?: DirectedLane,
  ): DirectedLane[] {
    const source = nodeKey(from),
      target = nodeKey(to);
    if (!this.nodes.has(source) || !this.nodes.has(target) || source === target)
      return [];
    const open = new Set<string>(),
      cost = new Map<string, number>(),
      prev = new Map<string, string>();
    for (const l of entry
      ? [entry]
      : this.lanesAt(source).filter((l) => l.inEdge === -1 && (!l.serviceId || l.publicTransit))) {
      open.add(l.id);
      cost.set(l.id, l.length / 13);
    }
    const heuristic = (id: string) => {
      const lane=this.lanes.get(id)!;
      const n = this.nodes.get(lane.nodeId);
      if(n)return (Math.max(0, distance(n, to) - 1) * HEX_STEP) / 13;
      return 0; // Virtual frontage lanes have no editable road-cell node.
    };
    while (open.size) {
      let current = "";
      let best = Infinity;
      for (const id of open) {
        const f = cost.get(id)! + heuristic(id);
        if (f < best) {
          best = f;
          current = id;
        }
      }
      open.delete(current);
      const lane = this.lanes.get(current)!;
      if (lane.nodeId === target && lane.outEdge === -1) {
        const path = [lane];
        let key = current;
        while (prev.has(key)) {
          key = prev.get(key)!;
          path.unshift(this.lanes.get(key)!);
        }
        return path;
      }
      for (const next of this.successors(lane)) {
        if ((next.serviceId && !next.publicTransit) || !this.movementAllowed(next)) continue;
        if (next.outEdge === -1 && next.nodeId !== target) continue;
        const score = cost.get(current)! + next.length / 13;
        if (score < (cost.get(next.id) ?? Infinity)) {
          cost.set(next.id, score);
          prev.set(next.id, current);
          open.add(next.id);
        }
      }
    }
    return [];
  }
}
