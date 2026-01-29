#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { indexCommand } from './commands/index.js';
import { packCommand } from './commands/pack.js';
import { openCommand } from './commands/open.js';

const program = new Command();

program
  .name('context')
  .description('CLI context packer for agentic coding')
  .version('0.1.0');

// init command
program
  .command('init')
  .description('Initialize context packer in the current directory')
  .option('-f, --force', 'Force reinitialization')
  .action(async (options) => {
    await initCommand(options);
  });

// index command
program
  .command('index')
  .description('Index the repository')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    await indexCommand(options);
  });

// pack command
program
  .command('pack')
  .description('Create a context pack')
  .option('-t, --task <description>', 'Task description')
  .option('-e, --error <file>', 'Error log file path')
  .option('--since <duration>', 'Filter error log (e.g., 1h, 2h, 30m)')
  .option('-d, --diff <ref>', 'Git diff reference (e.g., origin/main)')
  .option('-f, --file <path>', 'Specific file to analyze')
  .option('-s, --symbol <name>', 'Specific symbol to focus on')
  .option('--max-files <number>', 'Maximum files to include', parseInt)
  .option('--include <categories>', 'Include categories (comma-separated: tests,config,docs)')
  .option('--exclude <patterns>', 'Exclude patterns (comma-separated)')
  .option('--focus <domains>', 'Focus on domains (comma-separated: auth,payments,api)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    // Parse comma-separated options
    if (options.include) {
      options.include = options.include.split(',').map((s: string) => s.trim());
    }
    if (options.exclude) {
      options.exclude = options.exclude.split(',').map((s: string) => s.trim());
    }
    if (options.focus) {
      options.focus = options.focus.split(',').map((s: string) => s.trim());
    }

    await packCommand(options);
  });

// open command
program
  .command('open')
  .description('Open the context pack directory')
  .option('-f, --file <name>', 'Open specific file (e.g., PACK.md)')
  .action(async (options) => {
    await openCommand(options);
  });

// Parse arguments
program.parse();
