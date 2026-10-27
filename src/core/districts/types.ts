import type { Hex } from '../hex/HexCoords.ts';
export type DistrictFootprintType = 'single' | 'triad_3' | 'superhex_7';
export interface FacilityGate { hex: Hex; edge: number }
export interface ShopState { stock: number; maxStock: number; inFlightTrucks: number; consumptionTimer: number }
export interface WarehouseState { stock: number; capacity: number; reservedStock: number; incomingTrucks: number }
export interface FactoryState { productionBuffer: number; bufferLimit: number; productionTimer: number; productionRateSec: number }
export interface LogisticsConfig { truckPayload: number; factoryProductionRateSec: number; factoryBufferLimit: number; warehouseCapacity: number; shopMaxStock: number; shopConsumptionRateSec: number }
export const DEFAULT_LOGISTICS_CONFIG: LogisticsConfig = { truckPayload:2, factoryProductionRateSec:4, factoryBufferLimit:8, warehouseCapacity:24, shopMaxStock:10, shopConsumptionRateSec:3 };
interface FacilityBase { id: string; center: Hex; tiles: Hex[]; footprint: DistrictFootprintType; direction: number; inGate?: FacilityGate; outGate?: FacilityGate }
export type DistrictFacility = FacilityBase & (
  { type:'home'; state: Record<string,never> } |
  { type:'shop'; state: ShopState } |
  { type:'warehouse'; state: WarehouseState } |
  { type:'factory'; state: FactoryState }
);
export function logisticsConfig(overrides: Partial<LogisticsConfig> = {}): LogisticsConfig {
  const config={...DEFAULT_LOGISTICS_CONFIG,...overrides};
  for(const [key,value] of Object.entries(config)) {
    if(!Number.isFinite(value)||value<=0) throw new RangeError(`Invalid logistics config: ${key}`);
    if(!key.endsWith('Sec')&&!Number.isInteger(value)) throw new RangeError(`Expected integer: ${key}`);
  }
  if(config.truckPayload>Math.min(config.shopMaxStock,config.warehouseCapacity,config.factoryBufferLimit)) throw new RangeError('Payload exceeds storage capacity');
  return config;
}
