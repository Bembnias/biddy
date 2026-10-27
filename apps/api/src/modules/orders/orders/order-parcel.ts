// Paczka zamówienia ze snapshotu przedmiotu (F-24): opcje dostawy, wybór dostawy w checkoutcie
// (F-25) i „Nadaj” liczą się według przedmiotu z chwili zakupu, nie po późniejszych zmianach.
import type { ParcelSpec } from '../../shipping/index.js';
import type { OrderItemSnapshot } from './order-snapshot.js';

/** Paczka ze snapshotu przedmiotu z chwili zakupu (późniejsze zmiany przedmiotu się nie liczą). */
export function parcelFromSnapshot(snapshot: OrderItemSnapshot): ParcelSpec {
  const size = snapshot.item.packageSize;
  return {
    packageSize: size === 'S' || size === 'M' || size === 'L' || size === 'XL' ? size : null,
    weightGrams: snapshot.item.weightGrams,
    dimensionsCm: snapshot.item.dimensionsCm,
    allowedCarriers: snapshot.item.allowedCarriers,
  };
}
