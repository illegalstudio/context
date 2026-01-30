/**
 * RAKE - Rapid Automatic Keyword Extraction
 *
 * RAKE extracts multi-word keyphrases from text by:
 * 1. Splitting text into candidate phrases using stopwords and punctuation as delimiters
 * 2. Calculating word scores based on degree (co-occurrence) and frequency
 * 3. Scoring phrases by summing their word scores
 *
 * This allows extracting meaningful phrases like "payment webhook handler" instead of
 * just individual words like "payment", "webhook", "handler".
 *
 * Reference: Rose, S., Engel, D., Cramer, N., & Cowley, W. (2010).
 * "Automatic Keyword Extraction from Individual Documents"
 */

export interface KeyphraseResult {
  phrase: string;
  score: number;
  words: string[];
}

// Stopwords that delimit phrases
const DEFAULT_STOPWORDS = new Set([
  // English articles and prepositions
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
  'shall', 'can', 'need', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their', 'what',
  'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there',
  // Italian articles and prepositions
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'da', 'a', 'in',
  'con', 'su', 'per', 'tra', 'fra', 'e', 'o', 'ma', 'che', 'non', 'si', 'come',
  // Technical stopwords
  'fix', 'bug', 'issue', 'error', 'problem', 'add', 'update', 'change', 'modify',
  'please', 'need', 'want', 'work', 'working', 'broken',
]);

export class RAKEExtractor {
  private stopwords: Set<string>;
  private minWordLength: number;
  private maxPhraseWords: number;

  constructor(options?: {
    stopwords?: Set<string>;
    minWordLength?: number;
    maxPhraseWords?: number;
  }) {
    this.stopwords = options?.stopwords || DEFAULT_STOPWORDS;
    this.minWordLength = options?.minWordLength || 2;
    this.maxPhraseWords = options?.maxPhraseWords || 4;
  }

  /**
   * Extract keyphrases from text.
   *
   * @param text - Input text to extract keyphrases from
   * @param maxPhrases - Maximum number of keyphrases to return (default: 10)
   * @returns Array of keyphrases sorted by score (highest first)
   */
  extract(text: string, maxPhrases: number = 10): KeyphraseResult[] {
    // 1. Tokenize and split into candidate phrases
    const phrases = this.extractCandidatePhrases(text);

    if (phrases.length === 0) return [];

    // 2. Calculate word scores (degree / frequency)
    const wordScores = this.calculateWordScores(phrases);

    // 3. Score phrases by summing word scores
    const phraseScores = this.scorePhrases(phrases, wordScores);

    // 4. Return top phrases (only multi-word)
    return phraseScores
      .filter(p => p.words.length > 1) // Only multi-word phrases
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPhrases);
  }

  /**
   * Extract candidate phrases by splitting on stopwords and punctuation.
   */
  private extractCandidatePhrases(text: string): string[][] {
    // Split into sentences
    const sentences = text
      .toLowerCase()
      .split(/[.!?;:\n\r]+/)
      .filter(s => s.trim().length > 0);

    const phrases: string[][] = [];

    for (const sentence of sentences) {
      // Tokenize: keep alphanumeric, underscores, and hyphens
      const words = sentence
        .split(/[^a-z0-9_-]+/)
        .filter(w => w.length >= this.minWordLength);

      // Split by stopwords to create candidate phrases
      let currentPhrase: string[] = [];

      for (const word of words) {
        if (this.stopwords.has(word)) {
          // Stopword: end current phrase and start new one
          if (currentPhrase.length > 0 && currentPhrase.length <= this.maxPhraseWords) {
            phrases.push([...currentPhrase]);
          }
          currentPhrase = [];
        } else {
          currentPhrase.push(word);

          // Also add single words as phrases (for score calculation)
          if (currentPhrase.length === 1) {
            phrases.push([word]);
          }
        }
      }

      // Don't forget the last phrase
      if (currentPhrase.length > 0 && currentPhrase.length <= this.maxPhraseWords) {
        phrases.push([...currentPhrase]);
      }
    }

    return phrases;
  }

  /**
   * Calculate word scores based on degree and frequency.
   *
   * Degree: number of words that co-occur with this word in phrases
   * Frequency: number of times this word appears
   * Score: (degree + frequency) / frequency
   *
   * Words that appear in longer phrases (higher degree) get higher scores,
   * while words that appear alone frequently get lower scores.
   */
  private calculateWordScores(phrases: string[][]): Map<string, number> {
    const wordFreq = new Map<string, number>();
    const wordDegree = new Map<string, number>();

    for (const phrase of phrases) {
      const degree = phrase.length - 1; // Degree = number of co-occurring words

      for (const word of phrase) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        wordDegree.set(word, (wordDegree.get(word) || 0) + degree);
      }
    }

    const wordScores = new Map<string, number>();

    for (const [word, freq] of wordFreq) {
      const degree = wordDegree.get(word) || 0;
      // Score = (degree + frequency) / frequency
      // This favors words in longer phrases
      wordScores.set(word, (degree + freq) / freq);
    }

    return wordScores;
  }

  /**
   * Score phrases by summing the scores of their constituent words.
   */
  private scorePhrases(
    phrases: string[][],
    wordScores: Map<string, number>
  ): KeyphraseResult[] {
    const phraseScoresMap = new Map<string, KeyphraseResult>();

    for (const phrase of phrases) {
      if (phrase.length < 2) continue; // Skip single words

      const key = phrase.join(' ');

      if (!phraseScoresMap.has(key)) {
        const score = phrase.reduce((sum, word) => sum + (wordScores.get(word) || 0), 0);
        phraseScoresMap.set(key, {
          phrase: key,
          score,
          words: phrase,
        });
      }
    }

    return [...phraseScoresMap.values()];
  }

  /**
   * Get just the keyphrase strings (without scores).
   */
  extractPhraseStrings(text: string, maxPhrases: number = 10): string[] {
    return this.extract(text, maxPhrases).map(r => r.phrase);
  }
}
