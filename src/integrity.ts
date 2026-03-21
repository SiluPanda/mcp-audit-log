import { createHmac, randomBytes } from 'node:crypto';
import type { IntegrityConfig, AuditRecord, IntegrityVerificationResult } from './types.js';

/**
 * Manages HMAC integrity chain computation for audit records.
 */
export class IntegrityChain {
  private readonly algorithm: string;
  private readonly secret: string | Buffer;
  private previousHmac: string;
  private isFirst = true;
  private readonly seed: string;

  constructor(config: IntegrityConfig) {
    this.algorithm = config.algorithm ?? 'sha256';
    this.secret = config.secret;
    this.seed = config.seed ?? randomBytes(32).toString('hex');
    this.previousHmac = this.seed;
  }

  /**
   * Compute the HMAC for a record and attach _integrity (and optionally _integritySeed) fields.
   * Mutates the record in place and returns it.
   */
  sign(record: AuditRecord): AuditRecord {
    // Remove existing integrity fields before computing
    const rec = record as unknown as Record<string, unknown>;
    delete rec._integrity;
    delete rec._integritySeed;

    if (this.isFirst) {
      rec._integritySeed = this.seed;
      this.isFirst = false;
    }

    const canonical = JSON.stringify(rec);
    const payload = this.previousHmac + canonical;
    const hmac = createHmac(this.algorithm, this.secret)
      .update(payload)
      .digest('hex');

    rec._integrity = hmac;
    this.previousHmac = hmac;

    return record;
  }
}

/**
 * Verify the integrity chain of a sequence of audit records.
 */
export function verifyIntegrityChain(
  records: AuditRecord[],
  secret: string | Buffer,
  algorithm: string = 'sha256',
): IntegrityVerificationResult {
  if (records.length === 0) {
    return { valid: true, recordCount: 0, firstInvalidIndex: -1 };
  }

  const firstRecord = records[0] as unknown as Record<string, unknown>;
  const seed = firstRecord._integritySeed as string | undefined;
  if (!seed) {
    return {
      valid: false,
      recordCount: records.length,
      firstInvalidIndex: 0,
      error: 'First record missing _integritySeed field',
    };
  }

  let previousHmac = seed;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i] as unknown as Record<string, unknown>;
    const storedHmac = rec._integrity as string | undefined;

    if (!storedHmac) {
      return {
        valid: false,
        recordCount: records.length,
        firstInvalidIndex: i,
        error: `Record at index ${i} missing _integrity field`,
      };
    }

    // Reconstruct the record without _integrity for HMAC computation
    const clone = { ...rec };
    delete clone._integrity;

    const canonical = JSON.stringify(clone);
    const payload = previousHmac + canonical;
    const expectedHmac = createHmac(algorithm, secret)
      .update(payload)
      .digest('hex');

    if (storedHmac !== expectedHmac) {
      return {
        valid: false,
        recordCount: records.length,
        firstInvalidIndex: i,
        expectedHmac,
        actualHmac: storedHmac,
      };
    }

    previousHmac = storedHmac;
  }

  return { valid: true, recordCount: records.length, firstInvalidIndex: -1 };
}
