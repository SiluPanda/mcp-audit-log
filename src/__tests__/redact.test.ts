import { describe, it, expect } from 'vitest';
import { redactRecord } from '../redact.js';

describe('redactRecord', () => {
  describe('path-based redaction', () => {
    it('should redact a top-level field by path', () => {
      const input = { name: 'Alice', password: 'secret123' };
      const result = redactRecord(input, { paths: ['password'] });
      expect(result.name).toBe('Alice');
      expect(result.password).toBe('[REDACTED]');
    });

    it('should redact a nested field by dot path', () => {
      const input = {
        toolArguments: {
          headers: { Authorization: 'Bearer token123' },
          body: 'safe',
        },
      };
      const result = redactRecord(input, {
        paths: ['toolArguments.headers.Authorization'],
      });
      expect(result.toolArguments.headers.Authorization).toBe('[REDACTED]');
      expect(result.toolArguments.body).toBe('safe');
    });

    it('should redact multiple fields', () => {
      const input = { apiKey: 'key123', token: 'tok456', name: 'test' };
      const result = redactRecord(input, { paths: ['apiKey', 'token'] });
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.name).toBe('test');
    });

    it('should handle non-existent paths gracefully', () => {
      const input = { name: 'Alice' };
      const result = redactRecord(input, { paths: ['nonexistent'] });
      expect(result).toEqual({ name: 'Alice' });
    });

    it('should redact fields in arrays', () => {
      const input = {
        items: [
          { name: 'a', secret: 'x' },
          { name: 'b', secret: 'y' },
        ],
      };
      const result = redactRecord(input, { paths: ['secret'] });
      expect(result.items[0].secret).toBe('[REDACTED]');
      expect(result.items[1].secret).toBe('[REDACTED]');
      expect(result.items[0].name).toBe('a');
    });
  });

  describe('pattern-based redaction', () => {
    it('should redact email addresses', () => {
      const input = { text: 'Contact alice@example.com for details' };
      const result = redactRecord(input, {
        patterns: [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
      });
      expect(result.text).toBe('Contact [REDACTED] for details');
    });

    it('should redact API keys', () => {
      const input = { config: 'key=sk-abcdefghijklmnopqrstuvwxyz012345678901234567' };
      const result = redactRecord(input, {
        patterns: [/sk-[a-zA-Z0-9]{44}/g],
      });
      expect(result.config).not.toContain('sk-');
      expect(result.config).toContain('[REDACTED]');
    });

    it('should apply multiple patterns', () => {
      const input = { text: 'Email: test@test.com SSN: 123-45-6789' };
      const result = redactRecord(input, {
        patterns: [
          /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
          /\b\d{3}-\d{2}-\d{4}\b/g,
        ],
      });
      expect(result.text).not.toContain('test@test.com');
      expect(result.text).not.toContain('123-45-6789');
    });
  });

  describe('custom redactor', () => {
    it('should use custom redactor function', () => {
      const input = { message: 'Hello World', secret: 'password123' };
      const result = redactRecord(input, {
        custom: (path, value) => {
          if (path === 'secret') return '***';
          return value;
        },
      });
      expect(result.secret).toBe('***');
      expect(result.message).toBe('Hello World');
    });
  });

  describe('custom placeholder', () => {
    it('should use custom placeholder string', () => {
      const input = { password: 'secret' };
      const result = redactRecord(input, {
        paths: ['password'],
        placeholder: '[REMOVED]',
      });
      expect(result.password).toBe('[REMOVED]');
    });
  });

  describe('preserveLength', () => {
    it('should include original length in placeholder', () => {
      const input = { password: 'secret123' };
      const result = redactRecord(input, {
        paths: ['password'],
        preserveLength: true,
      });
      expect(result.password).toBe('[REDACTED:9]');
    });

    it('should include length in pattern-based redaction', () => {
      const input = { text: 'My email is test@test.com' };
      const result = redactRecord(input, {
        patterns: [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
        preserveLength: true,
      });
      expect(result.text).toContain('[REDACTED:');
    });
  });

  describe('deep object handling', () => {
    it('should handle deeply nested objects', () => {
      const input = {
        a: { b: { c: { d: { secret: 'value' } } } },
      };
      const result = redactRecord(input, { paths: ['secret'] });
      expect(result.a.b.c.d.secret).toBe('[REDACTED]');
    });

    it('should not mutate the input', () => {
      const input = { password: 'secret' };
      const original = { ...input };
      redactRecord(input, { paths: ['password'] });
      expect(input).toEqual(original);
    });

    it('should handle null values', () => {
      const input = { value: null, name: 'test' };
      const result = redactRecord(input, { paths: ['value'] });
      expect(result.value).toBe('[REDACTED]');
    });

    it('should handle undefined config', () => {
      const input = { name: 'test' };
      const result = redactRecord(input, undefined as unknown as import('../types.js').RedactionConfig);
      expect(result).toEqual({ name: 'test' });
    });
  });
});
