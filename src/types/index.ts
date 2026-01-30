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
  rawWords: string[];     // Original words from task (>= 3 chars, lowercased)
  keywords: string[];
  filesHint: string[];
  symbols: string[];
  domains: string[];
  domainWeights: Record<string, number>;  // How many keywords matched each domain
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
  fileHintHit: boolean;         // File explicitly mentioned in the task (e.g., "User.php")
  fileHintExact: boolean;       // Exact filename match (User.php matches User.php, not ChatUser.php)
  symbolMatch: boolean;
  exactSymbolMention: boolean;  // File contains a symbol explicitly mentioned in the task (method/class name)
  keywordMatch: boolean;
  graphRelated: boolean;
  graphDepth?: number;    // Depth at which file was found via graph traversal (1 = direct, 2+ = transitive)
  graphDecay?: number;    // Decay factor based on graph depth (1.0 at depth 1, decreasing with depth)
  rawPathMatchCount?: number;      // Number of RAW task words (from original input) matching in file path
  filenameMatchCount?: number;     // Number of task keywords matching in the file path (2+ = very relevant)
  basenameMatchCount?: number;     // Number of keywords matching in just the filename (e.g., "ListUsers" = 2 for list+user)
  testFile: boolean;
  gitHotspot: boolean;
  relatedFile: boolean;    // Found by a discovery rule (view, component, etc.)
  exampleUsage: boolean;   // Example of similar pattern usage
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
  since?: string;
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
  verbose?: boolean;
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
