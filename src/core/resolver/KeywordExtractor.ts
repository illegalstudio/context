// Keyword extraction using rule-based approach (no AI needed)

// Common stopwords to remove
const STOPWORDS = new Set([
  // English
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
  'shall', 'can', 'need', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their', 'what',
  'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there',
  // Technical but too common
  'fix', 'bug', 'issue', 'error', 'problem', 'add', 'update', 'change', 'modify',
  'create', 'delete', 'remove', 'make', 'get', 'set', 'use', 'implement', 'handle',
  'new', 'old', 'file', 'code', 'function', 'method', 'class', 'module', 'component',
  'please', 'need', 'want', 'should', 'work', 'working', 'broken', 'doesn\'t', 'don\'t',
  'isn\'t', 'won\'t', 'can\'t', 'cannot', 'unable', 'able', 'properly', 'correctly',
]);

// Domain keywords that indicate specific areas
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  auth: ['auth', 'authentication', 'login', 'logout', 'session', 'token', 'jwt', 'oauth', 'password', 'user', 'permission', 'role', 'access', 'credential', 'sanctum', 'passport'],
  payments: ['payment', 'stripe', 'checkout', 'charge', 'invoice', 'subscription', 'billing', 'price', 'cart', 'order', 'webhook', 'refund', 'paypal', 'transaction'],
  api: ['api', 'endpoint', 'route', 'rest', 'graphql', 'request', 'response', 'controller', 'middleware', 'cors', 'rate', 'limit'],
  database: ['database', 'db', 'query', 'migration', 'model', 'schema', 'table', 'column', 'index', 'eloquent', 'sql', 'orm', 'relation', 'foreign'],
  cache: ['cache', 'redis', 'memcache', 'session', 'store', 'ttl', 'invalidate', 'flush'],
  queue: ['queue', 'job', 'worker', 'dispatch', 'listener', 'event', 'async', 'background', 'schedule', 'cron'],
  email: ['email', 'mail', 'smtp', 'notification', 'template', 'send', 'inbox', 'mailer'],
  storage: ['storage', 'file', 'upload', 'download', 's3', 'disk', 'filesystem', 'image', 'media', 'asset'],
  testing: ['test', 'spec', 'mock', 'stub', 'fixture', 'assert', 'expect', 'unit', 'integration', 'e2e', 'coverage'],
  security: ['security', 'xss', 'csrf', 'injection', 'sanitize', 'escape', 'validate', 'encrypt', 'decrypt', 'hash', 'vulnerability'],
  performance: ['performance', 'slow', 'fast', 'optimize', 'speed', 'latency', 'cache', 'index', 'query', 'n+1'],
  ui: ['ui', 'component', 'view', 'template', 'blade', 'react', 'vue', 'frontend', 'css', 'style', 'layout'],
};

// Change type indicators
const CHANGE_TYPE_KEYWORDS: Record<string, string[]> = {
  bugfix: ['fix', 'bug', 'issue', 'error', 'broken', 'crash', 'fail', 'wrong', 'incorrect', 'not working', 'doesn\'t work'],
  feature: ['add', 'new', 'feature', 'implement', 'create', 'introduce', 'support'],
  refactor: ['refactor', 'clean', 'reorganize', 'restructure', 'simplify', 'improve code', 'extract', 'move'],
  perf: ['performance', 'slow', 'fast', 'optimize', 'speed', 'efficient', 'cache', 'memory', 'cpu'],
  security: ['security', 'vulnerability', 'xss', 'csrf', 'injection', 'auth', 'permission', 'access'],
};

export interface ExtractedKeywords {
  keywords: string[];
  entities: ExtractedEntities;
  domains: string[];
  changeType: 'bugfix' | 'feature' | 'refactor' | 'perf' | 'security' | 'unknown';
}

export interface ExtractedEntities {
  classNames: string[];
  methodNames: string[];
  fileNames: string[];
  routePatterns: string[];
  errorCodes: string[];
}

export class KeywordExtractor {
  extract(text: string): ExtractedKeywords {
    const normalizedText = text.toLowerCase();

    // Extract entities first (they're more reliable)
    const entities = this.extractEntities(text);

    // Extract keywords (after removing entities to avoid duplication)
    const keywords = this.extractKeywords(text, entities);

    // Detect domains
    const domains = this.detectDomains(normalizedText);

    // Detect change type
    const changeType = this.detectChangeType(normalizedText);

    return {
      keywords,
      entities,
      domains,
      changeType,
    };
  }

