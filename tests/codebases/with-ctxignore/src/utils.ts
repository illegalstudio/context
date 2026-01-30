/**
 * Utility functions - should be indexed
 */

export function formatMessage(msg: string): string {
  return `[APP] ${msg}`;
}

export function log(msg: string): void {
  console.log(formatMessage(msg));
}
