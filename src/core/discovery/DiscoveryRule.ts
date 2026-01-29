import type { ResolvedTask, CandidateSignals } from '../../types/index.js';
import type { ContextDatabase } from '../../storage/Database.js';

/**
 * Context provided to discovery rules
 */
export interface DiscoveryContext {
  task: ResolvedTask;
  candidates: Map<string, CandidateSignals>;
  db: ContextDatabase;
  rootDir: string;
}

/**
 * Base interface for discovery rules
 *
 * Discovery rules are modular plugins that add framework/tool-specific
 * heuristics for finding related files (e.g., Controller → View in Laravel)
 */
export interface DiscoveryRule {
  /**
   * Unique identifier for the rule
   */
  name: string;

  /**
   * Human-readable description for debug/logging
   */
  description: string;

  /**
   * Check if this rule applies to the current project
   * E.g., Laravel rule checks for composer.json with laravel/framework
   *
   * @param rootDir - Project root directory
   * @returns true if the rule should be applied
   */
  appliesTo(rootDir: string): boolean | Promise<boolean>;

  /**
   * Execute the discovery and find related files
   *
   * @param ctx - Discovery context with task, existing candidates, DB, etc.
   * @returns Map of newly discovered file paths and their signals
   */
  discover(ctx: DiscoveryContext): Promise<Map<string, CandidateSignals>>;

  /**
   * Ignore patterns for this rule (will be merged into .ctxignore)
   */
  ignorePatterns: string;

  /**
   * Optional weight multiplier for candidates found by this rule
   * Default is 1.0
   */
  weight?: number;
}

/**
 * Create default candidate signals with all flags set to false
 */
export function createDefaultSignals(): CandidateSignals {
  return {
    stacktraceHit: false,
    diffHit: false,
    symbolMatch: false,
    keywordMatch: false,
    graphRelated: false,
    testFile: false,
    gitHotspot: false,
    relatedFile: false,
    exampleUsage: false,
  };
}

/**
 * Merge new signals into existing signals (OR operation)
 */
export function mergeSignals(
  existing: CandidateSignals,
  newSignals: Partial<CandidateSignals>
): CandidateSignals {
  return {
    ...existing,
    ...newSignals,
  };
}
