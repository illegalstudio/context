/**
 * Shared utilities used across all modules
 */

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}
