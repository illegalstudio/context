import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface ListOptions {
  limit?: number;
}

interface PackInfo {
  slug: string;
  date: string;
  time: string;
  task: string;
  fileCount: number;
}

/**
 * Parse a pack slug to extract date, time, and task
 */
function parseSlug(slug: string): { date: string; time: string; task: string } | null {
  // Format: YYYYMMDD-HHMMSS-task-slug
  const match = slug.match(/^(\d{8})-(\d{6})-(.+)$/);
  if (!match) {
    return null;
  }

  const [, dateStr, timeStr, taskSlug] = match;

  // Format date as YYYY-MM-DD
  const date = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;

  // Format time as HH:MM:SS
  const time = `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}`;

  return { date, time, task: taskSlug };
}

/**
 * Get file count from a pack directory
 */
function getPackFileCount(packDir: string): number {
  try {
    const manifestPath = path.join(packDir, 'ctx.json');
    if (fs.existsSync(manifestPath)) {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      return manifest.files?.length || 0;
    }
  } catch {
    // Ignore errors reading manifest
  }
  return 0;
}

/**
 * Get list of packs with their info
 */
function getPackList(packsDir: string): PackInfo[] {
  if (!fs.existsSync(packsDir)) {
    return [];
  }

  const entries = fs.readdirSync(packsDir, { withFileTypes: true });
  const packs: PackInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const parsed = parseSlug(entry.name);
    if (!parsed) continue;

    const packDir = path.join(packsDir, entry.name);
    const fileCount = getPackFileCount(packDir);

    packs.push({
      slug: entry.name,
      date: parsed.date,
      time: parsed.time,
      task: parsed.task,
      fileCount,
    });
  }

  // Sort by date/time descending (most recent first)
  packs.sort((a, b) => b.slug.localeCompare(a.slug));

  return packs;
}

export async function listCommand(options: ListOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const packsDir = path.join(cwd, '.context', 'packs');

  const packs = getPackList(packsDir);

  if (packs.length === 0) {
    logger.info('No context packs found.');
    logger.dim('Run `context pack --task "..."` to create one.');
    return;
  }

  // Apply limit if specified
  const limit = options.limit || packs.length;
  const displayPacks = packs.slice(0, limit);

  logger.header('Context Packs');
  logger.blank();

  // Display as table
  // DATE        TIME      TASK                                 FILES
  const headers = ['DATE', 'TIME', 'TASK', 'FILES'];
  const colWidths = [10, 8, 40, 5];

  // Header
  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
  logger.bold(headerLine);
  logger.dim('-'.repeat(headerLine.length));

  // Rows
  for (const pack of displayPacks) {
    const task = pack.task.length > 37 ? pack.task.slice(0, 37) + '...' : pack.task;
    const row = [
      pack.date.padEnd(colWidths[0]),
      pack.time.padEnd(colWidths[1]),
      task.padEnd(colWidths[2]),
      String(pack.fileCount).padStart(colWidths[3]),
    ].join('  ');
    console.log(row);
  }

  if (packs.length > limit) {
    logger.blank();
    logger.dim(`Showing ${limit} of ${packs.length} packs. Use --limit to show more.`);
  }

  logger.blank();
  logger.dim('Use `context open <pack>` to open a specific pack.');
}
