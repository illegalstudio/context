/**
 * Test utility functions
 */

import fs from 'fs';
import path from 'path';
import { ContextDatabase } from '../../src/storage/Database.js';
import { createTempDir } from './setup.js';

/**
 * Create a test database in a temporary directory
 */
export function createTestDatabase(): { db: ContextDatabase; rootDir: string } {
  const rootDir = path.join(createTempDir(), `db-${Date.now()}`);
  fs.mkdirSync(rootDir, { recursive: true });
  const db = new ContextDatabase(rootDir);
  return { db, rootDir };
}

/**
 * Helper to create a mock ResolvedTask for testing
 */
export function createMockTask(overrides: Partial<{
  raw: string;
  rawWords: string[];
  keywords: string[];
  filesHint: string[];
  symbols: string[];
  domains: string[];
  domainWeights: Record<string, number>;
  changeType: string;
  confidence: { overall: number; signals: any };
}> = {}): any {
  return {
    raw: overrides.raw || 'test task',
    rawWords: overrides.rawWords || ['test', 'task'],
    keywords: overrides.keywords || ['test', 'task'],
    filesHint: overrides.filesHint || [],
    symbols: overrides.symbols || [],
    domains: overrides.domains || [],
    domainWeights: overrides.domainWeights || {},
    changeType: overrides.changeType || 'unknown',
    confidence: overrides.confidence || {
      overall: 0.5,
      signals: {
        hasExactFileName: false,
        hasClassName: false,
        hasMethodName: false,
        hasRoutePattern: false,
        hasErrorCode: false,
        keywordMatchCount: 2,
      },
    },
  };
}

/**
 * Create mock CandidateSignals
 */
export function createMockSignals(overrides: Partial<{
  stacktraceHit: boolean;
  diffHit: boolean;
  fileHintHit: boolean;
  fileHintExact: boolean;
  symbolMatch: boolean;
  exactSymbolMention: boolean;
  keywordMatch: boolean;
  graphRelated: boolean;
  graphDepth: number;
  graphDecay: number;
  rawPathMatchCount: number;
  filenameMatchCount: number;
  basenameMatchCount: number;
  testFile: boolean;
  gitHotspot: boolean;
  relatedFile: boolean;
  exampleUsage: boolean;
}> = {}): any {
  return {
    stacktraceHit: overrides.stacktraceHit || false,
    diffHit: overrides.diffHit || false,
    fileHintHit: overrides.fileHintHit || false,
    fileHintExact: overrides.fileHintExact || false,
    symbolMatch: overrides.symbolMatch || false,
    exactSymbolMention: overrides.exactSymbolMention || false,
    keywordMatch: overrides.keywordMatch || false,
    graphRelated: overrides.graphRelated || false,
    graphDepth: overrides.graphDepth,
    graphDecay: overrides.graphDecay,
    rawPathMatchCount: overrides.rawPathMatchCount,
    filenameMatchCount: overrides.filenameMatchCount,
    basenameMatchCount: overrides.basenameMatchCount,
    testFile: overrides.testFile || false,
    gitHotspot: overrides.gitHotspot || false,
    relatedFile: overrides.relatedFile || false,
    exampleUsage: overrides.exampleUsage || false,
  };
}

/**
 * Wait for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalize paths for cross-platform comparison
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
