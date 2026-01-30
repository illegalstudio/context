/**
 * TF-IDF (Term Frequency - Inverse Document Frequency) Calculator
 *
 * TF-IDF weighs terms by how important they are to a document relative to a corpus.
 * - Terms that appear frequently in a document but rarely across all documents get high scores
 * - Common terms that appear everywhere get low scores
 *
 * This is used to select the most meaningful keywords from a task description,
 * prioritizing rare/specific terms over common ones.
 */

export interface TFIDFResult {
  term: string;
  tfidf: number;
  tf: number;
  idf: number;
}

export class TFIDFCalculator {
  private documentFrequency: Map<string, number> = new Map();
  private totalDocuments: number = 0;

  /**
   * Index a document to build the IDF corpus statistics.
   * Call this for each document in the corpus during indexing.
   *
   * @param terms - Array of terms (already tokenized and normalized)
   */
  indexDocument(terms: string[]): void {
    this.totalDocuments++;
    const uniqueTerms = new Set(terms.map(t => t.toLowerCase()));

    for (const term of uniqueTerms) {
      this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1);
    }
  }

  /**
   * Calculate TF-IDF scores for terms in a document.
   *
   * @param terms - Array of terms from the document
   * @returns Array of results sorted by TF-IDF score (highest first)
   */
  calculate(terms: string[]): TFIDFResult[] {
    if (terms.length === 0) return [];

    // Count term frequency in this document
    const termCounts = new Map<string, number>();
    for (const term of terms) {
      const normalized = term.toLowerCase();
      termCounts.set(normalized, (termCounts.get(normalized) || 0) + 1);
    }

    const results: TFIDFResult[] = [];

    for (const [term, count] of termCounts) {
      // TF: term frequency (normalized by document length)
      const tf = count / terms.length;

      // IDF: inverse document frequency
      // Use +1 smoothing to avoid division by zero and log(0)
      const df = this.documentFrequency.get(term) || 0;
      const idf = Math.log((this.totalDocuments + 1) / (df + 1)) + 1;

      // TF-IDF score
      const tfidf = tf * idf;

      results.push({ term, tfidf, tf, idf });
    }

    // Sort by TF-IDF score descending
    return results.sort((a, b) => b.tfidf - a.tfidf);
  }

  /**
   * Calculate TF-IDF without pre-indexed corpus.
   * Uses simple heuristics based on term characteristics.
   *
   * This is useful when we don't have a pre-built corpus but still want
   * to prioritize rare/specific terms over common ones.
   *
   * @param terms - Array of terms from the document
   * @param baselineFrequencies - Optional map of term -> expected frequency (0-1)
   * @returns Array of results sorted by estimated importance
   */
  calculateWithoutCorpus(
    terms: string[],
    baselineFrequencies?: Map<string, number>
  ): TFIDFResult[] {
    if (terms.length === 0) return [];

    // Count term frequency in this document
    const termCounts = new Map<string, number>();
    for (const term of terms) {
      const normalized = term.toLowerCase();
      termCounts.set(normalized, (termCounts.get(normalized) || 0) + 1);
    }

    const results: TFIDFResult[] = [];

    for (const [term, count] of termCounts) {
      // TF: term frequency
      const tf = count / terms.length;

      // Estimate IDF based on term characteristics
      let idf: number;

      if (baselineFrequencies?.has(term)) {
        // Use provided baseline frequency
        const freq = baselineFrequencies.get(term)!;
        idf = Math.log(1 / (freq + 0.01)) + 1;
      } else {
        // Heuristic-based IDF estimation:
        // - Longer terms are usually more specific
        // - Terms with underscores/camelCase are usually identifiers (more specific)
        // - Terms with numbers are usually specific codes/versions
        let specificity = 1;

        // Length bonus (longer = more specific)
        if (term.length > 8) specificity += 0.5;
        if (term.length > 12) specificity += 0.3;

        // Identifier patterns (very specific)
        if (term.includes('_') || /[a-z][A-Z]/.test(term)) specificity += 0.8;

        // Contains numbers (specific)
        if (/\d/.test(term)) specificity += 0.4;

        // All caps (usually constants/codes)
        if (term === term.toUpperCase() && term.length > 2) specificity += 0.3;

        idf = specificity;
      }

      const tfidf = tf * idf;
      results.push({ term, tfidf, tf, idf });
    }

    return results.sort((a, b) => b.tfidf - a.tfidf);
  }

  /**
   * Get the top N terms by TF-IDF score.
   *
   * @param terms - Array of terms from the document
   * @param n - Number of top terms to return
   * @returns Array of top N terms (just the term strings)
   */
  getTopTerms(terms: string[], n: number): string[] {
    const results = this.totalDocuments > 0
      ? this.calculate(terms)
      : this.calculateWithoutCorpus(terms);

    return results.slice(0, n).map(r => r.term);
  }

  /**
   * Reset the corpus statistics.
   */
  reset(): void {
    this.documentFrequency.clear();
    this.totalDocuments = 0;
  }

  /**
   * Get the number of indexed documents.
   */
  getDocumentCount(): number {
    return this.totalDocuments;
  }

  /**
   * Get the document frequency for a term.
   */
  getDocumentFrequency(term: string): number {
    return this.documentFrequency.get(term.toLowerCase()) || 0;
  }
}
