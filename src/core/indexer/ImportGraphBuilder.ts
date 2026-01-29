import fs from 'fs';
import path from 'path';
import type { ImportRelation } from '../../types/index.js';

// Import patterns for different languages
const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    // import X from 'path'
    /import\s+(?:type\s+)?(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)?\s*,?\s*(?:\{[^}]+\})?\s*from\s*['"]([^'"]+)['"]/g,
    // import 'path' (side effect)
    /import\s+['"]([^'"]+)['"]/g,
    // require('path')
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // dynamic import('path')
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  javascript: [
    /import\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)?\s*,?\s*(?:\{[^}]+\})?\s*from\s*['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  php: [
    // use Namespace\Class
    /use\s+([\w\\]+)(?:\s+as\s+\w+)?;/g,
    // include/require
    /(?:include|require)(?:_once)?\s*\(?['"]([^'"]+)['"]\)?/g,
  ],
  python: [
    // import module
    /^import\s+([\w.]+)/gm,
    // from module import
    /^from\s+([\w.]+)\s+import/gm,
  ],
  go: [
    // import "path"
    /import\s+(?:\w+\s+)?["']([^"']+)["']/g,
    // import ( "path" )
    /^\s*(?:\w+\s+)?["']([^"']+)["']/gm,
  ],
  rust: [
    // use crate::module
    /use\s+((?:crate|super|self)?(?:::\w+)+)/g,
    // mod module
    /mod\s+(\w+)/g,
  ],
  ruby: [
    // require 'path'
    /require\s+['"]([^'"]+)['"]/g,
    // require_relative 'path'
    /require_relative\s+['"]([^'"]+)['"]/g,
  ],
  java: [
    // import package.Class
    /import\s+(?:static\s+)?([\w.]+)/g,
  ],
};

// Extensions to try when resolving imports
const EXTENSION_MAP: Record<string, string[]> = {
  typescript: ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs', '/index.js', '/index.jsx'],
  php: ['.php'],
  python: ['.py', '/__init__.py'],
  go: ['.go'],
  rust: ['.rs', '/mod.rs'],
  ruby: ['.rb'],
  java: ['.java'],
};

const LANGUAGE_ALIAS: Record<string, string> = {
  tsx: 'typescript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  kotlin: 'java',
  swift: 'java',
  csharp: 'java',
};

