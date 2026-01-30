/**
 * Type declarations for snowball-stemmers
 * @see https://www.npmjs.com/package/snowball-stemmers
 */

declare module 'snowball-stemmers' {
  export interface Stemmer {
    /**
     * Stem a word to its root form
     * @param word - The word to stem
     * @returns The stemmed word
     */
    stem(word: string): string;
  }

  export type Language =
    | 'arabic'
    | 'armenian'
    | 'basque'
    | 'catalan'
    | 'danish'
    | 'dutch'
    | 'english'
    | 'finnish'
    | 'french'
    | 'german'
    | 'greek'
    | 'hindi'
    | 'hungarian'
    | 'indonesian'
    | 'irish'
    | 'italian'
    | 'lithuanian'
    | 'nepali'
    | 'norwegian'
    | 'porter'
    | 'portuguese'
    | 'romanian'
    | 'russian'
    | 'serbian'
    | 'spanish'
    | 'swedish'
    | 'tamil'
    | 'turkish'
    | 'yiddish';

  /**
   * Create a new stemmer for the specified language
   * @param language - The language to use for stemming
   * @returns A Stemmer instance
   */
  export function newStemmer(language: Language): Stemmer;
}
