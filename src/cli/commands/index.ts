import path from 'path';
import { Indexer } from '../../core/indexer/index.js';
import { logger } from '../utils/logger.js';
import { createSpinner } from '../utils/spinner.js';

export interface IndexOptions {
  verbose?: boolean;
}

export async function indexCommand(options: IndexOptions = {}): Promise<void> {
  const cwd = process.cwd();

  // Check if initialized
  if (!Indexer.isInitialized(cwd)) {
    // Auto-initialize if needed
    logger.info('Initializing Context Packer...');
    const { initCommand } = await import('./init.js');
    await initCommand();
  }

  logger.header('Indexing Repository');

  const spinner = createSpinner('Scanning files...');
  spinner.start();

  try {
    const indexer = new Indexer(cwd, {
      verbose: options.verbose,
      onProgress: (current, total, file) => {
        spinner.progress(current, total, path.basename(file));
      },
    });

    const stats = await indexer.index();

    spinner.succeed('Indexing complete');

    logger.blank();
    logger.info(`Files indexed: ${stats.files}`);
    logger.info(`Symbols found: ${stats.symbols}`);
    logger.info(`Import relations: ${stats.imports}`);
    logger.info(`Duration: ${(stats.duration / 1000).toFixed(2)}s`);

    indexer.close();

    logger.blank();
    logger.success('Repository indexed successfully!');
    logger.dim('Run `context pack --task "..."` to create a context pack.');
  } catch (error) {
    spinner.fail('Indexing failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
