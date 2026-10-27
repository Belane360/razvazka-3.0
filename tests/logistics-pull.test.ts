import test from 'node:test';
import assert from 'node:assert/strict';
import { updateLogisticsTick } from '../src/core/simulation/Logistics.ts';
import { DEFAULT_LOGISTICS_CONFIG as config } from '../src/core/districts/types.ts';
import type { DistrictFacility } from '../src/core/districts/types.ts';
const base = (id: string, q = 0) => ({ id, center:{q,r:0}, tiles:[{q,r:0}], footprint:'single' as const, direction:0 });
const shop = (id='s') => ({...base(id),type:'shop' as const,state:{stock:10,maxStock:10,inFlightTrucks:0,consumptionTimer:0}});
const warehouse = (id='w', q=1, stock=24) => ({...base(id,q),type:'warehouse' as const,state:{stock,capacity:24,reservedStock:0,incomingTrucks:0}});
const factory = () => ({...base('f',3),type:'factory' as const,state:{productionBuffer:0,bufferLimit:8,productionTimer:0,productionRateSec:2}});
const neverSpawn=()=>false;

test('factory produces three units at six seconds with two-second rate and retains residual',()=>{
 const f=factory(); updateLogisticsTick(6,[f],config,neverSpawn); assert.equal(f.state.productionBuffer,3);
 updateLogisticsTick(1.5,[f],config,neverSpawn); assert.equal(f.state.productionTimer,1.5);
 updateLogisticsTick(.5,[f],config,neverSpawn); assert.equal(f.state.productionBuffer,4);
});
test('full warehouse blocks shipments and production caps without backlog',()=>{
 const f=factory(),w=warehouse(); let calls=0;
 updateLogisticsTick(60,[w,f],config,()=>{calls++;return true;});
 assert.equal(calls,0);assert.equal(f.state.productionBuffer,8);assert.equal(f.state.productionTimer,0);
 f.state.productionBuffer=0;updateLogisticsTick(1,[f],config,neverSpawn);assert.equal(f.state.productionBuffer,0);
});
test('shop requests exactly a complete payload deficit and accounts for trucks in flight',()=>{
 const s=shop(),w=warehouse();let calls=0;const spawn=()=>{calls++;return true;};
 updateLogisticsTick(3,[s,w],config,spawn);assert.equal(s.state.stock,9);assert.equal(calls,0);
 updateLogisticsTick(3,[s,w],config,spawn);assert.equal(s.state.stock,8);assert.equal(calls,1);assert.equal(w.state.reservedStock,2);
 updateLogisticsTick(1,[s,w],config,spawn);assert.equal(calls,1);assert.equal(s.state.inFlightTrucks,1);assert.equal(w.state.stock,24);
});
test('nearest inaccessible supplier falls back deterministically without failed reservations',()=>{
 const s=shop(),a=warehouse('a',1),b=warehouse('b',1),far=warehouse('far',5);s.state.stock=8;const attempts:string[]=[];
 updateLogisticsTick(.1,[far,b,s,a],config,(from,to,payload)=>{attempts.push(from.id);assert.equal(to.id,s.id);assert.equal(payload,2);return from.id==='b';});
 assert.deepEqual(attempts,['a','b']);assert.equal(a.state.reservedStock,0);assert.equal(b.state.reservedStock,2);assert.equal(s.state.inFlightTrucks,1);
});
test('failed spawn changes no shipment counters or production buffer',()=>{
 const s=shop(),w=warehouse(),f=factory();s.state.stock=8;f.state.productionBuffer=4;w.state.stock=4;
 updateLogisticsTick(.1,[s,w,f],config,neverSpawn);
 assert.equal(s.state.inFlightTrucks,0);assert.equal(w.state.reservedStock,0);assert.equal(w.state.incomingTrucks,0);assert.equal(f.state.productionBuffer,4);
});
test('warehouse replenishment counts incoming trucks and reserves no more than capacity',()=>{
 const f=factory(),w=warehouse('w',1,20);f.state.productionBuffer=8;
 updateLogisticsTick(.1,[w,f],config,()=>true);
 assert.equal(w.state.incomingTrucks,2);assert.equal(f.state.productionBuffer,4);assert.equal(w.state.stock,20);
 updateLogisticsTick(.1,[w,f],config,()=>true);assert.equal(w.state.incomingTrucks,2);
});
test('shop cannot reserve warehouse stock already committed to another shop',()=>{
 const a=shop('a'),b=shop('b'),w=warehouse('w',1,2);a.state.stock=b.state.stock=8;
 updateLogisticsTick(.1,[b,w,a],config,()=>true);assert.equal(a.state.inFlightTrucks,1);assert.equal(b.state.inFlightTrucks,0);
});
test('partitioned time retains the same consumption and production residuals',()=>{
 const a=shop(),b=shop(),f=factory(),g=factory();
 updateLogisticsTick(7.25,[a,f],config,neverSpawn);
 for(const dt of [1,.25,2,4])updateLogisticsTick(dt,[b,g],config,neverSpawn);
 assert.deepEqual(a.state,b.state);assert.deepEqual(f.state,g.state);
 updateLogisticsTick(100,[a],config,neverSpawn);assert.equal(a.state.stock,0);
});
test('invalid elapsed time does not mutate state or spawn trucks',()=>{
 const s=shop(),f=factory();const before=structuredClone([s,f]);
 for(const dt of [-1,NaN,Infinity,0])updateLogisticsTick(dt,[s,f],config,()=>assert.fail('invalid dt spawned'));
 assert.deepEqual([s,f],before);
});
