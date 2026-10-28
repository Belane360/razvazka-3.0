import * as THREE from 'three';
import type { DistrictCluster } from '../core/districts/DistrictManager.ts';
import { hexToWorld, HEX_SIZE } from '../core/hex/HexCoords.ts';
import { complexLayout } from '../core/districts/ServiceYard.ts';

const C = { asphalt: 0x4a475c, concrete: 0xc5c6b6, mark: 0xf5eddc, roof: 0x3a3742, ochre: 0xc88a37, factory: 0x9a9fa8, glass: 0x8cb9bd, orange: 0xe87932, pine: 0x225e49 };
const materials = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number) {
  let value = materials.get(color);
  if (!value) { value = new THREE.MeshStandardMaterial({ color, roughness: 0.93, metalness: 0 }); materials.set(color, value); }
  return value;
}
function box(g: THREE.Group, name: string, x: number, y: number, z: number, w: number, h: number, d: number, color: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.name = name; m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
function cylinder(g: THREE.Group, name: string, x: number, y: number, z: number, rt: number, rb: number, h: number, color: number) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 16), mat(color));
  m.name = name; m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
function surface(g: THREE.Group, name: string, shape: THREE.Shape, color: number, y = 0.19) {
  let geo: THREE.BufferGeometry = new THREE.ShapeGeometry(shape, 32); geo.rotateX(-Math.PI / 2);
  const cells = g.userData.groundCells as number[][][] | undefined;
  if (cells) {
    const positions = geo.getAttribute('position'), indices = geo.getIndex(), output: number[] = [];
    for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
      const triangle = [0,1,2].map(j => { const k = indices ? indices.getX(i+j) : i+j; return [positions.getX(k), positions.getZ(k)]; });
      for (const cell of cells) {
        let poly = triangle;
        for (let edge = 0; edge < 6 && poly.length; edge++) {
          const a = cell[edge], b = cell[(edge+1)%6];
          const side = (p: number[]) => (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
          const clipped: number[][] = [];
          for (let j = 0; j < poly.length; j++) {
            const p=poly[j], q=poly[(j+1)%poly.length], sp=side(p), sq=side(q);
            if(sp>=-1e-8) clipped.push(p);
            if((sp>=0)!==(sq>=0)) { const t=sp/(sp-sq); clipped.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]); }
          }
          poly=clipped;
        }
        for(let j=1;j<poly.length-1;j++) for(const p of [poly[0],poly[j],poly[j+1]]) output.push(p[0],0,p[1]);
      }
    }
    geo.dispose(); geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(output,3)); geo.computeVertexNormals();
  }
  // Shape coordinates use -z so all top faces point upward.
  const mesh = new THREE.Mesh(geo, mat(color)); mesh.position.y = y; mesh.name = name; mesh.receiveShadow = true; g.add(mesh); return mesh;
}
function polygon(g: THREE.Group, name: string, points: number[][], color: number, y = 0.19) {
  const s = new THREE.Shape(); points.forEach(([x,z],i)=> i ? s.lineTo(x,-z) : s.moveTo(x,-z)); s.closePath(); return surface(g,name,s,color,y);
}
function line(g: THREE.Group, name: string, a: number[], b: number[], width = 0.12, color = C.mark) {
  const dx=b[0]-a[0], dz=b[1]-a[1];
  const m=box(g,name,(a[0]+b[0])/2,0.235,(a[1]+b[1])/2,width,0.025,Math.hypot(dx,dz),color); m.rotation.y=Math.atan2(dx,dz); return m;
}
function arrow(g: THREE.Group, x:number,z:number, angle:number) {
  const a = new THREE.Group(); a.position.set(x,0,z); a.rotation.y=angle; a.name='yard-direction';
  line(a,'arrow-shaft',[0,-0.8],[0,0.8]); line(a,'arrow-head',[-0.5,0.2],[0,0.8]); line(a,'arrow-head',[0.5,0.2],[0,0.8]); g.add(a);
}

