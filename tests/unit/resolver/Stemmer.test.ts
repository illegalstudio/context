import { describe, it, expect } from 'vitest';
import { MultiLangStemmer, stemmer } from '../../../src/core/resolver/Stemmer.js';

describe('MultiLangStemmer', () => {
  describe('singleton instance', () => {
    it('should export a singleton stemmer instance', () => {
      expect(stemmer).toBeInstanceOf(MultiLangStemmer);
    });
  });

  describe('stemLang()', () => {
    it('should stem English words', () => {
      const s = new MultiLangStemmer();

      expect(s.stemLang('users', 'en')).toBe('user');
      expect(s.stemLang('payments', 'en')).toBe('payment');
      expect(s.stemLang('running', 'en')).toBe('run');
    });

    it('should stem Italian words', () => {
      const s = new MultiLangStemmer();

      // Italian stems
      const utenteResult = s.stemLang('utente', 'it');
      const utentiResult = s.stemLang('utenti', 'it');

      // Both should produce the same stem
      expect(utenteResult).toBe(utentiResult);
    });

    it('should throw for unsupported language', () => {
      const s = new MultiLangStemmer();

      expect(() => s.stemLang('test', 'xx')).toThrow('Unsupported language');
    });
  });

  describe('stem()', () => {
    it('should return stems from all languages', () => {
      const s = new MultiLangStemmer();

      const stems = s.stem('payment');

      expect(stems).toBeInstanceOf(Array);
      expect(stems.length).toBeGreaterThan(0);
      expect(stems.some(st => st.length >= 2)).toBe(true);
    });

    it('should return unique stems', () => {
      const s = new MultiLangStemmer();

      const stems = s.stem('users');

      // Should be unique
      const uniqueStems = [...new Set(stems)];
      expect(stems.length).toBe(uniqueStems.length);
    });

    it('should filter out very short stems', () => {
      const s = new MultiLangStemmer();

      const stems = s.stem('a');

      // Should filter stems shorter than 2 characters
      expect(stems.every(st => st.length >= 2)).toBe(true);
    });
  });

  describe('hasLanguage()', () => {
    it('should return true for supported languages', () => {
      const s = new MultiLangStemmer();

      expect(s.hasLanguage('en')).toBe(true);
      expect(s.hasLanguage('it')).toBe(true);
    });

    it('should return false for unsupported languages', () => {
      const s = new MultiLangStemmer();

      expect(s.hasLanguage('xx')).toBe(false);
    });
  });

  describe('getSupportedLanguages()', () => {
    it('should return array of language codes', () => {
      const s = new MultiLangStemmer();

      const languages = s.getSupportedLanguages();

      expect(Array.isArray(languages)).toBe(true);
      expect(languages).toContain('en');
    });
  });

  describe('case sensitivity', () => {
    it('should normalize to lowercase before stemming', () => {
      const s = new MultiLangStemmer();

      const lowerStems = s.stem('payment');
      const upperStems = s.stem('PAYMENT');
      const mixedStems = s.stem('Payment');

      expect(lowerStems).toEqual(upperStems);
      expect(lowerStems).toEqual(mixedStems);
    });
  });
});
