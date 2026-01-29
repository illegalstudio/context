/**
 * Built-in Core Domain Definitions
 *
 * These are generic domains that apply to most software projects,
 * regardless of framework. Framework-specific domains are defined
 * in their respective discovery rule files (e.g., laravel/index.ts).
 *
 * Each domain has:
 * - name: unique identifier
 * - description: human-readable description
 * - keywords: words that indicate this domain when found in the task
 */

export interface DomainDefinition {
  name: string;
  description: string;
  keywords: string[];
}

/**
 * Core domains that apply to most software projects
 * Framework-specific domains are loaded from discovery rules
 */
export const CORE_DOMAINS: Record<string, DomainDefinition> = {
  auth: {
    name: 'auth',
    description: 'Authentication and authorization',
    keywords: ['auth', 'authentication', 'login', 'logout', 'session', 'token', 'jwt', 'oauth', 'password', 'permission', 'role', 'credential', 'sso', 'saml', '2fa', 'mfa'],
  },

  payments: {
    name: 'payments',
    description: 'Payment processing and billing',
    keywords: ['payment', 'stripe', 'checkout', 'charge', 'invoice', 'subscription', 'billing', 'price', 'cart', 'order', 'webhook', 'refund', 'paypal', 'transaction', 'credit', 'wallet'],
  },

  api: {
    name: 'api',
    description: 'API endpoints and routing',
    keywords: ['api', 'endpoint', 'route', 'rest', 'graphql', 'request', 'response', 'controller', 'middleware', 'cors', 'rate', 'limit', 'swagger', 'openapi'],
  },

  database: {
    name: 'database',
    description: 'Database operations and ORM',
    keywords: ['database', 'db', 'query', 'migration', 'model', 'schema', 'table', 'column', 'index', 'sql', 'orm', 'relation', 'foreign', 'seed', 'factory'],
  },

  cache: {
    name: 'cache',
    description: 'Caching and session storage',
    keywords: ['cache', 'redis', 'memcache', 'session', 'store', 'ttl', 'invalidate', 'flush', 'memoize'],
  },

  queue: {
    name: 'queue',
    description: 'Background jobs and queues',
    keywords: ['queue', 'job', 'worker', 'dispatch', 'listener', 'event', 'async', 'background', 'schedule', 'cron'],
  },

  email: {
    name: 'email',
    description: 'Email and notifications',
    keywords: ['email', 'mail', 'smtp', 'notification', 'template', 'send', 'inbox', 'mailer', 'newsletter'],
  },

  storage: {
    name: 'storage',
    description: 'File storage and media',
    keywords: ['storage', 'file', 'upload', 'download', 's3', 'disk', 'filesystem', 'image', 'media', 'asset', 'attachment'],
  },

  testing: {
    name: 'testing',
    description: 'Testing and quality assurance',
    keywords: ['test', 'spec', 'mock', 'stub', 'fixture', 'assert', 'expect', 'unit', 'integration', 'e2e', 'coverage'],
  },

  security: {
    name: 'security',
    description: 'Security and vulnerability prevention',
    keywords: ['security', 'xss', 'csrf', 'injection', 'sanitize', 'escape', 'validate', 'encrypt', 'decrypt', 'hash', 'vulnerability', 'firewall'],
  },

  performance: {
    name: 'performance',
    description: 'Performance optimization',
    keywords: ['performance', 'slow', 'fast', 'optimize', 'speed', 'latency', 'cache', 'index', 'query', 'n+1', 'profil'],
  },

  ui: {
    name: 'ui',
    description: 'User interface and frontend',
    keywords: ['ui', 'component', 'view', 'template', 'frontend', 'css', 'style', 'layout', 'form', 'button', 'modal'],
  },

  chat: {
    name: 'chat',
    description: 'Messaging and chat functionality',
    keywords: ['chat', 'message', 'messaging', 'conversation', 'inbox', 'dm', 'direct', 'unlock', 'thread', 'realtime', 'websocket', 'pusher'],
  },

  moderation: {
    name: 'moderation',
    description: 'Content moderation and user management',
    keywords: ['report', 'ban', 'suspend', 'dispute', 'flag', 'moderate', 'block', 'abuse', 'spam', 'review'],
  },

  sms: {
    name: 'sms',
    description: 'SMS and phone verification',
    keywords: ['sms', 'text', 'mobile', 'phone', 'otp', 'verification', 'twilio', 'nexmo', 'vonage', 'pin'],
  },

  search: {
    name: 'search',
    description: 'Search functionality',
    keywords: ['search', 'query', 'filter', 'sort', 'elasticsearch', 'algolia', 'meilisearch', 'fulltext'],
  },

  export: {
    name: 'export',
    description: 'Data export and reporting',
    keywords: ['export', 'report', 'csv', 'excel', 'pdf', 'download', 'generate'],
  },

  localization: {
    name: 'localization',
    description: 'Internationalization and translation',
    keywords: ['i18n', 'l10n', 'translation', 'locale', 'language', 'translate', 'multilingual'],
  },

  logging: {
    name: 'logging',
    description: 'Logging and monitoring',
    keywords: ['log', 'logging', 'monitor', 'debug', 'trace', 'audit', 'sentry', 'bugsnag'],
  },
};

/**
 * Get all core domain keywords as a flat record
 */
export function getCoreDomainKeywords(): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const [name, domain] of Object.entries(CORE_DOMAINS)) {
    result[name] = domain.keywords;
  }

  return result;
}
