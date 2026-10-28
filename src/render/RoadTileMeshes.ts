import * as THREE from 'three';
import { HEX_STEP, hexToWorld } from '../core/hex/HexCoords.ts';
import type { Hex } from '../core/hex/HexCoords.ts';
import { edgeDirection } from '../core/roads/geometry.ts';
import { roadTileCenterline, pocketWidening } from '../core/roads/RoadTiles.ts';
import type { RoadTileSpec } from '../core/roads/RoadTiles.ts';

type Point = { x: number; z: number };
/** Ground-road module. Coordinates are world-space; terrain height is sampled along every strip. */
export function buildRoadTileMesh(h: Hex, spec: RoadTileSpec, height: (x: number, z: number) => number, asphalt = 0x514b50): THREE.Group {
  const group = new THREE.Group(); group.name = `road-tile:${spec.kind}`;
  const c = hexToWorld(h.q, h.r);
  const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide });
  const surface = (outline: Point[], color: number, raise: number, name: string) => {
    const shape = new THREE.Shape(outline.map(p => new THREE.Vector2(p.x, -p.z)));
    const geo = new THREE.ShapeGeometry(shape), a = geo.getAttribute('position');
    for (let i = 0; i < a.count; i++) { const x = a.getX(i), z = -a.getY(i); a.setXYZ(i, x, height(x, z) + raise, z); }
    geo.computeVertexNormals(); const mesh = new THREE.Mesh(geo, mat(color)); mesh.name = name; mesh.receiveShadow = true; group.add(mesh);
  };
  const strip = (points: Point[], width: number, color: number, raise: number, name: string) => {
    const left: Point[] = [], right: Point[] = [];
    points.forEach((p, i) => { const a = points[Math.max(0, i-1)], b = points[Math.min(points.length-1, i+1)], len = Math.hypot(b.x-a.x,b.z-a.z)||1;
      const dx = -(b.z-a.z)/len*width/2, dz = (b.x-a.x)/len*width/2;
      left.push({x:p.x+dx,z:p.z+dz}); right.push({x:p.x-dx,z:p.z-dz}); });
    surface([...left,...right.reverse()],color,raise,name);
  };
  const arrow = (x: number,z: number,dx: number,dz: number) => {
    const transform = (a: number,b: number) => ({x:x+dx*a-dz*b,z:z+dz*a+dx*b});
    surface([[1,0],[-.1,-.65],[-.1,-.2],[-1,-.2],[-1,.2],[-.1,.2],[-.1,.65]].map(([a,b])=>transform(a,b)),0xf6eedb,.05,'direction-arrow');
  };
  if (!spec.edges.length) {
    surface(Array.from({length:32},(_,i)=>({x:c.x+3*Math.cos(i*Math.PI/16),z:c.z+3*Math.sin(i*Math.PI/16)})),asphalt,0,'terminal-pad');
    return group;
  }
  if (spec.edges.length <= 2) {
    const curve = roadTileCenterline(h,spec,height), steps = Math.max(32,Math.ceil(curve.length/.25));
    const at = (t: number,side: number): Point => { const s=curve.sample(curve.length*t), l=Math.hypot(s.tangent.x,s.tangent.z)||1;
      return {x:s.position.x-s.tangent.z/l*side,z:s.position.z+s.tangent.x/l*side}; };
    const sides = [-1,1].map(sign=>Array.from({length:steps+1},(_,i)=>at(i/steps,sign*(3+(spec.kind==='pocket'&&sign===spec.pocketSide?pocketWidening(i/steps):0)))));
    surface([...sides[0],...sides[1].slice().reverse()],asphalt,0,'asphalt');
    for (const side of sides) strip(side,.24,0xc5c6b6,.10,'continuous-curb');
    for (let u=.6;u<curve.length-.3;u+=3) strip([at(u/curve.length,0),at(Math.min(curve.length,u+1.4)/curve.length,0)],.13,0xf6eedb,.025,'centre-dash');
    if (spec.kind==='pocket') {
      const s=spec.pocketSide;
      strip([at(.3,3.25*s),at(.7,3.25*s)],.12,0xf6eedb,.035,'parking-line');
      for (const t of [.3,.7]) strip([at(t,3.25*s),at(t,6.2*s)],.12,0xf6eedb,.035,'parking-end');
    }
  } else {
    // One watertight polygon: edge mouths joined by smooth concave curb returns.
    const outline: Point[]=[];
    for (let i=0;i<spec.edges.length;i++) {
      const d=edgeDirection(spec.edges[i]),next=edgeDirection(spec.edges[(i+1)%spec.edges.length]);
      const a={x:c.x+d.x*HEX_STEP/2+d.z*3,z:c.z+d.z*HEX_STEP/2-d.x*3};
      const b={x:c.x+d.x*HEX_STEP/2-d.z*3,z:c.z+d.z*HEX_STEP/2+d.x*3};
      const end={x:c.x+next.x*HEX_STEP/2+next.z*3,z:c.z+next.z*HEX_STEP/2-next.x*3};
      outline.push(a,b);
      const curve:Point[]=[];
      // Cubic return is tangent to both street mouths, preserving curb direction across the seam.
      const first={x:b.x-d.x*3,z:b.z-d.z*3},last={x:end.x-next.x*3,z:end.z-next.z*3};
      for(let j=0;j<=48;j++){ const t=j/48,u=1-t;curve.push({x:u*u*u*b.x+3*u*u*t*first.x+3*u*t*t*last.x+t*t*t*end.x,z:u*u*u*b.z+3*u*u*t*first.z+3*u*t*t*last.z+t*t*t*end.z}); }
      outline.push(...curve.slice(1));strip(curve,.24,0xc5c6b6,.1,'junction-curb');
      for(let u=5.4;u<HEX_STEP/2;u+=2.6)strip([{x:c.x+d.x*u,z:c.z+d.z*u},{x:c.x+d.x*Math.min(u+1.25,HEX_STEP/2),z:c.z+d.z*Math.min(u+1.25,HEX_STEP/2)}],.13,0xf6eedb,.025,'arm-dash');
    }
    surface(outline,asphalt,0,'junction-asphalt');
    if(spec.kind==='decel_ramp') {const e=spec.edges.find(e=>!spec.edges.includes((e+3)%6))??spec.edges[0],d=edgeDirection(e);arrow(c.x+d.x*4,c.z+d.z*4,d.x,d.z);}
  }
  return group;
}
