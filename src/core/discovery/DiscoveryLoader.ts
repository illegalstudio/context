import fs from 'fs';
import path from 'path';
import type { DiscoveryRule, DiscoveryContext } from './DiscoveryRule.js';
import { createDefaultSignals, mergeSignals } from './DiscoveryRule.js';
import type { CandidateSignals } from '../../types/index.js';
import { builtInRules } from './rules/index.js';

/**
 * Project detection cache structure
 */
export interface ProjectCache {
  detectedAt: string;
  activeDiscoveries: string[];
}

/**
 * DiscoveryLoader - Orchestrates loading and running discovery rules
 *
 * Responsible for:
 * - Loading built-in rules
 * - Detecting which rules apply to the project
 * - Loading and merging ctxignore patterns from each rule
 * - Caching project detection in .context/project.json
 */
export class DiscoveryLoader {
  private rules: DiscoveryRule[] = [];
  private appliedRuleNames: string[] = [];

  constructor(private rootDir: string) {}

  /**
   * Initialize by detecting which rules apply to this project
   * Uses cache if available, otherwise detects fresh
   */
  async init(): Promise<void> {
    // Try to load from cache first
    const cache = this.loadCache();

    if (cache) {
      // Use cached discoveries
      this.appliedRuleNames = cache.activeDiscoveries;
      this.rules = builtInRules.filter(r => this.appliedRuleNames.includes(r.name));
      return;
    }

    // Fresh detection
    await this.detectRules();
  }

  /**
   * Force fresh detection (ignore cache)
   */
  async detectRules(): Promise<void> {
    this.rules = [];
    this.appliedRuleNames = [];

    for (const rule of builtInRules) {
      try {
        const applies = await rule.appliesTo(this.rootDir);
        if (applies) {
          this.rules.push(rule);
          this.appliedRuleNames.push(rule.name);
        }
      } catch {
        // If a rule fails to check, skip it
      }
    }
  }

  /**
   * Save current detection to cache
   */
  saveCache(): void {
    const contextDir = path.join(this.rootDir, '.context');
    if (!fs.existsSync(contextDir)) {
      fs.mkdirSync(contextDir, { recursive: true });
    }

    const cache: ProjectCache = {
      detectedAt: new Date().toISOString(),
      activeDiscoveries: this.appliedRuleNames,
    };

    const cachePath = path.join(contextDir, 'project.json');
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  }

  /**
   * Load cache if it exists
   */
  private loadCache(): ProjectCache | null {
    const cachePath = path.join(this.rootDir, '.context', 'project.json');

    if (!fs.existsSync(cachePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Clear the cache (forces re-detection on next init)
   */
  clearCache(): void {
    const cachePath = path.join(this.rootDir, '.context', 'project.json');
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  }

  /**
   * Get the names of rules that apply to this project
   */
  getAppliedRuleNames(): string[] {
    return this.appliedRuleNames;
  }

  /**
   * Get merged ctxignore content from all applicable rules
   */
  getMergedCtxIgnore(): string {
    const sections: string[] = [];

    sections.push('# Context Packer - Ignore Patterns');
    sections.push('# Auto-generated based on detected project type');
    sections.push('# Modify this file to control which files are excluded');
    sections.push('# Syntax: same as .gitignore');
    sections.push('');

    for (const rule of this.rules) {
      if (rule.ignorePatterns) {
        sections.push(rule.ignorePatterns);
        sections.push('');
      }
    }

    return sections.join('\n');
  }

  /**
   * Run all applicable rules and merge their discoveries
   */
  async runAll(ctx: DiscoveryContext): Promise<Map<string, CandidateSignals>> {
    const allDiscovered = new Map<string, CandidateSignals>();

    for (const rule of this.rules) {
      try {
        const discovered = await rule.discover(ctx);

        // Merge discovered candidates
        for (const [filePath, signals] of discovered) {
          const existing = allDiscovered.get(filePath) || ctx.candidates.get(filePath);

          if (existing) {
            allDiscovered.set(filePath, mergeSignals(existing, signals));
          } else {
            allDiscovered.set(filePath, {
              ...createDefaultSignals(),
              ...signals,
            });
          }
        }
      } catch (error) {
        // Log error but continue with other rules
        console.error(`Discovery rule '${rule.name}' failed:`, error);
      }
    }

    return allDiscovered;
  }

  /**
   * Check if a specific rule is loaded
   */
  hasRule(ruleName: string): boolean {
    return this.appliedRuleNames.includes(ruleName);
  }

  /**
   * Get count of loaded rules
   */
  getRuleCount(): number {
    return this.rules.length;
  }
}
