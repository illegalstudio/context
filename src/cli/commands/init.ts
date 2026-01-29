import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface InitOptions {
  force?: boolean;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const contextDir = path.join(cwd, '.context');

  // Check if already initialized
  if (fs.existsSync(contextDir) && !options.force) {
    logger.warning('Already initialized. Use --force to reinitialize.');
    return;
  }

  // Create .context directory
  if (!fs.existsSync(contextDir)) {
    fs.mkdirSync(contextDir, { recursive: true });
    logger.success('Created .context directory');
  }

  // Create config file
  const configPath = path.join(contextDir, 'config.json');
  const defaultConfig = {
    version: '0.1.0',
    excludePatterns: [
      'node_modules',
      'vendor',
      '.git',
      'dist',
      'build',
      'coverage',
    ],
    includeLanguages: [],
    maxFileSize: 1048576, // 1MB
  };

  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  logger.success('Created config file');

  // Add .context to .gitignore if it exists
  const gitignorePath = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gitignore.includes('.context')) {
      fs.appendFileSync(gitignorePath, '\n# Context Packer\n.context/\nctx/\n');
      logger.success('Updated .gitignore');
    }
  }

  logger.blank();
  logger.info('Context Packer initialized!');
  logger.blank();
  logger.dim('Next steps:');
  logger.list([
    'Run `context index` to index your repository',
    'Run `context pack --task "your task"` to create a context pack',
  ]);
}
