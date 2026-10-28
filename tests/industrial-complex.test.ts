import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIndustrialComplex } from '../src/render/IndustrialComplexMesh.ts';
import { DistrictManager } from '../src/core/districts/DistrictManager.ts';
import { HexRoadGraph } from '../src/core/roads/HexRoadGraph.ts';
import { HexMap } from '../src/core/hex/HexMap.ts';
import { hexKey, worldToHex } from '../src/core/hex/HexCoords.ts';

function model(type:'Factory'|'Warehouse',direction=0) {
  const map=new HexMap(4), graph=new HexRoadGraph(()=>4), districts=new DistrictManager(graph,()=>map);
  districts.place({q:0,r:0},type,Infinity,'superhex_7',direction);
  const c=districts.clusters[0]; return {g:createIndustrialComplex(c,4),c};
}
test('northern industrial silhouettes have three docks and distinct industrial equipment',()=>{
 const {g:factory}=model('Factory'),{g:warehouse}=model('Warehouse');
 const count=(g:THREE.Group,p:string)=>g.children.filter(o=>o.name.startsWith(p)).length;
 assert.equal(count(factory,'dock:'),3);assert.equal(count(warehouse,'dock:'),3);
 assert.equal(count(factory,'shed:'),3);assert.equal(count(factory,'stack:'),2);assert.equal(count(factory,'silo:'),3);
 assert.equal(count(warehouse,'shed:'),0);assert.equal(count(warehouse,'stack:'),0);assert.equal(count(warehouse,'roof:'),2);
 assert.equal(count(warehouse,'HVAC'),4);
 const stacks=factory.children.filter(o=>o.name.startsWith('stack:')) as THREE.Mesh[];
 assert.deepEqual(stacks.map(m=>(m.geometry as THREE.CylinderGeometry).parameters.height),[16,14]);
 for(const g of [factory,warehouse]) {
  assert.ok(g.getObjectByName('waiting-pocket'));assert.ok(g.getObjectByName('frontage-street'));
  assert.ok(g.getObjectByName('industrial-pines') instanceof THREE.InstancedMesh);
  for(const o of g.children.filter(o=>o.name.startsWith('dock:')))assert.ok(o.position.z>0);
 }
});
test('apron and frontage geometry are clipped to the occupied seven cells at every orientation',()=>{
 for(let direction=0;direction<6;direction++) {
  const {g,c}=model('Factory',direction);g.updateMatrixWorld(true);
  const occupied=new Set(c.tiles.map(hexKey));
  for(const name of [`apron:${c.id}`,'frontage-street','waiting-pocket']) {
   const mesh=g.getObjectByName(name) as THREE.Mesh, p=mesh.geometry.getAttribute('position');
   for(let i=0;i<p.count;i+=3) {
    // A triangle centroid avoids ambiguous rounding exactly on a shared hex boundary.
    const v=new THREE.Vector3();for(let j=0;j<3;j++)v.add(new THREE.Vector3(p.getX(i+j),p.getY(i+j),p.getZ(i+j)));v.multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld);
    assert.ok(occupied.has(hexKey(worldToHex(v.x,v.z))),`${name}, direction ${direction}, ${v.x},${v.z}`);
   }
  }
 }
});
