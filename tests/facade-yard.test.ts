import test from 'node:test';
import assert from 'node:assert/strict';
import {DistrictManager} from '../src/core/districts/DistrictManager.ts';
import {complexLayout} from '../src/core/districts/ServiceYard.ts';
import {TrafficSim} from '../src/core/simulation/TrafficSim.ts';
import {HexRoadGraph} from '../src/core/roads/HexRoadGraph.ts';
import {hexKey,neighbor,worldToHex} from '../src/core/hex/HexCoords.ts';

test('superhex gates and entire service lane stay on southern cells in all six orientations',()=>{
 for(const type of ['Factory','Warehouse'] as const)for(let direction=0;direction<6;direction++){
  const graph=new HexRoadGraph(()=>0),districts=new DistrictManager(graph);
  const center={q:3,r:-2};districts.place(center,type,Infinity,'superhex_7',direction);
  const facility=[...districts.facilities.values()][0];
  assert.deepEqual(facility.inGate,{hex:neighbor(center,(direction+1)%6),edge:(direction+1)%6});
  assert.deepEqual(facility.outGate,{hex:neighbor(center,(direction+3)%6),edge:(direction+3)%6});
  for(const gate of [facility.inGate!,facility.outGate!])graph.addRoad({...neighbor(gate.hex,gate.edge),level:'ground'});
  const layout=complexLayout(districts.clusters[0],0);
  const route=graph.serviceRoute(facility.id,'IN','OUT');assert.ok(route);assert.equal(route.length,2);
  assert.equal(graph.serviceRoute(facility.id,'OUT','IN'),null);
  const dock=layout.local(route[0].sample(route[0].length).position);
  assert.ok(Math.abs(dock.x)<1e-9);assert.ok(Math.abs(dock.z-3)<1e-9);
  assert.deepEqual(route[0].sample(route[0].length).position,route[1].sample(0).position);
  for(const lane of route)for(let i=1;i<300;i++){
   const {position,tangent}=lane.sample(lane.length*i/300);
   for(const side of [-1.5,0,1.5]){
    const p={x:position.x-side*tangent.z,y:0,z:position.z+side*tangent.x};
    assert.ok(districts.occupiedBy.has(hexKey(worldToHex(p.x,p.z))));
    assert.ok(layout.local(p).z>=1.5-1e-8,'service lane never loops behind the northern building');
   }
  }
 }
});

test('frontage routes public traffic both ways while delivery still visits the dock',()=>{
 for(let direction=0;direction<6;direction++){
  const graph=new HexRoadGraph(()=>0),districts=new DistrictManager(graph);
  districts.place({q:0,r:0},'Factory',Infinity,'superhex_7',direction);
  const f=[...districts.facilities.values()][0];
  const a={...neighbor(f.inGate!.hex,f.inGate!.edge),level:'ground' as const};
  const b={...neighbor(f.outGate!.hex,f.outGate!.edge),level:'ground' as const};
  graph.addRoad(a);graph.addRoad(b);
  for(const [from,to] of [[a,b],[b,a]]){
   const route=graph.route(from,to);assert.ok(route.length);
   assert.ok(route.some(l=>l.id.includes(':TRANSIT:')));
   assert.ok(route.every(l=>!l.serviceId||l.publicTransit));
   for(let i=1;i<route.length;i++){
    const p=route[i-1].sample(route[i-1].length).position,q=route[i].sample(0).position;
    assert.ok(Math.hypot(p.x-q.x,p.z-q.z)<1e-8);
   }
  }
  const starts=graph.lanesAt(a).filter(l=>l.inEdge===-1);
  const targets=[...graph.lanes.values()].filter(l=>l.serviceId===f.id&&!l.publicTransit&&l.outEdge===-1).map(l=>l.id);
  const delivery=graph.routeLanes(starts,targets,new Set([f.id]));
  assert.ok(delivery.some(l=>l.id===`yard:${f.id}:IN`));
  assert.ok(delivery.some(l=>l.id===`yard:${f.id}:OUT`));
  assert.ok(!delivery.some(l=>l.publicTransit));
  for(const lane of graph.lanes.values())if(lane.publicTransit&&lane.nodeId.startsWith('frontage:'))for(let i=1;i<300;i++){
   const s=lane.sample(lane.length*i/300);
   for(const side of [-1.5,1.5])assert.ok(districts.occupiedBy.has(hexKey(worldToHex(s.position.x-side*s.tangent.z,s.position.z+side*s.tangent.x))),`frontage width ${direction}`);
  }
  districts.remove(f.center);assert.equal(graph.route(a,b).length,0);
 }
});

test('delivery lane provides distance-based waiting and dock stops, public street has none',()=>{
 for(const shape of ['superhex_7','triad_3'] as const){
  const graph=new HexRoadGraph(()=>0),districts=new DistrictManager(graph);
  districts.place({q:0,r:0},'Warehouse',Infinity,shape);
  const f=[...districts.facilities.values()][0];
  for(const gate of [f.inGate!,f.outGate!])graph.addRoad({...neighbor(gate.hex,gate.edge),level:'ground'});
  const lane=graph.lanes.get(`yard:${f.id}:IN`)!,layout=complexLayout(districts.clusters[0],0);
  const stops=lane.serviceStops!;assert.equal(stops.length,shape==='superhex_7'?2:1);
  const dock=stops.at(-1)!;assert.equal(dock.kind,'dock');assert.equal(dock.seconds,3);assert.equal(dock.distance,lane.length);
  if(shape==='superhex_7'){
   const wait=stops[0],p=layout.local(lane.sample(wait.distance).position);
   assert.equal(wait.kind,'waiting');assert.equal(wait.seconds,1);assert.ok(wait.distance<dock.distance);
   assert.ok(Math.abs(p.x-16)<1e-8);assert.ok(Math.abs(p.z-9)<1e-8);
  }
  for(const l of graph.lanes.values())if(l.publicTransit)assert.equal(l.serviceStops,undefined);
 }
});


test('demolishing a frontage under a public car cancels its virtual route atomically',()=>{
 const graph=new HexRoadGraph(()=>0),districts=new DistrictManager(graph),sim=new TrafficSim(graph,districts);
 districts.place({q:0,r:0},'Factory');const f=[...districts.facilities.values()][0];
 const a={...neighbor(f.inGate!.hex,f.inGate!.edge),level:'ground' as const};
 const b={...neighbor(f.outGate!.hex,f.outGate!.edge),level:'ground' as const};
 graph.addRoad(a);graph.addRoad(b);
 const car=sim.spawn(graph.route(a,b),'car');assert.ok(car);
 car.laneIndex=car.route.findIndex(l=>l.nodeId.startsWith('frontage:'));car.u=car.route[car.laneIndex].length/2;
 assert.doesNotThrow(()=>{districts.remove(f.center);sim.step(1/30);});
 assert.equal(sim.vehicles.length,0);
});
