import test from 'node:test';
import assert from 'node:assert/strict';
import {DistrictManager} from '../src/core/districts/DistrictManager.ts';
import {HexRoadGraph} from '../src/core/roads/HexRoadGraph.ts';
import {HexMap} from '../src/core/hex/HexMap.ts';
import {hexKey,neighbor,ring} from '../src/core/hex/HexCoords.ts';
const center={q:0,r:0};
function fixture(){const map=new HexMap(5),graph=new HexRoadGraph(()=>4),districts=new DistrictManager(graph,()=>map);return {map,graph,districts};}
test('Factory reserves center plus six neighbors under a single facility ID',()=>{
  const {map,districts:d}=fixture();d.place(center,'Factory');
  assert.equal(d.facilities.size,1);const f=[...d.facilities.values()][0];
  assert.equal(f.footprint,'superhex_7');assert.equal(f.tiles.length,7);
  assert.deepEqual(new Set(f.tiles.map(hexKey)),new Set([center,...ring(center,1)].map(hexKey)));
  for(const h of f.tiles){assert.equal(d.occupiedBy.get(hexKey(h)),f.id);assert.equal(map.get(h)!.occupiedBy,f.id);}
});
test('facility placement is atomic for occupied, out-of-bounds, height and budget failures',()=>{
  for(const reason of ['occupied','bounds','height','budget']){
    const {map,graph,districts:d}=fixture();let h=center,budget=Infinity;
    if(reason==='occupied')graph.addRoad({...neighbor(center,0),level:'ground'});
    if(reason==='bounds')h={q:5,r:0};
    if(reason==='height')map.get(neighbor(center,0))!.elevation=10.01;
    if(reason==='budget'){map.get(neighbor(center,0))!.elevation=10;budget=149;}
    const heights=[...map.tiles.values()].map(t=>t.elevation);
    assert.throws(()=>d.place(h,'Factory',budget));
    assert.equal(d.zones.size,0);assert.equal(d.occupiedBy.size,0);assert.equal(d.facilities.size,0);
    assert.deepEqual([...map.tiles.values()].map(t=>t.elevation),heights);
  }
});
test('all dependent cells level to base, charge150 each and internal courtyard stays flat',()=>{
  const {map,districts:d}=fixture();for(const h of ring(center,1))map.get(h)!.elevation=10;
  assert.equal(d.place(center,'Factory',900),900);
  for(const h of [center,...ring(center,1)])assert.equal(map.height(h),4);
});
test('supported footprints are enforced and Home never groups with neighboring Home',()=>{
  const {districts:d}=fixture();d.place(center,'Home');d.place(neighbor(center,0),'Home');
  assert.equal(d.facilities.size,2);assert.ok(d.clusters.every(c=>c.tiles.length===1));
  const other=fixture().districts;other.place(center,'Warehouse');assert.equal(other.zones.size,3);
  assert.throws(()=>fixture().districts.place(center,'Factory',Infinity,'triad_3'));
});
test('A* crosses facility IN to OUT and rejects entry through OUT',()=>{
  const {graph,districts:d}=fixture();d.place(center,'Factory');
  for(const h of ring(center,2))graph.addRoad({...h,level:'ground'});
  const f=[...d.facilities.values()][0];
  const route=graph.serviceRoute(f.id,'IN','OUT');assert.ok(route?.length);
  assert.equal(graph.serviceRoute(f.id,'OUT','IN'),null);
  for(const lane of route!)for(let i=0;i<=10;i++){assert.equal(lane.sample(lane.length*i/10).position.y,4);assert.equal(lane.sample(lane.length*i/10).grade,0);}
});
test('demolition from any member releases entire footprint and all service lanes',()=>{
  for(const member of [center,neighbor(center,2)]){
    const {map,graph,districts:d}=fixture();d.place(center,'Factory');for(const h of ring(center,2))graph.addRoad({...h,level:'ground'});
    const f=[...d.facilities.values()][0];d.remove(member);
    assert.equal(d.facilities.size,0);assert.equal(d.occupiedBy.size,0);assert.equal(d.zones.size,0);
    for(const h of f.tiles)assert.equal(map.get(h)!.occupiedBy,undefined);
    assert.ok(![...graph.lanes.values()].some(l=>l.serviceId===f.id));
  }
});
