/**
 * Module A - imports from B
 * Part of a circular dependency: A -> B -> C -> A
 */

import { processB } from './b.js';

export interface ItemA {
  id: string;
  name: string;
  dataFromB?: string;
}

export function processA(item: ItemA): ItemA {
  console.log('Processing in A:', item.id);
  // This creates a circular dependency
  const bResult = processB({ id: item.id, value: 100 });
  return {
    ...item,
    dataFromB: `processed-${bResult.value}`,
  };
}

export function createItemA(name: string): ItemA {
  return {
    id: `a-${Date.now()}`,
    name,
  };
}
