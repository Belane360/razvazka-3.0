import * as THREE from 'three';

// Pure visual models. No game state, routing or simulation imports.
const palette = { grass:'#8FA958', earth:'#826443', asphalt:'#514B52', concrete:'#C9C2A6', roof:'#3A3742', warehouse:'#C88A37', factory:'#9A9FA8', cream:'#E8DDAD', orange:'#E56B31', red:'#C84C32', teal:'#337A70', glass:'#526E76', line:'#F4E9CD', yellow:'#E4B740' };
const materials = new Map();
function material(color) {
  if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({color, roughness:0.88, metalness:0}));
  return materials.get(color);
}
function mesh(g, geometry, color, x=0,y=0,z=0) {
  const m = new THREE.Mesh(geometry, material(palette[color] ?? color));
  m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; g.add(m); return m;
}
function box(g,x,y,z,w,h,d,color) { return mesh(g,new THREE.BoxGeometry(w,h,d),color,x,y,z); }
function cylinder(g,x,y,z,rt,rb,h,color,n=12) { return mesh(g,new THREE.CylinderGeometry(rt,rb,h,n),color,x,y,z); }
function line(g,points,color,width=.08,y=.12) {
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1];
    const m=box(g,(a[0]+b[0])/2,y,(a[1]+b[1])/2,width,.025,Math.hypot(dx,dz),color); m.rotation.y=Math.atan2(dx,dz);
  }
}
function polygon(g,points,color,y=.04,depth=0) {
  const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p[0],-p[1])));
  const geometry=depth ? new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false}) : new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI/2);
  return mesh(g,geometry,color,0,y-depth,0);
}
const directions=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
const world=([q,r])=>[Math.sqrt(3)*10*(q+r/2),15*r];
function outline(cells) {
  const edges=new Map();
  const key=p=>p.map(v=>Math.round(v*1e5)).join(',');
  for(const c of cells) {
    const [x,z]=world(c), vertices=Array.from({length:6},(_,i)=>[x+10*Math.cos(Math.PI/6+i*Math.PI/3),z+10*Math.sin(Math.PI/6+i*Math.PI/3)]);
    for(let i=0;i<6;i++) { const a=vertices[i],b=vertices[(i+1)%6],k=[key(a),key(b)].sort().join('|'); if(edges.has(k))edges.delete(k);else edges.set(k,[a,b]); }
  }
  const remaining=[...edges.values()],result=[remaining[0][0]],end=key(result[0]); let current=result[0];
  while(remaining.length) {
    const i=remaining.findIndex(e=>key(e[0])===key(current)||key(e[1])===key(current));
    if(i<0)throw Error('Disconnected footprint');
    const edge=remaining.splice(i,1)[0];current=key(edge[0])===key(current)?edge[1]:edge[0];
    if(key(current)===end)break;result.push(current);
  }
  return result;
}
let shadowTexture;
function contact(g,x,z,w,d,opacity=.25,y=.135) {
  if(!shadowTexture) {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
    const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(64,64,8,64,64,64);
    gradient.addColorStop(0,'rgba(35,26,15,.8)');gradient.addColorStop(.55,'rgba(35,26,15,.4)');gradient.addColorStop(1,'rgba(35,26,15,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
    shadowTexture=new THREE.CanvasTexture(canvas);
  }
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,opacity,depthWrite:false}));m.rotation.x=-Math.PI/2;m.position.set(x,y,z);g.add(m);return m;
}
function pine(g,x,z,height=6) {
  cylinder(g,x,.65,z,.24,.34,1.3,'#705138',7);
  for(let i=0;i<3;i++) mesh(g,new THREE.ConeGeometry(height*(.26-i*.035),height*.56,5),['#275E4F','#2E6F59','#35765C'][i],x,height*(.35+i*.21),z);
  contact(g,x,z,5,5,.22);
}
function crate(g,x,z,size=1.3,y=.2) {
  box(g,x,y+size/2,z,size,size,size,'#BD8C4E');
  for(const side of [-1,1]) {
    for(const v of [-.36,.36])box(g,x+v*size,y+size/2,z+side*(size/2+.025),.1,size,.07,'#E1B675');
    const brace=box(g,x,y+size/2,z+side*(size/2+.07),size*1.2,.1,.06,'#E1B675');brace.rotation.z=.65;
  }
  for(const v of [-.35,.35])box(g,x,y+size+.025,z+v*size,size,.07,.1,'#E1B675');
}
function pallet(g,x,z,stack=1) {
  for(let k=0;k<stack;k++) {
    for(const dx of [-.65,.65])box(g,x+dx,.16+k*.28,z,.16,.14,1.8,'#9E7541');
    for(let j=0;j<5;j++)box(g,x-.8+j*.4,.27+k*.28,z,.3,.1,1.9,'#D0A263');
  }
}
function cargo(g,x,z) { pallet(g,x,z,2);crate(g,x-.35,z,1.1,.6);crate(g,x+.75,z,.85,.6);crate(g,x-.35,z,.85,1.7); }
function windowPanel(g,x,y,z,w=1.5,h=.85) {
  box(g,x,y,z,w+.18,h+.18,.13,'concrete');box(g,x,y,z+.08,w,h,.07,'glass');box(g,x,y,z+.13,.06,h,.04,'#9EB1AD');
}
function gable(g,w,d,eave,rise,z,color='roof') {
  const v=[-w/2,eave,z-d/2,w/2,eave,z-d/2,w/2,eave,z+d/2,-w/2,eave,z+d/2,-w/2,eave+rise,z,w/2,eave+rise,z];
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(v,3));geo.setIndex([0,4,5,0,5,1,4,3,2,4,2,5,0,3,4,1,5,2]);geo.computeVertexNormals();mesh(g,geo,color);
  const slope=Math.atan2(rise,d/2),length=Math.hypot(d/2,rise);
  for(let x=-w/2+.5;x<w/2;x+=.8)for(const sign of [-1,1]) {
    const seam=box(g,x,eave+rise/2+.045,z+sign*d/4,.055,.055,length,'#504B54');seam.rotation.x=sign*slope;
  }
  line(g,[[-w/2,z],[w/2,z]],'#625B62',.12,eave+rise+.04);
}
function truck(g,x,z,color='red',rotation=0,small=false) {
  const t=new THREE.Group();t.position.set(x,.12,z);t.rotation.y=rotation;t.scale.setScalar(small?.72:1);g.add(t);
  contact(t,0,0,4.8,11,.34);
  box(t,0,.75,0,2.1,.3,8,'#3F4244');
  box(t,0,2,-1.3,2.35,2.6,5.9,'#E2DECA');box(t,0,3.34,-1.3,2.45,.12,6,'#F5EDD6');
  for(const xSide of [-1,1])for(let i=0;i<11;i++)box(t,xSide*1.185,2,-3.8+i*.51,.025,2.45,.035,'#CBC7B5');
  box(t,0,1.65,3.1,2.35,2.2,2.5,color);box(t,0,2.95,2.9,2.35,.45,2.1,color);
  box(t,0,2.27,4.365,1.9,.72,.04,'glass');box(t,0,1.1,4.39,1.5,.45,.08,'#3E4445');
  box(t,0,.77,4.45,2.4,.2,.15,'#BDBCB2');
  for(const side of [-1,1]) {
    box(t,side*.85,1.25,4.45,.38,.25,.08,'line');box(t,side*1.2,2.2,3,.04,.75,1.1,'glass');
    for(const axle of [-3,-2,2.6]) {
      const wheel=cylinder(t,side*1.16,.66,axle,.53,.53,.35,'#303439',12);wheel.rotation.z=Math.PI/2;
      const hub=cylinder(t,side*1.37,.66,axle,.24,.24,.03,'#A1A39C',10);hub.rotation.z=Math.PI/2;
    }
  }
  return t;
}
function bollard(g,x,z) { cylinder(g,x,.6,z,.13,.16,1.1,'yellow',8);cylinder(g,x,.75,z,.14,.14,.23,'#36383B',8); }
function dock(g,x,z) {
  box(g,x,2,z,3.5,3.8,.4,'#D0CCBA');box(g,x,1.85,z+.23,2.9,3.3,.16,'#30373D');
  for(let i=0;i<8;i++)box(g,x,.4+i*.37,z+.33,2.65,.025,.045,'#62676A');
  box(g,x,3.96,z+.75,3.8,.26,1.8,'orange');box(g,x,3.7,z+1.56,3.8,.35,.12,'orange');
  for(const side of [-1,1]) { box(g,x+side*1.53,1.4,z+.52,.22,2.4,.28,'#242D32');bollard(g,x+side*1.9,z+1.2); }
  box(g,x,.24,z+1.1,3.6,.42,1.8,'concrete');
  line(g,[[x-1.9,z+1.8],[x-1.9,z+10.5],[x+1.9,z+10.5],[x+1.9,z+1.8]],'line',.1,.11);
}
function arrow(g,x,z,angle=0) {
  const group=new THREE.Group();group.position.set(x,.14,z);group.rotation.y=angle;g.add(group);
  polygon(group,[[-.12,1.2],[.12,1.2],[.12,-.25],[.6,-.25],[0,-1.1],[-.6,-.25],[-.12,-.25]],'line',0);
}
function markingText(g,text,x,z,angle=0) {
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#F4E9CD';ctx.textAlign='center';ctx.font='bold 75px sans-serif';ctx.fillText(text,128,90);
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(3,1.5),new THREE.MeshStandardMaterial({map:tex,transparent:true,roughness:1,depthWrite:false}));m.rotation.set(-Math.PI/2,0,angle);m.position.set(x,.16,z);g.add(m);
}
function road(g,points,width=4.5) {
  // Extruded planar ribbon; smooth corners use sampled Catmull-Rom points.
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p[0],.09,p[1])),false,'centripetal');
  const verts=[],indices=[],left=[],right=[];
  for(let i=0;i<=100;i++) {
    const p=curve.getPoint(i/100),t=curve.getTangent(i/100),n=new THREE.Vector3(-t.z,0,t.x).multiplyScalar(width/2);
    left.push([p.x+n.x,p.z+n.z]);right.push([p.x-n.x,p.z-n.z]);verts.push(p.x+n.x,.09,p.z+n.z,p.x-n.x,.09,p.z-n.z);
    if(i<100){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(indices);geo.computeVertexNormals();mesh(g,geo,'asphalt');
  line(g,left,'line',.07);line(g,right,'line',.07);
  const length=curve.getLength();for(let u=1;u<length;u+=3.8) {const a=curve.getPointAt(u/length),b=curve.getPointAt(Math.min(1,(u+1.65)/length));line(g,[[a.x,a.z],[b.x,b.z]],'line',.09);}
}
function base(g,kind) {
  const cells=kind==='home'?[[0,0]]:kind==='shop'?[[0,0],[1,0],[0,1]]:[[0,0],...directions];
  const boundary=outline(cells);if(kind==='shop') {for(const p of boundary){p[0]-=8.66;p[1]-=5;}}
  polygon(g,boundary,'earth',0,2.5);polygon(g,boundary,'grass',.035);
  line(g,[...boundary,boundary[0]],'#9BB86D',.12,.08);
  contact(g,0,0,kind==='home'?28:kind==='shop'?48:66,kind==='home'?26:60,.26,-2.47);
  return boundary;
}
function garden(g) {
  for(const [x,z,h] of [[-21,-8,6],[-17,-15,7],[-8,-21,6],[7,-20,7.3],[17,-14,5.5],[22,-7,6],[-18,11,4.6],[18,11,4.9]])pine(g,x,z,h);
  for(const [x,z] of [[-22,-3],[21,-12],[-13,-20],[13,20]])mesh(g,new THREE.DodecahedronGeometry(.7,0),'#768F4C',x,.45,z);
}
function industrialBase(g) {
  const boundary=base(g,'large');
  polygon(g,boundary.map(([x,z])=>[x*.85,z*.85]),'asphalt',.08);
  polygon(g,[[-17.3,-12.5],[17.3,-12.5],[17.3,3],[-17.3,3]],'concrete',.1);
  road(g,[[-25.95,0],[-23,0],[-21,3],[-16,6],[-14,11],[-11,16],[0,18],[11,16],[14,11],[16,6],[21,3],[23,0],[25.95,0]],3);
  for(const x of [-7,0,7])arrow(g,x,17.6,-Math.PI/2);
  markingText(g,'IN',-22,1,-Math.PI/2);markingText(g,'OUT',22,1,-Math.PI/2);
  garden(g);
}
function warehouse() {
  const g=new THREE.Group();industrialBase(g);contact(g,0,-5,40,22,.36);
  box(g,0,4.3,-5.5,34,8.4,13,'warehouse');box(g,0,.45,-5.5,34.2,.7,13.2,'concrete');
  gable(g,35.2,14.2,8.6,2.8,-5.5);
  for(let x=-16;x<=16;x+=4) { box(g,x,4.5,1.04,.18,7.9,.16,'#D8A45A');windowPanel(g,x,6.8,1.09,1.7,.7); }
  for(const x of [-10.5,-3.5,3.5,10.5])dock(g,x,1.1);
  truck(g,-10.5,6.7,'red');truck(g,3.5,6.7,'teal');
  for(const [x,z] of [[-18,1.8],[17.8,4.7],[-17,-10]])cargo(g,x,z);
  pallet(g,17.8,8,5);box(g,18.5,1.7,-7,2.7,3.4,3,'#AB824E');
  windowPanel(g,18.5,2,-5.46,1.1,1);
  return g;
}
function factory() {
  const g=new THREE.Group();industrialBase(g);contact(g,0,-5,40,24,.4);
  box(g,0,4.4,-5.5,34,8.6,13,'factory');box(g,0,.45,-5.5,34.3,.7,13.3,'concrete');
  // Each bay rises from left eave to a vertical clerestory: true sawtooth profile.
  for(let bay=0;bay<4;bay++) {
    const x=-17+bay*8.5;
    const shape=new THREE.Shape();shape.moveTo(x,8.7);shape.lineTo(x+7.7,11.3);shape.lineTo(x+7.7,8.7);shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth:14,bevelEnabled:false});mesh(g,geo,'roof',0,0,-12.5);
    for(let z=-11.5;z<1;z+=1.2)box(g,x+7.75,10.05,z,.13,1.9,1,'#8CABB0');
    for(let z=-12.3;z<1.4;z+=.9) {const ridge=box(g,x+3.85,10.07,z,8.15,.07,.055,'#57545E');ridge.rotation.z=Math.atan2(2.6,7.7);}
    box(g,x+7.78,10,-5.5,.16,.13,13.8,'#CDD4CF');
  }
  for(const x of [-10.5,-3.5,3.5,10.5])dock(g,x,1.1);
  truck(g,-10.5,6.7,'orange');truck(g,3.5,6.7,'red');
  for(let x=-16;x<17;x+=4)windowPanel(g,x,6.7,1.09,2.9,.8);
  for(const [x,z,h] of [[-7,-8,18],[0,-8,20],[7,-8,17]]) {
    box(g,x,9,-8,3.2,2.1,3.2,'#7F858A');
    const start=10;for(let y=start;y<h;y+=1.4)cylinder(g,x,y+Math.min(1.4,h-y)/2,z,.62,.68,Math.min(1.4,h-y),(Math.floor((y-start)/1.4)%4===2)?'line':'#AB5946',12);
    cylinder(g,x,h+.1,z,.78,.78,.35,'line');cylinder(g,x,h+.29,z,.49,.49,.03,'#414044');
  }
  box(g,18.1,2,-7,3.8,3.9,5.5,'#B9B5A3');
  const annex=new THREE.Group();annex.position.x=18.1;g.add(annex);gable(annex,4.4,6.1,4.05,.8,-7);
  for(let i=0;i<4;i++)box(g,18.1,1.5+i*.35,-4.21,2.4,.17,.08,'#5A6364');
  for(const z of [-4,0]) { cylinder(g,-19,1.8,z,1.35,1.35,3.3,'#B4B7AB');cylinder(g,-19,3.5,z,1.38,1.38,.15,'#D3D1BD'); }
  for(const [x,z] of [[18,4],[-18,6]])cargo(g,x,z);
  for(let i=0;i<4;i++)box(g,18,.35+i*.35,9,3,.25,1.8,'#68777B');
  return g;
}
function shop() {
  const g=new THREE.Group();const boundary=base(g,'shop');
  polygon(g,boundary.map(([x,z])=>[x*.84,z*.84]),'concrete',.08);
  polygon(g,[[-8,1],[8,1],[7,12],[-7,12]],'asphalt',.1);
  contact(g,0,-4,21,17,.35);box(g,0,2.8,-4,16,5.4,10,'cream');box(g,0,.45,-4,16.2,.7,10.2,'concrete');
  gable(g,17,11,5.7,2,-4,'teal');
  for(const x of [-4.8,4.8]) {windowPanel(g,x,2.5,1.1,3.5,2.8);}
  box(g,0,1.8,1.1,1.8,3.3,.2,'#436966');box(g,.5,1.7,1.25,.08,.7,.08,'line');
  for(let i=0;i<12;i++){const x=-7.15+i*1.3;const awning=box(g,x,4.45,2,1.3,.13,2.4,i%2?'line':'orange');awning.rotation.x=.18;box(g,x,4.13,3.16,1.3,.5,.1,i%2?'line':'orange');}
  box(g,0,5.05,1.15,5.5,.65,.17,'teal');
  for(const x of [-5,-1.5,2,5.5])line(g,[[x,5],[x-1.2,9]],'line',.09,.13);
  for(const [x,z,h]of[[-14,-7,6],[11,-9,5],[0,14,5.5],[5,12,4]])pine(g,x,z,h);
  cargo(g,10,-1);truck(g,12,-3,'teal',Math.PI/2,true);
  return g;
}
function home() {
  const g=new THREE.Group();base(g,'home');
  polygon(g,[[-4,-4],[4,-4],[4,4],[-4,4]],'concrete',.08);box(g,0,1.8,-1,6,3.5,5,'cream');gable(g,6.8,5.8,3.6,1.7,-1,'red');
  box(g,0,1.3,1.56,1.2,2.5,.12,'#797B5F');windowPanel(g,-2,2,1.57,.9,1.2);windowPanel(g,2,2,1.57,.9,1.2);
  box(g,2.1,5,-1.5,.65,2,.65,'cream');box(g,2.1,6,-1.5,.8,.2,.8,'concrete');
  polygon(g,[[-.8,1.5],[.8,1.5],[.8,6],[-.8,6]],'concrete',.1);pine(g,-5,-2,5);pine(g,5,-4,5.5);road(g,[[-7,5],[0,6],[7,5]],2.5);
  return g;
}
export function createModels() {
  return [ {id:'home',label:'Дом',cells:1,group:home(),x:-100,radius:12}, {id:'shop',label:'Магазин',cells:3,group:shop(),x:-62,radius:23}, {id:'warehouse',label:'Склад',cells:7,group:warehouse(),x:0,radius:33}, {id:'factory',label:'Завод',cells:7,group:factory(),x:68,radius:33} ];
}
