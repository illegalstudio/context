/**
 * Domain Management CLI Commands
 *
 * context domains list    - List all active domains
 * context domains add     - Add a custom domain
 * context domains remove  - Remove a custom domain
 */

import { DomainManager, CORE_DOMAINS } from '../../core/resolver/domains/index.js';
import { logger } from '../utils/logger.js';

export interface DomainsListOptions {
  all?: boolean;     // Show all domains including disabled
  verbose?: boolean; // Show keywords
}

export interface DomainsAddOptions {
  name: string;
  description?: string;
  keywords: string[];
}

export interface DomainsRemoveOptions {
  name: string;
}

/**
 * List all active domains
 */
export async function domainsListCommand(options: DomainsListOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const manager = new DomainManager(cwd);
  await manager.detectFrameworks();

  logger.header('Domains');

  // Get detected frameworks
  const frameworks = manager.getDetectedFrameworks();
  if (frameworks.length > 0) {
    logger.info(`Detected frameworks: ${frameworks.join(', ')}`);
    logger.blank();
  }

  // Get all domains grouped by source
  const domains = manager.getAllDomains();

  // Group by source
  const grouped: Record<string, typeof domains> = {};
  for (const item of domains) {
    if (!grouped[item.source]) {
      grouped[item.source] = [];
    }
    grouped[item.source].push(item);
  }

  // Display core domains
  if (grouped.core) {
    logger.info('Core Domains:');
    for (const { domain } of grouped.core) {
      const line = `  ${domain.name.padEnd(15)} - ${domain.description}`;
      logger.dim(line);
      if (options.verbose) {
        logger.dim(`    Keywords: ${domain.keywords.slice(0, 10).join(', ')}${domain.keywords.length > 10 ? '...' : ''}`);
      }
    }
    logger.blank();
  }

  // Display framework domains
  if (grouped.framework && grouped.framework.length > 0) {
    const frameworkLabel = frameworks.length > 0
      ? `Framework Domains (${frameworks.join(', ')}):`
      : 'Framework Domains:';
    logger.info(frameworkLabel);
    for (const { domain } of grouped.framework) {
      const line = `  ${domain.name.padEnd(15)} - ${domain.description}`;
      logger.dim(line);
      if (options.verbose) {
        logger.dim(`    Keywords: ${domain.keywords.slice(0, 10).join(', ')}${domain.keywords.length > 10 ? '...' : ''}`);
      }
    }
    logger.blank();
  }

  // Display custom domains
  if (grouped.custom && grouped.custom.length > 0) {
    logger.info('Custom Domains:');
    for (const { domain } of grouped.custom) {
      const line = `  ${domain.name.padEnd(15)} - ${domain.description || '(no description)'}`;
      logger.success(line);
      if (options.verbose) {
        logger.dim(`    Keywords: ${domain.keywords.join(', ')}`);
      }
    }
    logger.blank();
  }

  // Display disabled domains
  const disabled = manager.getDisabledDomains();
  if (disabled.length > 0) {
    logger.info('Disabled Domains:');
    for (const name of disabled) {
      logger.dim(`  ${name}`);
    }
    logger.blank();
  }

  // Show totals
  const totalActive = domains.length;
  const totalCustom = grouped.custom?.length || 0;
  logger.dim(`Total: ${totalActive} active domains (${totalCustom} custom)`);
}

/**
 * Add a custom domain
 */
export async function domainsAddCommand(name: string, keywords: string[], description?: string): Promise<void> {
  const cwd = process.cwd();
  const manager = new DomainManager(cwd);

  // Validate inputs
  if (!name || name.length < 2) {
    logger.error('Domain name must be at least 2 characters');
    process.exit(1);
  }

  if (!keywords || keywords.length === 0) {
    logger.error('At least one keyword is required');
    process.exit(1);
  }

  // Check if it conflicts with built-in
  if (CORE_DOMAINS[name]) {
    logger.warning(`Domain "${name}" exists as a core domain. Your custom domain will override it.`);
  }

  // Add the domain
  manager.addCustomDomain({
    name,
    description: description || `Custom domain: ${name}`,
    keywords,
  });

  logger.success(`Added custom domain: ${name}`);
  logger.dim(`Keywords: ${keywords.join(', ')}`);
}

/**
 * Remove a custom domain
 */
export async function domainsRemoveCommand(name: string): Promise<void> {
  const cwd = process.cwd();
  const manager = new DomainManager(cwd);

  // Check if it's a custom domain
  const customDomains = manager.getCustomDomains();
  const isCustom = customDomains.some(d => d.name === name);

  if (isCustom) {
    const removed = manager.removeCustomDomain(name);
    if (removed) {
      logger.success(`Removed custom domain: ${name}`);
    } else {
      logger.error(`Domain "${name}" not found`);
      process.exit(1);
    }
  } else if (manager.domainExists(name)) {
    // It's a built-in domain - disable it instead
    manager.disableDomain(name);
    logger.success(`Disabled built-in domain: ${name}`);
    logger.dim('Use "context domains enable" to re-enable it.');
  } else {
    logger.error(`Domain "${name}" not found`);
    process.exit(1);
  }
}

/**
 * Enable a previously disabled domain
 */
export async function domainsEnableCommand(name: string): Promise<void> {
  const cwd = process.cwd();
  const manager = new DomainManager(cwd);

  const disabled = manager.getDisabledDomains();
  if (!disabled.includes(name)) {
    logger.warning(`Domain "${name}" is not disabled`);
    return;
  }

  manager.enableDomain(name);
  logger.success(`Enabled domain: ${name}`);
}
