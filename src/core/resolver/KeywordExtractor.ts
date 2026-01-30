// Keyword extraction using rule-based approach (no AI needed)

import { SynonymExpander } from './dictionaries/index.js';
import { TFIDFCalculator } from './TFIDFCalculator.js';
import { RAKEExtractor } from './RAKEExtractor.js';

// Case conversion utilities
function snakeToCamel(str: string): string {
  return str
    .split('_')
    .map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function snakeToPascal(str: string): string {
  return str
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function camelToSnake(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

function pascalToSnake(str: string): string {
  return camelToSnake(str);
}

// Generate all case variants for a term
export function generateCaseVariants(term: string): string[] {
  const variants = new Set<string>();
  variants.add(term);
  variants.add(term.toLowerCase());

  // If it looks like snake_case
  if (term.includes('_')) {
    variants.add(snakeToCamel(term));      // manage_credit -> manageCredit
    variants.add(snakeToPascal(term));     // manage_credit -> ManageCredit
    variants.add(term.replace(/_/g, ''));  // manage_credit -> managecredit
  }

  // If it looks like CamelCase or PascalCase
  if (/[a-z][A-Z]/.test(term) || /^[A-Z][a-z]/.test(term)) {
    variants.add(camelToSnake(term));      // ManageCredit -> manage_credit
    variants.add(term.toLowerCase());       // ManageCredit -> managecredit
  }

  return [...variants].filter(v => v.length > 0);
}

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
// This is kept for backward compatibility - prefer using DomainManager for new code
// The actual domain definitions are now in ./domains/builtin.ts
import { getCoreDomainKeywords } from './domains/index.js';

// Re-export for backward compatibility with Scorer and other modules
// Initially loaded with core domains, then updated by TaskResolver with full domains
export let DOMAIN_KEYWORDS: Record<string, string[]> = getCoreDomainKeywords();

/**
 * Update the domain keywords (called by TaskResolver with DomainManager data)
 * This merges core + framework + custom domains
 */
export function setDomainKeywords(keywords: Record<string, string[]>): void {
  DOMAIN_KEYWORDS = keywords;
}

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
  keyphrases: string[];  // Multi-word keyphrases extracted via RAKE
  entities: ExtractedEntities;
  domains: string[];
  domainWeights: Record<string, number>;  // How many keywords matched each domain
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
  private synonymExpander: SynonymExpander;
  private tfidfCalculator: TFIDFCalculator;
  private rakeExtractor: RAKEExtractor;

  constructor() {
    this.synonymExpander = new SynonymExpander();
    this.tfidfCalculator = new TFIDFCalculator();
    this.rakeExtractor = new RAKEExtractor({ stopwords: STOPWORDS });
  }

  extract(text: string): ExtractedKeywords {
    const normalizedText = text.toLowerCase();

    // Extract entities first (they're more reliable)
    const entities = this.extractEntities(text);

    // Extract keywords using TF-IDF scoring (after removing entities to avoid duplication)
    const rawKeywords = this.extractKeywordsWithTFIDF(text, entities);

    // Extract multi-word keyphrases using RAKE
    const keyphrases = this.rakeExtractor.extractPhraseStrings(text, 10);

    // Expand keywords with synonyms and translations
    const keywords = this.synonymExpander.expandAll(rawKeywords);

    // Also expand keyphrases (each word in the phrase gets synonyms)
    const expandedKeyphrases = this.expandKeyphrases(keyphrases);

    // Detect domains with weights (how many keywords matched each)
    const { domains, domainWeights } = this.detectDomainsWithWeights(
      normalizedText,
      [...keywords, ...expandedKeyphrases]
    );

    // Detect change type
    const changeType = this.detectChangeType(normalizedText);

    return {
      keywords: [...new Set([...keywords, ...expandedKeyphrases])],
      keyphrases,
      entities,
      domains,
      domainWeights,
      changeType,
    };
  }

  /**
   * Expand keyphrases by adding synonym variants of each word.
   * E.g., "payment webhook" → ["payment webhook", "pagamento webhook"]
   */
  private expandKeyphrases(keyphrases: string[]): string[] {
    const expanded: string[] = [];

    for (const phrase of keyphrases) {
      expanded.push(phrase);

      // Also add the phrase as individual words for matching
      const words = phrase.split(' ');
      for (const word of words) {
        if (word.length >= 3 && !STOPWORDS.has(word)) {
          // Get synonyms for this word
          const synonyms = this.synonymExpander.expandAll([word]);
          expanded.push(...synonyms);
        }
      }
    }

    return [...new Set(expanded)];
  }

  private extractEntities(text: string): ExtractedEntities {
    const classNames: string[] = [];
    const methodNames: string[] = [];
    const fileNames: string[] = [];
    const routePatterns: string[] = [];
    const errorCodes: string[] = [];

    let match;

    // CamelCase/PascalCase class names (e.g., UserController, StripeService)
    const camelCasePattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
    while ((match = camelCasePattern.exec(text)) !== null) {
      // Add the match and all its variants
      const variants = generateCaseVariants(match[1]);
      classNames.push(...variants);
    }

    // snake_case identifiers (e.g., manage_credit, user_profile)
    // These are likely table names, model names, or file references
    const snakeCasePattern = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;
    while ((match = snakeCasePattern.exec(text)) !== null) {
      // Skip if it's a common programming term
      if (!STOPWORDS.has(match[1])) {
        // Add all variants (snake_case, CamelCase, PascalCase)
        const variants = generateCaseVariants(match[1]);
        classNames.push(...variants);
      }
    }

    // Method/function names (e.g., handleWebhook, processPayment)
    // Look for patterns like ClassName.methodName or ::methodName
    const methodPattern = /(?:\.|\:\:)([a-z][a-zA-Z0-9]+)/g;
    while ((match = methodPattern.exec(text)) !== null) {
      const variants = generateCaseVariants(match[1]);
      methodNames.push(...variants);
    }

    // Also look for standalone method-like patterns (camelCase)
    const standaloneMethodPattern = /\b([a-z][a-zA-Z0-9]*(?:[A-Z][a-z0-9]+)+)\b/g;
    while ((match = standaloneMethodPattern.exec(text)) !== null) {
      if (!classNames.includes(match[1])) {
        const variants = generateCaseVariants(match[1]);
        methodNames.push(...variants);
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
      classNames: [...new Set(classNames)].filter(n => n.length > 2),
      methodNames: [...new Set(methodNames)].filter(n => n.length > 2),
      fileNames: [...new Set(fileNames)],
      routePatterns: [...new Set(routePatterns)],
      errorCodes: [...new Set(errorCodes)],
    };
  }

  /**
   * Extract keywords using TF-IDF scoring to prioritize rare/specific terms.
   * This replaces simple frequency-based keyword selection.
   */
  private extractKeywordsWithTFIDF(text: string, entities: ExtractedEntities): string[] {
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
      // Split CamelCase into parts, preserving acronyms: "SMSService" → ["SMS", "Service"]
      const parts = cls.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).map(p => p.toLowerCase()).filter(p => p.length > 0);
      parts.forEach(p => entityParts.add(p));
    }

    const keywords = filtered.filter(token => {
      // Keep if not a single entity part (keep compound terms)
      if (entityParts.has(token)) return false;
      return true;
    });

    // Use TF-IDF to score keywords (uses heuristics since we don't have a corpus)
    // This prioritizes rare/specific terms over common ones
    const tfidfResults = this.tfidfCalculator.calculateWithoutCorpus(keywords);

    // Return top 20 keywords by TF-IDF score
    return tfidfResults
      .slice(0, 20)
      .map(r => r.term);
  }

  /**
   * Legacy method kept for backward compatibility.
   * Uses simple frequency-based extraction.
   * @deprecated Use extractKeywordsWithTFIDF instead
   */
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
      // Split CamelCase into parts, preserving acronyms: "SMSService" → ["SMS", "Service"]
      const parts = cls.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).map(p => p.toLowerCase()).filter(p => p.length > 0);
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

  /**
   * Detect domains and count how many keywords match each domain.
   * This allows weighting domains by relevance (more keyword matches = more relevant).
   */
  private detectDomainsWithWeights(text: string, expandedKeywords: string[]): {
    domains: string[];
    domainWeights: Record<string, number>;
  } {
    const domainWeights: Record<string, number> = {};
    const keywordSet = new Set(expandedKeywords.map(k => k.toLowerCase()));

    for (const [domain, domainKeywords] of Object.entries(DOMAIN_KEYWORDS)) {
      let matchCount = 0;

      for (const keyword of domainKeywords) {
        // Check both the original text and the expanded keywords
        if (text.includes(keyword) || keywordSet.has(keyword)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        domainWeights[domain] = matchCount;
      }
    }

    // Sort domains by weight (most matches first)
    const domains = Object.keys(domainWeights).sort(
      (a, b) => domainWeights[b] - domainWeights[a]
    );

    return { domains, domainWeights };
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
