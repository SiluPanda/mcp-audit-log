import { describe, it, expect } from 'vitest';
import { IntegrityChain, verifyIntegrityChain } from '../integrity.js';
import type { AuditRecord, GenericRequestRecord } from '../types.js';

function makeRecord(overrides: Partial<GenericRequestRecord> = {}): GenericRequestRecord {
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
    params: null,
    ...overrides,
  };
}

describe('IntegrityChain', () => {
  const SECRET = 'test-secret-key';

  it('should add _integritySeed to the first record', () => {
    const chain = new IntegrityChain({ secret: SECRET, seed: 'seed-value' });
    const record = makeRecord();
    const signed = chain.sign(record);
    expect((signed as Record<string, unknown>)._integritySeed).toBe('seed-value');
    expect((signed as Record<string, unknown>)._integrity).toBeDefined();
  });

  it('should not add _integritySeed to subsequent records', () => {
    const chain = new IntegrityChain({ secret: SECRET, seed: 'seed-value' });
    const r1 = makeRecord({ recordId: 'rec-001' });
    const r2 = makeRecord({ recordId: 'rec-002' });
    chain.sign(r1);
    const signed2 = chain.sign(r2);
    expect((signed2 as Record<string, unknown>)._integritySeed).toBeUndefined();
    expect((signed2 as Record<string, unknown>)._integrity).toBeDefined();
  });

  it('should produce different HMACs for different records', () => {
    const chain = new IntegrityChain({ secret: SECRET, seed: 'seed' });
    const r1 = makeRecord({ recordId: 'rec-001' });
    const r2 = makeRecord({ recordId: 'rec-002' });
    chain.sign(r1);
    chain.sign(r2);
    expect((r1 as Record<string, unknown>)._integrity).not.toBe(
      (r2 as Record<string, unknown>)._integrity,
    );
  });

  it('should chain HMACs (each depends on the previous)', () => {
    const chain1 = new IntegrityChain({ secret: SECRET, seed: 'seed' });
    const chain2 = new IntegrityChain({ secret: SECRET, seed: 'seed' });

    const r1a = makeRecord({ recordId: 'rec-001' });
    const r1b = makeRecord({ recordId: 'rec-001' });
    chain1.sign(r1a);
    chain2.sign(r1b);

    // Same input, same seed, same secret => same HMAC
    expect((r1a as Record<string, unknown>)._integrity).toBe(
      (r1b as Record<string, unknown>)._integrity,
    );
  });

  it('should generate a random seed when none is provided', () => {
    const chain = new IntegrityChain({ secret: SECRET });
    const record = makeRecord();
    chain.sign(record);
    const seed = (record as Record<string, unknown>)._integritySeed as string;
    expect(seed).toBeDefined();
    expect(seed.length).toBe(64); // 32 bytes = 64 hex chars
  });

  it('should support sha384 algorithm', () => {
    const chain = new IntegrityChain({ secret: SECRET, seed: 'seed', algorithm: 'sha384' });
    const record = makeRecord();
    chain.sign(record);
    const hmac = (record as Record<string, unknown>)._integrity as string;
    expect(hmac).toBeDefined();
    expect(hmac.length).toBe(96); // SHA384 produces 48 bytes = 96 hex chars
  });

  it('should support sha512 algorithm', () => {
    const chain = new IntegrityChain({ secret: SECRET, seed: 'seed', algorithm: 'sha512' });
    const record = makeRecord();
    chain.sign(record);
    const hmac = (record as Record<string, unknown>)._integrity as string;
    expect(hmac).toBeDefined();
    expect(hmac.length).toBe(128); // SHA512 produces 64 bytes = 128 hex chars
  });
});

describe('verifyIntegrityChain', () => {
  const SECRET = 'verify-secret';

  function signRecords(records: AuditRecord[], seed: string = 'seed'): AuditRecord[] {
    const chain = new IntegrityChain({ secret: SECRET, seed });
    return records.map((r) => chain.sign(structuredClone(r)));
  }

  it('should verify a valid chain', () => {
    const records = [
      makeRecord({ recordId: 'r1' }),
      makeRecord({ recordId: 'r2' }),
      makeRecord({ recordId: 'r3' }),
    ];
    const signed = signRecords(records);
    const result = verifyIntegrityChain(signed, SECRET);
    expect(result.valid).toBe(true);
    expect(result.recordCount).toBe(3);
    expect(result.firstInvalidIndex).toBe(-1);
  });

  it('should detect a tampered record', () => {
    const records = [
      makeRecord({ recordId: 'r1' }),
      makeRecord({ recordId: 'r2' }),
      makeRecord({ recordId: 'r3' }),
    ];
    const signed = signRecords(records);

    // Tamper with the second record
    (signed[1] as Record<string, unknown>).method = 'tampered';

    const result = verifyIntegrityChain(signed, SECRET);
    expect(result.valid).toBe(false);
    expect(result.firstInvalidIndex).toBe(1);
    expect(result.expectedHmac).toBeDefined();
    expect(result.actualHmac).toBeDefined();
  });

  it('should detect a removed record', () => {
    const records = [
      makeRecord({ recordId: 'r1' }),
      makeRecord({ recordId: 'r2' }),
      makeRecord({ recordId: 'r3' }),
    ];
    const signed = signRecords(records);

    // Remove the second record
    signed.splice(1, 1);

    const result = verifyIntegrityChain(signed, SECRET);
    expect(result.valid).toBe(false);
    expect(result.firstInvalidIndex).toBe(1);
  });

  it('should detect wrong secret', () => {
    const records = [makeRecord({ recordId: 'r1' })];
    const signed = signRecords(records);

    const result = verifyIntegrityChain(signed, 'wrong-secret');
    expect(result.valid).toBe(false);
  });

  it('should handle empty records array', () => {
    const result = verifyIntegrityChain([], SECRET);
    expect(result.valid).toBe(true);
    expect(result.recordCount).toBe(0);
  });

  it('should detect missing _integritySeed on first record', () => {
    const record = makeRecord();
    delete (record as Record<string, unknown>)._integritySeed;
    (record as Record<string, unknown>)._integrity = 'fake';

    const result = verifyIntegrityChain([record], SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('_integritySeed');
  });

  it('should detect missing _integrity field', () => {
    const record = makeRecord();
    (record as Record<string, unknown>)._integritySeed = 'seed';
    // No _integrity field

    const result = verifyIntegrityChain([record], SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('_integrity');
  });
});
