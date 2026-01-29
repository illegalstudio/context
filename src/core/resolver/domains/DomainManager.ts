/**
 * Domain Manager
 *
 * Manages domain definitions from multiple sources:
 * - Built-in core domains (generic, apply to all projects)
 * - Framework-specific domains (loaded from discovery rules)
 * - Project-specific custom domains (user-defined)
 */

import fs from 'fs';
import path from 'path';
import { CORE_DOMAINS, getCoreDomainKeywords, type DomainDefinition } from './builtin.js';
import { DiscoveryLoader } from '../../discovery/DiscoveryLoader.js';

export interface CustomDomain {
  name: string;
  description: string;
  keywords: string[];
}

export interface ProjectDomainsConfig {
  customDomains: CustomDomain[];
  disabledDomains: string[];  // Domains to exclude
}

const DEFAULT_CONFIG: ProjectDomainsConfig = {
  customDomains: [],
  disabledDomains: [],
};

export class DomainManager {
  private rootDir: string;
  private configPath: string;
  private config: ProjectDomainsConfig;
  private discoveryLoader: DiscoveryLoader;
  private frameworkDomains: Record<string, { description: string; keywords: string[] }> = {};

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.configPath = path.join(rootDir, '.context', 'domains.json');
    this.config = this.loadConfig();
    this.discoveryLoader = new DiscoveryLoader(rootDir);
  }

  /**
   * Load project domain configuration
   */
  private loadConfig(): ProjectDomainsConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
      }
    } catch (error) {
      // Ignore errors, use default
    }
    return { ...DEFAULT_CONFIG };
  }

  /**
   * Save project domain configuration
   */
  saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      throw new Error(`Failed to save domain config: ${error}`);
    }
  }

  /**
   * Detect frameworks and load their domains from discovery rules
   */
  async detectFrameworks(): Promise<string[]> {
    await this.discoveryLoader.init();
    this.frameworkDomains = this.discoveryLoader.getFrameworkDomains();
    return this.discoveryLoader.getAppliedRuleNames();
  }

  /**
   * Synchronous version - uses cached detection
   */
  detectFrameworksSync(): string[] {
    // Try to detect without async
    this.discoveryLoader.detectRules();
    this.frameworkDomains = this.discoveryLoader.getFrameworkDomains();
    return this.discoveryLoader.getAppliedRuleNames();
  }

  /**
   * Get all active domain keywords (for use in task analysis)
   * Combines core + framework + custom domains
   */
  getAllDomainKeywords(): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    // Add core domains (unless disabled)
    for (const [name, domain] of Object.entries(CORE_DOMAINS)) {
      if (!this.config.disabledDomains.includes(name)) {
        result[name] = domain.keywords;
      }
    }

    // Add framework-specific domains (from discovery rules)
    for (const [name, domain] of Object.entries(this.frameworkDomains)) {
      if (!this.config.disabledDomains.includes(name)) {
        result[name] = domain.keywords;
      }
    }

    // Add custom domains
    for (const custom of this.config.customDomains) {
      result[custom.name] = custom.keywords;
    }

    return result;
  }

  /**
   * Get all domain definitions (for display/listing)
   */
  getAllDomains(): { source: string; domain: DomainDefinition | CustomDomain }[] {
    const result: { source: string; domain: DomainDefinition | CustomDomain }[] = [];

    // Core domains
    for (const domain of Object.values(CORE_DOMAINS)) {
      if (!this.config.disabledDomains.includes(domain.name)) {
        result.push({ source: 'core', domain });
      }
    }

    // Framework domains (from discovery rules)
    for (const [name, data] of Object.entries(this.frameworkDomains)) {
      if (!this.config.disabledDomains.includes(name)) {
        result.push({
          source: 'framework',
          domain: { name, description: data.description, keywords: data.keywords },
        });
      }
    }

    // Custom domains
    for (const domain of this.config.customDomains) {
      result.push({ source: 'custom', domain });
    }

    return result;
  }

  /**
   * Add a custom domain
   */
  addCustomDomain(domain: CustomDomain): void {
    // Check if already exists
    const existing = this.config.customDomains.findIndex(d => d.name === domain.name);
    if (existing >= 0) {
      // Update existing
      this.config.customDomains[existing] = domain;
    } else {
      this.config.customDomains.push(domain);
    }
    this.saveConfig();
  }

  /**
   * Remove a custom domain
   */
  removeCustomDomain(name: string): boolean {
    const index = this.config.customDomains.findIndex(d => d.name === name);
    if (index >= 0) {
      this.config.customDomains.splice(index, 1);
      this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Disable a built-in domain
   */
  disableDomain(name: string): void {
    if (!this.config.disabledDomains.includes(name)) {
      this.config.disabledDomains.push(name);
      this.saveConfig();
    }
  }

  /**
   * Enable a previously disabled domain
   */
  enableDomain(name: string): void {
    const index = this.config.disabledDomains.indexOf(name);
    if (index >= 0) {
      this.config.disabledDomains.splice(index, 1);
      this.saveConfig();
    }
  }

  /**
   * Get detected framework names
   */
  getDetectedFrameworks(): string[] {
    return this.discoveryLoader.getAppliedRuleNames();
  }

  /**
   * Get custom domains
   */
  getCustomDomains(): CustomDomain[] {
    return this.config.customDomains;
  }

  /**
   * Get disabled domains
   */
  getDisabledDomains(): string[] {
    return this.config.disabledDomains;
  }

  /**
   * Check if a domain exists (core, framework, or custom)
   */
  domainExists(name: string): boolean {
    if (CORE_DOMAINS[name]) return true;
    if (this.frameworkDomains[name]) return true;
    return this.config.customDomains.some(d => d.name === name);
  }
}
