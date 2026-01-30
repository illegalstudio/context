import fs from 'fs';
import path from 'path';
import type { DiscoveryRule, DiscoveryContext } from '../../DiscoveryRule.js';
import { createDefaultSignals } from '../../DiscoveryRule.js';
import type { CandidateSignals } from '../../../../types/index.js';

/**
 * Node.js Discovery Rule
 *
 * Node.js-specific heuristics:
 * - Component → Test file
 * - Module → Index exports
 */
export const rule: DiscoveryRule = {
  name: 'nodejs',
  description: 'Node.js: Component→Test, Module→Index',
  weight: 0.9,

  ignorePatterns: `
# === Node.js ===
node_modules/
dist/
build/
out/
.next/
.nuxt/
.output/
coverage/
.nyc_output/
.cache/
.parcel-cache/
.turbo/
`.trim(),

  /**
   * Node.js ecosystem domains
   */
  domains: [
    {
      name: 'express',
      description: 'Express.js routing and middleware',
      keywords: ['express', 'router', 'middleware', 'req', 'res', 'next', 'app.use', 'app.get', 'app.post'],
    },
    {
      name: 'prisma',
      description: 'Prisma ORM',
      keywords: ['prisma', 'schema', 'migration', 'client', 'model', 'findMany', 'create', 'update', 'delete'],
    },
    {
      name: 'nextjs',
      description: 'Next.js framework',
      keywords: ['nextjs', 'getServerSideProps', 'getStaticProps', 'getStaticPaths', 'useRouter', 'Image', 'Link', 'Head', 'app router', 'page router'],
    },
    {
      name: 'nestjs',
      description: 'NestJS framework',
      // Use NestJS-specific decorators to avoid matching generic terms like "controller"/"service" in Laravel/other frameworks
      keywords: ['nestjs', '@nestjs', '@Controller', '@Injectable', '@Module', '@Guard', '@Pipe', '@Interceptor', '@Get', '@Post', '@Put', '@Delete', '@Patch'],
    },
    {
      name: 'react',
      description: 'React components and hooks',
      keywords: ['react', 'useState', 'useEffect', 'useContext', 'useReducer', 'useMemo', 'useCallback', 'useRef', 'component', 'jsx', 'tsx'],
    },
    {
      name: 'redux',
      description: 'Redux state management',
      keywords: ['redux', 'store', 'reducer', 'action', 'dispatch', 'selector', 'slice', 'thunk', 'saga', 'toolkit'],
    },
    {
      name: 'vue',
      description: 'Vue.js framework',
      keywords: ['vue', 'ref', 'reactive', 'computed', 'watch', 'onMounted', 'defineComponent', 'setup', 'template'],
    },
    {
      name: 'graphql',
      description: 'GraphQL API',
      keywords: ['graphql', 'query', 'mutation', 'subscription', 'resolver', 'schema', 'type', 'apollo', 'gql'],
    },
  ],

  appliesTo(rootDir: string): boolean {
    return fs.existsSync(path.join(rootDir, 'package.json'));
  },

  async discover(ctx: DiscoveryContext): Promise<Map<string, CandidateSignals>> {
    const found = new Map<string, CandidateSignals>();

    await Promise.all([
      discoverTestFiles(ctx, found),
      discoverIndexExports(ctx, found),
    ]);

    return found;
  },
};

/**
 * Find test files for candidates
 */
async function discoverTestFiles(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const allFiles = ctx.db.getAllFiles();

  for (const [filePath] of ctx.candidates) {
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    const dir = path.dirname(filePath);

    // Look for test files
    const testPatterns = [
      `${dir}/${baseName}.test${ext}`,
      `${dir}/${baseName}.spec${ext}`,
      `${dir}/__tests__/${baseName}${ext}`,
      `${dir}/__tests__/${baseName}.test${ext}`,
      `tests/${baseName}.test${ext}`,
      `test/${baseName}.test${ext}`,
    ];

    for (const file of allFiles) {
      if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

      if (testPatterns.some(p => file.path === p || file.path.endsWith(p.replace(/^.*\//, '/')))) {
        found.set(file.path, {
          ...createDefaultSignals(),
          testFile: true,
        });
      }
    }
  }
}

/**
 * Find index files that export candidates
 */
async function discoverIndexExports(
  ctx: DiscoveryContext,
  found: Map<string, CandidateSignals>
): Promise<void> {
  const allFiles = ctx.db.getAllFiles();

  for (const [filePath] of ctx.candidates) {
    const dir = path.dirname(filePath);

    // Look for index file in same directory
    for (const file of allFiles) {
      if (ctx.candidates.has(file.path) || found.has(file.path)) continue;

      if (
        file.path === `${dir}/index.ts` ||
        file.path === `${dir}/index.js` ||
        file.path === `${dir}/index.tsx` ||
        file.path === `${dir}/index.jsx`
      ) {
        found.set(file.path, {
          ...createDefaultSignals(),
          relatedFile: true,
        });
      }
    }
  }
}

export default rule;
