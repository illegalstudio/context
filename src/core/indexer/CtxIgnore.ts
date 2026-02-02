import fs from 'fs';
import path from 'path';
import ignore, { type Ignore } from 'ignore';

/**
 * CtxIgnore - Parser for .ctxignore files
 *
 * Works like .gitignore:
 * - Optional file in project root
 * - Supports glob patterns (*, **, !)
 * - Ignored files are excluded from indexing and discovery
 */
export class CtxIgnore {
  private ig: Ignore;
  private loaded: boolean = false;

  // Builtin patterns always applied (cannot be overridden)
  private static readonly BUILTIN_PATTERNS = `
# Context packer output
.context/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
`;

  constructor(rootDir: string) {
    this.ig = ignore();

    // Always add builtin patterns first
    this.ig.add(CtxIgnore.BUILTIN_PATTERNS);

    const ctxignorePath = path.join(rootDir, '.ctxignore');
    if (fs.existsSync(ctxignorePath)) {
      try {
        const content = fs.readFileSync(ctxignorePath, 'utf-8');
        this.ig.add(content);
        this.loaded = true;
      } catch {
        // If we can't read the file, proceed without custom ignores
      }
    }
  }

  /**
   * Check if a file path should be ignored
   * @param filePath - Relative path from project root
   * @returns true if the file should be ignored
   */
  isIgnored(filePath: string): boolean {
    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Always check against builtin + custom patterns
    return this.ig.ignores(normalizedPath);
  }

  /**
   * Filter an array of file paths, removing ignored ones
   * @param filePaths - Array of relative paths
   * @returns Array of paths that are not ignored
   */
  filter(filePaths: string[]): string[] {
    // Always filter - builtin patterns are always applied
    return filePaths.filter(fp => !this.isIgnored(fp));
  }

  /**
   * Check if .ctxignore file was loaded
   */
  hasCustomIgnores(): boolean {
    return this.loaded;
  }

  /**
   * Create a CtxIgnore instance from raw pattern content (for testing)
   */
  static fromPatterns(patterns: string): CtxIgnore {
    const instance = new CtxIgnore(''); // Empty root, won't load file
    instance.ig.add(patterns);
    instance.loaded = true;
    return instance;
  }
}
