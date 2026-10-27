import { hexToWorld, HEX_STEP } from '../hex/HexCoords.ts';
import type { Vec3 } from '../hex/HexCoords.ts';
import { laneGeometry } from '../roads/geometry.ts';
import type { LaneGeometry } from '../roads/geometry.ts';
import type { HexRoadGraph, DirectedLane } from '../roads/HexRoadGraph.ts';
import type { DistrictCluster } from './DistrictManager.ts';
export interface ComplexLayout {
  center: Vec3;
  axis: {
    x: number;
    z: number;
  };
  front: {
    x: number;
    z: number;
  };
  point(x: number, z: number): Vec3;
  local(p: Vec3): {
    x: number;
    z: number;
  };
}
export function complexLayout(c: DistrictCluster, elevation: number): ComplexLayout {
  const a = hexToWorld(c.tiles[0].q, c.tiles[0].r), b = hexToWorld(c.tiles[1].q, c.tiles[1].r);
  const axis = { x: (b.x - a.x) / HEX_STEP, z: (b.z - a.z) / HEX_STEP };
  const center = { x: (a.x + b.x) / 2, y: elevation, z: (a.z + b.z) / 2 };
  const f = { x: -axis.z, z: axis.x };
  const score = Object.values(c.ports).reduce((s, p) => {
    const r = hexToWorld(p.road.q, p.road.r), t = hexToWorld(p.tile.q, p.tile.r);
    return s + (r.x - t.x) * f.x + (r.z - t.z) * f.z;
  }, 0);
  const sign = score < -1e-6 ? -1 : 1;
  const front = { x: f.x * sign, z: f.z * sign };
  return {
    center, axis, front,
    point: (x, z) => ({ x: center.x + axis.x * x + front.x * z, y: elevation, z: center.z + axis.z * x + front.z * z }),
    local: p => ({ x: (p.x - center.x) * axis.x + (p.z - center.z) * axis.z, z: (p.x - center.x) * front.x + (p.z - center.z) * front.z }),
  };
}
/** Piecewise-linear yard geometry with exact shared endpoints and horizontal service area. */
export function pathGeometry(points: Vec3[]): LaneGeometry {
  const lengths = [0];
  for (let i = 1;i < points.length;i++)
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z));
  const length = lengths.at(-1)!;
  return {
    length, sample(u) {
      u = Math.max(0, Math.min(length, u));
      let i = 1;
      while (i < lengths.length - 1 && lengths[i] < u)
        i++;
      const a = points[i - 1], b = points[i], d = lengths[i] - lengths[i - 1], t = (u - lengths[i - 1]) / (d || 1);
      return { position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, tangent: { x: (b.x - a.x) / (d || 1), y: (b.y - a.y) / (d || 1), z: (b.z - a.z) / (d || 1) }, grade: (b.y - a.y) / (Math.hypot(b.x - a.x, b.z - a.z) || 1) };
    }
  };
}
export function serviceNetwork(c: DistrictCluster, graph: HexRoadGraph, elevation: number): {
  lanes: DirectedLane[];
  ports: {
    nodeId: string;
    edge: number;
  }[];
} {
  const lanes: DirectedLane[] = [], ports: {
    nodeId: string;
    edge: number;
  }[] = [];
  if (!c.ports.IN || !c.ports.OUT)
    return { lanes, ports };
  const layout = complexLayout(c, elevation), id = c.id;
  const yardId = `yard:${id}`, inId = `${yardId}:IN`, outId = `${yardId}:OUT`;
  const gates: Partial<Record<'IN' | 'OUT', Vec3>> = {};
  const exits: string[] = [];
  for (const port of [c.ports.IN, c.ports.OUT]) {
    const n = graph.get(port.road)!;
    const edge = (port.edge + 3) % 6;
    ports.push({ nodeId: n.id, edge });
    const street = graph.streetEdges(n.id);
    for (const e of [-1, ...street]) {
      const incoming = port.role === 'IN';
      const geom = laneGeometry(n, incoming ? e : edge, incoming ? edge : e, (x, z) => graph.heightAt(n, x, z));
      const gate = geom.sample(incoming ? geom.length : 0).position;
      gates[port.role] = { ...gate, y: elevation };
      // The road-side connector takes the grade; the entire yard is level.
      const flatGate = gates[port.role]!;
      const joined: LaneGeometry = {
        length: geom.length,
        sample(u) {
          const sample = geom.sample(u), t = Math.max(0, Math.min(1, u / geom.length));
          const delta = flatGate.y - gate.y;
          sample.position.y += delta * (incoming ? t : 1 - t);
          sample.grade += delta * (incoming ? 1 : -1) / geom.length;
          sample.tangent.y = sample.grade / Math.sqrt(1 + sample.grade ** 2);
          return sample;
        }
      };
      const lane: DirectedLane = { ...joined, id: `${yardId}:${port.role}:${n.id}:${e}`, nodeId: n.id, inEdge: incoming ? e : edge, outEdge: incoming ? edge : e, serviceId: id, servicePart: 'connector', speedLimit: 5 };
      if (incoming)
        lane.nextLanes = [inId];
      else {
        lane.nextNode = graph.lanesAt(n.id).find(l => !l.serviceId && l.outEdge === e)?.nextNode;
        exits.push(lane.id);
      }
      lanes.push(lane);
    }
  }
  const approach = (gate: Vec3, side: number): Vec3[] => {
    const local = layout.local(gate);
    // A rear gate wraps around the outside end, never through the building.
    if (local.z < 1)
      return [gate, layout.point(side * 14, -5.5), layout.point(side * 14, 3.5), layout.point(side * 8.3, 3.5)];
    return [gate, layout.point(side * 8.3, 3.5)];
  };
  const incoming = approach(gates.IN!, -1), outgoing = approach(gates.OUT!, 1).reverse();
  const service = layout.point(0, 3.5);
  lanes.push({ ...pathGeometry([...incoming, service]), id: inId, nodeId: yardId, inEdge: 0, outEdge: 1, nextLanes: [outId], serviceId: id, servicePart: 'yard', speedLimit: 4 });
  lanes.push({ ...pathGeometry([service, ...outgoing]), id: outId, nodeId: yardId, inEdge: 1, outEdge: 2, nextLanes: exits, serviceId: id, servicePart: 'yard', speedLimit: 4 });
  return { lanes, ports };
}
