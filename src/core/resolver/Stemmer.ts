/**
 * Multi-Language Stemmer
 *
 * Uses Snowball stemming algorithm to reduce words to their root form.
 * Dynamically supports all languages defined in languages.ts.
 *
 * Examples:
 * - "utenti" → "utent"
 * - "utente" → "utent"
 * - "users" → "user"
 * - "payments" → "payment"
 */

import { newStemmer, type Stemmer } from 'snowball-stemmers';
import { SUPPORTED_LANGUAGES } from './dictionaries/languages.js';

export class MultiLangStemmer {
  private stemmers: Map<string, Stemmer> = new Map();

  constructor() {
    // Initialize stemmers for all supported languages
    for (const lang of SUPPORTED_LANGUAGES) {
      this.stemmers.set(lang.code, newStemmer(lang.stemmerName));
    }
  }

  /**
   * Stem with a specific language code
   */
  stemLang(word: string, langCode: string): string {
    const stemmer = this.stemmers.get(langCode);
    if (!stemmer) {
      throw new Error(`Unsupported language: ${langCode}`);
    }
    return stemmer.stem(word.toLowerCase());
  }

  /**
   * Stem with all available stemmers.
   * Returns unique stems from all languages.
   */
  stem(word: string): string[] {
    const stems = new Set<string>();
    const normalized = word.toLowerCase();

    for (const [, stemmer] of this.stemmers) {
      const stem = stemmer.stem(normalized);
      if (stem && stem.length >= 2) {
        stems.add(stem);
      }
    }

    return [...stems];
  }

  /**
   * Check if a language is supported
   */
  hasLanguage(langCode: string): boolean {
    return this.stemmers.has(langCode);
  }

  /**
   * List of supported languages
   */
  getSupportedLanguages(): string[] {
    return [...this.stemmers.keys()];
  }
}

// Export singleton instance for convenience
export const stemmer = new MultiLangStemmer();
