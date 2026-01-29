import type { DiscoveryRule } from '../DiscoveryRule.js';
import { rule as genericRule } from './generic/index.js';
import { rule as laravelRule } from './laravel/index.js';
import { rule as statamicRule } from './statamic/index.js';
import { rule as nodejsRule } from './nodejs/index.js';

/**
 * All built-in discovery rules
 *
 * Order matters: more specific rules should come first
 */
export const builtInRules: DiscoveryRule[] = [
  statamicRule,  // Most specific (requires statamic/cms)
  laravelRule,   // Framework-specific (requires laravel/framework)
  nodejsRule,    // Node.js projects
  genericRule,   // Always applies (fallback patterns)
];

// Re-export individual rules
export { rule as genericRule } from './generic/index.js';
export { rule as laravelRule } from './laravel/index.js';
export { rule as statamicRule } from './statamic/index.js';
export { rule as nodejsRule } from './nodejs/index.js';
