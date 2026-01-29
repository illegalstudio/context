import fs from 'fs';
import path from 'path';
import type { DiscoveryRule, DiscoveryContext } from '../../DiscoveryRule.js';
import { createDefaultSignals } from '../../DiscoveryRule.js';
import type { CandidateSignals } from '../../../../types/index.js';

/**
 * Statamic CMS Discovery Rule
 *
 * Statamic-specific heuristics:
 * - Blueprint → Fields, related templates
 * - Taxonomy usage across templates
 * - Antlers template relationships
 * - Collection → Entries, Blueprints
 */
export const rule: DiscoveryRule = {
  name: 'statamic',
  description: 'Statamic CMS: Blueprint→Fields, Taxonomy usage, Antlers templates',
  weight: 1.0,

  ignorePatterns: `
# === Statamic ===
.meta/
*.meta.yaml
content/assets/
users/*.yaml
storage/statamic/
`.trim(),

  appliesTo(rootDir: string): boolean {
    const composerPath = path.join(rootDir, 'composer.json');
    if (!fs.existsSync(composerPath)) return false;

    try {
      const content = fs.readFileSync(composerPath, 'utf-8');
      const composer = JSON.parse(content);
      return !!composer.require?.['statamic/cms'];
    } catch {
      return false;
    }
  },

  async discover(ctx: DiscoveryContext): Promise<Map<string, CandidateSignals>> {
    const found = new Map<string, CandidateSignals>();

    await Promise.all([
      discoverBlueprintsFromCollections(ctx, found),
      discoverTemplatesFromBlueprints(ctx, found),
      discoverTaxonomyUsage(ctx, found),
      discoverFieldsetsFromBlueprints(ctx, found),
      discoverAntlersPartials(ctx, found),
      discoverExampleUsage(ctx, found),
    ]);

    return found;
  },
};

async function discoverBlueprintsFromCollections(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const allFiles = ctx.db.getAllFiles();

  for (const [filePath] of ctx.candidates) {
    const collectionMatch = filePath.match(/content\/collections\/([^/]+)\//);
    if (!collectionMatch) continue;

    const collectionName = collectionMatch[1];

    for (const file of allFiles) {
      if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

      if (
        file.path.includes(`resources/blueprints/collections/${collectionName}/`) ||
        file.path === `resources/blueprints/collections/${collectionName}.yaml`
      ) {
        found.set(file.path, {
          ...createDefaultSignals(),
          relatedFile: true,
        });
      }
    }
  }
}

async function discoverTemplatesFromBlueprints(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const allFiles = ctx.db.getAllFiles();

  for (const [filePath] of ctx.candidates) {
    let templateName: string | null = null;

    const collectionMatch = filePath.match(/content\/collections\/([^/]+)\//);
    if (collectionMatch) {
      templateName = collectionMatch[1];
    }

    const blueprintMatch = filePath.match(/resources\/blueprints\/collections\/([^/]+)/);
    if (blueprintMatch) {
      templateName = blueprintMatch[1].replace('.yaml', '');
    }

    if (!templateName) continue;

    const templatePatterns = [
      `resources/views/${templateName}/`,
      `resources/views/${templateName}.antlers.html`,
      `resources/views/${templateName}.blade.php`,
      `resources/views/collections/${templateName}`,
      `resources/views/${templateName}/show.antlers.html`,
      `resources/views/${templateName}/index.antlers.html`,
    ];

    for (const file of allFiles) {
      if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

      const matchesTemplate = templatePatterns.some(pattern =>
        file.path.startsWith(pattern) || file.path === pattern
      );

      if (matchesTemplate) {
        found.set(file.path, {
          ...createDefaultSignals(),
          relatedFile: true,
        });
      }
    }
  }
}

async function discoverTaxonomyUsage(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const allFiles = ctx.db.getAllFiles();

  for (const [filePath] of ctx.candidates) {
    const taxonomyMatch = filePath.match(/content\/taxonomies\/([^/]+)\//);
    if (!taxonomyMatch) continue;

    const taxonomyName = taxonomyMatch[1];

    for (const file of allFiles) {
      if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

      if (file.path.endsWith('.antlers.html') || file.path.endsWith('.blade.php')) {
        try {
          const content = fs.readFileSync(path.join(ctx.rootDir, file.path), 'utf-8');

          if (
            content.includes(`taxonomy:${taxonomyName}`) ||
            content.includes(`from="${taxonomyName}"`) ||
            content.includes(`taxonomy="${taxonomyName}"`) ||
            content.includes(`:${taxonomyName}`)
          ) {
            found.set(file.path, {
              ...createDefaultSignals(),
              exampleUsage: true,
            });
          }
        } catch {
          // Skip
        }
      }
    }
  }
}

async function discoverFieldsetsFromBlueprints(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const allFiles = ctx.db.getAllFiles();

  for (const [filePath] of ctx.candidates) {
    if (!filePath.includes('resources/blueprints/')) continue;

    try {
      const content = fs.readFileSync(path.join(ctx.rootDir, filePath), 'utf-8');
      const fieldsetPattern = /(?:import|fieldset):\s*([a-z_]+)/gi;
      let match;

      while ((match = fieldsetPattern.exec(content)) !== null) {
        const fieldsetName = match[1];

        for (const file of allFiles) {
          if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

          if (
            file.path === `resources/fieldsets/${fieldsetName}.yaml` ||
            file.path.includes(`resources/fieldsets/${fieldsetName}`)
          ) {
            found.set(file.path, {
              ...createDefaultSignals(),
              relatedFile: true,
            });
          }
        }
      }
    } catch {
      // Skip
    }
  }
}

async function discoverAntlersPartials(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const allFiles = ctx.db.getAllFiles();

  for (const [filePath] of ctx.candidates) {
    if (!filePath.endsWith('.antlers.html')) continue;

    try {
      const content = fs.readFileSync(path.join(ctx.rootDir, filePath), 'utf-8');
      const partialPattern = /\{\{\s*partial(?::|\s+src=["'])([^"'\s}]+)/g;
      let match;

      while ((match = partialPattern.exec(content)) !== null) {
        const partialPath = match[1].replace(/["']/g, '');

        for (const file of allFiles) {
          if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

          if (
            file.path.includes(`resources/views/${partialPath}`) ||
            file.path.includes(`resources/views/partials/${partialPath}`) ||
            file.path.includes(`resources/views/components/${partialPath}`)
          ) {
            found.set(file.path, {
              ...createDefaultSignals(),
              relatedFile: true,
            });
          }
        }
      }
    } catch {
      // Skip
    }
  }
}

async function discoverExampleUsage(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const domainKeywords = ctx.task.domains.concat(ctx.task.keywords.slice(0, 5));
  if (domainKeywords.length === 0) return;

  const allFiles = ctx.db.getAllFiles();

  for (const file of allFiles) {
    if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

    if (!file.path.endsWith('.antlers.html') && !file.path.endsWith('.blade.php')) {
      continue;
    }

    try {
      const content = fs.readFileSync(path.join(ctx.rootDir, file.path), 'utf-8');
      const contentLower = content.toLowerCase();

      let matchCount = 0;
      for (const keyword of domainKeywords) {
        if (contentLower.includes(keyword.toLowerCase())) {
          matchCount++;
        }
      }

      if (matchCount >= 2) {
        found.set(file.path, {
          ...createDefaultSignals(),
          exampleUsage: true,
        });
      }
    } catch {
      // Skip
    }
  }
}

export default rule;
