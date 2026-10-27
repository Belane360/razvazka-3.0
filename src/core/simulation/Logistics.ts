import type { DistrictFacility, LogisticsConfig } from '../districts/types.ts';
import { distance } from '../hex/HexCoords.ts';

export type SpawnLogisticsTruck = (
  from: DistrictFacility,
  to: DistrictFacility,
  payload: number,
) => boolean;

const byId = (a: DistrictFacility, b: DistrictFacility): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function nearestTo(target: DistrictFacility) {
  return (a: DistrictFacility, b: DistrictFacility): number =>
    distance(a.center, target.center) - distance(b.center, target.center) || byId(a, b);
}

/** Split time before adding it so even a large finite dt cannot overflow the timer. */
function elapsedCycles(timer: number, dt: number, period: number) {
  const remainder = timer % period + dt % period;
  const tolerance = period * 1e-12;
  const extra = Math.floor((remainder + tolerance) / period);
  return {
    cycles: Math.floor(timer / period) + Math.floor(dt / period) + extra,
    remainder: Math.max(0, remainder - extra * period),
  };
}

/** Advance persistent inventory and place only orders confirmed by the routing layer.
 * The callback creates the vehicle; this function alone commits dispatch counters.
 * Delivery and cancellation bookkeeping belongs to the shipment owner.
 */
export function updateLogisticsTick(
  dt: number,
  facilities: DistrictFacility[],
  config: LogisticsConfig,
  spawnTruckFn: SpawnLogisticsTruck,
): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const payload = config.truckPayload;
  if (!Number.isFinite(payload) || payload <= 0 ||
      !Number.isFinite(config.shopConsumptionRateSec) || config.shopConsumptionRateSec <= 0) return;
  const shops = facilities.filter(f => f.type === 'shop').sort(byId);
  const warehouses = facilities.filter(f => f.type === 'warehouse').sort(byId);
  const factories = facilities.filter(f => f.type === 'factory').sort(byId);

  for (const shop of shops) {
    const state = shop.state;
    const elapsed = elapsedCycles(state.consumptionTimer, dt, config.shopConsumptionRateSec);
    state.stock = Math.max(0, state.stock - elapsed.cycles);
    state.consumptionTimer = elapsed.remainder;
  }
  for (const factory of factories) {
    const state = factory.state;
    if (!Number.isFinite(state.productionRateSec) || state.productionRateSec <= 0) continue;
    const elapsed = elapsedCycles(state.productionTimer, dt, state.productionRateSec);
    state.productionBuffer = Math.min(state.bufferLimit, state.productionBuffer + elapsed.cycles);
    // Time spent at capacity is lost; clearing the buffer cannot release a backlog.
    state.productionTimer = state.productionBuffer >= state.bufferLimit ? 0 : elapsed.remainder;
  }

  for (const shop of shops) {
    for (const warehouse of [...warehouses].sort(nearestTo(shop))) {
      while (shop.state.maxStock - shop.state.stock - shop.state.inFlightTrucks * payload >= payload &&
             warehouse.state.stock - warehouse.state.reservedStock >= payload) {
        if (!spawnTruckFn(warehouse, shop, payload)) break;
        warehouse.state.reservedStock += payload;
        shop.state.inFlightTrucks++;
      }
    }
  }
  for (const warehouse of warehouses) {
    for (const factory of [...factories].sort(nearestTo(warehouse))) {
      while (warehouse.state.capacity - warehouse.state.stock - warehouse.state.incomingTrucks * payload >= payload &&
             factory.state.productionBuffer >= payload) {
        if (!spawnTruckFn(factory, warehouse, payload)) break;
        factory.state.productionBuffer -= payload;
        warehouse.state.incomingTrucks++;
      }
    }
  }
}
