/**
 * Module C - imports from A
 * Part of a circular dependency: A -> B -> C -> A
 */

// Note: This import completes the cycle
import { type ItemA } from './a.js';

export interface ItemC {
  id: string;
  active: boolean;
  relatedA?: ItemA;
}

export function processC(item: ItemC): ItemC {
  console.log('Processing in C:', item.id);
  // Using type from A without calling functions to break runtime cycle
  return {
    ...item,
    active: true,
  };
}

export function createItemC(active: boolean): ItemC {
  return {
    id: `c-${Date.now()}`,
    active,
  };
}
