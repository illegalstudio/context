import path from 'path';
import { Indexer } from '../../core/indexer/index.js';
import { TaskResolver } from '../../core/resolver/index.js';
import { CandidateDiscovery, Scorer } from '../../core/discovery/index.js';
import { ExcerptExtractor } from '../../core/extractor/index.js';
import { PackComposer } from '../../core/composer/index.js';
import { logger } from '../utils/logger.js';
import { createSpinner } from '../utils/spinner.js';
import type { PackOptions } from '../../types/index.js';

export async function packCommand(options: PackOptions): Promise<void> {
  const cwd = process.cwd();

  // Check if indexed
  if (!Indexer.isInitialized(cwd)) {
    logger.error('Repository not indexed. Run `context index` first.');
    process.exit(1);
  }

  // Validate we have some input
  if (!options.task && !options.error && !options.diff && !options.file) {
    logger.error('No input provided. Use --task, --error, --diff, or --file.');
    logger.blank();
    logger.dim('Examples:');
    logger.list([
      'context pack --task "Fix checkout webhook idempotency"',
      'context pack --error storage/logs/laravel.log --since 1h',
      'context pack --diff origin/main',
      'context pack --file app/Services/StripeService.php --symbol handleWebhook',
    ]);
    process.exit(1);
  }

  logger.header('Creating Context Pack');

  const spinner = createSpinner();
  let indexer: Indexer | null = null;

  try {
    // Load index
    spinner.start('Loading index...');
    indexer = new Indexer(cwd);
    const db = indexer.getDatabase();
    spinner.succeed('Index loaded');

    // Resolve task
    spinner.start('Analyzing task...');
    const resolver = new TaskResolver(cwd);
    const { task, stacktraceEntries, diffEntries } = await resolver.resolve(options);
    spinner.succeed('Task analyzed');

    // Show task analysis
    logger.blank();
    logger.info(`Confidence: ${(task.confidence.overall * 100).toFixed(0)}%`);
    if (task.keywords.length > 0) {
      logger.dim(`Keywords: ${task.keywords.slice(0, 5).join(', ')}`);
    }
    if (task.domains.length > 0) {
      logger.dim(`Domains: ${task.domains.join(', ')}`);
    }
    if (task.changeType !== 'unknown') {
      logger.dim(`Type: ${task.changeType}`);
    }
    logger.blank();

    // Check for vague task
    if (resolver.isTaskVague(task)) {
      logger.warning('Task is vague. Consider providing more specific information:');
      const suggestions = resolver.generateSuggestions(task);
      logger.list(suggestions.slice(0, 3));
      logger.blank();
    }

    // Discover candidates
    spinner.start('Discovering relevant files...');
    const discovery = new CandidateDiscovery(db, cwd);
    await discovery.init(); // Initialize discovery rules
    const loadedRules = discovery.getLoadedRuleNames();
    const candidateSignals = await discovery.discover({
      task,
      stacktraceEntries,
      diffEntries,
    });
    spinner.succeed(`Found ${candidateSignals.size} candidate files`);

    // Log loaded discovery rules
    if (loadedRules.length > 0) {
      logger.dim(`Discovery rules: ${loadedRules.join(', ')}`);
    }

    // Score and rank
    spinner.start('Scoring and ranking...');
    const scorer = new Scorer(db);
    const candidates = scorer.score(candidateSignals, task, {
      maxFiles: options.maxFiles || 25,
      includeTests: true,
      includeConfig: true,
    });
    spinner.succeed(`Selected ${candidates.length} files`);

    // Show top candidates
    logger.blank();
    logger.bold('Top files:');
    for (const candidate of candidates.slice(0, 5)) {
      const score = (candidate.score * 100).toFixed(0);
      logger.dim(`  ${score}% ${candidate.path}`);
    }
    if (candidates.length > 5) {
      logger.dim(`  ... and ${candidates.length - 5} more`);
    }
    logger.blank();

    // Extract excerpts
    spinner.start('Extracting excerpts...');
    const extractor = new ExcerptExtractor(cwd, db, {
      maxLinesPerFile: 300,
    });

    // Get changed lines from diff if available
    const highlightLines = new Map<string, number[]>();
    if (options.diff) {
      const { DiffAnalyzer } = await import('../../core/resolver/index.js');
      const diffAnalyzer = new DiffAnalyzer(cwd);
      for (const candidate of candidates) {
        const lines = diffAnalyzer.getChangedLines(candidate.path, options.diff);
        if (lines.length > 0) {
          highlightLines.set(candidate.path, lines);
        }
      }
    }

    const excerpts = await extractor.extractExcerpts(candidates, highlightLines);
    spinner.succeed(`Extracted ${excerpts.length} excerpts`);

    // Compose pack
    spinner.start('Composing pack...');
    const composer = new PackComposer(cwd, db);
    const outputDir = await composer.compose({
      task,
      candidates,
      excerpts,
      diffEntries,
    });
    spinner.succeed('Pack composed');

    // Done
    logger.blank();
    logger.success(`Context pack created at: ${path.relative(cwd, outputDir)}/`);
    logger.blank();
    logger.dim('Contents:');
    logger.list([
      'TASK.md     - Task analysis and assumptions',
      'FILES.md    - Selected files with reasons',
      'GRAPH.md    - Dependency graph',
      'PACK.md     - Ready-to-use prompt for AI agents',
      'excerpts/   - Code excerpts',
      'ctx.json    - Machine-readable manifest',
      'ctx.tgz     - Portable archive',
    ]);
    logger.blank();
    logger.dim('Use `context open` to open the pack directory.');
  } catch (error) {
    spinner.fail('Pack creation failed');
    logger.error(error instanceof Error ? error.message : String(error));
    if (options.verbose) {
      console.error(error);
    }
    process.exit(1);
  } finally {
    indexer?.close();
  }
}
