/**
 * Language Configuration
 *
 * Defines supported languages for the synonym expander.
 * English is the pivot language - all other languages translate towards English.
 */

import type { Language } from 'snowball-stemmers';

export interface LanguageConfig {
  code: string; // 'en', 'it', 'es', 'fr'
  stemmerName: Language; // Snowball stemmer name: 'english', 'italian', 'spanish'
  isPivot?: boolean; // true only for English
}

export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
  { code: 'en', stemmerName: 'english', isPivot: true },
  { code: 'it', stemmerName: 'italian' },
  // Future: { code: 'es', stemmerName: 'spanish' },
  // Future: { code: 'fr', stemmerName: 'french' },
];

export const PIVOT_LANGUAGE = 'en';
