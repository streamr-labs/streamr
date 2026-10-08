import { describe, it, expect } from 'vitest';
import { mapRawStream, unwrapOptionalText, unwrapAddress } from './useStreams';

describe('useStreams Utils', () => {
  describe('unwrapOptionalText', () => {
    it('handles null or undefined', () => {
      expect(unwrapOptionalText(null)).toBeNull();
      expect(unwrapOptionalText(undefined)).toBeNull();
    });

    it('handles standard strings', () => {
      expect(unwrapOptionalText('hello')).toBe('hello');
      expect(unwrapOptionalText('  padded  ')).toBe('padded');
    });

    it('handles empty strings', () => {
      expect(unwrapOptionalText('')).toBeNull();
      expect(unwrapOptionalText('   ')).toBeNull();
    });

    it('handles ScVal structure (some / value)', () => {
      expect(unwrapOptionalText({ some: 'nested' })).toBe('nested');
      expect(unwrapOptionalText({ value: 'val' })).toBe('val');
      expect(unwrapOptionalText({ str: 'stringval' })).toBe('stringval');
    });

    it('handles arrays', () => {
      expect(unwrapOptionalText(['first', 'second'])).toBe('first');
      expect(unwrapOptionalText([])).toBeNull();
    });
  });

  describe('unwrapAddress', () => {
    it('handles basic values', () => {
      expect(unwrapAddress(null)).toBe('');
      expect(unwrapAddress(undefined)).toBe('');
      expect(unwrapAddress('GABC123')).toBe('GABC123');
    });

    it('removes surrounding quotes', () => {
      expect(unwrapAddress('"GABC123"')).toBe('GABC123');
    });
  });

  describe('mapRawStream', () => {
    it('handles null stream', () => {
      expect(mapRawStream(null)).toBeNull();
      expect(mapRawStream(undefined)).toBeNull();
    });

    it('handles missing id', () => {
      expect(mapRawStream({ sender: 'alice' })).toBeNull();
      expect(mapRawStream({ id: 'invalid' })).toBeNull();
    });

    it('maps valid stream object', () => {
      const raw = {
        id: 42,
        sender: '"alice"',
        recipient: '"bob"',
        token_contract: 'tokenA',
        rate_per_second: 100,
        deposit: 10000,
        start_time: 1000,
        last_withdraw_time: 1500,
        is_active: true,
        title: { some: 'Project Funding' },
        description: '   '
      };

      const result = mapRawStream(raw);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(42);
      expect(result?.sender).toBe('alice');
      expect(result?.recipient).toBe('bob');
      expect(result?.token_contract).toBe('tokenA');
      expect(result?.rate_per_second).toBe(100n);
      expect(result?.deposit).toBe(10000n);
      expect(result?.start_time).toBe(1000n);
      expect(result?.last_withdraw_time).toBe(1500n);
      expect(result?.is_active).toBe(true);
      expect(result?.title).toBe('Project Funding');
      expect(result?.description).toBeNull();
    });

    it('handles array of recipients', () => {
      const raw = {
        id: '99',
        sender: 'alice',
        recipients: ['"bob"', '"charlie"']
      };

      const result = mapRawStream(raw);
      expect(result?.recipient).toBe('bob');
      expect(result?.recipients).toEqual(['bob', 'charlie']);
    });
  });
});