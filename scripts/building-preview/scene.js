import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createModels } from './models.js';

const canvas=document.querySelector('canvas');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.25;
const scene=new THREE.Scene();
scene.background=new THREE.Color('#F5EEDC');
const ambient=new THREE.AmbientLight('#FFF1D8',.65);scene.add(ambient);
const hemi=new THREE.HemisphereLight('#FFF8E8','#827C55',1.5);scene.add(hemi);
const key=new THREE.DirectionalLight('#FFF0D7',3.1);
key.position.set(-60,100,65);key.castShadow=true;
key.shadow.mapSize.set(4096,4096);
Object.assign(key.shadow.camera,{left:-160,right:160,top:90,bottom:-90,near:1,far:300});
key.shadow.bias=-.00015;key.shadow.normalBias=.08;key.shadow.radius=4;
scene.add(key);
const fill=new THREE.DirectionalLight('#DBE8E3',.65);fill.position.set(40,35,-50);scene.add(fill);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({color:'#F5EEDC',roughness:1}));
ground.rotation.x=-Math.PI/2;ground.position.y=-2.58;ground.receiveShadow=true;scene.add(ground);

const models=createModels();
for(const model of models) {
  model.group.name=model.id;model.group.position.x=model.x;scene.add(model.group);
}
// Fail visibly on invalid procedural geometry, rather than silently drawing an empty scene.
scene.traverse(o=>{
  if(!o.isMesh)return;
  const positions=o.geometry.getAttribute('position');
  for(const value of positions.array)if(!Number.isFinite(value))throw Error('Non-finite model geometry: '+o.name);
});
const perspective=new THREE.PerspectiveCamera(35,1,.1,2000);
const ortho=new THREE.OrthographicCamera(-100,100,70,-70,.1,2000);
let camera=ortho,controls,selected='all',frame=126;
const viewDirection=new THREE.Vector3(.32,.76,1).normalize();
function bindControls(target,position) {
  controls?.dispose();camera.position.copy(position);camera.lookAt(target);
  controls=new OrbitControls(camera,canvas);controls.target.copy(target);controls.enableDamping=true;
  controls.dampingFactor=.08;controls.minDistance=12;controls.maxDistance=520;
  controls.minZoom=.35;controls.maxZoom=7;controls.maxPolarAngle=Math.PI*.48;
  controls.update();
}
function focus(id) {
  selected=id;
  for(const model of models)model.group.visible=id==='all'||model.id===id;
  const model=models.find(m=>m.id===id),target=new THREE.Vector3(model?model.x:-9,model?3:2,0);
  frame=model?model.radius*1.48:126;
  const distance=frame/Math.tan(THREE.MathUtils.degToRad(35/2));
  camera.zoom=1;
  bindControls(target,target.clone().addScaledVector(viewDirection,distance));
  resize();
  document.querySelectorAll('[data-focus]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.focus===id)));
  const details={all:'Четыре масштаба в одной сцене',home:'Дом · 1 гекс · эталон масштаба',shop:'Магазин · 3 гекса · торговый зал и зона доставки',warehouse:'Склад · 7 гексов · 4 дока · фальцевая крыша',factory:'Завод · 7 гексов · 4 шеда · 3 трубы'};
  document.querySelector('#status').textContent=details[id];
}
function resize() {
  const w=innerWidth,h=innerHeight,aspect=w/h;
  renderer.setSize(w,h);
  // The overview is fitted horizontally; portrait windows retain all four models.
  const halfHeight=Math.max(frame/aspect,selected==='all'?48:frame*.65);
  ortho.left=-halfHeight*aspect;ortho.right=halfHeight*aspect;ortho.top=halfHeight;ortho.bottom=-halfHeight;
  ortho.updateProjectionMatrix();perspective.aspect=aspect;perspective.updateProjectionMatrix();
}
window.addEventListener('resize',resize);
document.querySelectorAll('[data-focus]').forEach(button=>button.addEventListener('click',()=>focus(button.dataset.focus)));
document.querySelector('#camera').addEventListener('click',()=>{
  const target=controls.target.clone(),direction=camera.position.clone().sub(target).normalize();
  const visibleHeight=camera===ortho?(ortho.top-ortho.bottom)/ortho.zoom:2*camera.position.distanceTo(target)*Math.tan(THREE.MathUtils.degToRad(perspective.fov/2));
  camera=camera===ortho?perspective:ortho;
  if(camera===ortho)ortho.zoom=(ortho.top-ortho.bottom)/visibleHeight;
  const distance=visibleHeight/(2*Math.tan(THREE.MathUtils.degToRad(perspective.fov/2)));
  bindControls(target,target.clone().addScaledVector(direction,distance));resize();
  document.querySelector('#camera').textContent=camera===ortho?'Камера: ортографическая':'Камера: перспектива';
});
document.querySelector('#reset').addEventListener('click',()=>focus(selected));
document.querySelector('#rotate').addEventListener('click',e=>{
  controls.autoRotate=!controls.autoRotate;controls.autoRotateSpeed=.65;
  e.currentTarget.setAttribute('aria-pressed',String(controls.autoRotate));
});
document.querySelector('#shadows').addEventListener('change',e=>{renderer.shadowMap.enabled=e.target.checked;scene.traverse(o=>{if(o.isMesh)o.material.needsUpdate=true;});});
document.querySelector('#exposure').addEventListener('input',e=>{renderer.toneMappingExposure=Number(e.target.value);});
document.querySelector('#capture').addEventListener('click',()=>{
  renderer.render(scene,camera);const a=document.createElement('a');a.download='razvyazka-'+selected+'.png';a.href=canvas.toDataURL('image/png');a.click();
});
focus('all');
const clock=new THREE.Clock();
function render(){requestAnimationFrame(render);controls.update(Math.min(clock.getDelta(),.1));renderer.render(scene,camera);}
render();
document.querySelector('#loading').remove();
