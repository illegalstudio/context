/**
 * Synonym Expander
 *
 * Expands keywords with synonyms and translations.
 * Supports:
 * - English synonyms (en.ts)
 * - Italian synonyms (it.ts)
 * - Bidirectional IT↔EN translations (en-it.ts)
 */

import { synonymGroups as enSynonyms } from './en.js';
import { synonymGroups as itSynonyms } from './it.js';
import { translations } from './en-it.js';

export class SynonymExpander {
  private enIndex: Map<string, Set<string>>;
  private itIndex: Map<string, Set<string>>;
  private translationIndex: Map<string, Set<string>>;

  constructor() {
    this.enIndex = this.buildIndex(enSynonyms);
    this.itIndex = this.buildIndex(itSynonyms);
    this.translationIndex = this.buildTranslationIndex(translations);
  }

  /**
   * Expand a single term with all synonyms and translations
   *
   * Example: "pagamento" → ["pagamento", "payment", "charge", "transaction", "billing", "versamento", "transazione"]
   */
  expand(term: string): string[] {
    const result = new Set<string>();
    result.add(term);

    const termLower = term.toLowerCase();

    // 1. English synonyms
    const enSyns = this.enIndex.get(termLower);
    if (enSyns) {
      enSyns.forEach(s => result.add(s));
    }

    // 2. Italian synonyms
    const itSyns = this.itIndex.get(termLower);
    if (itSyns) {
      itSyns.forEach(s => result.add(s));
    }

    // 3. Translations (bidirectional)
    const trans = this.translationIndex.get(termLower);
    if (trans) {
      trans.forEach(t => {
        result.add(t);

        // Also expand synonyms of the translated term
        const transSynsEn = this.enIndex.get(t);
        if (transSynsEn) {
          transSynsEn.forEach(s => result.add(s));
        }

        const transSynsIt = this.itIndex.get(t);
        if (transSynsIt) {
          transSynsIt.forEach(s => result.add(s));
        }
      });
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
    return (
      this.enIndex.has(termLower) ||
      this.itIndex.has(termLower) ||
      this.translationIndex.has(termLower)
    );
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
   * Build a bidirectional translation index
   *
   * Each term maps to its translations in both directions.
   */
  private buildTranslationIndex(pairs: [string, string][]): Map<string, Set<string>> {
    const index = new Map<string, Set<string>>();

    for (const [a, b] of pairs) {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();

      // A → B
      if (!index.has(aLower)) {
        index.set(aLower, new Set());
      }
      index.get(aLower)!.add(bLower);

      // B → A (bidirectional)
      if (!index.has(bLower)) {
        index.set(bLower, new Set());
      }
      index.get(bLower)!.add(aLower);
    }

    return index;
  }

  /**
   * Get statistics about the dictionaries
   */
  getStats(): { enTerms: number; itTerms: number; translations: number } {
    return {
      enTerms: this.enIndex.size,
      itTerms: this.itIndex.size,
      translations: this.translationIndex.size,
    };
  }
}

// Export a singleton instance for convenience
export const synonymExpander = new SynonymExpander();
