import fs from 'fs';
import path from 'path';
import type { DiscoveryRule, DiscoveryContext } from '../../DiscoveryRule.js';
import { createDefaultSignals } from '../../DiscoveryRule.js';
import type { CandidateSignals } from '../../../../types/index.js';

/**
 * Laravel Discovery Rule
 *
 * Framework-specific heuristics:
 * - Controller → View (blade templates)
 * - Route → Controller
 * - Model → Migration, Factory
 * - Request → Controller
 */
export const rule: DiscoveryRule = {
  name: 'laravel',
  description: 'Laravel framework: Controller→View, Route→Controller, Model→Migration',
  weight: 1.0,

  ignorePatterns: `
# === Laravel ===
vendor/
storage/app/
storage/framework/
storage/logs/
bootstrap/cache/
public/build/
public/vendor/
public/hot
public/storage
`.trim(),

  appliesTo(rootDir: string): boolean {
    const composerPath = path.join(rootDir, 'composer.json');
    if (!fs.existsSync(composerPath)) return false;

    try {
      const content = fs.readFileSync(composerPath, 'utf-8');
      const composer = JSON.parse(content);
      return !!(
        composer.require?.['laravel/framework'] ||
        composer.require?.['illuminate/support']
      );
    } catch {
      return false;
    }
  },

  async discover(ctx: DiscoveryContext): Promise<Map<string, CandidateSignals>> {
    const found = new Map<string, CandidateSignals>();

    await Promise.all([
      discoverViewsFromControllers(ctx, found),
      discoverControllersFromRoutes(ctx, found),
      discoverMigrationsFromModels(ctx, found),
      discoverRelatedModels(ctx, found),
      discoverFormRequests(ctx, found),
    ]);

    return found;
  },
};

/**
 * Find Blade views related to controllers
 */
async function discoverViewsFromControllers(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const allFiles = ctx.db.getAllFiles();

  for (const [filePath] of ctx.candidates) {
    const controllerMatch = filePath.match(/([A-Z][a-zA-Z]*)Controller\.php$/);
    if (!controllerMatch) continue;

    const controllerName = controllerMatch[1];
    const domain = controllerName.toLowerCase();

    const viewPatterns = [
      `resources/views/${domain}/`,
      `resources/views/${domain}.blade.php`,
      `resources/views/livewire/${domain}`,
      new RegExp(`resources/views/.*${domain}.*\\.blade\\.php$`, 'i'),
    ];

    for (const file of allFiles) {
      if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

      const matchesView = viewPatterns.some(pattern => {
        if (typeof pattern === 'string') {
          return file.path.startsWith(pattern);
        }
        return pattern.test(file.path);
      });

      if (matchesView) {
        found.set(file.path, {
          ...createDefaultSignals(),
          relatedFile: true,
        });
      }
    }
  }
}

/**
 * Find controllers referenced in route files
 */
async function discoverControllersFromRoutes(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  for (const [filePath] of ctx.candidates) {
    if (!filePath.match(/routes\/(web|api|console)\.php$/)) continue;

    try {
      const content = fs.readFileSync(path.join(ctx.rootDir, filePath), 'utf-8');
      const controllerPattern = /([A-Z][a-zA-Z]+Controller)(?:::class|@)/g;
      let match;

      while ((match = controllerPattern.exec(content)) !== null) {
        const controllerName = match[1];
        const allFiles = ctx.db.getAllFiles();

        for (const file of allFiles) {
          if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

          if (file.path.endsWith(`${controllerName}.php`)) {
            found.set(file.path, {
              ...createDefaultSignals(),
              relatedFile: true,
            });
          }
        }
      }
    } catch {
      // Skip if can't read file
    }
  }
}

/**
 * Find migrations related to models
 */
async function discoverMigrationsFromModels(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const allFiles = ctx.db.getAllFiles();

  for (const [filePath] of ctx.candidates) {
    if (!filePath.match(/app\/Models\/[A-Z][a-zA-Z]+\.php$/)) continue;

    const modelName = path.basename(filePath, '.php');
    const tableName = pluralize(toSnakeCase(modelName));

    for (const file of allFiles) {
      if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

      if (file.path.includes('database/migrations/')) {
        if (
          file.path.includes(`_${tableName}_table`) ||
          file.path.includes(`_create_${tableName}`) ||
          file.path.includes(`_${tableName}s_table`)
        ) {
          found.set(file.path, {
            ...createDefaultSignals(),
            relatedFile: true,
          });
        }
      }
    }
  }
}

/**
 * Find related models from relationships
 */
async function discoverRelatedModels(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const allFiles = ctx.db.getAllFiles();

  for (const [filePath] of ctx.candidates) {
    if (!filePath.match(/app\/Models\/[A-Z][a-zA-Z]+\.php$/)) continue;

    try {
      const content = fs.readFileSync(path.join(ctx.rootDir, filePath), 'utf-8');
      const relationPattern = /(?:hasMany|belongsTo|hasOne|belongsToMany|morphTo|morphMany|morphOne|morphToMany|morphedByMany)\s*\(\s*([A-Z][a-zA-Z]+)::class/g;
      let match;

      while ((match = relationPattern.exec(content)) !== null) {
        const relatedModel = match[1];

        for (const file of allFiles) {
          if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

          if (file.path.endsWith(`app/Models/${relatedModel}.php`)) {
            found.set(file.path, {
              ...createDefaultSignals(),
              relatedFile: true,
            });
          }
        }
      }
    } catch {
      // Skip if can't read file
    }
  }
}

/**
 * Find Form Request classes related to controllers
 */
async function discoverFormRequests(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  for (const [filePath] of ctx.candidates) {
    const controllerMatch = filePath.match(/([A-Z][a-zA-Z]*)Controller\.php$/);
    if (!controllerMatch) continue;

    const controllerName = controllerMatch[1];
    const allFiles = ctx.db.getAllFiles();

    for (const file of allFiles) {
      if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

      if (file.path.includes('app/Http/Requests/')) {
        const requestName = path.basename(file.path, '.php');
        if (
          requestName.includes(controllerName) ||
          requestName.startsWith(`Store${controllerName}`) ||
          requestName.startsWith(`Update${controllerName}`) ||
          requestName.startsWith(`Create${controllerName}`)
        ) {
          found.set(file.path, {
            ...createDefaultSignals(),
            relatedFile: true,
          });
        }
      }
    }
  }
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function pluralize(str: string): string {
  if (str.endsWith('y')) return str.slice(0, -1) + 'ies';
  if (str.endsWith('s') || str.endsWith('x') || str.endsWith('ch') || str.endsWith('sh')) {
    return str + 'es';
  }
  return str + 's';
}

export default rule;
