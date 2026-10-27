import { hexKey, neighbor, neighbors, hexToWorld, distance } from '../hex/HexCoords.ts';
import type { Hex } from '../hex/HexCoords.ts';
import { HexRoadGraph } from '../roads/HexRoadGraph.ts';
import type { DirectedLane, RoadAddress } from '../roads/HexRoadGraph.ts';
import type { HexMap } from '../hex/HexMap.ts';
import { serviceNetwork } from './ServiceYard.ts';
import { logisticsConfig } from './types.ts';
import type { DistrictFacility, DistrictFootprintType, FacilityGate, LogisticsConfig } from './types.ts';
export type ZoneType = 'Home' | 'Shop' | 'Factory' | 'Warehouse';
export interface Zone extends Hex { type: ZoneType; progress: number; facilityId: string; accessEdge?: number }
export interface DistrictEdge { tile: Hex; edge: number; road?: RoadAddress }
export interface AccessPort extends DistrictEdge { role: 'IN' | 'OUT'; road: RoadAddress }
export interface DistrictCluster {
  id: string; type: ZoneType; shape: DistrictFootprintType; center: Hex; direction: number;
  tiles: Zone[]; level: number; progress: number; externalEdges: DistrictEdge[];
  ports: { IN?: AccessPort; OUT?: AccessPort };
}
const forms: Record<ZoneType, DistrictFootprintType[]> = {
  Home:['single'], Shop:['single','triad_3'], Warehouse:['triad_3','superhex_7'], Factory:['superhex_7'],
};
export function defaultFootprint(type: ZoneType): DistrictFootprintType { return forms[type][0]; }
export function facilityFootprint(center: Hex, footprint: DistrictFootprintType, direction=0): Hex[] {
  if (!Number.isInteger(direction) || direction<0 || direction>5) throw new RangeError('Direction must be 0..5');
  if(footprint==='single') return [{...center}];
  if(footprint==='triad_3') return [{...center},neighbor(center,direction),neighbor(center,(direction+1)%6)];
  if(footprint==='superhex_7') return [{...center},...neighbors(center)];
  throw new RangeError('Unknown footprint');
}
export class DistrictManager {
  readonly zones = new Map<string,Zone>();
  readonly facilities = new Map<string,DistrictFacility>();
  readonly occupiedBy = new Map<string,string>();
  revision=0;
  config: LogisticsConfig;
  onFacilityRemoved?: (facility:DistrictFacility)=>void;
  private serial=0;
  private graph: HexRoadGraph;
  private terrain?: ()=>HexMap;
  constructor(graph:HexRoadGraph,terrain?:()=>HexMap,config:Partial<LogisticsConfig>={}) {
    this.graph=graph;this.terrain=terrain;this.config=logisticsConfig(config);
    graph.onRoadChange=()=>this.syncNetwork();
  }
  private newState(type:ZoneType): DistrictFacility['state'] {
    const c=this.config;
    if(type==='Shop')return {stock:c.shopMaxStock,maxStock:c.shopMaxStock,inFlightTrucks:0,consumptionTimer:0};
    if(type==='Warehouse')return {stock:0,capacity:c.warehouseCapacity,reservedStock:0,incomingTrucks:0};
    if(type==='Factory')return {productionBuffer:0,bufferLimit:c.factoryBufferLimit,productionTimer:0,productionRateSec:c.factoryProductionRateSec};
    return {};
  }
  resetLogistics(config:Partial<LogisticsConfig>={}):void {
    this.config=logisticsConfig(config);
    for(const f of this.facilities.values())f.state=this.newState(this.zones.get(hexKey(f.center))!.type);
  }
  place(h:Hex,type:ZoneType,available=Infinity,shape:DistrictFootprintType=defaultFootprint(type),direction=0):number {
    if(!forms[type].includes(shape))throw new Error('Этот размер недоступен для выбранного здания');
    const tiles=facilityFootprint(h,shape,direction),map=this.terrain?.(),base=map?.height(h)??0;
    let cost=0;
    for(const tile of tiles) {
      if(this.occupiedBy.has(hexKey(tile)) || this.graph.get({...tile,level:'ground'}) || this.graph.get({...tile,level:'elevated'}))throw new Error('Площадка занята зданием или дорогой');
      if(map&&!map.get(tile))throw new Error('Площадка выходит за пределы региона');
      if(map?.get(tile)?.biome==='water')throw new Error('Предприятие нельзя разместить на воде');
      const elevation=map?.height(tile)??base;
      if(!Number.isFinite(elevation)||Math.abs(elevation-base)>6)throw new Error('Перепад площадки превышает 6 м');
      for(const other of tiles)if(distance(tile,other)===1&&Math.abs(elevation-(map?.height(other)??base))>6)throw new Error('Перепад соседних ячеек превышает 6 м');
      if(Math.abs(elevation-base)>1e-8)cost+=150;
    }
    if(available<cost)throw new Error(`Недостаточно средств для планировки (+${cost} Cr)`);
    const id=`facility-${++this.serial}`;
    const facility={id,center:{...h},tiles,footprint:shape,direction,type:type.toLowerCase(),state:this.newState(type)} as DistrictFacility;
    if(shape!=='single') {
      const external=this.externalEdges(tiles);
      const axis=hexToWorld(neighbor({q:0,r:0},direction).q,neighbor({q:0,r:0},direction).r);
      const projection=(e:DistrictEdge)=>{const n=neighbor(e.tile,e.edge),p=hexToWorld(e.tile.q+n.q,e.tile.r+n.r);return p.x*axis.x+p.z*axis.z;};
      const input=external.filter(e=>e.edge===(direction+3)%6).sort((a,b)=>projection(a)-projection(b))[0];
      const output=external.filter(e=>e.edge===direction).sort((a,b)=>projection(b)-projection(a))[0];
      facility.inGate={hex:{...input.tile},edge:input.edge};facility.outGate={hex:{...output.tile},edge:output.edge};
    }
    this.facilities.set(id,facility);
    for(const tile of tiles){const key=hexKey(tile);this.occupiedBy.set(key,id);this.zones.set(key,{...tile,type,progress:0,facilityId:id});if(map)map.get(tile)!.occupiedBy=id;}
    if(shape!=='single')map?.flatten(tiles,base);
    this.revision++;this.syncNetwork();return cost;
  }
  remove(h:Hex):DistrictFacility|undefined {
    const f=this.facilityAt(h);if(!f)return;
    this.facilities.delete(f.id);
    for(const t of f.tiles){const key=hexKey(t);this.zones.delete(key);this.occupiedBy.delete(key);const tile=this.terrain?.().get(t);if(tile)delete tile.occupiedBy;}
    this.revision++;this.syncNetwork();this.onFacilityRemoved?.(f);return f;
  }
  facilityAt(h:Hex|string):DistrictFacility|undefined {
    const key=typeof h==='string'?h:hexKey(h);
    return this.facilities.get(key)??this.facilities.get(this.occupiedBy.get(key)??'');
  }
  private externalEdges(tiles:Hex[]):DistrictEdge[] {
    const members=new Set(tiles.map(hexKey)),result:DistrictEdge[]=[];
    for(const tile of tiles)for(let edge=0;edge<6;edge++){
      const n=neighbor(tile,edge);if(members.has(hexKey(n)))continue;
      const road=this.graph.get({...n,level:'ground'});
      result.push({tile,edge,road:road&&!road.rampId?{...n,level:'ground'}:undefined});
    }
    return result;
  }
  get clusters():DistrictCluster[] {
    return [...this.facilities.values()].map(f=>{
      const tiles=f.tiles.map(t=>this.zones.get(hexKey(t))!),externalEdges=this.externalEdges(f.tiles);
      const port=(gate:FacilityGate|undefined,role:'IN'|'OUT'):AccessPort|undefined=>{
        if(!gate)return;const e=externalEdges.find(e=>hexKey(e.tile)===hexKey(gate.hex)&&e.edge===gate.edge);
        return e?.road?{...e,role,road:e.road}:undefined;
      };
      const progress=tiles.reduce((sum,t)=>sum+t.progress,0);
      return {id:f.id,type:tiles[0].type,shape:f.footprint,center:f.center,direction:f.direction,tiles,progress,level:f.footprint==='single'?1+Math.floor(Math.sqrt(progress/12)):f.footprint==='triad_3'?2:3,externalEdges,ports:{IN:port(f.inGate,'IN'),OUT:port(f.outGate,'OUT')}};
    });
  }
  clusterAt(h:Hex|string):DistrictCluster|undefined {const f=this.facilityAt(h);return f?this.clusters.find(c=>c.id===f.id):undefined;}
  position(h:Hex){return hexToWorld(h.q,h.r,this.terrain?.().height(h)??0);}
  syncNetwork():void {
    const lanes:DirectedLane[]=[],ports:{nodeId:string;edge:number}[]=[];
    for(const c of this.clusters){
      if(c.shape==='single')continue;
      const network=serviceNetwork(c,this.graph,this.terrain?.().height(c.center)??0);lanes.push(...network.lanes);ports.push(...network.ports);
    }
    this.graph.setServiceNetwork(lanes,ports);
  }
  access(h:Hex,role:'IN'|'OUT'='IN'):RoadAddress[]{
    const c=this.clusterAt(h);if(!c)return [];
    if(c.shape!=='single')return c.ports[role]?[c.ports[role]!.road]:[];
    return c.externalEdges.filter(e=>e.road).map(e=>e.road!);
  }
  private endpoints(h:Hex,role:'IN'|'OUT'):DirectedLane[]{
    const c=this.clusterAt(h);if(!c)return [];
    if(c.shape!=='single'){
      if(!c.ports.IN||!c.ports.OUT)return [];
      return [...this.graph.lanes.values()].filter(l=>l.serviceId===c.id&&(role==='OUT'?l.id===`yard:${c.id}:OUT`:l.servicePart==='connector'&&l.inEdge>=0&&l.outEdge===-1));
    }
    return this.access(h).flatMap(a=>this.graph.lanesAt(a).filter(l=>!l.serviceId&&(role==='OUT'?l.inEdge===-1:l.outEdge===-1)));
  }
  routeTrip(source:Hex,destination:Hex,entry?:DirectedLane):DirectedLane[]{
    const from=this.clusterAt(source),to=this.clusterAt(destination);if(!to||(!entry&&!from))return [];
    const allowed=new Set([from?.id,to.id].filter((id):id is string=>!!id));if(entry?.serviceId)allowed.add(entry.serviceId);
    return this.graph.routeLanes(entry?[entry]:this.endpoints(source,'OUT'),this.endpoints(destination,'IN').map(l=>l.id),allowed);
  }
  deliver(key:string):void {const f=this.facilityAt(key),z=f&&this.zones.get(hexKey(f.center));if(z)z.progress++;}
}
