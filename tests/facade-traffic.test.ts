import test from 'node:test';
import assert from 'node:assert/strict';
import { DistrictManager } from '../src/core/districts/DistrictManager.ts';
import { complexLayout } from '../src/core/districts/ServiceYard.ts';
import { TrafficSim } from '../src/core/simulation/TrafficSim.ts';
import { HexRoadGraph } from '../src/core/roads/HexRoadGraph.ts';
import { neighbor } from '../src/core/hex/HexCoords.ts';

function fixture(direction = 0) {
  const graph = new HexRoadGraph(()=>0), districts = new DistrictManager(graph);
  districts.place({q:0,r:0}, 'Factory', Infinity, 'superhex_7', direction);
  const f = [...districts.facilities.values()][0];
  const a = {...neighbor(f.inGate!.hex,f.inGate!.edge),level:'ground' as const};
  const b = {...neighbor(f.outGate!.hex,f.outGate!.edge),level:'ground' as const};
  graph.addRoad(a);graph.addRoad(b);
  return { graph, districts, f, a, b, sim:new TrafficSim(graph,districts), layout:complexLayout(districts.clusters[0],0) };
}

test('opposing public cars pass through the frontage simultaneously and both finish',()=>{
  for(let direction=0;direction<6;direction++) {
    const {graph,a,b,sim}=fixture(direction);
    const forward=sim.spawn(graph.route(a,b),'car'),reverse=sim.spawn(graph.route(b,a),'car');
    assert.ok(forward);assert.ok(reverse);
    let concurrent=false,minimumSeparation=Infinity;
    for(let i=0;i<1800 && sim.vehicles.length;i++) {
      const first=forward.route[forward.laneIndex],second=reverse.route[reverse.laneIndex];
      if(first?.nodeId.startsWith('frontage:') && second?.nodeId.startsWith('frontage:')) {
        concurrent=true;
        const p=sim.sample(forward).position,q=sim.sample(reverse).position;
        minimumSeparation=Math.min(minimumSeparation,Math.hypot(p.x-q.x,p.z-q.z));
      }
      sim.step(1/30);
    }
    assert.ok(concurrent,'both cars should occupy the two-lane public street together');
    assert.ok(minimumSeparation>2,'opposing cars retain separate physical lanes');
    assert.equal(sim.vehicles.length,0,'opposing traffic must not deadlock');
    assert.equal(sim.deliveries,2);
  }
});

test('outgoing truck yields to an approaching frontage car and resumes after it passes',()=>{
  const {graph,a,b,sim,f}=fixture();
  const car=sim.spawn(graph.route(a,b),'car');assert.ok(car);
  const outgoing=graph.lanes.get(`yard:${f.id}:OUT`)!;
  const exit=graph.lanes.get(outgoing.nextLanes![0])!;
  const truck=sim.spawn([outgoing,exit],'truck');assert.ok(truck);
  car.laneIndex=car.route.findIndex(l=>l.nodeId.startsWith('frontage:'));
  const street=car.route[car.laneIndex];car.u=street.length-12;car.speed=2;
  truck.u=outgoing.length-5.3;truck.speed=1;
  sim.step(.5);
  assert.ok(truck.u<=outgoing.length-5.09,'truck stays behind the merge while the car approaches');
  assert.equal(truck.speed,0);
  for(let i=0;i<1800 && sim.vehicles.length;i++)sim.step(1/30);
  assert.equal(sim.vehicles.length,0,'truck should resume without manual intervention');
  assert.equal(sim.deliveries,2);
});

test('truck waits once in the pocket, reverses perpendicular to its dock, unloads once and exits',()=>{
  const {graph,sim,f,layout}=fixture();
  const inbound=graph.lanes.get(`yard:${f.id}:IN`)!,outbound=graph.lanes.get(`yard:${f.id}:OUT`)!;
  const exit=graph.lanes.get(outbound.nextLanes![0])!;
  const truck=sim.spawn([inbound,outbound,exit],'truck');assert.ok(truck);
  const seen:string[]=[];
  for(let i=0;i<2700 && sim.vehicles.length;i++) {
    sim.step(1/30);
    const completed: string[] = truck.completedServiceStops ?? [];
    for(const key of completed)if(!seen.includes(key)) {
      seen.push(key);
      const index: number=Number(key.slice(key.lastIndexOf(':')+1));
      const stop: {distance:number;seconds:number;kind:'waiting'|'dock'}=inbound.serviceStops![index];
      assert.equal(truck.dockWaitRemaining,stop.seconds);
      assert.ok(Math.abs(truck.u-stop.distance)<1e-8);
      assert.equal(truck.speed,0);
      if(stop.kind==='dock') {
        const sample=sim.sample(truck),p=layout.local(sample.position);
        assert.ok(Math.abs(p.x)<1e-8 && Math.abs(p.z-3)<1e-8);
        assert.ok(sample.tangent.x*layout.front.x+sample.tangent.z*layout.front.z>.999,'cab faces away from the dock while reversing trailer toward it');
        const motion=inbound.sample(inbound.length).tangent;
        assert.ok(motion.x*sample.tangent.x+motion.z*sample.tangent.z<-.999);
      }
      const previous: number=truck.u;
      sim.step(stop.seconds-.1);
      assert.equal(truck.u,previous,'vehicle stays still for the configured dwell');
      assert.ok((truck.dockWaitRemaining??0)>0);
    }
  }
  assert.equal(seen.length,2);
  assert.equal(new Set(truck.completedServiceStops).size,2);
  assert.equal(sim.deliveries,1);
  assert.equal(sim.vehicles.length,0);
});
