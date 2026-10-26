import * as THREE from "three";
import { box, material } from "./HexMeshBuilder.ts";
import type { TrafficSim, Vehicle } from "../core/simulation/TrafficSim.ts";
export class VehicleRenderer {
  readonly root = new THREE.Group();
  private meshes = new Map<number, THREE.Group>();
  private target = new THREE.Vector3();
  private create(v: Vehicle): THREE.Group {
    const g = new THREE.Group(),
      truck = v.kind === "truck";
    const colors = [0x3aafa9, 0x45b678, 0x96c8d8, 0xd95b52];
    const color = colors[v.id % colors.length];
    box(g, 1.65, 0.65, v.length, 0, 0.65, 0, truck ? 0xd95b52 : color);
    if (truck) {
      box(g, 1.8, 1.6, 2.5, 0, 1.65, -0.75, 0xd95b52);
      box(g, 1.65, 1.35, 1.4, 0, 1.2, 1.45, 0xf2a950);
      box(g, 1.4, 0.6, 0.1, 0, 1.5, 2.18, 0x96c8d8);
    } else {
      box(g, 1.45, 0.7, 1.6, 0, 1.2, -0.15, color);
      box(g, 1.3, 0.5, 0.1, 0, 1.2, 0.68, 0x4a6574);
    }
    for (const x of [-0.9, 0.9])
      for (const z of [-v.length * 0.31, v.length * 0.31]) {
        const wheel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.38, 0.38, 0.3, 8),
          material(0x1e2224),
        );
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.4, z);
        g.add(wheel);
      }
    this.root.add(g);
    this.meshes.set(v.id, g);
    return g;
  }
  update(sim: TrafficSim): void {
    const active = new Set(sim.vehicles.map((v) => v.id));
    for (const [id, m] of this.meshes)
      if (!active.has(id)) {
        this.root.remove(m);
        m.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        this.meshes.delete(id);
      }
    for (const v of sim.vehicles) {
      const m = this.meshes.get(v.id) ?? this.create(v),
        s = sim.sample(v);
      m.position.set(s.position.x, s.position.y + 0.2, s.position.z);
      this.target.set(
        s.position.x + s.tangent.x,
        s.position.y + 0.2 + s.tangent.y,
        s.position.z + s.tangent.z,
      );
      m.lookAt(this.target);
    }
  }
  dispose(): void {
    for (const m of this.meshes.values())
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    this.root.clear();
    this.meshes.clear();
  }
}
