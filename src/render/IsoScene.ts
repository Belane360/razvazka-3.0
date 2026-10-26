import { RISE_PER_STEP } from "../core/hex/HeightUnits.ts";
import * as THREE from "three";
import { HexMeshBuilder, disposeGroup } from "./HexMeshBuilder.ts";
import { VehicleRenderer } from "./VehicleRenderer.ts";
import {
  hexKey,
  hexToWorld,
  neighbor,
  hexLine,
} from "../core/hex/HexCoords.ts";
import type { Hex } from "../core/hex/HexCoords.ts";
import { GameState } from "../core/GameState.ts";
import type { Tool } from "../core/GameState.ts";
import type { RoadAddress } from "../core/roads/HexRoadGraph.ts";
import type { Level } from "../core/roads/HexRoadGraph.ts";
export interface SceneOptions {
  tool: Tool;
  level: Level;
  direction: number;
  span: number;
  rampTarget: Level;
  paper: boolean;
}
export class IsoScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera();
  private builder = new HexMeshBuilder();
  private cars = new VehicleRenderer();
  private ghost = new THREE.Group();
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private target = new THREE.Vector3();
  private keys = new Set<string>();
  private angle = Math.PI / 4;
  private desiredAngle = Math.PI / 4;
  private zoom = 1;
  private frame = 0;
  private last = 0;
  private lastRevision = -1;
  private paper = false;
  private observer: ResizeObserver;
  private hover?: Hex;
  private lastPaint = "";
  private stroke?: Hex;
  private dragging = false;
  private disposed = false;
  options: SceneOptions = {
    tool: "inspect",
    level: "ground",
    direction: 0,
    span: 3,
    rampTarget: "elevated",
    paper: false,
  };
  onHover?: (h: Hex | undefined) => void;
  onChange?: () => void;
  onSelect?: (address: RoadAddress | undefined) => void;
  private container: HTMLElement;
  private game: GameState;
  constructor(container: HTMLElement, game: GameState) {
    this.container = container;
    this.game = game;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffefd9, 0x8c997b, 1.8));
    const sun = new THREE.DirectionalLight(0xffe2bb, 2.2);
    sun.position.set(-80, 150, 75);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -210,
      right: 210,
      top: 210,
      bottom: -210,
      near: 1,
      far: 450,
    });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.08;
    this.scene.add(sun, this.builder.root, this.cars.root, this.ghost);
    this.camera.near = 0.1;
    this.camera.far = 1200;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.move);
    el.addEventListener("pointerdown", this.down);
    el.addEventListener("pointerup", this.up);
    el.addEventListener("pointercancel", this.up);
    el.addEventListener("contextmenu", this.context);
    el.addEventListener("wheel", this.wheel, { passive: false });
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("keyup", this.keyup);
    window.addEventListener("blur", this.blur);
    this.frame = requestAnimationFrame(this.animate);
  }
  rotate(): void {
    this.desiredAngle += Math.PI / 3;
  }
  private resize(): void {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    const half = 105 / this.zoom;
    this.camera.left = (-half * w) / h;
    this.camera.right = (half * w) / h;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }
  private context = (e: Event) => e.preventDefault();
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom = Math.max(
      0.45,
      Math.min(3, this.zoom * Math.exp(-e.deltaY * 0.001)),
    );
    this.resize();
  };
  private keydown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).matches("input,select,textarea")) return;
    this.keys.add(e.code);
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(e.code))
      e.preventDefault();
  };
  private keyup = (e: KeyboardEvent) => this.keys.delete(e.code);
  private blur = () => {
    this.keys.clear();
    this.dragging = false;
  };
  private down = (e: PointerEvent) => {
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.dragging = e.button === 2;
    this.lastPaint = "";
    this.stroke = undefined;
    if (e.button === 0) this.paint();
  };
  private up = () => {
    this.dragging = false;
    this.lastPaint = "";
    this.stroke = undefined;
  };
  private move = (e: PointerEvent) => {
    if (this.dragging) {
      const scale = 0.22 / this.zoom;
      this.target.x +=
        (-Math.cos(this.angle) * e.movementX +
          Math.sin(this.angle) * e.movementY) *
        scale;
      this.target.z +=
        (Math.sin(this.angle) * e.movementX +
          Math.cos(this.angle) * e.movementY) *
        scale;
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    const hit = this.ray.intersectObjects(this.builder.pickables, false)[0];
    const h = hit?.object.userData.hex as Hex | undefined;
    if (h && (!this.hover || hexKey(h) !== hexKey(this.hover))) {
      this.hover = h;
      this.onHover?.(h);
      this.preview();
    } else if (!h) {
      this.hover = undefined;
      this.ghost.visible = false;
      this.onHover?.(undefined);
    }
    if (
      e.buttons === 1 &&
      ["road", "overpass", "demolish"].includes(this.options.tool)
    )
      this.paint();
  };
  private paint(): void {
    if (!this.hover) return;
    const key = hexKey(this.hover);
    if (key === this.lastPaint) return;
    this.lastPaint = key;
    if (this.options.tool === "inspect" || this.options.tool === "signal") {
      const address = { ...this.hover, level: this.options.level },
        n = this.game.roads.get(address);
      if (n && !n.rampId) {
        if (this.options.tool === "signal" && !n.signal)
          this.game.build(
            this.hover,
            "signal",
            this.options.level,
            this.options.direction,
            this.options.span,
          );
        this.onSelect?.(address);
        this.onChange?.();
        return;
      }
      this.onSelect?.(undefined);
    }
    const drawing =
      this.options.tool === "road" || this.options.tool === "overpass";
    const cells =
      drawing && this.stroke
        ? hexLine(this.stroke, this.hover).slice(1)
        : [this.hover];
    for (const h of cells) {
      const ok = this.game.build(
        h,
        this.options.tool,
        this.options.level,
        this.options.direction,
        this.options.span,
        drawing ? this.stroke : undefined,
        this.options.rampTarget,
      );
      const exists = this.game.roads.get({
        ...h,
        level:
          this.options.tool === "overpass" ? "elevated" : this.options.level,
      });
      if (drawing && (ok || (!this.stroke && exists)))
        this.stroke = { q: h.q, r: h.r };
      else if (drawing) {
        this.stroke = undefined;
        break;
      }
    }
    this.onChange?.();
  }
  preview(): void {
    disposeGroup(this.ghost);
    if (!this.hover || this.options.tool === "inspect") {
      this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    let h = { ...this.hover };
    for (
      let i = 0;
      i <= (this.options.tool === "ramp" ? this.options.span : 0);
      i++
    ) {
      const tile = this.game.map.get(h);
      const pos = hexToWorld(h.q, h.r, this.game.map.height(h));
      const high =
        this.options.level === "elevated" || this.options.tool === "overpass";
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(9.5, 9.5, 0.22, 6),
        new THREE.MeshBasicMaterial({
          color: tile ? 0xf7e6a4 : 0xd94c40,
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
        }),
      );
      let y = pos.y;
      if (this.options.tool === "ramp") {
        let end = { ...this.hover };
        for (let j = 0; j < this.options.span; j++)
          end = neighbor(end, this.options.direction);
        const low = this.game.map.height(this.hover),
          top =
            this.options.rampTarget === "ground"
              ? this.game.map.height(end)
              : low + this.options.span * RISE_PER_STEP,
          t = i / this.options.span;
        y = low + (top - low) * t * t * (3 - 2 * t);
      } else if (high)
        y = this.game.roads.proposedHeight(
          { ...h, level: "elevated" },
          this.stroke ? { ...this.stroke, level: "elevated" } : undefined,
        );
      m.position.set(pos.x, y + 0.6, pos.z);
      this.ghost.add(m);
      h = neighbor(h, this.options.direction);
    }
  }
  private animate = (now: number) => {
    if (this.disposed) return;
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    this.game.update(dt);
    const pan = (dt * 70) / this.zoom;
    let x = 0,
      z = 0;
    if (this.keys.has("KeyW")) z--;
    if (this.keys.has("KeyS")) z++;
    if (this.keys.has("KeyA")) x--;
    if (this.keys.has("KeyD")) x++;
    this.target.x +=
      (Math.cos(this.angle) * x + Math.sin(this.angle) * z) * pan;
    this.target.z +=
      (-Math.sin(this.angle) * x + Math.cos(this.angle) * z) * pan;
    this.angle += (this.desiredAngle - this.angle) * Math.min(1, dt * 9);
    this.camera.position.set(
      this.target.x + Math.sin(this.angle) * 250,
      this.target.y + 250 / Math.sqrt(2),
      this.target.z + Math.cos(this.angle) * 250,
    );
    this.camera.lookAt(this.target);
    if (
      this.lastRevision !== this.game.revision ||
      this.paper !== this.options.paper
    ) {
      this.builder.build(this.game, this.options.paper);
      this.lastRevision = this.game.revision;
      this.paper = this.options.paper;
      this.preview();
    }
    this.builder.updateSignals(this.game);
    this.cars.update(this.game.sim);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
    window.removeEventListener("blur", this.blur);
    disposeGroup(this.builder.root);
    disposeGroup(this.ghost);
    this.cars.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
