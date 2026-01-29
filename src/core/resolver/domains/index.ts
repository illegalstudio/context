/**
 * Domain Management Module
 *
 * Exports domain-related functionality for use throughout the application.
 */

export { DomainManager, type CustomDomain, type ProjectDomainsConfig } from './DomainManager.js';
export {
  CORE_DOMAINS,
  getCoreDomainKeywords,
  type DomainDefinition,
} from './builtin.js';
