// Core types for Context Packer

export interface FileMetadata {
  path: string;
  language: string;
  size: number;
  mtime: number;
  hash: string;
}

export interface Symbol {
  id?: number;
  filePath: string;
  name: string;
  kind: 'class' | 'function' | 'method' | 'interface' | 'constant' | 'variable';
  startLine: number;
  endLine: number;
  signature?: string;
}

export interface ImportRelation {
  sourcePath: string;
  targetPath: string;
  symbol?: string; // null = whole file import
}

export interface GitSignal {
  path: string;
  lastModified?: string;
  commitCount: number;
  churnScore: number;
}

export interface ResolvedTask {
  raw: string;
  keywords: string[];
  filesHint: string[];
  symbols: string[];
  domains: string[];
  changeType: 'bugfix' | 'feature' | 'refactor' | 'perf' | 'security' | 'unknown';
  confidence: TaskConfidence;
}

export interface TaskConfidence {
  overall: number;
  signals: {
    hasExactFileName: boolean;
    hasClassName: boolean;
    hasMethodName: boolean;
    hasRoutePattern: boolean;
    hasErrorCode: boolean;
    keywordMatchCount: number;
  };
}

export interface Candidate {
  path: string;
  score: number;
  reasons: string[];
  signals: CandidateSignals;
}

export interface CandidateSignals {
  stacktraceHit: boolean;
  diffHit: boolean;
  symbolMatch: boolean;
  keywordMatch: boolean;
  graphRelated: boolean;
  testFile: boolean;
  gitHotspot: boolean;
}

export interface Excerpt {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

export interface PackManifest {
  version: string;
  timestamp: string;
  task: ResolvedTask;
  files: Array<{
    path: string;
    score: number;
    reasons: string[];
    excerptRange?: { start: number; end: number };
  }>;
  budgetTokens: number;
  commitBase?: string;
  tags: string[];
}

export interface PackOptions {
  task?: string;
  error?: string;
  diff?: string;
  file?: string;
  symbol?: string;
  maxFiles?: number;
  include?: string[];
  exclude?: string[];
  focus?: string[];
  format?: ('md' | 'json')[];
  snapshot?: 'none' | 'excerpts' | 'full';
  budgetTokens?: number;
  interactive?: boolean;
}

export interface IndexerConfig {
  rootDir: string;
  excludePatterns: string[];
  includeLanguages: string[];
}

export interface StacktraceEntry {
  file: string;
  line: number;
  column?: number;
  function?: string;
  message?: string;
}

export interface DiffEntry {
  file: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}
