// Public API exports for library usage

// Core modules
export { Indexer, type IndexerOptions, type IndexStats } from './core/indexer/index.js';
export { TaskResolver, type ResolveResult } from './core/resolver/index.js';
export { CandidateDiscovery, Scorer, type DiscoveryContext, type ScorerOptions } from './core/discovery/index.js';
export { ExcerptExtractor, type ExtractionOptions } from './core/extractor/index.js';
export { PackComposer, type ComposeOptions, type ComposeInput } from './core/composer/index.js';

// Storage
export { ContextDatabase } from './storage/Database.js';

// Type exports
export * from './types/index.js';
