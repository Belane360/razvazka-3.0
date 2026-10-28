import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HexMap } from '../src/core/hex/HexMap.ts';
import { hexKey, neighbor } from '../src/core/hex/HexCoords.ts';
import { DistrictManager } from '../src/core/districts/DistrictManager.ts';
import { HexRoadGraph } from '../src/core/roads/HexRoadGraph.ts';
import { HexMeshBuilder } from '../src/render/HexMeshBuilder.ts';
import { buildRoadTileMesh } from '../src/render/RoadTileMeshes.ts';
import { TrafficSim } from '../src/core/simulation/TrafficSim.ts';
import { VehicleRenderer } from '../src/render/VehicleRenderer.ts';

const scene=new THREE.Scene();scene.background=new THREE.Color(0xeee8da);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;document.body.prepend(renderer.domElement);
const ortho=new THREE.OrthographicCamera(),perspective=new THREE.PerspectiveCamera(35,1,.1,900);let camera:THREE.Camera=ortho;
let controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.48;controls.minDistance=35;controls.maxDistance=400;
scene.add(new THREE.AmbientLight(0xffefd2,.85),new THREE.HemisphereLight(0xfff7e7,0x849484,1.8));
const sun=new THREE.DirectionalLight(0xfff0d8,3.2);sun.position.set(-70,140,70);sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-130,right:130,top:110,bottom:-110,near:1,far:400});sun.shadow.normalBias=.06;sun.shadow.bias=-.0001;sun.shadow.radius=4;scene.add(sun);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(1500,1500),new THREE.MeshStandardMaterial({color:0xeee8da,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.1;floor.receiveShadow=true;scene.add(floor);
const labelRoot=document.querySelector('#labels')!;const labels:{el:HTMLDivElement;point:THREE.Vector3;scope:string}[]=[];
const galleryGroups:{group:THREE.Group;scope:string}[]=[];
function label(title:string,subtitle:string,x:number,z:number,scope='all'){const el=document.createElement('div');el.className='label';el.innerHTML=`${title}<small>${subtitle}</small>`;labelRoot.append(el);labels.push({el,point:new THREE.Vector3(x,.5,z),scope});}
function flatMap(radius:number){const map=new HexMap(radius);for(const t of map.tiles.values()){t.elevation=2;t.biome='valley';}map.flatten([...map.tiles.values()],2);return map;}
const simulations:{sim:TrafficSim;vehicles:VehicleRenderer;route:ReturnType<HexRoadGraph['serviceRoute']>;timer:number}[]=[];
function facility(type:'Warehouse'|'Factory',x:number){
 const map=flatMap(3),roads=new HexRoadGraph(()=>2),districts=new DistrictManager(roads,()=>map);districts.place({q:0,r:0},type,Infinity,'superhex_7');
 const f=[...districts.facilities.values()][0];const keep=new Set(f.tiles.map(hexKey));
 for(const gate of [f.inGate!,f.outGate!]){const h=neighbor(gate.hex,gate.edge);keep.add(hexKey(h));roads.addRoad({...h,level:'ground'});}
 for(const key of map.tiles.keys())if(!keep.has(key))map.tiles.delete(key);
 const builder=new HexMeshBuilder();builder.build({map,roads,districts,terrainAt:()=>2});
 const group=new THREE.Group();group.position.set(x,0,-13);group.rotation.y=Math.PI/6;group.add(builder.root);scene.add(group);galleryGroups.push({group,scope:type.toLowerCase()});
 const sim=new TrafficSim(roads),vehicles=new VehicleRenderer();group.add(vehicles.root);const route=roads.serviceRoute(f.id,'IN','OUT');simulations.push({sim,vehicles,route,timer:0});
 label(type==='Factory'?'ЗАВОД · 7 ГЕКСОВ':'СКЛАД · 7 ГЕКСОВ',type==='Factory'?'3 шеда · 2 трубы · 3 силоса':'Фальцевая кровля · световые фонари · HVAC',x,22,type.toLowerCase());
 return {map,roads,districts,builder,sim};
}
const warehouse=facility('Warehouse',-39),factory=facility('Factory',39);
const modules=[{name:'ПРЯМАЯ',edges:[1,4]},{name:'ПОВОРОТ 60°',edges:[0,2]},{name:'ПОВОРОТ 120°',edges:[0,1]},{name:'Т-ОБРАЗНЫЙ',edges:[0,2,3]},{name:'КАРМАН',edges:[1,4],decoration:'pocket' as const},{name:'РАСТРУБ',edges:[0,1,3],decoration:'decel_ramp' as const}];
modules.forEach((m,i)=>{
 const map=flatMap(0),roads=new HexRoadGraph(()=>2),districts=new DistrictManager(roads,()=>map);const builder=new HexMeshBuilder();builder.build({map,roads,districts,terrainAt:()=>2});
 roads.addRoad({q:0,r:0,level:'ground'});for(const edge of m.edges)roads.addRoad({...neighbor({q:0,r:0},edge),level:'ground'});
 if(m.decoration)roads.setRoadTile({q:0,r:0,level:'ground'},m.decoration);
 const g=new THREE.Group();g.position.set((i-2.5)*24,0,48);g.add(builder.root,buildRoadTileMesh({q:0,r:0},roads.roadTile({q:0,r:0,level:'ground'}),()=>2.04));scene.add(g);galleryGroups.push({group:g,scope:'all'});label(m.name,'6 м · стык по центру грани',g.position.x,62);
});
let focus='all',perspectiveMode=false,traffic=true,viewSize=120;
function setView(view:string){ortho.zoom=1;perspective.zoom=1;focus=view;for(const item of galleryGroups)item.group.visible=view==='all'||view==='top'||item.scope===view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',(b as HTMLElement).dataset.view===view));const target=new THREE.Vector3(view==='factory'?39:view==='warehouse'?-39:0,2,view==='all'||view==='top'?10:-13);viewSize=view==='factory'||view==='warehouse'?57:120;camera.position.copy(target).add(view==='top'?new THREE.Vector3(0,170,.001):new THREE.Vector3(68,105,155).multiplyScalar(perspectiveMode?viewSize/120:1));controls.target.copy(target);camera.lookAt(target);resize();controls.update();}
function resize(){renderer.setSize(innerWidth,innerHeight);const aspect=innerWidth/innerHeight;const halfHeight=Math.max(viewSize/2,(focus==='all'||focus==='top'?100:40)/aspect);ortho.left=-halfHeight*aspect;ortho.right=halfHeight*aspect;ortho.top=halfHeight;ortho.bottom=-halfHeight;ortho.near=.1;ortho.far=900;ortho.updateProjectionMatrix();perspective.aspect=aspect;perspective.updateProjectionMatrix();if(perspectiveMode){const direction=camera.position.clone().sub(controls.target).normalize();camera.position.copy(controls.target).addScaledVector(direction,halfHeight/Math.sin(THREE.MathUtils.degToRad(perspective.fov/2)));}}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view!));
document.querySelector<HTMLButtonElement>('#projection')!.onclick=()=>{perspectiveMode=!perspectiveMode;camera=perspectiveMode?perspective:ortho;controls.dispose();controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.48;document.querySelector('#projection')!.textContent=perspectiveMode?'Ортографическая':'Перспектива';setView(focus);};
document.querySelector<HTMLButtonElement>('#traffic')!.onclick=()=>{traffic=!traffic;document.querySelector('#traffic')!.textContent=`Транспорт: ${traffic?'вкл.':'пауза'}`;};
addEventListener('resize',resize);setView('all');let previous=performance.now();
renderer.setAnimationLoop(()=>{const now=performance.now(),dt=Math.min(.05,(now-previous)/1000);previous=now;controls.update();if(traffic)for(const s of simulations){s.timer-=dt;if(s.timer<=0&&s.route){s.sim.spawn(s.route,'truck');s.timer=12;}s.sim.step(dt);s.vehicles.update(s.sim);}for(const {el,point,scope} of labels){const p=point.clone().project(camera);el.style.left=`${(p.x*.5+.5)*innerWidth}px`;el.style.top=`${(-p.y*.5+.5)*innerHeight}px`;el.style.display=(focus!=='all'&&focus!=='top'&&scope!==focus)||Math.abs(p.x)>1||Math.abs(p.y)>1?'none':'block';}renderer.render(scene,camera);});
Object.assign(window,{roadModulePreview:{scene,renderer,warehouse,factory,setView}});
