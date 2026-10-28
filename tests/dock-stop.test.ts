import test from 'node:test';
import assert from 'node:assert/strict';
import { HexRoadGraph } from '../src/core/roads/HexRoadGraph.ts';
import { TrafficSim } from '../src/core/simulation/TrafficSim.ts';
import { pathGeometry } from '../src/core/districts/ServiceYard.ts';
import type { DirectedLane } from '../src/core/roads/HexRoadGraph.ts';

test('truck stops at the dock before taking the outbound yard lane, then completes once',()=>{
 const g=new HexRoadGraph(()=>0);
 const a:DirectedLane={...pathGeometry([{x:0,y:0,z:0},{x:10,y:0,z:0}]),id:'yard:test:IN',nodeId:'yard:test',inEdge:0,outEdge:1,speedLimit:4,serviceId:'test',servicePart:'yard',nextLanes:['yard:test:OUT']};
 const b:DirectedLane={...pathGeometry([{x:10,y:0,z:0},{x:20,y:0,z:0}]),id:'yard:test:OUT',nodeId:'yard:test',inEdge:1,outEdge:2,speedLimit:4,serviceId:'test',servicePart:'yard',nextLanes:[]};
 g.setServiceNetwork([a,b],[]);
 const sim=new TrafficSim(g),v=sim.spawn([a,b],'truck')!;
 v.u=9.999;v.speed=4;sim.step(1/30);
 assert.equal(v.laneIndex,0);assert.equal(v.speed,0);assert.ok(v.dockWaitRemaining!>0);
 const p=sim.sample(v).position;
 sim.step(1);assert.deepEqual(sim.sample(v).position,p);assert.equal(sim.deliveries,0);
 for(let i=0;i<30;i++)sim.step(1);
 assert.equal(sim.vehicles.length,0);assert.equal(sim.deliveries,1);
});
