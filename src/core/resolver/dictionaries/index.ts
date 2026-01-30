/**
 * Synonym Expander with Stemming Support
 *
 * Expands keywords with synonyms and translations using stemming.
 * Supports:
 * - English synonyms (en.ts)
 * - Italian synonyms (it.ts)
 * - Bidirectional IT↔EN stem translations (en-it.ts)
 * - Automatic plural/conjugation handling via Snowball stemmer
 */

import { synonymGroups as enSynonyms } from './en.js';
import { synonymGroups as itSynonyms } from './it.js';
import { stemTranslations } from './en-it.js';
import { stemmer } from '../Stemmer.js';

export class SynonymExpander {
  private enIndex: Map<string, Set<string>>;
  private itIndex: Map<string, Set<string>>;
  private stemIndex: Map<string, Set<string>>;

  constructor() {
    this.enIndex = this.buildIndex(enSynonyms);
    this.itIndex = this.buildIndex(itSynonyms);
    this.stemIndex = this.buildStemIndex(stemTranslations);
  }

  /**
   * Expand a single term with all synonyms and translations.
   * Uses stemming to match morphological variants (plurals, conjugations).
   *
   * Example: "utenti" → ["utenti", "utent", "user", ...]
   */
  expand(term: string): string[] {
    const result = new Set<string>();
    result.add(term);

    const termLower = term.toLowerCase();
    result.add(termLower);

    // 1. English synonyms (exact match)
    const enSyns = this.enIndex.get(termLower);
    if (enSyns) {
      enSyns.forEach(s => result.add(s));
    }

    // 2. Italian synonyms (exact match)
    const itSyns = this.itIndex.get(termLower);
    if (itSyns) {
      itSyns.forEach(s => result.add(s));
    }

    // 3. Stem-based translations
    // Get stems for the input term
    const stems = stemmer.stem(termLower);
    for (const stem of stems) {
      // Add the stem itself (useful for filename matching)
      result.add(stem);

      // Look up translations for this stem
      const translations = this.stemIndex.get(stem);
      if (translations) {
        translations.forEach(t => result.add(t));
      }
    }

    // 4. Also expand synonyms of translated terms
    for (const translated of [...result]) {
      const transSynsEn = this.enIndex.get(translated);
      if (transSynsEn) {
        transSynsEn.forEach(s => result.add(s));
      }

      const transSynsIt = this.itIndex.get(translated);
      if (transSynsIt) {
        transSynsIt.forEach(s => result.add(s));
      }
    }

    return [...result];
  }

  /**
   * Expand a list of keywords
   *
   * Returns a deduplicated list of all keywords and their expansions.
   */
  expandAll(keywords: string[]): string[] {
    const expanded = new Set<string>();

    for (const keyword of keywords) {
      const expansions = this.expand(keyword);
      expansions.forEach(k => expanded.add(k));
    }

    return [...expanded];
  }

  /**
   * Check if a term has any synonyms or translations
   */
  hasSynonyms(term: string): boolean {
    const termLower = term.toLowerCase();

    // Check exact match
    if (this.enIndex.has(termLower) || this.itIndex.has(termLower)) {
      return true;
    }

    // Check stem-based match
    const stems = stemmer.stem(termLower);
    for (const stem of stems) {
      if (this.stemIndex.has(stem)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Build a synonym index from groups
   *
   * Each term in a group maps to the entire group (as a Set).
   */
  private buildIndex(groups: string[][]): Map<string, Set<string>> {
    const index = new Map<string, Set<string>>();

    for (const group of groups) {
      const synonyms = new Set(group.map(s => s.toLowerCase()));

      for (const term of group) {
        const termLower = term.toLowerCase();

        // Merge with existing synonyms if term appears in multiple groups
        const existing = index.get(termLower);
        if (existing) {
          synonyms.forEach(s => existing.add(s));
        } else {
          index.set(termLower, new Set(synonyms));
        }
      }
    }

    return index;
  }

  /**
   * Build a bidirectional stem translation index.
   * Maps stems to their translations in both directions.
   */
  private buildStemIndex(pairs: [string, string][]): Map<string, Set<string>> {
    const index = new Map<string, Set<string>>();

    for (const [itStem, enStem] of pairs) {
      // IT stem → EN stem
      if (!index.has(itStem)) {
        index.set(itStem, new Set());
      }
      index.get(itStem)!.add(enStem);

      // EN stem → IT stem (bidirectional)
      if (!index.has(enStem)) {
        index.set(enStem, new Set());
      }
      index.get(enStem)!.add(itStem);
    }

    return index;
  }

  /**
   * Get statistics about the dictionaries
   */
  getStats(): { enTerms: number; itTerms: number; stemTranslations: number } {
    return {
      enTerms: this.enIndex.size,
      itTerms: this.itIndex.size,
      stemTranslations: this.stemIndex.size,
    };
  }
}

// Export a singleton instance for convenience
export const synonymExpander = new SynonymExpander();

// Re-export stemmer for use in other modules
export { stemmer } from '../Stemmer.js';