export class ImportGraphBuilder {
  private rootDir: string;
  private fileIndex: Map<string, boolean>;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.fileIndex = new Map();
  }

  setFileIndex(files: string[]): void {
    this.fileIndex.clear();
    for (const file of files) {
      this.fileIndex.set(file, true);
      // Also index without extension for easier matching
      const withoutExt = file.replace(/\.[^/.]+$/, '');
      this.fileIndex.set(withoutExt, true);
    }
  }

  async extractImports(filePath: string, language: string): Promise<ImportRelation[]> {
    const fullPath = path.join(this.rootDir, filePath);

    try {
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const normalizedLang = LANGUAGE_ALIAS[language] || language;
      const patterns = IMPORT_PATTERNS[normalizedLang];

      if (!patterns) {
        return [];
      }

      const imports: ImportRelation[] = [];
      const seenTargets = new Set<string>();

      for (const pattern of patterns) {
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(content)) !== null) {
          const importPath = match[1];

          if (!importPath) continue;

          // Skip node_modules / external packages
          if (this.isExternalImport(importPath, language)) continue;

          // Resolve the import to an actual file path
          const resolvedPath = this.resolveImport(importPath, filePath, language);

          if (resolvedPath && !seenTargets.has(resolvedPath)) {
            seenTargets.add(resolvedPath);
            imports.push({
              sourcePath: filePath,
              targetPath: resolvedPath,
            });
          }
        }
      }

      return imports;
    } catch (error) {
      return [];
    }
  }

  private isExternalImport(importPath: string, language: string): boolean {
    // Language-specific external import detection
    switch (language) {
      case 'typescript':
      case 'javascript':
        // Relative imports start with . or /
        // Everything else is likely from node_modules
        return !importPath.startsWith('.') && !importPath.startsWith('/') && !importPath.startsWith('@/');

      case 'php':
        // PHP uses namespaces - we're looking for project files
        // Skip vendor namespaces (common patterns)
        const vendorPrefixes = ['Illuminate\\', 'Symfony\\', 'Psr\\', 'GuzzleHttp\\', 'Carbon\\', 'Laravel\\'];
        return vendorPrefixes.some(prefix => importPath.startsWith(prefix));

      case 'python':
        // Built-in and common external modules
        const pythonBuiltins = ['os', 'sys', 'json', 'typing', 'collections', 'functools', 'itertools', 'pathlib', 'datetime', 're', 'math', 'random', 'time', 'logging', 'unittest', 'pytest', 'django', 'flask', 'numpy', 'pandas'];
        const firstPart = importPath.split('.')[0];
        return pythonBuiltins.includes(firstPart);

      case 'go':
        // Go standard library and external packages
        return !importPath.startsWith('.') && (
          importPath.includes('github.com') ||
          !importPath.includes('/') ||
          importPath.startsWith('golang.org')
        );

      case 'rust':
        // Rust external crates (not starting with crate::, super::, self::)
        return !importPath.startsWith('crate') && !importPath.startsWith('super') && !importPath.startsWith('self');

      case 'ruby':
        // Ruby gems
        const rubyBuiltins = ['json', 'yaml', 'csv', 'net/http', 'uri', 'fileutils', 'pathname', 'date', 'time', 'logger', 'rails', 'active_record', 'active_support'];
        return rubyBuiltins.some(b => importPath.startsWith(b));

      case 'java':
        // Java standard library
        return importPath.startsWith('java.') || importPath.startsWith('javax.') || importPath.startsWith('org.') || importPath.startsWith('com.google.');

      default:
        return false;
    }
  }

  private resolveImport(importPath: string, sourceFile: string, language: string): string | null {
    const normalizedLang = LANGUAGE_ALIAS[language] || language;
    const extensions = EXTENSION_MAP[normalizedLang] || [];
    const sourceDir = path.dirname(sourceFile);

    // Handle different import styles
    let basePath: string;

    if (importPath.startsWith('.')) {
      // Relative import
      basePath = path.join(sourceDir, importPath);
    } else if (importPath.startsWith('@/') || importPath.startsWith('~/')) {
      // Project root alias (common in many frameworks)
      basePath = importPath.slice(2);
    } else if (importPath.startsWith('/')) {
      // Absolute from project root
      basePath = importPath.slice(1);
    } else {
      // Could be a project module (namespace or module path)
      basePath = this.convertNamespaceToPath(importPath, language);
    }

    // Normalize path
    basePath = path.normalize(basePath);

    // Try exact match first
    if (this.fileIndex.has(basePath)) {
      return basePath;
    }

    // Try with various extensions
    for (const ext of extensions) {
      const withExt = basePath + ext;
      if (this.fileIndex.has(withExt)) {
        return withExt;
      }
    }

    // Try to find partial match (for namespace-style imports)
    const baseFileName = path.basename(basePath);
    for (const [file] of this.fileIndex) {
      if (file.endsWith('/' + baseFileName) || file.endsWith(baseFileName + '.php') || file.endsWith(baseFileName + '.ts') || file.endsWith(baseFileName + '.js')) {
        // Check if the path structure somewhat matches
        if (this.pathLikelyMatches(file, importPath, language)) {
          return file;
        }
      }
    }

    return null;
  }

  private convertNamespaceToPath(importPath: string, language: string): string {
    switch (language) {
      case 'php':
        // App\Http\Controllers\UserController -> app/Http/Controllers/UserController
        return importPath.replace(/\\/g, '/').replace(/^App\//, 'app/');

      case 'python':
        // app.services.user -> app/services/user
        return importPath.replace(/\./g, '/');

      case 'java':
        // com.example.services.UserService -> com/example/services/UserService
        return importPath.replace(/\./g, '/');

      default:
        return importPath;
    }
  }

  private pathLikelyMatches(filePath: string, importPath: string, language: string): boolean {
    // Check if the file path reasonably matches the import
    const normalizedFile = filePath.toLowerCase().replace(/[\/\\]/g, '/');
    const normalizedImport = importPath.toLowerCase().replace(/[\.\\\:]/g, '/');

    // Extract significant parts
    const importParts = normalizedImport.split('/').filter(p => p.length > 2);
    const fileParts = normalizedFile.split('/').filter(p => p.length > 2);

    // At least half of import parts should be in file path
    let matches = 0;
    for (const part of importParts) {
      if (fileParts.some(fp => fp.includes(part) || part.includes(fp.replace(/\.[^.]+$/, '')))) {
        matches++;
      }
    }

    return matches >= importParts.length / 2;
  }
}
