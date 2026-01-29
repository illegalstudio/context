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

  /**
   * Laravel-specific domains for task analysis
   */
  domains: [
    {
      name: 'eloquent',
      description: 'Laravel Eloquent ORM',
      keywords: ['eloquent', 'model', 'relation', 'scope', 'accessor', 'mutator', 'cast', 'factory', 'seeder', 'hasMany', 'belongsTo', 'morphTo'],
    },
    {
      name: 'blade',
      description: 'Laravel Blade templates',
      keywords: ['blade', 'template', 'view', 'component', 'slot', 'directive', 'layout', 'section', 'yield'],
    },
    {
      name: 'artisan',
      description: 'Laravel Artisan commands',
      keywords: ['artisan', 'command', 'console', 'schedule', 'cron', 'tinker'],
    },
    {
      name: 'filament',
      description: 'Filament admin panel',
      keywords: ['filament', 'resource', 'widget', 'page', 'panel', 'admin', 'form', 'table', 'infolist'],
    },
    {
      name: 'livewire',
      description: 'Laravel Livewire components',
      keywords: ['livewire', 'wire', 'alpine', 'reactive', 'emit', 'dispatch'],
    },
    {
      name: 'nova',
      description: 'Laravel Nova admin',
      keywords: ['nova', 'resource', 'lens', 'action', 'filter', 'metric', 'card'],
    },
    {
      name: 'sanctum',
      description: 'Laravel Sanctum authentication',
      keywords: ['sanctum', 'token', 'ability', 'personalAccessToken', 'spa'],
    },
    {
      name: 'horizon',
      description: 'Laravel Horizon queue management',
      keywords: ['horizon', 'supervisor', 'balance', 'queue', 'redis'],
    },
  ],

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
      discoverControllersFromRoutesByKeyword(ctx, found), // NEW: proactive route discovery
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
 * Proactively read route files (web.php, api.php) and find controllers
 * related to the task keywords. This enables discovery even when route
 * files aren't in the initial candidate set.
 */
async function discoverControllersFromRoutesByKeyword(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const routeFiles = ['routes/web.php', 'routes/api.php'];
  const allFiles = ctx.db.getAllFiles();

  // Build a set of keywords to match against routes
  const taskKeywords = new Set<string>();
  for (const keyword of ctx.task.keywords) {
    if (keyword.length > 2) {
      taskKeywords.add(keyword.toLowerCase());
    }
  }
  for (const domain of ctx.task.domains) {
    if (domain.length > 2) {
      taskKeywords.add(domain.toLowerCase());
    }
  }
  for (const symbol of ctx.task.symbols) {
    if (symbol.length > 2) {
      taskKeywords.add(symbol.toLowerCase());
    }
  }

  if (taskKeywords.size === 0) return;

  for (const routeFile of routeFiles) {
    const routeFullPath = path.join(ctx.rootDir, routeFile);
    if (!fs.existsSync(routeFullPath)) continue;

    try {
      const content = fs.readFileSync(routeFullPath, 'utf-8');

      // Also add the route file itself if it matches keywords
      const contentLower = content.toLowerCase();
      let routeFileRelevant = false;
      for (const keyword of taskKeywords) {
        if (contentLower.includes(keyword)) {
          routeFileRelevant = true;
          break;
        }
      }

      if (routeFileRelevant && !ctx.candidates.has(routeFile) && !found.has(routeFile)) {
        found.set(routeFile, {
          ...createDefaultSignals(),
          relatedFile: true,
        });
      }

      // Parse routes and match against keywords
      // Pattern 1: Route::method('/path', [Controller::class, 'method'])
      const routePattern1 = /Route::\w+\(\s*['"]([^'"]+)['"]\s*,\s*\[\s*([A-Z][a-zA-Z]+Controller)::class\s*,\s*['"]([a-zA-Z_]+)['"]\s*\]/g;
      let match;

      while ((match = routePattern1.exec(content)) !== null) {
        const routePath = match[1];
        const controller = match[2];
        const method = match[3];

        // Check if route path, controller, or method matches any keyword
        const combined = `${routePath} ${controller} ${method}`.toLowerCase();
        const isRelevant = [...taskKeywords].some(kw => combined.includes(kw));

        if (isRelevant) {
          // Find the controller file
          for (const file of allFiles) {
            if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

            if (file.path.endsWith(`${controller}.php`)) {
              found.set(file.path, {
                ...createDefaultSignals(),
                relatedFile: true,
              });
            }
          }
        }
      }

      // Pattern 2: Route::method('/path', 'Controller@method')
      const routePattern2 = /Route::\w+\(\s*['"]([^'"]+)['"]\s*,\s*['"]([A-Z][a-zA-Z]+Controller)@([a-zA-Z_]+)['"]\s*\)/g;

      while ((match = routePattern2.exec(content)) !== null) {
        const routePath = match[1];
        const controller = match[2];
        const method = match[3];

        const combined = `${routePath} ${controller} ${method}`.toLowerCase();
        const isRelevant = [...taskKeywords].some(kw => combined.includes(kw));

        if (isRelevant) {
          for (const file of allFiles) {
            if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

            if (file.path.endsWith(`${controller}.php`)) {
              found.set(file.path, {
                ...createDefaultSignals(),
                relatedFile: true,
              });
            }
          }
        }
      }

      // Pattern 3: Route::method('/path', [Controller::class, 'method']) - single line
      // Also captures Route::resource, Route::apiResource
      const routePattern3 = /Route::(?:get|post|put|patch|delete|any|resource|apiResource)\s*\(\s*['"]([^'"]+)['"][^)]*?([A-Z][a-zA-Z]+Controller)/g;

      while ((match = routePattern3.exec(content)) !== null) {
        const routePath = match[1];
        const controller = match[2];

        const combined = `${routePath} ${controller}`.toLowerCase();
        const isRelevant = [...taskKeywords].some(kw => combined.includes(kw));

        if (isRelevant) {
          for (const file of allFiles) {
            if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

            if (file.path.endsWith(`${controller}.php`)) {
              found.set(file.path, {
                ...createDefaultSignals(),
                relatedFile: true,
              });
            }
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
