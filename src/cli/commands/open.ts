import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface OpenOptions {
  file?: string; // Specific file to open
  pack?: string; // Specific pack to open (slug or partial match)
}

/**
 * Get the most recent pack directory from .context/packs/
 */
function getMostRecentPack(packsDir: string): string | null {
  if (!fs.existsSync(packsDir)) {
    return null;
  }

  const entries = fs.readdirSync(packsDir, { withFileTypes: true });
  const packDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    // Slugs start with YYYYMMDD-HHMMSS, so sorting descending gives most recent first
    .sort((a, b) => b.localeCompare(a));

  if (packDirs.length === 0) {
    return null;
  }

  return path.join(packsDir, packDirs[0]);
}

/**
 * Find a pack by name (exact or partial match)
 */
function findPack(packsDir: string, packName: string): string | null {
  if (!fs.existsSync(packsDir)) {
    return null;
  }

  const packPath = path.join(packsDir, packName);

  // Try exact match first
  if (fs.existsSync(packPath) && fs.statSync(packPath).isDirectory()) {
    return packPath;
  }

  // Try partial match (prefix)
  const entries = fs.readdirSync(packsDir, { withFileTypes: true });
  const matches = entries
    .filter(e => e.isDirectory() && e.name.startsWith(packName))
    .map(e => e.name)
    .sort((a, b) => b.localeCompare(a)); // Most recent first

  if (matches.length > 0) {
    return path.join(packsDir, matches[0]);
  }

  return null;
}

export async function openCommand(options: OpenOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const packsDir = path.join(cwd, '.context', 'packs');

  // Determine which pack to open
  let packDir: string | null;

  if (options.pack) {
    // Find specific pack
    packDir = findPack(packsDir, options.pack);
    if (!packDir) {
      logger.error(`Pack not found: ${options.pack}`);

      // List available packs
      if (fs.existsSync(packsDir)) {
        const entries = fs.readdirSync(packsDir, { withFileTypes: true });
        const packs = entries
          .filter(e => e.isDirectory())
          .map(e => e.name)
          .sort((a, b) => b.localeCompare(a));

        if (packs.length > 0) {
          logger.blank();
          logger.dim('Available packs:');
          logger.list(packs.slice(0, 10));
          if (packs.length > 10) {
            logger.dim(`  ... and ${packs.length - 10} more`);
          }
        }
      }
      process.exit(1);
    }
  } else {
    // Find most recent pack
    packDir = getMostRecentPack(packsDir);
    if (!packDir) {
      // Check for legacy ctx/ directory
      const legacyDir = path.join(cwd, 'ctx');
      if (fs.existsSync(legacyDir)) {
        packDir = legacyDir;
        logger.dim('Note: Using legacy ctx/ directory. Run `context pack` to create a new pack in .context/packs/');
      } else {
        logger.error('No context pack found. Run `context pack` first.');
        process.exit(1);
      }
    }
  }

  // Determine what to open
  let targetPath: string;

  if (options.file) {
    targetPath = path.join(packDir, options.file);
    if (!fs.existsSync(targetPath)) {
      logger.error(`File not found: ${options.file}`);
      logger.dim('Available files:');
      const files = fs.readdirSync(packDir);
      logger.list(files);
      process.exit(1);
    }
  } else {
    // Default to opening the directory
    targetPath = packDir;
  }

  // Open using system default
  const openCommand = getOpenCommand();
  if (!openCommand) {
    logger.error('Could not determine how to open files on this system.');
    logger.info(`Pack location: ${packDir}`);
    return;
  }

  exec(`${openCommand} "${targetPath}"`, (error) => {
    if (error) {
      logger.error(`Failed to open: ${error.message}`);
      logger.info(`Pack location: ${packDir}`);
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
