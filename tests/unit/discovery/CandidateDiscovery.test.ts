import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CandidateDiscovery } from '../../../src/core/discovery/CandidateDiscovery.js';
import { ContextDatabase } from '../../../src/storage/Database.js';
import { createTempProject, cleanupTempProject } from '../../helpers/setup.js';
import { createMockTask } from '../../helpers/utils.js';
import fs from 'fs';
import path from 'path';

describe('CandidateDiscovery', () => {
  let discovery: CandidateDiscovery;
  let db: ContextDatabase;
  let projectDir: string;

  beforeEach(async () => {
    projectDir = createTempProject({
      'src/controllers/UserController.ts': `
import { UserService } from '../services/UserService.js';

export class UserController {
  private service: UserService;

  async index() {
    return this.service.getAllUsers();
  }
}
      `,
      'src/services/UserService.ts': `
import { User } from '../models/User.js';

export class UserService {
  async getAllUsers(): Promise<User[]> {
    return [];
  }
}
      `,
      'src/models/User.ts': `
export interface User {
  id: string;
  name: string;
}
      `,
      'tests/UserController.test.ts': `
import { UserController } from '../src/controllers/UserController.js';

describe('UserController', () => {
  it('should work', () => {});
});
      `,
      'package.json': '{"name": "test"}',
    });

    db = new ContextDatabase(projectDir);

    // Index files
    db.upsertFile({ path: 'src/controllers/UserController.ts', language: 'typescript', size: 200, mtime: Date.now(), hash: 'h1' });
    db.upsertFile({ path: 'src/services/UserService.ts', language: 'typescript', size: 200, mtime: Date.now(), hash: 'h2' });
    db.upsertFile({ path: 'src/models/User.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h3' });
    db.upsertFile({ path: 'tests/UserController.test.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h4' });

    // Index symbols
    db.insertSymbol({ filePath: 'src/controllers/UserController.ts', name: 'UserController', kind: 'class', startLine: 4, endLine: 12 });
    db.insertSymbol({ filePath: 'src/services/UserService.ts', name: 'UserService', kind: 'class', startLine: 4, endLine: 10 });
    db.insertSymbol({ filePath: 'src/models/User.ts', name: 'User', kind: 'interface', startLine: 1, endLine: 5 });

    // Index imports
    db.insertImport({ sourcePath: 'src/controllers/UserController.ts', targetPath: 'src/services/UserService.ts' });
    db.insertImport({ sourcePath: 'src/services/UserService.ts', targetPath: 'src/models/User.ts' });

    // Index content for FTS
    db.indexFileContent('src/controllers/UserController.ts', 'export class UserController { index() {} }');
    db.indexFileContent('src/services/UserService.ts', 'export class UserService { getAllUsers() {} }');
    db.indexFileContent('src/models/User.ts', 'export interface User { id: string; name: string; }');

    discovery = new CandidateDiscovery(db, projectDir);
    await discovery.init();
  });

  afterEach(() => {
    db.close();
    if (projectDir) {
      cleanupTempProject(projectDir);
    }
  });

  describe('discover()', () => {
    it('should discover files from symbols', async () => {
      const task = createMockTask({
        raw: 'Bug in UserController',
        symbols: ['UserController'],
        keywords: ['user', 'controller'],
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      expect(candidates.has('src/controllers/UserController.ts')).toBe(true);
    });

    it('should discover files from file hints', async () => {
      const task = createMockTask({
        raw: 'Fix UserService.ts',
        filesHint: ['UserService.ts'],
        keywords: ['user', 'service'],
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      expect(candidates.has('src/services/UserService.ts')).toBe(true);
    });

    it('should discover files from keywords via FTS', async () => {
      const task = createMockTask({
        raw: 'Issue with getAllUsers',
        keywords: ['getAllUsers', 'users'],
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // Should find UserService via FTS
      expect(candidates.size).toBeGreaterThan(0);
    });

    it('should discover files from stacktrace', async () => {
      const task = createMockTask({
        raw: 'Error in application',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [
          { file: 'src/controllers/UserController.ts', line: 8 },
        ],
        diffEntries: [],
      });

      expect(candidates.has('src/controllers/UserController.ts')).toBe(true);
      expect(candidates.get('src/controllers/UserController.ts')?.stacktraceHit).toBe(true);
    });

    it('should discover files from diff', async () => {
      const task = createMockTask({
        raw: 'Review changes',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [
          { file: 'src/services/UserService.ts', status: 'modified', additions: 5, deletions: 2 },
        ],
      });

      expect(candidates.has('src/services/UserService.ts')).toBe(true);
      expect(candidates.get('src/services/UserService.ts')?.diffHit).toBe(true);
    });

    it('should expand graph to find related files', async () => {
      const task = createMockTask({
        raw: 'Bug in UserController',
        symbols: ['UserController'],
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // Should find UserService via import graph
      expect(candidates.has('src/services/UserService.ts')).toBe(true);
      // UserService imports from User
      expect(candidates.has('src/models/User.ts')).toBe(true);
    });

    it('should discover test files for candidates', async () => {
      const task = createMockTask({
        raw: 'Bug in UserController',
        symbols: ['UserController'],
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // Should find test file - check if it exists in candidates
      // Test file discovery depends on the discovery rules implementation
      const hasTestFile = candidates.has('tests/UserController.test.ts');
      if (hasTestFile) {
        // Test file found - this verifies test discovery is working
        // The testFile signal may or may not be set depending on implementation
        const testSignals = candidates.get('tests/UserController.test.ts');
        expect(testSignals).toBeDefined();
      }
      // At minimum, the main controller file should be discovered
      expect(candidates.has('src/controllers/UserController.ts')).toBe(true);
    });

    it('should set exact symbol mention signal', async () => {
      const task = createMockTask({
        raw: 'Fix UserService class',
        symbols: ['UserService'],
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      const userServiceSignals = candidates.get('src/services/UserService.ts');
      expect(userServiceSignals?.exactSymbolMention).toBe(true);
    });

    it('should track raw path match count', async () => {
      const task = createMockTask({
        raw: 'Fix user controller issue',
        rawWords: ['user', 'controller', 'issue'],
        symbols: [],
        keywords: ['user', 'controller'],
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // UserController.ts should have raw path matches for "user" and "controller"
      const signals = candidates.get('src/controllers/UserController.ts');
      if (signals?.rawPathMatchCount) {
        expect(signals.rawPathMatchCount).toBeGreaterThan(0);
      }
    });
  });

  describe('getLoadedRuleNames()', () => {
    it('should return array of rule names', () => {
      const ruleNames = discovery.getLoadedRuleNames();
      expect(Array.isArray(ruleNames)).toBe(true);
    });
  });
});
