import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { ContextDatabase } from '../../storage/Database.js';
import type { ResolvedTask, Candidate, Excerpt, PackManifest, DiffEntry } from '../../types/index.js';

export interface ComposeOptions {
  outputDir?: string;
  includeArchive?: boolean;
  slug?: string;
}

export interface ComposeInput {
  task: ResolvedTask;
  candidates: Candidate[];
  excerpts: Excerpt[];
  diffEntries?: DiffEntry[];
}

export class PackComposer {
  private rootDir: string;
  private db: ContextDatabase;

  constructor(rootDir: string, db: ContextDatabase) {
    this.rootDir = rootDir;
    this.db = db;
  }

  /**
   * Generate a slug for the pack based on timestamp and task description.
   * Format: YYYYMMDD-HHMMSS-task-slug
   */
  generateSlug(task: string): string {
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14); // YYYYMMDDHHMMSS

    const formatted = `${timestamp.slice(0, 8)}-${timestamp.slice(8, 14)}`;

    const taskSlug = task
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
      .replace(/-$/, '');

    return `${formatted}-${taskSlug}`;
  }

  async compose(input: ComposeInput, options: ComposeOptions = {}): Promise<string> {
    // Generate slug if not provided
    const slug = options.slug || this.generateSlug(input.task.raw || 'pack');
    const outputDir = options.outputDir || path.join(this.rootDir, '.context', 'packs', slug);

    // Create output directory
    await fs.promises.mkdir(outputDir, { recursive: true });

    // Create excerpts directory
    const excerptsDir = path.join(outputDir, 'excerpts');
    await fs.promises.mkdir(excerptsDir, { recursive: true });

    // Generate all files
    await Promise.all([
      this.writeTaskMd(outputDir, input.task),
      this.writeFilesMd(outputDir, input.candidates),
      this.writeGraphMd(outputDir, input.candidates),
      this.writePackMd(outputDir, input),
      this.writeDiffMd(outputDir, input.diffEntries),
      this.writeTestsMd(outputDir, input.candidates),
      this.writeExcerpts(excerptsDir, input.excerpts),
      this.writeManifest(outputDir, input, slug),
    ]);

    // Create archive if requested
    if (options.includeArchive !== false) {
      await this.createArchive(outputDir);
    }

    return outputDir;
  }

  private async writeTaskMd(outputDir: string, task: ResolvedTask): Promise<void> {
    const content = `# Task

## Description

${task.raw || '(No task description provided)'}

## Analysis

### Keywords
${task.keywords.length > 0 ? task.keywords.map(k => `- ${k}`).join('\n') : '- (none detected)'}

### Detected Entities
${task.filesHint.length > 0 ? '**Files:**\n' + task.filesHint.map(f => `- ${f}`).join('\n') : ''}
${task.symbols.length > 0 ? '\n**Symbols:**\n' + task.symbols.map(s => `- ${s}`).join('\n') : ''}

### Domains
${task.domains.length > 0 ? task.domains.map(d => `- ${d}`).join('\n') : '- (none detected)'}

### Change Type
${task.changeType !== 'unknown' ? task.changeType : '(not determined)'}

## Confidence
Score: ${(task.confidence.overall * 100).toFixed(0)}%

${task.confidence.overall < 0.5 ? `
> **Warning:** Low confidence score. Consider providing more specific information:
> - Specify exact file paths
> - Include class or method names
> - Use --error flag with a log file
> - Use --diff flag to analyze changes
` : ''}

## Assumptions
(Review and adjust as needed)

1. Changes should follow existing code patterns
2. All existing tests should continue to pass
3. No unrelated refactoring should be included

## Acceptance Criteria
(Suggested - adjust as needed)

1. [ ] Described functionality is implemented
2. [ ] Tests pass
3. [ ] Code follows project conventions
4. [ ] No regressions introduced
`;

    await fs.promises.writeFile(path.join(outputDir, 'TASK.md'), content);
  }

  private async writeFilesMd(outputDir: string, candidates: Candidate[]): Promise<void> {
    const lines = ['# Included Files\n'];
    lines.push('Files selected for context, sorted by relevance score.\n');

    for (const candidate of candidates) {
      lines.push(`## ${candidate.path}`);
      lines.push(`**Score:** ${(candidate.score * 100).toFixed(0)}%\n`);
      lines.push('**Reasons:**');
      for (const reason of candidate.reasons) {
        lines.push(`- ${reason}`);
      }
      lines.push('');

      // Add file info
      const file = this.db.getFile(candidate.path);
      if (file) {
        lines.push(`**Language:** ${file.language}`);
        lines.push(`**Size:** ${this.formatBytes(file.size)}`);
      }

      // Add symbols summary
      const symbols = this.db.getSymbolsByFile(candidate.path);
      if (symbols.length > 0) {
        lines.push('\n**Symbols:**');
        const grouped = this.groupSymbols(symbols);
        for (const [kind, names] of Object.entries(grouped)) {
          lines.push(`- ${kind}: ${names.join(', ')}`);
        }
      }

      lines.push('\n---\n');
    }

    await fs.promises.writeFile(path.join(outputDir, 'FILES.md'), lines.join('\n'));
  }

  private async writeGraphMd(outputDir: string, candidates: Candidate[]): Promise<void> {
    const lines = ['# Dependency Graph\n'];
    lines.push('Import relationships between included files.\n');

    const candidatePaths = new Set(candidates.map(c => c.path));

    for (const candidate of candidates.slice(0, 15)) { // Limit to top 15
      const imports = this.db.getImportsFrom(candidate.path);
      const importers = this.db.getImportersOf(candidate.path);

      // Filter to only show relationships within candidates
      const relevantImports = imports.filter(i => candidatePaths.has(i.targetPath));
      const relevantImporters = importers.filter(i => candidatePaths.has(i.sourcePath));

      if (relevantImports.length > 0 || relevantImporters.length > 0) {
        lines.push(`## ${candidate.path}`);

        if (relevantImports.length > 0) {
          lines.push('\n**Imports:**');
          for (const imp of relevantImports) {
            lines.push(`- → ${imp.targetPath}`);
          }
        }

        if (relevantImporters.length > 0) {
          lines.push('\n**Imported by:**');
          for (const imp of relevantImporters) {
            lines.push(`- ← ${imp.sourcePath}`);
          }
        }

        lines.push('');
      }
    }

    // Add suggested flow
    lines.push('\n## Suggested Reading Order\n');
    lines.push('Start with entry points, then follow imports:\n');

    const entryPoints = candidates.filter(c => this.isEntryPoint(c.path));
    if (entryPoints.length > 0) {
      lines.push('**Entry Points:**');
      for (const ep of entryPoints.slice(0, 5)) {
        lines.push(`1. ${ep.path}`);
      }
    }

    await fs.promises.writeFile(path.join(outputDir, 'GRAPH.md'), lines.join('\n'));
  }

  private async writePackMd(outputDir: string, input: ComposeInput): Promise<void> {
    const lines = [
      'You are a coding agent. Use the provided context excerpts to complete the task.',
      '',
      '## Goal',
      '',
      input.task.raw || '(Complete the requested task)',
      '',
      '## Constraints',
      '',
      '- Only modify files relevant to the task',
      '- Do not change public API response schemas unless explicitly required',
      '- Maintain existing code style and patterns',
      '- Ensure all existing tests continue to pass',
      '',
      '## Definition of Done',
      '',
      '- [ ] Described functionality is implemented correctly',
      '- [ ] New tests added for new functionality',
      '- [ ] All tests pass',
      '- [ ] Minimal diff - no unrelated refactors',
      '',
      '## Files (priority order)',
      '',
    ];

    // List files with priority
    for (let i = 0; i < input.candidates.length; i++) {
      const candidate = input.candidates[i];
      const safeFilename = this.getSafeFilename(candidate.path);
      lines.push(`${i + 1}. excerpts/${safeFilename}.md (${(candidate.score * 100).toFixed(0)}%)`);
    }

    // Add test commands based on detected domains/files
    lines.push('');
    lines.push('## Commands');
    lines.push('');

    const testCommands = this.detectTestCommands(input.candidates);
    for (const cmd of testCommands) {
      lines.push(`- ${cmd}`);
    }

    // Add notes
    lines.push('');
    lines.push('## Notes');
    lines.push('');

    if (input.task.domains.includes('payments')) {
      lines.push('- **Payments:** Ensure idempotency for webhook handlers');
    }
    if (input.task.domains.includes('auth')) {
      lines.push('- **Auth:** Verify permission checks are in place');
    }
    if (input.task.domains.includes('database')) {
      lines.push('- **Database:** Consider adding migrations if schema changes');
    }

    if (input.task.confidence.overall < 0.5) {
      lines.push('- **Warning:** Task analysis had low confidence. Review file selection carefully.');
    }

    await fs.promises.writeFile(path.join(outputDir, 'PACK.md'), lines.join('\n'));
  }

  private async writeDiffMd(outputDir: string, diffEntries?: DiffEntry[]): Promise<void> {
    if (!diffEntries || diffEntries.length === 0) {
      const content = '# Diff\n\nNo diff information available.\n\nUse `--diff origin/main` to include diff analysis.\n';
      await fs.promises.writeFile(path.join(outputDir, 'DIFF.md'), content);
      return;
    }

    const lines = ['# Diff\n'];
    lines.push(`**${diffEntries.length} files changed**\n`);

    // Summary
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const entry of diffEntries) {
      totalAdditions += entry.additions;
      totalDeletions += entry.deletions;
    }

    lines.push(`+${totalAdditions} -${totalDeletions}\n`);

    // Details
    for (const entry of diffEntries) {
      const icon = entry.status === 'added' ? '+' :
                   entry.status === 'deleted' ? '-' :
                   entry.status === 'renamed' ? '→' : 'M';
      lines.push(`- [${icon}] ${entry.file} (+${entry.additions} -${entry.deletions})`);
    }

    await fs.promises.writeFile(path.join(outputDir, 'DIFF.md'), lines.join('\n'));
  }

  private async writeTestsMd(outputDir: string, candidates: Candidate[]): Promise<void> {
    const testFiles = candidates.filter(c => c.signals.testFile);
    const lines = ['# Tests\n'];

    if (testFiles.length === 0) {
      lines.push('No test files included in this pack.\n');
      lines.push('Consider running the full test suite after making changes.\n');
    } else {
      lines.push('## Included Test Files\n');
      for (const test of testFiles) {
        lines.push(`- ${test.path}`);
      }
    }

    // Suggest test commands
    lines.push('\n## Suggested Commands\n');

    const commands = this.detectTestCommands(candidates);
    for (const cmd of commands) {
      lines.push(`\`\`\`bash\n${cmd}\n\`\`\``);
    }

    await fs.promises.writeFile(path.join(outputDir, 'TESTS.md'), lines.join('\n'));
  }

  private async writeExcerpts(excerptsDir: string, excerpts: Excerpt[]): Promise<void> {
    for (const excerpt of excerpts) {
      const safeFilename = this.getSafeFilename(excerpt.path);
      const outputPath = path.join(excerptsDir, `${safeFilename}.md`);

      const lines = [
        `# ${excerpt.path}`,
        '',
        `Lines ${excerpt.startLine}-${excerpt.endLine} of ${excerpt.totalLines}`,
        excerpt.truncated ? '(truncated)' : '(complete)',
        '',
        '```' + this.getLanguageForFence(excerpt.path),
        excerpt.content,
        '```',
      ];

      await fs.promises.writeFile(outputPath, lines.join('\n'));
    }
  }

  private async writeManifest(outputDir: string, input: ComposeInput, slug?: string): Promise<void> {
    const manifest: PackManifest = {
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      slug,
      task: input.task,
      files: input.candidates.map(c => ({
        path: c.path,
        score: c.score,
        reasons: c.reasons,
      })),
      budgetTokens: this.estimateTokens(input.excerpts),
      tags: input.task.domains,
    };

    await fs.promises.writeFile(
      path.join(outputDir, 'ctx.json'),
      JSON.stringify(manifest, null, 2)
    );
  }

  private async createArchive(outputDir: string): Promise<void> {
    const archivePath = path.join(outputDir, 'ctx.tgz');
    const output = fs.createWriteStream(archivePath);
    const archive = archiver('tar', { gzip: true });

    return new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);

      // Add all files except the archive itself
      archive.glob('**/*', {
        cwd: outputDir,
        ignore: ['ctx.tgz'],
      });

      archive.finalize();
    });
  }

  private getSafeFilename(filePath: string): string {
    return filePath.replace(/[\/\\]/g, '_').replace(/\./g, '_');
  }

  private getLanguageForFence(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.php': 'php',
      '.py': 'python',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      '.sql': 'sql',
      '.sh': 'bash',
    };
    return map[ext] || '';
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private groupSymbols(symbols: Array<{ name: string; kind: string }>): Record<string, string[]> {
    const grouped: Record<string, string[]> = {};
    for (const symbol of symbols) {
      if (!grouped[symbol.kind]) {
        grouped[symbol.kind] = [];
      }
      grouped[symbol.kind].push(symbol.name);
    }
    return grouped;
  }

  private isEntryPoint(filePath: string): boolean {
    const patterns = [
      /Controller\./i,
      /Handler\./i,
      /routes?\//i,
      /index\./,
      /main\./,
      /app\./,
    ];
    return patterns.some(p => p.test(filePath));
  }

  private detectTestCommands(candidates: Candidate[]): string[] {
    const commands: string[] = [];
    const hasPhp = candidates.some(c => c.path.endsWith('.php'));
    const hasTs = candidates.some(c => c.path.endsWith('.ts') || c.path.endsWith('.tsx'));
    const hasJs = candidates.some(c => c.path.endsWith('.js') || c.path.endsWith('.jsx'));
    const hasPy = candidates.some(c => c.path.endsWith('.py'));
    const hasGo = candidates.some(c => c.path.endsWith('.go'));
    const hasRust = candidates.some(c => c.path.endsWith('.rs'));

    if (hasPhp) {
      commands.push('php artisan test');
      commands.push('./vendor/bin/phpunit');
    }
    if (hasTs || hasJs) {
      commands.push('npm test');
      commands.push('npm run test:watch');
    }
    if (hasPy) {
      commands.push('pytest');
      commands.push('python -m pytest');
    }
    if (hasGo) {
      commands.push('go test ./...');
    }
    if (hasRust) {
      commands.push('cargo test');
    }

    // Default if nothing detected
    if (commands.length === 0) {
      commands.push('# Run your test suite');
    }

    return commands;
  }

  private estimateTokens(excerpts: Excerpt[]): number {
    let totalChars = 0;
    for (const excerpt of excerpts) {
      totalChars += excerpt.content.length;
    }
    // Rough estimate: ~4 characters per token
    return Math.ceil(totalChars / 4);
  }
}
