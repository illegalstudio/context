import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { FileMetadata } from '../../types/index.js';

// Language detection by extension
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.php': 'php',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.md': 'markdown',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.dockerfile': 'dockerfile',
};

// Default exclude patterns
const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules',
  'vendor',
  '.git',
  '.context',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '__pycache__',
  '.pytest_cache',
  'coverage',
  '.nyc_output',
  'target', // Rust
  '.idea',
  '.vscode',
  '.DS_Store',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
];

// Files to never include (security)
const NEVER_INCLUDE = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
];

export interface ScanOptions {
  excludePatterns?: string[];
  includeLanguages?: string[];
  maxFileSize?: number; // bytes
}

export class FileScanner {
  private rootDir: string;
  private excludePatterns: Set<string>;
  private includeLanguages: Set<string> | null;
  private maxFileSize: number;

  constructor(rootDir: string, options: ScanOptions = {}) {
    this.rootDir = path.resolve(rootDir);
    this.excludePatterns = new Set([
      ...DEFAULT_EXCLUDE_PATTERNS,
      ...(options.excludePatterns || []),
    ]);
    this.includeLanguages = options.includeLanguages
      ? new Set(options.includeLanguages)
      : null;
    this.maxFileSize = options.maxFileSize || 1024 * 1024; // 1MB default
  }

  async scan(): Promise<FileMetadata[]> {
    const files: FileMetadata[] = [];
    await this.scanDirectory(this.rootDir, files);
    return files;
  }

  private async scanDirectory(dir: string, files: FileMetadata[]): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(this.rootDir, fullPath);

      // Check exclusions
      if (this.shouldExclude(entry.name, relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath, files);
      } else if (entry.isFile()) {
        const metadata = await this.processFile(fullPath, relativePath);
        if (metadata) {
          files.push(metadata);
        }
      }
    }
  }

  private shouldExclude(name: string, relativePath: string): boolean {
    // Check if path segment matches exclude pattern
    const segments = relativePath.split(path.sep);
    for (const segment of segments) {
      if (this.excludePatterns.has(segment)) {
        return true;
      }
    }

    // Check never-include patterns
    for (const pattern of NEVER_INCLUDE) {
      if (pattern.startsWith('*')) {
        if (name.endsWith(pattern.slice(1))) {
          return true;
        }
      } else if (name === pattern || name.startsWith(pattern)) {
        return true;
      }
    }

    return false;
  }

  private async processFile(fullPath: string, relativePath: string): Promise<FileMetadata | null> {
    try {
      const stat = await fs.promises.stat(fullPath);

      // Skip files that are too large
      if (stat.size > this.maxFileSize) {
        return null;
      }

      // Skip empty files
      if (stat.size === 0) {
        return null;
      }

      const ext = path.extname(fullPath).toLowerCase();
      const language = LANGUAGE_MAP[ext] || 'unknown';

      // Skip if language filtering is enabled and this language isn't included
      if (this.includeLanguages && !this.includeLanguages.has(language)) {
        return null;
      }

      // Skip unknown binary-like files
      if (language === 'unknown' && !this.isLikelyTextFile(fullPath)) {
        return null;
      }

      // Compute hash
      const content = await fs.promises.readFile(fullPath);
      const hash = crypto.createHash('md5').update(content).digest('hex');

      return {
        path: relativePath,
        language,
        size: stat.size,
        mtime: Math.floor(stat.mtimeMs),
        hash,
      };
    } catch (error) {
      // Skip files we can't read
      return null;
    }
  }

  private isLikelyTextFile(filePath: string): boolean {
    // Check common text file extensions that might not be in LANGUAGE_MAP
    const textExtensions = ['.txt', '.log', '.conf', '.cfg', '.ini', '.env.example', '.gitignore', '.dockerignore', '.editorconfig'];
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath).toLowerCase();

    return textExtensions.includes(ext) ||
           basename === 'readme' ||
           basename === 'license' ||
           basename === 'changelog' ||
           basename === 'makefile' ||
           basename === 'dockerfile' ||
           basename === 'vagrantfile';
  }

  static detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return LANGUAGE_MAP[ext] || 'unknown';
  }
}