/** Northern production cells and southern frontage share a single, explicit local frame. */
export function createIndustrialComplex(c: DistrictCluster, elevation: number): THREE.Group {
  const layout = complexLayout(c,elevation), g = new THREE.Group();
  g.name=`complex:${c.id}`; g.position.set(layout.center.x,elevation,layout.center.z); g.rotation.y=-Math.atan2(layout.axis.z,layout.axis.x);
  g.userData.groundCells=c.tiles.map(tile=> { const p=hexToWorld(tile.q,tile.r); return Array.from({length:6},(_,i)=> { const angle=(i+.5)*Math.PI/3, v=layout.local({x:p.x+HEX_SIZE*Math.cos(angle),y:elevation,z:p.z+HEX_SIZE*Math.sin(angle)}); return [v.x,v.z]; }); });
  g.userData.layout='north-production-south-frontage'; g.userData.facilityId=c.id;
  const factory=c.type==='Factory';
  // A useful apron, rather than an inset copy of the seven-hex boundary.
  const apron=new THREE.Shape(); apron.moveTo(-16,1); apron.lineTo(16,1); apron.lineTo(16,-5);
  apron.quadraticCurveTo(16,-8,19,-10); apron.lineTo(22.5,-12.99); apron.lineTo(20,-15.9);
  apron.quadraticCurveTo(18,-13.8,15,-11); apron.lineTo(-15,-11);
  apron.quadraticCurveTo(-18,-13.8,-20,-15.9); apron.lineTo(-22.5,-12.99); apron.lineTo(-19,-10);
  apron.quadraticCurveTo(-16,-8,-16,-5); apron.closePath(); surface(g,`apron:${c.id}`,apron,C.asphalt);
  // The roadway meets the two external edges flush; its interior is a straight street.
  polygon(g,'frontage-street',[[25.1,11.49],[19.9,14.49],[17.4,16],[-17.4,16],[-19.9,14.49],[-25.1,11.49],[-22.5,9.99],[-18,10],[18,10],[22.5,9.99]],C.asphalt,0.2);
  for(let x=-17;x<18;x+=3) line(g,'frontage-center-dash',[x,13],[x+1.5,13]);
  line(g,'street-edge',[-17,15.7],[17,15.7],0.1); line(g,'street-edge',[-12,10.25],[12,10.25],0.1);
  arrow(g,11,11.6,-Math.PI/2); arrow(g,-11,14.4,Math.PI/2);
  // Dedicated waiting space lies off the through lane, beside the entry.
  polygon(g,'waiting-pocket',[[12,4],[18,4],[20,8.5],[17,10],[12,10]],C.asphalt,0.205);
  line(g,'waiting-bay',[13,4.8],[17.2,4.8]); line(g,'waiting-bay',[13,4.8],[13,9]); line(g,'waiting-bay',[17.2,4.8],[18.4,8.5]);
  arrow(g,19,10,-2.2); arrow(g,-18.5,10.5,-1.2);
  // Yield marking at the outgoing merge; no rear circulation loop.
  for(let i=0;i<3;i++) polygon(g,'yield-tooth',[[-18+i*.7,10],[-17.65+i*.7,10.7],[-17.3+i*.7,10]],C.mark,0.245);
  const h=factory?9:7.2;
  box(g,`foundation:${c.id}`,0,0.32,-6,30.4,.32,12.4,C.concrete);
  box(g,`body:${c.id}`,0,h/2+.4,-6,30,h,12,factory?C.factory:C.ochre);
  // Structural rhythm and narrow high windows provide scale without toy-like exaggeration.
  for(let x=-14;x<=14;x+=4) {
    box(g,'facade-pier',x,h/2+.4,.08,.18,h,.18,factory?0xb5b7b3:0xd4a052);
    box(g,'clerestory',x,h-1.1,.13,2.5,.65,.1,C.glass);
    box(g,'clerestory-mullion',x,h-1.1,.2,.08,.65,.08,C.concrete);
  }
  if(factory) {
    for(let i=0;i<3;i++) {
      const x=-15+i*10, shape=new THREE.Shape(); shape.moveTo(0,0); shape.lineTo(10,0); shape.lineTo(10,2.5); shape.closePath();
      const roof=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:12.6,bevelEnabled:false}),mat(C.roof));
      roof.name=`shed:${c.id}:${i}`; roof.position.set(x,h+.4,-12.3); roof.castShadow=true; g.add(roof);
      box(g,'shed-glazing',x+10.04,h+1.75,-6,.1,1.8,11.7,C.glass);
      for(let z=-11;z<0;z+=2) box(g,'shed-mullion',x+10.12,h+1.75,z,.12,1.9,.09,C.concrete);
      for(let z=-12;z<=0;z+=1.2) {
        const seam=box(g,'shed-seam',x+5,h+1.78,z,10.3,.045,.045,0x69676d); seam.rotation.z=Math.atan2(2.5,10);
      }
    }
    box(g,'boiler-house',0,2,-17,9,3.5,5,C.factory);
    for(const [i,height] of [16,14].entries()) {
      const x=-2+i*4;
      cylinder(g,`stack:${c.id}:${i}`,x,height/2+.4,-18,.62,.9,height,0xac5a42);
      for(const ring of [height-3,height-1]) cylinder(g,'stack-white-ring',x,ring,-18,.71,.73,.8,C.mark);
      cylinder(g,'stack-mouth',x,height+.42,-18,.57,.57,.06,0x23292b);
    }
    for(let i=0;i<3;i++) {
      cylinder(g,`silo:${i}`,-4+i*4,2.7,-22,.95,.95,4.6,0xb7bdb6);
      cylinder(g,'silo-cap',-4+i*4,5.15,-22,.1,1.02,.45,0xd0d2c6);
      cylinder(g,'silo-foot',-4+i*4,.45,-22,1.1,1.1,.25,C.concrete);
    }
    box(g,'transformer',-18,1.5,-7,3,2.4,3,0x6d7773);
    for(let x=-19;x<-17;x+=.4) box(g,'transformer-fin',x,1.5,-5.45,.12,1.7,.22,0x495855);
  } else {
    const slope=.23, half=6.45, ridge=h+.6+Math.tan(slope)*half;
    for(const sign of [-1,1]) {
      const z=-6+sign*half/2, y=ridge-Math.tan(slope)*half/2;
      const roof=box(g,`roof:${c.id}:${sign}`,0,y,z,31,.2,half/Math.cos(slope),C.roof); roof.rotation.x=sign*slope;
      for(let x=-15;x<=15;x+=1) { const seam=box(g,'roof-standing-seam',x,y+.13,z,.045,.06,half/Math.cos(slope),0x595760); seam.rotation.x=sign*slope; }
      for(const x of [-10,0,10]) { const sky=box(g,`skylight:${c.id}:${x}:${sign}`,x,y+.22,z,3,.15,1.5,C.glass); sky.rotation.x=sign*slope; }
    }
    for(const x of [-5,5]) {
      box(g,'HVAC',x,ridge+.45,-6,2.2,.9,1.9,0xb0b5b1);
      cylinder(g,'HVAC-fan',x,ridge+.94,-6,.55,.55,.08,0x4a5554);
    }
  }
  for(const [i,x] of [-8,0,8].entries()) {
    box(g,`dock:${c.id}:${i}`,x,2.25,.16,3.2,3.8,.22,0x293133);
    for(let y=.8;y<3.9;y+=.45) box(g,'door-panel',x,y,.3,2.9,.045,.04,0x566164);
    box(g,'dock-platform',x,.45,.8,3.8,.35,1.4,C.concrete);
    box(g,'dock-canopy',x,4.35,.95,4,.24,2.2,C.orange);
    for(const dx of [-1.85,1.85]) {
      cylinder(g,'dock-bollard',x+dx,.95,1.4,.14,.14,1.15,0xe8b940);
      cylinder(g,'dock-bollard-band',x+dx,1.1,1.4,.15,.15,.3,0x343d3b);
      line(g,'dock-parking-line',[x+dx,1.8],[x+dx,6.7]);
    }
    line(g,'dock-stop-line',[x-1.85,6.7],[x+1.85,6.7],.2);
  }
  for(const [x,z] of [[-13,2.5],[-12,3.7],[11,2.7]]) {
    box(g,'pallet',x,.32,z,1.4,.18,1.1,0x95734b);
    box(g,'crate',x,.95,z,1.25,1.1,1,0xc69860);
    for(const dx of [-.48,.48]) box(g,'crate-strap',x+dx,.95,z+.51,.09,1.1,.04,0x795f42);
  }
  const trees=[[-20,-7],[20,-7],[-13,-17],[13,-17],[-5,23],[5,23],[-21,3],[21,3]];
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.18,.22,1.3,5),mat(0x70543c),trees.length);
  const crowns=new THREE.InstancedMesh(new THREE.ConeGeometry(1.35,4.3,6),mat(C.pine),trees.length*2);
  trunks.name='industrial-pine-trunks'; crowns.name='industrial-pines'; const m=new THREE.Matrix4();
  trees.forEach(([x,z],i)=> { trunks.setMatrixAt(i,m.makeTranslation(x,.8,z)); crowns.setMatrixAt(2*i,m.makeTranslation(x,2.9,z)); crowns.setMatrixAt(2*i+1,m.makeTranslation(x,4.1,z)); });
  trunks.castShadow=crowns.castShadow=true; g.add(trunks,crowns);
  return g;
}
