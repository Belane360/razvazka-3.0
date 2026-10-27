import test from 'node:test';
import assert from 'node:assert/strict';
import { HexRoadGraph } from '../src/core/roads/HexRoadGraph.ts';
import { DistrictManager, facilityFootprint } from '../src/core/districts/DistrictManager.ts';
import { HexMap } from '../src/core/hex/HexMap.ts';
import { complexLayout } from '../src/core/districts/ServiceYard.ts';
import { GameState } from '../src/core/GameState.ts';
import { hexKey, neighbor, ring } from '../src/core/hex/HexCoords.ts';
import type { Vehicle } from '../src/core/simulation/TrafficSim.ts';

const center={q:2,r:4};
test('triad earthwork charges changed cells once and insufficient budget changes nothing',()=>{
 for(const enough of [false,true]){
  const g=new GameState(),tiles=facilityFootprint(center,'triad_3');
  for(const [i,h] of tiles.entries())g.map.get(h)!.elevation=i===1?10:4;
  g.budget=enough?270:269;
  assert.equal(g.build(center,'Warehouse','ground',0,3),enough);
  assert.equal(g.budget,enough?0:269);
  assert.equal(g.map.height(tiles[1]),enough?4:10);
  assert.equal(!!g.districts.facilityAt(center),enough);
  void g.districts.clusters;assert.equal(g.budget,enough?0:269);
 }
});
test('flat triad charges placement only and excessive height rejects the entire footprint',()=>{
 for(const delta of [0,6.001,-6.001]){
  const g=new GameState(),tiles=facilityFootprint(center,'triad_3'),budget=g.budget;
  for(const h of tiles)g.map.get(h)!.elevation=4;
  g.map.get(tiles[1])!.elevation+=delta;
  assert.equal(g.build(center,'Warehouse','ground',0,3),delta===0);
  assert.equal(g.budget,budget-(delta===0?120:0));
  assert.equal(g.map.height(tiles[1]),4+delta);
 }
});
test('all six orientations retain opposing fixed gates and keep yard paths outside the hall',()=>{
 for(const shape of ['triad_3','superhex_7'] as const)for(let direction=0;direction<6;direction++){
  const map=new HexMap(5),roads=new HexRoadGraph(()=>4),d=new DistrictManager(roads,()=>map),h={q:0,r:0};
  d.place(h,shape==='triad_3'?'Warehouse':'Factory',Infinity,shape,direction);
  const f=d.facilityAt(h)!;const gates=structuredClone([f.inGate,f.outGate]);
  for(const cell of ring(h,2))if(!d.facilityAt(cell))roads.addRoad({...cell,level:'ground'});
  for(const gate of [f.inGate!,f.outGate!])roads.addRoad({...neighbor(gate.hex,gate.edge),level:'ground'});
  assert.equal((f.inGate!.edge+3)%6,f.outGate!.edge);
  const c=d.clusterAt(h)!,layout=complexLayout(c,4),yard=roads.serviceRoute(f.id,'IN','OUT');assert.ok(yard?.length);
  assert.equal(roads.serviceRoute(f.id,'OUT','IN'),null);
  for(const lane of yard!)for(let i=0;i<=100;i++){
   const sample=lane.sample(lane.length*i/100),p=layout.local(sample.position);
   assert.equal(sample.position.y,4);assert.equal(sample.grade,0);
   const halfWidth=shape==='superhex_7'?16:9,minZ=shape==='superhex_7'?-13:-5.5,maxZ=shape==='superhex_7'?0:1.5;
   assert.ok(!(Math.abs(p.x)<halfWidth&&p.z>minZ&&p.z<maxZ),`hall intersection ${shape} direction ${direction}`);
  }
  const road=neighbor(f.inGate!.hex,f.inGate!.edge);roads.removeRoad({...road,level:'ground'});
  assert.deepEqual([f.inGate,f.outGate],gates);
 }
});
function shipmentFixture(kind:'factory'|'warehouse'){
 const g=new GameState(23,{factoryProductionRateSec:100000,shopConsumptionRateSec:100000});
 const f=[...g.districts.facilities.values()].find(f=>f.type==='factory')!;
 const w=[...g.districts.facilities.values()].find(f=>f.type==='warehouse')!;
 const s=[...g.districts.facilities.values()].find(f=>f.type==='shop')!;
 assert.equal(f.type,'factory');assert.equal(w.type,'warehouse');assert.equal(s.type,'shop');
 if(f.type!=='factory'||w.type!=='warehouse'||s.type!=='shop')throw Error('fixture');
 if(kind==='factory')f.state.productionBuffer=2;else {w.state.stock=2;s.state.stock=8;}
 g.sim.step(1/30);const v=g.sim.vehicles.find(v=>v.shipment);assert.ok(v,'connected facilities dispatch a real shipment');
 return {g,f,w,s,v};
}
function complete(g:GameState,v:Vehicle){
 v.laneIndex=v.route.length-1;v.u=v.route.at(-1)!.length-.001;v.speed=4;
 g.sim.step(1/30);
}
test('factory to warehouse shipment follows continuous road and yard route and settles once',()=>{
 const {g,f,w,v}=shipmentFixture('factory');
 assert.equal(f.state.productionBuffer,0);assert.equal(w.state.incomingTrucks,1);
 for(let i=1;i<v.route.length;i++){
  const a=v.route[i-1].sample(v.route[i-1].length).position,b=v.route[i].sample(0).position;
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<1e-5,`${v.route[i-1].id} -> ${v.route[i].id}`);
 }
 assert.ok(v.route[0].id.endsWith(':OUT'));
 complete(g,v);assert.equal(w.state.stock,2);assert.equal(w.state.incomingTrucks,0);assert.equal(g.sim.deliveries,1);
 g.sim.step(1);assert.equal(w.state.stock,2);assert.equal(g.sim.deliveries,1);
});
test('warehouse stock stays reserved until successful shop delivery and settles once',()=>{
 const {g,w,s,v}=shipmentFixture('warehouse');
 assert.equal(w.state.stock,2);assert.equal(w.state.reservedStock,2);assert.equal(s.state.inFlightTrucks,1);
 complete(g,v);assert.equal(w.state.stock,0);assert.equal(w.state.reservedStock,0);assert.equal(s.state.stock,10);assert.equal(s.state.inFlightTrucks,0);
 g.sim.step(1);assert.equal(s.state.stock,10);assert.equal(g.sim.deliveries,1);
});
test('demolishing any destination member cancels once and returns factory cargo',()=>{
 for(const member of [0,1,2]){
  const {g,f,w,v}=shipmentFixture('factory'),tiles=[...w.tiles];
  g.districts.remove(tiles[member]);assert.ok(!g.sim.vehicles.includes(v));assert.equal(f.state.productionBuffer,2);
  for(const h of tiles)assert.equal(g.districts.occupiedBy.has(hexKey(h)),false);
  assert.ok(![...g.roads.lanes.values()].some(l=>l.serviceId===w.id));
  g.sim.step(1);assert.equal(f.state.productionBuffer,2);assert.equal(g.sim.deliveries,0);
 }
});
test('demolishing source releases destination incoming reservation without delivery',()=>{
 const {g,f,w,v}=shipmentFixture('factory');g.districts.remove(f.tiles[4]);
 assert.ok(!g.sim.vehicles.includes(v));assert.equal(w.state.incomingTrucks,0);assert.equal(w.state.stock,0);g.sim.step(1);assert.equal(g.sim.deliveries,0);
});
test('shop demolition releases outgoing warehouse reservation without spending its stock',()=>{
 const {g,w,s,v}=shipmentFixture('warehouse');g.districts.remove(s.center);
 assert.ok(!g.sim.vehicles.includes(v));assert.equal(w.state.stock,2);assert.equal(w.state.reservedStock,0);assert.equal(g.sim.deliveries,0);
});
test('removing required gate road cancels shipment and releases cargo bookkeeping',()=>{
 const {g,f,w,v}=shipmentFixture('factory'),gate=w.inGate!;
 g.roads.removeRoad({...neighbor(gate.hex,gate.edge),level:'ground'});g.sim.step(1/30);
 assert.ok(!g.sim.vehicles.includes(v));assert.equal(f.state.productionBuffer,2);assert.equal(w.state.incomingTrucks,0);assert.equal(w.state.stock,0);assert.equal(g.sim.deliveries,0);
});
test('reset discards active shipments and initializes every inventory with new config',()=>{
 const {g,f,w,s}=shipmentFixture('factory');
 g.sim.reset({truckPayload:3,factoryProductionRateSec:2,factoryBufferLimit:9,warehouseCapacity:30,shopMaxStock:12,shopConsumptionRateSec:4});
 assert.equal(g.sim.vehicles.length,0);assert.equal(g.sim.time,0);assert.equal(g.sim.deliveries,0);
 assert.deepEqual(f.state,{productionBuffer:0,bufferLimit:9,productionTimer:0,productionRateSec:2});
 assert.deepEqual(w.state,{stock:0,capacity:30,reservedStock:0,incomingTrucks:0});
 assert.deepEqual(s.state,{stock:12,maxStock:12,inFlightTrucks:0,consumptionTimer:0});
 g.sim.step(2);assert.equal(f.state.productionBuffer,1);
});
