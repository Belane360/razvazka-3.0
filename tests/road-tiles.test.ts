import test from 'node:test';
import assert from 'node:assert/strict';
import { roadTileSpec, roadTileCenterline, pocketWidening } from '../src/core/roads/RoadTiles.ts';
import { HexRoadGraph } from '../src/core/roads/HexRoadGraph.ts';
import { neighbor } from '../src/core/hex/HexCoords.ts';
import { buildRoadTileMesh } from '../src/render/RoadTileMeshes.ts';
const mask=(...edges:number[])=>edges.reduce((m,e)=>m|1<<e,0);
test('road modules classify travel deflection consistently in all six rotations',()=>{
  for(let e=0;e<6;e++){
    assert.equal(roadTileSpec(mask(e,(e+3)%6)).kind,'straight');
    assert.equal(roadTileSpec(mask(e,(e+2)%6)).kind,'turn_60');
    assert.equal(roadTileSpec(mask(e,(e+1)%6)).kind,'turn_120');
    assert.equal(roadTileSpec(mask(e,(e+2)%6,(e+3)%6)).kind,'t_junction');
  }
});
test('adjacent straight and circular modules share exact mouth centres and tangent direction',()=>{
  for(let edge=0;edge<6;edge++)for(const difference of [1,2,3]){
    const a={q:0,r:0},b=neighbor(a,edge),other=(edge+3)%6;
    const first=roadTileCenterline(a,roadTileSpec(mask(edge,(edge+difference)%6)),()=>0);
    const second=roadTileCenterline(b,roadTileSpec(mask(other,(other+3)%6)),()=>0);
    const samples=[first.sample(0),first.sample(first.length)];
    const pair=[second.sample(0),second.sample(second.length)];
    const nearest=samples.flatMap(x=>pair.map(y=>({x,y,d:Math.hypot(x.position.x-y.position.x,x.position.z-y.position.z)}))).sort((x,y)=>x.d-y.d)[0];
    assert.ok(nearest.d<1e-8);
    assert.ok(Math.abs(nearest.x.tangent.x*nearest.y.tangent.z-nearest.x.tangent.z*nearest.y.tangent.x)<.005);
  }
});
test('pocket has four metres additional width and returns to standard seamless mouths',()=>{
  assert.equal(pocketWidening(0),0);assert.equal(pocketWidening(1),0);assert.equal(pocketWidening(.5),4);
  assert.ok(pocketWidening(.0001)<.00001);
});
test('graph decorations preserve lane routing and reject invalid pocket geometry',()=>{
  const graph=new HexRoadGraph(),h={q:0,r:0,level:'ground' as const};
  graph.addRoad(h);for(const e of [1,4])graph.addRoad({...neighbor(h,e),level:'ground'});
  const before=[...graph.lanes.keys()];graph.setRoadTile(h,'pocket');assert.equal(graph.roadTile(h).kind,'pocket');
  assert.deepEqual([...graph.lanes.keys()],before);
  graph.addRoad({...neighbor(h,0),level:'ground'});assert.throws(()=>graph.setRoadTile(h,'pocket'));
  graph.setRoadTile(h,'decel_ramp');assert.equal(graph.roadTile(h).kind,'decel_ramp');
});
test('every road module yields finite triangulated surfaces with standard material',()=>{
  for(const spec of [roadTileSpec(mask(1,4)),roadTileSpec(mask(0,2)),roadTileSpec(mask(0,1)),roadTileSpec(mask(0,2,3)),roadTileSpec(mask(1,4),'pocket'),roadTileSpec(mask(0,1,4),'decel_ramp')]){
    const group=buildRoadTileMesh({q:0,r:0},spec,()=>2);
    assert.ok(group.children.length>2);
    for(const child of group.children){const mesh=child as import('three').Mesh;const positions=mesh.geometry.getAttribute('position');assert.ok(positions.count>2);for(const n of positions.array)assert.ok(Number.isFinite(n));}
  }
});

test('isolated road tile is a compact pad without an invented unconnected arm',()=>{
  const g=buildRoadTileMesh({q:0,r:0},roadTileSpec(0),()=>0);
  assert.equal(g.children.length,1);
  const mesh=g.children[0] as import('three').Mesh;
  const a=mesh.geometry.getAttribute('position');
  for(let i=0;i<a.count;i++)assert.ok(Math.hypot(a.getX(i),a.getZ(i))<=3.00001);
});
