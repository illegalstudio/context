/**
 * Module B - imports from C
 * Part of a circular dependency: A -> B -> C -> A
 */

import { processC } from './c.js';

export interface ItemB {
  id: string;
  value: number;
  dataFromC?: boolean;
}

export function processB(item: ItemB): ItemB {
  console.log('Processing in B:', item.id);
  // This continues the circular dependency
  const cResult = processC({ id: item.id, active: true });
  return {
    ...item,
    dataFromC: cResult.active,
  };
}

export function createItemB(value: number): ItemB {
  return {
    id: `b-${Date.now()}`,
    value,
  };
}
