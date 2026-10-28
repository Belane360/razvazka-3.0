import type { DistrictFootprintType, LogisticsConfig } from "./districts/types.ts";
import { HEIGHT_UNIT } from "./hex/HeightUnits.ts";
import { hexToWorld } from "./hex/HexCoords.ts";
import { HexMap } from "./hex/HexMap.ts";
import { hexKey, neighbor } from "./hex/HexCoords.ts";
import type { Hex } from "./hex/HexCoords.ts";
import { HexRoadGraph } from "./roads/HexRoadGraph.ts";
import type { JunctionSettings } from "./roads/JunctionControl.ts";
import type { RoadAddress } from "./roads/HexRoadGraph.ts";
import type { Level } from "./roads/HexRoadGraph.ts";
import { DistrictManager } from "./districts/DistrictManager.ts";
import type { ZoneType } from "./districts/DistrictManager.ts";
import { TrafficSim } from "./simulation/TrafficSim.ts";
export type Tool =
  "inspect" | "road" | "overpass" | "ramp" | "signal" | ZoneType | "demolish";
export class GameState {
  readonly map: HexMap;
  readonly roads = new HexRoadGraph(
    (h) => {
      const p = hexToWorld(h.q, h.r);
      return this.map.roadSurfaceAt(p.x, p.z);
    },
    (h) => !!this.map.get(h),
    false,
    (x, z) => this.map.roadSurfaceAt(x, z),
    (a, b) => Math.abs(this.map.height(a) - this.map.height(b)) > HEIGHT_UNIT,
  );
  readonly districts = new DistrictManager(this.roads, () => this.map);
  readonly sim = new TrafficSim(this.roads, this.districts);
  budget = 16000;
  speed = 1;
  revision = 0;
  message = "Соединяйте районы. Доставки приносят доход.";
  private nextSpawn = 0;
  private trip = 0;
  private earnings: { t: number; amount: number }[] = [];
  constructor(seed = 23, config: Partial<LogisticsConfig> = {}) {
    this.map = new HexMap(14, seed);
    this.sim.reset(config);
    const path = (cells: Hex[], level: Level = "ground") => {
      for (const h of cells) this.roads.addRoad({ ...h, level });
      for (let i = 1;i < cells.length;i++)
        this.roads.connect({ ...cells[i - 1], level }, { ...cells[i], level });
    };
    path(Array.from({ length: 13 }, (_, i) => ({ q: i - 6, r: 0 })));
    path(Array.from({ length: 11 }, (_, i) => ({ q: 0, r: i - 5 })));
    for (const q of [-6, 6])
      path([
        { q, r: 0 },
        { q, r: 1 },
        { q, r: 2 },
      ]);
    this.roads.addRamp({ q: -5, r: 2 }, 0, 3);
    this.roads.addRamp({ q: 5, r: 2 }, 3, 3);
    path([
      { q: -6, r: 2 },
      { q: -5, r: 2 },
    ]);
    path([
      { q: 6, r: 2 },
      { q: 5, r: 2 },
    ]);
    path(
      Array.from({ length: 5 }, (_, i) => ({ q: i - 2, r: 2 })),
      "elevated",
    );
    this.roads.setSignal({ q: 0, r: 0, level: "ground" }, true);
    for (const [q, r, type] of [
      [-4, 1, "Home"],
      [-5, 1, "Home"],
      [-3, -1, "Home"],
      [4, -3, "Factory"],
      [1, -4, "Warehouse"],
      [-1, 4, "Shop"],
      [5, 1, "Shop"],
    ] as [number, number, ZoneType][])
      this.districts.place({ q, r }, type);
    path([{q:2,r:0},{q:2,r:-1},{q:2,r:-2},{q:2,r:-3},{q:3,r:-4}]);
    path([{q:6,r:0},{q:6,r:-1},{q:6,r:-2},{q:6,r:-3}]);
    path([{q:4,r:0},{q:4,r:-1}]);
    this.roads.configureJunction({q:2,r:-3,level:"ground"}, {allowLeft:true});
    this.sim.onDelivery = (destination, reward) => {
      this.budget += reward;
      this.earnings.push({ t: this.sim.time, amount: reward });
      if (destination) {
        const cluster = this.districts.clusters.find((c) =>
          c.tiles.some((t) => hexKey(t) === destination),
        );
        this.districts.deliver(destination);
        if (
          cluster &&
          this.districts.clusterAt(destination)?.level !== cluster.level
        )
          this.revision++;
      }
    };
  }
  get throughput(): number {
    return (
      this.earnings.reduce((s, e) => s + e.amount, 0) /
      Math.min(30, Math.max(1, this.sim.time))
    );
  }
  get cityLevel(): number {
    return 1 + Math.floor(this.sim.deliveries / 30);
  }
  update(dt: number): void {
    let remaining = Math.min(dt, 0.25) * this.speed;
    while (remaining > 1e-8) {
      const step = Math.min(1 / 30, remaining);
      this.sim.step(step);
      remaining -= step;
      if (this.sim.time >= this.nextSpawn) {
        this.nextSpawn = this.sim.time + 1.1;
        this.dispatch();
      }
    }
    this.earnings = this.earnings.filter((e) => this.sim.time - e.t < 30);
  }
  private dispatch(): void {
    if (this.sim.vehicles.filter(v => v.kind === "car").length >= 12)
      return;
    const zones = [...this.districts.facilities.values()].filter(f => f.type === "home" || f.type === "shop").map(f => this.districts.zones.get(hexKey(f.center))!);
    if (zones.length < 2)
      return;
    for (let attempt = 0;attempt < zones.length;attempt++) {
      const source = zones[this.trip++ % zones.length];
      const targetType = source.type === "Home" ? "Shop" : "Home";
      const targets = zones.filter((z) => z.type === targetType);
      if (!targets.length)
        continue;
      const dest = targets[Math.floor(this.trip / zones.length) % targets.length];
      if (this.sim.spawnTrip(source, dest, "car"))
        return;
    }
  }
  terrainAt(h: Hex, x: number, z: number): number {
    let y = this.map.tileSurfaceAt(h, x, z);
    for (const ramp of this.roads.ramps.values()) {
      if (ramp.targetLevel !== "ground") continue;
      const a = hexToWorld(ramp.start.q, ramp.start.r),
        end = this.roads.nodes.get(ramp.nodes.at(-1)!)!,
        b = hexToWorld(end.q, end.r);
      const length = Math.hypot(b.x - a.x, b.z - a.z),
        dx = (b.x - a.x) / length,
        dz = (b.z - a.z) / length;
      const along = (x - a.x) * dx + (z - a.z) * dz,
        side = Math.abs((x - a.x) * dz - (z - a.z) * dx);
      if (along < 0 || along > length || side >= 6) continue;
      const t = along / length,
        profile = ramp.low + (ramp.high - ramp.low) * t * t * (3 - 2 * t);
      const u = Math.max(0, Math.min(1, (side - 3.4) / 2.6)),
        blend = 1 - u * u * (3 - 2 * u);
      y += (profile - y) * blend;
    }
    return y;
  }
  configureJunction(h: RoadAddress, patch: Partial<JunctionSettings>): boolean {
    try {
      const n = this.roads.get(h);
      const cost =
        n && !n.signal && patch.mode && patch.mode !== "off" ? 30 : 0;
      if (this.budget < cost)
        throw new Error("Недостаточно средств для светофора");
      this.roads.configureJunction(h, patch);
      this.sim.reconcileRoutes();
      this.budget -= cost;
      this.revision++;
      this.message = "Правила перекрёстка обновлены";
      return true;
    } catch (e) {
      this.message = (e as Error).message;
      return false;
    }
  }
  build(
    h: Hex,
    tool: Tool,
    level: Level,
    direction: number,
    span: number,
    previous?: Hex,
    rampTarget: Level = "elevated",
    footprint?: DistrictFootprintType,
  ): boolean {
    if (tool === "inspect") return false;
    try {
      const tile = this.map.get(h);
      if (!tile) throw new Error("За пределами региона");
      const actualLevel = tool === "overpass" ? "elevated" : level;
      let cost =
        tool === "ramp"
          ? span * 100
          : tool === "overpass"
            ? 90
            : tool === "road"
              ? 40
              : tool === "signal"
                ? 30
                : tool === "demolish"
                  ? 0
                  : 120;
      if (
        (tool === "road" || tool === "overpass") &&
        this.roads.get({ ...h, level: actualLevel })
      )
        cost = 0;
      if (this.budget < cost) throw new Error("Недостаточно средств");
      if (tool === "road" || tool === "overpass") {
        const exists = !!this.roads.get({ ...h, level: actualLevel });
        if (exists) cost = 0;
        if (exists && !previous) return false;
        if (this.districts.zones.has(hexKey(h)))
          throw new Error("Сначала снесите район");
        if (tile.biome === "water" && actualLevel === "ground")
          throw new Error("Над водой нужна эстакада");
        if (previous && actualLevel === "ground") {
          const a = hexToWorld(previous.q, previous.r),
            b = hexToWorld(h.q, h.r);
          for (let i = 0;i <= 32;i++)
            if (
              this.map.surfaceAt(
                a.x + ((b.x - a.x) * i) / 32,
                a.z + ((b.z - a.z) * i) / 32,
              ) < this.map.seaLevel
            )
              throw new Error("Через воду прокладывайте эстакаду");
        }
        const deckHeight = this.roads.proposedHeight(
          { ...h, level: actualLevel },
          previous ? { ...previous, level: actualLevel } : undefined,
        );
        if (previous)
          this.roads.validateConnection(
            { ...previous, level: actualLevel },
            { ...h, level: actualLevel },
            deckHeight,
          );
        this.roads.addRoad({ ...h, level: actualLevel }, undefined, deckHeight);
        if (previous)
          this.roads.connect(
            { ...previous, level: actualLevel },
            { ...h, level: actualLevel },
          );
      } else if (tool === "ramp") {
        if (tile.biome === "water")
          throw new Error("Начало рампы должно находиться на суше");
        let cell = { ...h };
        for (let i = 0;i <= span;i++) {
          if (rampTarget === "ground" && this.map.get(cell)?.biome === "water")
            throw new Error("Наземная рампа не может пересекать воду");
          if (this.districts.zones.has(hexKey(cell)))
            throw new Error("На пути рампы расположен район");
          cell = neighbor(cell, direction);
        }
        this.roads.addRamp(h, direction, span, rampTarget);
      } else if (tool === "signal") {
        const n = this.roads.get({ ...h, level });
        if (!n || n.rampId) throw new Error("Выберите дорогу вне рампы");
        this.roads.setSignal(n, !n.signal);
      } else if (tool === "demolish") {
        if (this.roads.get({ ...h, level }))
          this.roads.removeRoad({ ...h, level });
        else if (level === "ground" && this.districts.zones.has(hexKey(h))) {
          this.districts.remove(h);
        } else return false;
      } else {
        if (tile.biome === "water")
          throw new Error("Район нельзя разместить на воде");
        cost += this.districts.place(h, tool, this.budget - cost, footprint, direction);
      }
      this.sim.reconcileRoutes();
      this.budget -= cost;
      this.revision++;
      this.message =
        tool === "ramp"
          ? `Рампа: ${span} интервала, ${span + 1} гексов`
          : "Строительство завершено";
      return true;
    } catch (error) {
      this.message =
        error instanceof Error ? error.message : "Ошибка строительства";
      return false;
    }
  }
}
