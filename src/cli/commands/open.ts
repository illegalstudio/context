import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface OpenOptions {
  file?: string; // Specific file to open
}

export async function openCommand(options: OpenOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const ctxDir = path.join(cwd, 'ctx');

  // Check if pack exists
  if (!fs.existsSync(ctxDir)) {
    logger.error('No context pack found. Run `context pack` first.');
    process.exit(1);
  }

  // Determine what to open
  let targetPath: string;

  if (options.file) {
    targetPath = path.join(ctxDir, options.file);
    if (!fs.existsSync(targetPath)) {
      logger.error(`File not found: ${options.file}`);
      logger.dim('Available files:');
      const files = fs.readdirSync(ctxDir);
      logger.list(files);
      process.exit(1);
    }
  } else {
    // Default to opening the directory
    targetPath = ctxDir;
  }

  // Open using system default
  const openCommand = getOpenCommand();
  if (!openCommand) {
    logger.error('Could not determine how to open files on this system.');
    logger.info(`Pack location: ${ctxDir}`);
    return;
  }

  exec(`${openCommand} "${targetPath}"`, (error) => {
    if (error) {
      logger.error(`Failed to open: ${error.message}`);
      logger.info(`Pack location: ${ctxDir}`);
    } else {
      logger.success(`Opened: ${path.relative(cwd, targetPath)}`);
    }
  });
}

function getOpenCommand(): string | null {
  switch (process.platform) {
    case 'darwin':
      return 'open';
    case 'win32':
      return 'start';
    case 'linux':
      return 'xdg-open';
    default:
      return null;
  }
}
