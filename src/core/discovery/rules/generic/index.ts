import path from 'path';
import type { DiscoveryRule, DiscoveryContext } from '../../DiscoveryRule.js';
import { createDefaultSignals } from '../../DiscoveryRule.js';
import type { CandidateSignals } from '../../../../types/index.js';

/**
 * Generic Discovery Rule
 *
 * Universal patterns that apply to all projects:
 * - Config files for candidates
 * - Similar patterns in the codebase
 */
export const rule: DiscoveryRule = {
  name: 'generic',
  description: 'Universal patterns: config files, similar patterns',
  weight: 0.8,

  ignorePatterns: `
# === Universal ===
.git/
.context/

# Logs
*.log
logs/

# Minified/compiled assets
*.min.js
*.min.css
*.map
*.bundle.js
*.bundle.css

# Build outputs
dist/
build/
out/

# Cache
.cache/
.tmp/
tmp/
temp/

# IDE/Editor
.idea/
.vscode/
*.swp
*.swo
.DS_Store

# Lock files
package-lock.json
yarn.lock
pnpm-lock.yaml
composer.lock
Gemfile.lock
Cargo.lock
poetry.lock

# Security - never index
.env
.env.*
!.env.example
*.pem
*.key
*.p12
*.pfx
id_rsa
id_dsa
id_ecdsa
id_ed25519
credentials.json
secrets.json
secrets.yaml
`.trim(),

  appliesTo(): boolean {
    // Generic rule always applies
    return true;
  },

  async discover(ctx: DiscoveryContext): Promise<Map<string, CandidateSignals>> {
    const found = new Map<string, CandidateSignals>();

    // Find config files related to candidates
    await findRelatedConfigs(ctx, found);

    // Find similar patterns in codebase
    await findSimilarPatterns(ctx, found);

    return found;
  },
};

/**
 * Find config files that might be related to candidate files
 */
async function findRelatedConfigs(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const configPatterns = [
    /\.config\./,
    /config\//,
    /\.env\.example$/,
    /tsconfig\.json$/,
    /package\.json$/,
    /composer\.json$/,
    /webpack\.config/,
    /vite\.config/,
    /tailwind\.config/,
    /eslint/,
    /prettier/,
  ];

  // Get candidate directories
  const candidateDirs = new Set<string>();
  for (const filePath of ctx.candidates.keys()) {
    const dir = path.dirname(filePath);
    candidateDirs.add(dir);

    // Also add parent directory for context
    const parentDir = path.dirname(dir);
    if (parentDir && parentDir !== '.') {
      candidateDirs.add(parentDir);
    }
  }

  const allFiles = ctx.db.getAllFiles();

  // Find config files in candidate directories or root
  for (const file of allFiles) {
    const fileDir = path.dirname(file.path);
    const isInCandidateDir = candidateDirs.has(fileDir);
    const isRootConfig = fileDir === '.' || fileDir === '';

    if (!isInCandidateDir && !isRootConfig) continue;

    const isConfig = configPatterns.some(p => p.test(file.path));
    if (isConfig && !ctx.candidates.has(file.path)) {
      found.set(file.path, {
        ...createDefaultSignals(),
        relatedFile: true,
      });
    }
  }
}

/**
 * Find files with similar naming patterns to candidates
 */
async function findSimilarPatterns(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const allFiles = ctx.db.getAllFiles();

  for (const [candidatePath] of ctx.candidates) {
    const candidateName = path.basename(candidatePath);
    const candidateExt = path.extname(candidatePath);
    const baseName = candidateName.replace(candidateExt, '');

    // Extract pattern from name
    // e.g., ShopController -> look for other *Controller files
    const suffixes = ['Controller', 'Service', 'Repository', 'Model', 'Handler', 'Middleware', 'Provider'];

    for (const suffix of suffixes) {
      if (baseName.endsWith(suffix)) {
        const prefix = baseName.replace(new RegExp(`${suffix}$`), '');

        // Look for related files with same prefix
        for (const file of allFiles) {
          if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

          const fileName = path.basename(file.path);
          const fileBaseName = fileName.replace(path.extname(fileName), '');

          // Check if file has the same prefix but different suffix
          if (fileBaseName.startsWith(prefix) && fileBaseName !== baseName) {
            // Check if it's a related type
            const isRelatedType = suffixes.some(s =>
              fileBaseName.endsWith(s) && fileBaseName !== baseName
            );

            if (isRelatedType) {
              found.set(file.path, {
                ...createDefaultSignals(),
                relatedFile: true,
              });
            }
          }
        }

        break;
      }
    }
  }
}

export default rule;
