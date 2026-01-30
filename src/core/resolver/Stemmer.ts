/**
 * Multi-Language Stemmer
 *
 * Uses Snowball stemming algorithm to reduce words to their root form.
 * Supports Italian and English for automatic plural/conjugation handling.
 *
 * Examples:
 * - "utenti" → "utent"
 * - "utente" → "utent"
 * - "users" → "user"
 * - "payments" → "payment"
 */

import { newStemmer, type Stemmer } from 'snowball-stemmers';

export class MultiLangStemmer {
  private stemmers: Map<string, Stemmer> = new Map();

  constructor() {
    this.stemmers.set('en', newStemmer('english'));
    this.stemmers.set('it', newStemmer('italian'));
  }

  /**
   * Stem a word using both Italian and English stemmers.
   * Returns array of unique stems (usually 1-2 stems).
   *
   * @param word - Word to stem
   * @returns Array of unique stems from all languages
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
   * Stem a word with a specific language.
   *
   * @param word - Word to stem
   * @param lang - Language code ('en' or 'it')
   * @returns Stemmed word
   */
  stemLang(word: string, lang: 'en' | 'it'): string {
    const stemmer = this.stemmers.get(lang);
    return stemmer?.stem(word.toLowerCase()) || word.toLowerCase();
  }

  /**
   * Get the Italian stem of a word.
   */
  stemIt(word: string): string {
    return this.stemLang(word, 'it');
  }

  /**
   * Get the English stem of a word.
   */
  stemEn(word: string): string {
    return this.stemLang(word, 'en');
  }
}

// Export singleton instance for convenience
export const stemmer = new MultiLangStemmer();
