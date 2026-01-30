/**
 * Global test setup and teardown utilities
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Test codebases directory
export const CODEBASES_DIR = path.join(import.meta.dirname, '..', 'codebases');

// Temp directory for test databases
let tempDir: string | null = null;

/**
 * Create a temporary directory for test databases
 */
export function createTempDir(): string {
  if (!tempDir) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-packer-test-'));
  }
  return tempDir;
}

/**
 * Clean up temporary directory
 */
export function cleanupTempDir(): void {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
}

/**
 * Get the path to a test codebase
 */
export function getCodebasePath(name: string): string {
  return path.join(CODEBASES_DIR, name);
}

/**
 * Create a temporary project directory with given files
 */
export function createTempProject(files: Record<string, string>): string {
  const projectDir = path.join(createTempDir(), `project-${Date.now()}`);
  fs.mkdirSync(projectDir, { recursive: true });

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(projectDir, filePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  return projectDir;
}

/**
 * Clean up a temporary project directory
 */
export function cleanupTempProject(projectDir: string): void {
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}