  private extractEntities(text: string): ExtractedEntities {
    const classNames: string[] = [];
    const methodNames: string[] = [];
    const fileNames: string[] = [];
    const routePatterns: string[] = [];
    const errorCodes: string[] = [];

    // CamelCase class names (e.g., UserController, StripeService)
    const camelCasePattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
    let match;
    while ((match = camelCasePattern.exec(text)) !== null) {
      classNames.push(match[1]);
    }

    // Method/function names (e.g., handleWebhook, processPayment)
    // Look for patterns like ClassName.methodName or ::methodName
    const methodPattern = /(?:\.|\:\:)([a-z][a-zA-Z0-9]+)/g;
    while ((match = methodPattern.exec(text)) !== null) {
      methodNames.push(match[1]);
    }

    // Also look for standalone method-like patterns
    const standaloneMethodPattern = /\b([a-z][a-zA-Z0-9]*(?:[A-Z][a-z0-9]+)+)\b/g;
    while ((match = standaloneMethodPattern.exec(text)) !== null) {
      if (!classNames.includes(match[1])) {
        methodNames.push(match[1]);
      }
    }

    // File paths and names (e.g., app/Services/StripeService.php)
    const filePattern = /(?:^|\s)((?:[\w-]+\/)*[\w-]+\.(?:php|ts|tsx|js|jsx|py|rb|go|rs|java|vue|svelte))\b/gi;
    while ((match = filePattern.exec(text)) !== null) {
      fileNames.push(match[1]);
    }

    // Route patterns (e.g., /api/checkout, POST /webhook)
    const routePattern = /(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)?\s*(\/[\w\-\/:{}*]+)/gi;
    while ((match = routePattern.exec(text)) !== null) {
      routePatterns.push(match[1]);
    }

    // Also match routes without HTTP method
    const simpleRoutePattern = /\b(\/api\/[\w\-\/:{}*]+)\b/gi;
    while ((match = simpleRoutePattern.exec(text)) !== null) {
      if (!routePatterns.includes(match[1])) {
        routePatterns.push(match[1]);
      }
    }

    // Error codes (e.g., E001, PAYMENT_FAILED, 404, 500)
    const errorCodePattern = /\b([A-Z][A-Z0-9_]{2,}_(?:ERROR|EXCEPTION|FAILED|INVALID)|E\d{3,}|[45]\d{2})\b/g;
    while ((match = errorCodePattern.exec(text)) !== null) {
      errorCodes.push(match[1]);
    }

    return {
      classNames: [...new Set(classNames)],
      methodNames: [...new Set(methodNames)],
      fileNames: [...new Set(fileNames)],
      routePatterns: [...new Set(routePatterns)],
      errorCodes: [...new Set(errorCodes)],
    };
  }

  private extractKeywords(text: string, entities: ExtractedEntities): string[] {
    // Tokenize
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\s\-_]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2);

    // Remove stopwords
    const filtered = tokens.filter(token => !STOPWORDS.has(token));

    // Remove tokens that are parts of already-extracted entities
    const entityParts = new Set<string>();
    for (const cls of entities.classNames) {
      // Split CamelCase into parts
      const parts = cls.split(/(?=[A-Z])/).map(p => p.toLowerCase());
      parts.forEach(p => entityParts.add(p));
    }

    const keywords = filtered.filter(token => {
      // Keep if not a single entity part (keep compound terms)
      if (entityParts.has(token)) return false;
      return true;
    });

    // Count frequency and dedupe
    const frequency = new Map<string, number>();
    for (const keyword of keywords) {
      frequency.set(keyword, (frequency.get(keyword) || 0) + 1);
    }

    // Sort by frequency and return unique
    return [...frequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([keyword]) => keyword)
      .slice(0, 20);
  }

  private detectDomains(text: string): string[] {
    const detectedDomains: string[] = [];

    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          detectedDomains.push(domain);
          break;
        }
      }
    }

    return [...new Set(detectedDomains)];
  }

  private detectChangeType(text: string): 'bugfix' | 'feature' | 'refactor' | 'perf' | 'security' | 'unknown' {
    const scores: Record<string, number> = {
      bugfix: 0,
      feature: 0,
      refactor: 0,
      perf: 0,
      security: 0,
    };

    for (const [type, keywords] of Object.entries(CHANGE_TYPE_KEYWORDS)) {
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          scores[type]++;
        }
      }
    }

    // Find highest score
    let maxType = 'unknown';
    let maxScore = 0;

    for (const [type, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        maxType = type;
      }
    }

    if (maxScore === 0) {
      return 'unknown';
    }

    return maxType as 'bugfix' | 'feature' | 'refactor' | 'perf' | 'security';
  }
}
