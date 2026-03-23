import { describe, it, expect } from 'vitest';
import { truncateRecord } from '../truncate.js';
import type { GenericRequestRecord } from '../types.js';

function makeRecord(params: Record<string, unknown> | null = null): GenericRequestRecord {
  return {
    v: 1,
    recordId: 'rec-001',
    timestamp: '2026-03-18T14:30:00.000Z',
    serverName: 'test',
    sessionId: null,
    type: 'request',
    method: 'ping',
    correlationId: 'corr-1',
    requestId: 1,
    params,
  };
}

describe('truncateRecord', () => {
  it('should not truncate fields within the size limit', () => {
    const record = makeRecord({ text: 'short' });
    const result = truncateRecord(record, 1000);
    expect('params' in result && result.params?.text).toBe('short');
    expect((result as Record<string, unknown>)._truncated).toBeUndefined();
  });

  it('should truncate fields exceeding the size limit', () => {
    const longText = 'x'.repeat(200);
    const record = makeRecord({ text: longText });
    const result = truncateRecord(record, 50);
    const text = 'params' in result ? (result.params?.text as string) : '';
    expect(text.length).toBeLessThan(longText.length);
    expect(text).toContain('...[truncated]');
    expect((result as Record<string, unknown>)._truncated).toBe(true);
  });

  it('should not truncate metadata fields', () => {
    const record = makeRecord(null);
    // Even if serverName were longer than max, metadata shouldn't be truncated
    record.serverName = 'a'.repeat(200);
    const result = truncateRecord(record, 50);
    expect(result.serverName).toBe('a'.repeat(200));
  });

  it('should handle nested objects', () => {
    const record = makeRecord({
      nested: { deep: { text: 'x'.repeat(200) } },
    });
    const result = truncateRecord(record, 50);
    const params = 'params' in result ? result.params : null;
    const text = (params?.nested as Record<string, Record<string, string>>)?.deep?.text ?? '';
    expect(text).toContain('...[truncated]');
  });

  it('should handle arrays with long strings', () => {
    const record = makeRecord({
      items: ['short', 'x'.repeat(200), 'also_short'],
    });
    const result = truncateRecord(record, 50);
    const params = 'params' in result ? result.params : null;
    const items = params?.items as string[];
    expect(items[0]).toBe('short');
    expect(items[1]).toContain('...[truncated]');
    expect(items[2]).toBe('also_short');
  });

  it('should return unchanged record when maxSize is 0', () => {
    const longText = 'x'.repeat(200);
    const record = makeRecord({ text: longText });
    const result = truncateRecord(record, 0);
    expect('params' in result && result.params?.text).toBe(longText);
  });

  it('should not mutate the input record', () => {
    const longText = 'x'.repeat(200);
    const record = makeRecord({ text: longText });
    const original = JSON.parse(JSON.stringify(record));
    truncateRecord(record, 50);
    expect(record).toEqual(original);
  });

  it('should handle null params', () => {
    const record = makeRecord(null);
    const result = truncateRecord(record, 50);
    expect('params' in result && result.params).toBeNull();
  });

  it('truncated result including suffix does not exceed maxSize', () => {
    const maxSize = 40;
    const longText = 'x'.repeat(500);
    const record = makeRecord({ text: longText });
    const result = truncateRecord(record, maxSize);
    const text = 'params' in result ? (result.params?.text as string) : '';
    // The full truncated string (including '...[truncated]' suffix) must fit within maxSize
    const byteLength = Buffer.byteLength(text, 'utf8');
    expect(byteLength).toBeLessThanOrEqual(maxSize);
    expect(text).toContain('...[truncated]');
  });
});
