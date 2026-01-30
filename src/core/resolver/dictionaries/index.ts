/**
 * Synonym Expander with Multi-Language Support
 *
 * Expands keywords with synonyms and translations using stemming.
 * Uses English as pivot language - all other languages translate towards English.
 *
 * Supports:
 * - English synonyms (en.ts) - pivot language
 * - Italian synonyms (it.ts)
 * - Unidirectional X→EN stem translations (translations/*.ts)
 * - Automatic plural/conjugation handling via Snowball stemmer
 *
 * Adding a new language:
 * 1. Add to languages.ts
 * 2. Create synonyms file (e.g., es.ts)
 * 3. Create translations file (e.g., translations/es.ts)
 * 4. Register in constructor
 */

import { synonymGroups as enSynonyms } from './en.js';
import { synonymGroups as itSynonyms } from './it.js';
import { stemTranslations as itTranslations } from './translations/it.js';
import { stemmer } from '../Stemmer.js';
import { PIVOT_LANGUAGE } from './languages.js';

interface LanguageDictionary {
  code: string;
  index: Map<string, Set<string>>;
  toEnglishStems?: Map<string, Set<string>>; // X→EN (only for non-pivot)
}

export class SynonymExpander {
  private dictionaries: Map<string, LanguageDictionary> = new Map();
  private pivotCode: string = PIVOT_LANGUAGE;

  constructor() {
    this.registerLanguage('en', enSynonyms);
    this.registerLanguage('it', itSynonyms, itTranslations);
  }

  /**
   * Register a language with its synonyms and translations to EN
   */
  private registerLanguage(
    code: string,
    synonymGroups: string[][],
    toEnglishTranslations?: [string, string][]
  ): void {
    const index = this.buildIndex(synonymGroups);

    const dict: LanguageDictionary = { code, index };

    // If not pivot, build translation map towards EN
    if (code !== this.pivotCode && toEnglishTranslations) {
      dict.toEnglishStems = this.buildTranslationIndex(toEnglishTranslations);
    }

    this.dictionaries.set(code, dict);
  }

  /**
   * Expand a term with synonyms from all languages.
   * Uses English as pivot for cross-language expansion.
   */
  expand(term: string): string[] {
    const result = new Set<string>();
    result.add(term);

    const termLower = term.toLowerCase();
    result.add(termLower);

    // 1. Get stems for the term (all languages)
    const stems = stemmer.stem(termLower);
    for (const stem of stems) {
      result.add(stem);
    }

    // 2. Look up in all language dictionaries (exact + stem match)
    for (const [, dict] of this.dictionaries) {
      // Exact match
      const exactSyns = dict.index.get(termLower);
      if (exactSyns) {
        exactSyns.forEach(s => result.add(s));
      }

      // Stem match
      for (const stem of stems) {
        const stemSyns = dict.index.get(stem);
        if (stemSyns) {
          stemSyns.forEach(s => result.add(s));
        }
      }
    }

    // 3. Translate stems to English (pivot) and expand
    const englishStems = this.translateToEnglish(stems);
    const pivotDict = this.dictionaries.get(this.pivotCode);

    if (pivotDict) {
      for (const enStem of englishStems) {
        result.add(enStem);

        const enSyns = pivotDict.index.get(enStem);
        if (enSyns) {
          enSyns.forEach(s => result.add(s));
        }
      }
    }

    // 4. Expand synonyms of all collected terms
    for (const collected of [...result]) {
      for (const [, dict] of this.dictionaries) {
        const syns = dict.index.get(collected);
        if (syns) {
          syns.forEach(s => result.add(s));
        }
      }
    }

    return [...result];
  }

  /**
   * Translate stems to English using all available translation maps
   */
  private translateToEnglish(stems: string[]): Set<string> {
    const englishStems = new Set<string>(stems); // Include originals

    for (const [code, dict] of this.dictionaries) {
      if (code === this.pivotCode || !dict.toEnglishStems) continue;

      for (const stem of stems) {
        const enStems = dict.toEnglishStems.get(stem);
        if (enStems) {
          enStems.forEach(s => englishStems.add(s));
        }
      }
    }

    return englishStems;
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

    // Check exact match in all dictionaries
    for (const [, dict] of this.dictionaries) {
      if (dict.index.has(termLower)) {
        return true;
      }
    }

    // Check stem-based match
    const stems = stemmer.stem(termLower);
    for (const stem of stems) {
      for (const [, dict] of this.dictionaries) {
        if (dict.index.has(stem)) {
          return true;
        }
      }

      // Check translations
      for (const [code, dict] of this.dictionaries) {
        if (code !== this.pivotCode && dict.toEnglishStems?.has(stem)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Build synonym index with stem keys
   */
  private buildIndex(groups: string[][]): Map<string, Set<string>> {
    const index = new Map<string, Set<string>>();

    for (const group of groups) {
      const synonyms = new Set(group.map(s => s.toLowerCase()));

      for (const term of group) {
        const termLower = term.toLowerCase();
        this.addToIndex(index, termLower, synonyms);

        const stems = stemmer.stem(termLower);
        for (const stem of stems) {
          this.addToIndex(index, stem, synonyms);
        }
      }
    }

    return index;
  }

  /**
   * Build translation index (source stem → target stems)
   */
  private buildTranslationIndex(
    pairs: [string, string][]
  ): Map<string, Set<string>> {
    const index = new Map<string, Set<string>>();

    for (const [sourceStem, targetStem] of pairs) {
      if (!index.has(sourceStem)) {
        index.set(sourceStem, new Set());
      }
      index.get(sourceStem)!.add(targetStem);
    }

    return index;
  }

  /**
   * Add synonyms to the index under a given key.
   * Merges with existing synonyms if key already exists.
   */
  private addToIndex(
    index: Map<string, Set<string>>,
    key: string,
    synonyms: Set<string>
  ): void {
    const existing = index.get(key);
    if (existing) {
      synonyms.forEach(s => existing.add(s));
    } else {
      index.set(key, new Set(synonyms));
    }
  }

  /**
   * Get statistics about the dictionaries
   */
  getStats(): {
    languages: string[];
    totalTerms: number;
    termsByLanguage: Record<string, number>;
    translations: number;
  } {
    const termsByLanguage: Record<string, number> = {};
    let translations = 0;

    for (const [code, dict] of this.dictionaries) {
      termsByLanguage[code] = dict.index.size;
      if (dict.toEnglishStems) {
        translations += dict.toEnglishStems.size;
      }
    }

    return {
      languages: [...this.dictionaries.keys()],
      totalTerms: Object.values(termsByLanguage).reduce((a, b) => a + b, 0),
      termsByLanguage,
      translations,
    };
  }
}

// Export a singleton instance for convenience
export const synonymExpander = new SynonymExpander();

// Re-export stemmer for use in other modules
export { stemmer } from '../Stemmer.js';
