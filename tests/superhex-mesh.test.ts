import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {HexMeshBuilder} from '../src/render/HexMeshBuilder.ts';
import {complexLayout} from '../src/core/districts/ServiceYard.ts';
import {DistrictManager} from '../src/core/districts/DistrictManager.ts';
import {HexMap} from '../src/core/hex/HexMap.ts';
import {HexRoadGraph} from '../src/core/roads/HexRoadGraph.ts';
import {hexKey,ring,neighbor,worldToHex} from '../src/core/hex/HexCoords.ts';
function scene(type:'Factory'|'Warehouse'|'Shop',shape:'superhex_7'|'triad_3'){
 const map=new HexMap(4),roads=new HexRoadGraph(()=>4),districts=new DistrictManager(roads,()=>map);
 districts.place({q:0,r:0},type,Infinity,shape);
 for(const h of ring({q:0,r:0},2))if(!districts.occupiedBy.has(hexKey(h)))roads.addRoad({...h,level:'ground'});
 const game={map,roads,districts,terrainAt:(h:{q:number;r:number},x:number,z:number)=>map.flattened.has(hexKey(h))?map.height(h):map.surfaceAt(x,z)};
 const builder=new HexMeshBuilder();builder.build(game);return{builder,districts};
}
test('superhex has one monumental body, three docks, unified flat apron and no internal tile edges',()=>{
 const{builder,districts}=scene('Factory','superhex_7'),f=[...districts.facilities.values()][0];
 const group=builder.root.getObjectByName(`complex:${f.id}`);assert.ok(group);
 assert.equal(group.children.filter(o=>o.name.startsWith('dock:')).length,3);
 const body=group.getObjectByName(`body:${f.id}`) as THREE.Mesh;assert.ok(body);
 body.geometry.computeBoundingBox();assert.equal(body.geometry.boundingBox!.getSize(new THREE.Vector3()).y,9);
 for(const h of f.tiles)assert.equal(builder.root.getObjectByName(`building:${hexKey(h)}`),undefined);
 const grid=builder.root.getObjectByName('grid:0,0') as THREE.LineSegments;assert.equal(grid.geometry.getAttribute('position').count,0);
 const apron=builder.root.getObjectByName(`apron:${f.id}`) as THREE.Mesh;const p=apron.geometry.getAttribute('position');
 assert.ok(p.count>0);for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i))<1e-5);
 assert.equal(apron.position.y,.19);
 assert.equal(group.children.filter(o=>o.name.startsWith('stack:')).length,2);
});
test('warehouse uses continuous gabled roof with skylights; triad shop remains retail',()=>{
 for(const [type,shape] of [['Warehouse','superhex_7'],['Warehouse','triad_3'],['Shop','triad_3']] as const){
 const{builder,districts}=scene(type,shape),f=[...districts.facilities.values()][0],g=builder.root.getObjectByName(`complex:${f.id}`)!;assert.ok(g);
 assert.ok(g.children.some(o=>o.name.startsWith(type==='Shop'?'shopfront:':'skylight:')));
 assert.ok(!g.children.some(o=>o.name.startsWith('stack:')));
 }
});
test('leveled facility retains exterior cuts but never builds interior retaining walls',()=>{
 const map=new HexMap(4),roads=new HexRoadGraph(()=>4),districts=new DistrictManager(roads,()=>map);
 for(const h of ring({q:0,r:0},2))map.get(h)!.elevation=9;
 districts.place({q:0,r:0},'Factory');
 const builder=new HexMeshBuilder();builder.build({map,roads,districts,terrainAt:(h:{q:number;r:number})=>map.height(h)});
 const walls=builder.root.children.filter(o=>o.name.startsWith('retaining:'));
 assert.ok(walls.length>0);assert.ok(!walls.some(o=>o.name.startsWith('retaining:0,0:')));
 for(const wall of walls)assert.equal(((wall as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex(),0xc5c6b6);
});

test('full-width yard stays in reserved tiles and clears the body in every orientation',()=>{
 for(const type of ['Warehouse','Factory'] as const)for(let direction=0;direction<6;direction++){
  const map=new HexMap(4),roads=new HexRoadGraph(()=>4),districts=new DistrictManager(roads,()=>map);
  districts.place({q:0,r:0},type,Infinity,type==='Factory'?'superhex_7':'triad_3',direction);
  const f=[...districts.facilities.values()][0];
  for(const gate of [f.inGate!,f.outGate!])roads.addRoad({...neighbor(gate.hex,gate.edge),level:'ground'});
  const layout=complexLayout(districts.clusters[0],4),halfWidth=type==='Factory'?16:7,front=type==='Factory'?0:1.5;
  for(const lane of roads.lanes.values())if(lane.servicePart==='yard')for(let i=1;i<200;i++){
   const sample=lane.sample(lane.length*i/200);
   for(const side of [-1.5,0,1.5]){
    const point={x:sample.position.x-side*sample.tangent.z,y:4,z:sample.position.z+side*sample.tangent.x};
    assert.ok(districts.occupiedBy.has(hexKey(worldToHex(point.x,point.z))),`${type} ${direction}: yard leaves footprint`);
    const p=layout.local(point);
    assert.ok(Math.abs(p.x)>=halfWidth || p.z>=front,`${type} ${direction}: yard intersects body`);
   }
  }
 }
});
