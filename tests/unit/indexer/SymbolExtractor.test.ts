import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SymbolExtractor } from '../../../src/core/indexer/SymbolExtractor.js';
import { createTempProject, cleanupTempProject } from '../../helpers/setup.js';

describe('SymbolExtractor', () => {
  let projectDir: string;
  let extractor: SymbolExtractor;

  afterEach(() => {
    if (projectDir) {
      cleanupTempProject(projectDir);
    }
  });

  describe('TypeScript/JavaScript', () => {
    it('should extract class declarations', async () => {
      projectDir = createTempProject({
        'user.ts': `
export class UserService {
  private users: User[] = [];

  async getUsers(): Promise<User[]> {
    return this.users;
  }
}
        `,
      });

      extractor = new SymbolExtractor(projectDir);
      const symbols = await extractor.extractSymbols('user.ts', 'typescript');

      const classSymbol = symbols.find(s => s.name === 'UserService');
      expect(classSymbol).toBeDefined();
      expect(classSymbol?.kind).toBe('class');
    });

    it('should extract interface declarations', async () => {
      projectDir = createTempProject({
        'types.ts': `
export interface User {
  id: string;
  name: string;
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
}
        `,
      });

      extractor = new SymbolExtractor(projectDir);
      const symbols = await extractor.extractSymbols('types.ts', 'typescript');

      const userInterface = symbols.find(s => s.name === 'User');
      const apiResponse = symbols.find(s => s.name === 'ApiResponse');

      expect(userInterface).toBeDefined();
      expect(apiResponse).toBeDefined();
    });

    it('should extract function declarations', async () => {
      projectDir = createTempProject({
        'utils.ts': `
export function formatDate(date: Date): string {
  return date.toISOString();
}

export async function fetchData(url: string): Promise<any> {
  const response = await fetch(url);
  return response.json();
}
        `,
      });

      extractor = new SymbolExtractor(projectDir);
      const symbols = await extractor.extractSymbols('utils.ts', 'typescript');

      const formatDate = symbols.find(s => s.name === 'formatDate');
      const fetchData = symbols.find(s => s.name === 'fetchData');

      expect(formatDate).toBeDefined();
      expect(formatDate?.kind).toBe('function');
      expect(fetchData).toBeDefined();
    });

    it('should extract arrow function assignments', async () => {
      projectDir = createTempProject({
        'handlers.ts': `
export const handleClick = () => {
  console.log('clicked');
};

export const processData = async (data: any) => {
  return data;
};
        `,
      });

      extractor = new SymbolExtractor(projectDir);
      const symbols = await extractor.extractSymbols('handlers.ts', 'typescript');

      expect(symbols.some(s => s.name === 'handleClick')).toBe(true);
      expect(symbols.some(s => s.name === 'processData')).toBe(true);
    });
  });

  describe('PHP', () => {
    it('should extract PHP class declarations', async () => {
      projectDir = createTempProject({
        'UserController.php': `<?php

namespace App\\Http\\Controllers;

class UserController extends Controller
{
    public function index()
    {
        return view('users.index');
    }

    public function store(Request $request)
    {
        // Store user
    }
}
        `,
      });

      extractor = new SymbolExtractor(projectDir);
      const symbols = await extractor.extractSymbols('UserController.php', 'php');

      const classSymbol = symbols.find(s => s.name === 'UserController');
      expect(classSymbol).toBeDefined();
      expect(classSymbol?.kind).toBe('class');

      // Methods
      expect(symbols.some(s => s.name === 'index')).toBe(true);
      expect(symbols.some(s => s.name === 'store')).toBe(true);
    });

    it('should extract PHP interfaces and traits', async () => {
      projectDir = createTempProject({
        'contracts.php': `<?php

interface Authenticatable
{
    public function authenticate();
}

trait HasTimestamps
{
    public function touch()
    {
        $this->updated_at = now();
    }
}
        `,
      });

      extractor = new SymbolExtractor(projectDir);
      const symbols = await extractor.extractSymbols('contracts.php', 'php');

      expect(symbols.some(s => s.name === 'Authenticatable')).toBe(true);
      expect(symbols.some(s => s.name === 'HasTimestamps')).toBe(true);
    });
  });

  describe('Python', () => {
    it('should extract Python class declarations', async () => {
      projectDir = createTempProject({
        'models.py': `
class User:
    def __init__(self, name: str):
        self.name = name

    def get_name(self) -> str:
        return self.name


class Payment:
    amount: float
    currency: str
        `,
      });

      extractor = new SymbolExtractor(projectDir);
      const symbols = await extractor.extractSymbols('models.py', 'python');

      expect(symbols.some(s => s.name === 'User')).toBe(true);
      expect(symbols.some(s => s.name === 'Payment')).toBe(true);
    });

    it('should extract Python function declarations', async () => {
      projectDir = createTempProject({
        'utils.py': `
def format_date(date):
    return date.isoformat()


async def fetch_data(url: str):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()
        `,
      });

      extractor = new SymbolExtractor(projectDir);
      const symbols = await extractor.extractSymbols('utils.py', 'python');

      expect(symbols.some(s => s.name === 'format_date')).toBe(true);
      expect(symbols.some(s => s.name === 'fetch_data')).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty files', async () => {
      projectDir = createTempProject({
        'empty.ts': '',
      });

      extractor = new SymbolExtractor(projectDir);
      const symbols = await extractor.extractSymbols('empty.ts', 'typescript');

      expect(symbols).toEqual([]);
    });

    it('should skip common keywords', async () => {
      projectDir = createTempProject({
        'code.ts': `
if (condition) {
  return true;
}

for (const item of items) {
  console.log(item);
}
        `,
      });

      extractor = new SymbolExtractor(projectDir);
      const symbols = await extractor.extractSymbols('code.ts', 'typescript');

      // Should not extract 'if', 'return', 'for', 'const' as symbols
      expect(symbols.some(s => s.name === 'if')).toBe(false);
      expect(symbols.some(s => s.name === 'return')).toBe(false);
    });

    it('should include line numbers', async () => {
      projectDir = createTempProject({
        'file.ts': `
// Line 1
// Line 2
export class TestClass {
  // Line 4
}
        `,
      });

      extractor = new SymbolExtractor(projectDir);
      const symbols = await extractor.extractSymbols('file.ts', 'typescript');

      const testClass = symbols.find(s => s.name === 'TestClass');
      expect(testClass?.startLine).toBeGreaterThan(0);
    });
  });
});
