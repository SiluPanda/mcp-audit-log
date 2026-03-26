import * as fs from 'node:fs';
import * as readline from 'node:readline';
import type {
  AuditLoggerOptions,
  AuditLoggerHandle,
  AuditRecord,
  AuditQueryParams,
  IntegrityVerificationResult,
} from './types.js';
import { NdjsonWriter } from './writer.js';
import { buildRequestRecord, buildResponseRecord, buildNotificationRecord } from './record.js';
import { redactRecord } from './redact.js';
import { shouldRecord, validateFilter } from './filter.js';
import { IntegrityChain, verifyIntegrityChain } from './integrity.js';
import { truncateRecord } from './truncate.js';

/**
 * Core audit logger class.
 * Wraps record building, filtering, redaction, integrity chaining,
 * and writing into a cohesive pipeline.
 */
export class AuditLogger implements AuditLoggerHandle {
  private writer: NdjsonWriter;
  private integrityChain: IntegrityChain | null = null;
  private readonly options: AuditLoggerOptions;
  private readonly serverName: string;
  private readonly includeBody: boolean;
  private readonly maxFieldSize: number;
  private readonly onError: (error: Error) => void;
  private readonly correlationTtlMs: number;
  private readonly correlationMaxSize: number;
  private _active = true;
  private _recordCount = 0;
  private _errorCount = 0;
  private correlationMap = new Map<string | number, { correlationId: string; method: string; timestamp: number }>();

  constructor(options: AuditLoggerOptions, serverName?: string) {
    validateFilter(options.filter);
    this.options = options;
    this.serverName = serverName ?? options.serverName ?? 'unknown';
    this.includeBody = options.includeBody ?? true;
    this.maxFieldSize = options.maxFieldSize ?? 1_048_576;
    this.onError = options.onError ?? ((err: Error) => console.error('[mcp-audit-log]', err.message));
    this.correlationTtlMs = options.correlationTtlMs ?? 300_000;
    this.correlationMaxSize = options.correlationMaxSize ?? 10_000;

    this.writer = new NdjsonWriter(
      options.sink,
      this.onError,
      options.buffer,
      options.rotation,
      options.retention,
    );

    if (options.integrity) {
      this.integrityChain = new IntegrityChain(options.integrity);
    }
  }

  async open(): Promise<void> {
    await this.writer.open();
  }

  get active(): boolean {
    return this._active;
  }

  get recordCount(): number {
    return this._recordCount;
  }

  get errorCount(): number {
    return this._errorCount;
  }

  /**
   * Log an incoming request. Returns the correlationId for pairing with the response.
   */
  logRequest(
    method: string,
    requestId: string | number,
    params: Record<string, unknown> | undefined | null,
    sessionId: string | null = null,
  ): string | null {
    if (!this._active) return null;
    if (!shouldRecord(method, this.options.filter)) return null;

    const { record, correlationId } = buildRequestRecord(
      this.serverName,
      method,
      requestId,
      params,
      sessionId,
      this.includeBody,
    );

    // Store correlation for response matching
    this.correlationMap.set(requestId, {
      correlationId,
      method,
      timestamp: Date.now(),
    });

    // Prune stale entries to prevent memory leaks from unanswered requests
    if (this.correlationMap.size > this.correlationMaxSize) {
      this.pruneStaleCorrelations();
    }

    this.writeRecord(record);
    return correlationId;
  }

  /**
   * Log an outgoing response.
   */
  logResponse(
    requestId: string | number,
    result: Record<string, unknown> | undefined | null,
    error: { code: number; message: string } | undefined | null,
    sessionId: string | null = null,
  ): void {
    if (!this._active) return;

    const correlation = this.correlationMap.get(requestId);
    if (!correlation) return; // No matching request recorded

    this.correlationMap.delete(requestId);

    const method = correlation.method;
    if (!shouldRecord(method, this.options.filter)) return;

    const durationMs = Date.now() - correlation.timestamp;

    const record = buildResponseRecord(
      this.serverName,
      method,
      requestId,
      correlation.correlationId,
      result,
      error,
      durationMs,
      sessionId,
      this.includeBody,
    );

    this.writeRecord(record);
  }

  /**
   * Log a notification.
   */
  logNotification(
    method: string,
    params: Record<string, unknown> | undefined | null,
    sessionId: string | null = null,
    direction: 'incoming' | 'outgoing' = 'incoming',
  ): void {
    if (!this._active) return;
    if (!shouldRecord(method, this.options.filter)) return;

    const record = buildNotificationRecord(
      this.serverName,
      method,
      params,
      sessionId,
      direction,
      this.includeBody,
    );

    this.writeRecord(record);
  }

  /**
   * Write a pre-built record directly.
   */
  writeRecordDirect(record: AuditRecord): void {
    if (!this._active) return;
    this.writeRecord(record);
  }

  async flush(): Promise<void> {
    await this.writer.flush();
  }

  async close(): Promise<void> {
    if (!this._active) return;
    this._active = false;
    this.correlationMap.clear();
    await this.writer.close();
  }

  async *query(params: AuditQueryParams): AsyncIterable<AuditRecord> {
    const filePath = params.filePath ?? this.writer.getFilePath();
    if (!filePath) {
      throw new Error('Query is only available with file sinks');
    }

    if (!fs.existsSync(filePath)) return;

    const input = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    let count = 0;
    let skipped = 0;
    const offset = params.offset ?? 0;
    const limit = params.limit ?? Infinity;
    const order = params.order ?? 'asc';

    // For desc order, collect all matching records then reverse
    const collected: AuditRecord[] = [];

    for await (const line of rl) {
      if (!line.trim()) continue;

      let record: AuditRecord;
      try {
        record = JSON.parse(line) as AuditRecord;
      } catch {
        continue; // Skip malformed lines
      }

      if (!matchesQuery(record, params)) continue;

      if (order === 'desc') {
        collected.push(record);
      } else {
        if (skipped < offset) {
          skipped++;
          continue;
        }
        if (count >= limit) break;
        yield record;
        count++;
      }
    }

    if (order === 'desc') {
      collected.reverse();
      for (const record of collected) {
        if (skipped < offset) {
          skipped++;
          continue;
        }
        if (count >= limit) break;
        yield record;
        count++;
      }
    }
  }

  async verifyIntegrity(filePath?: string): Promise<IntegrityVerificationResult> {
    if (!this.options.integrity) {
      return { valid: false, recordCount: 0, firstInvalidIndex: -1, error: 'Integrity not configured' };
    }

    const fp = filePath ?? this.writer.getFilePath();
    if (!fp) {
      return { valid: false, recordCount: 0, firstInvalidIndex: -1, error: 'No file path available' };
    }

    if (!fs.existsSync(fp)) {
      return { valid: false, recordCount: 0, firstInvalidIndex: -1, error: 'File not found' };
    }

    const content = fs.readFileSync(fp, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim());
    const records: AuditRecord[] = [];

    for (const line of lines) {
      try {
        records.push(JSON.parse(line) as AuditRecord);
      } catch {
        return {
          valid: false,
          recordCount: records.length,
          firstInvalidIndex: records.length,
          error: 'Malformed record in audit log',
        };
      }
    }

    return verifyIntegrityChain(
      records,
      this.options.integrity.secret,
      this.options.integrity.algorithm ?? 'sha256',
    );
  }

  /**
   * Get stats about the logger state.
   */
  getStats(): { recordCount: number; errorCount: number; active: boolean; pendingCorrelations: number } {
    return {
      recordCount: this._recordCount,
      errorCount: this._errorCount,
      active: this._active,
      pendingCorrelations: this.correlationMap.size,
    };
  }

  private pruneStaleCorrelations(): void {
    const now = Date.now();
    for (const [key, entry] of this.correlationMap) {
      if (now - entry.timestamp > this.correlationTtlMs) {
        this.correlationMap.delete(key);
      }
    }
  }

  private writeRecord(record: AuditRecord): void {
    try {
      let processed = record;

      // Apply field truncation
      if (this.maxFieldSize > 0) {
        processed = truncateRecord(processed, this.maxFieldSize);
      }

      // Apply redaction
      if (this.options.redaction) {
        processed = redactRecord(processed, this.options.redaction);
      }

      // Apply integrity chain
      if (this.integrityChain) {
        processed = this.integrityChain.sign(processed);
      }

      const line = JSON.stringify(processed) + '\n';
      this._recordCount++;

      this.writer.write(line).catch((err) => {
        this._errorCount++;
        this.onError(err as Error);
      });
    } catch (err) {
      this._errorCount++;
      this.onError(err as Error);
    }
  }
}

// ─── Query Matching ────────────────────────────────────────────────

function matchesQuery(record: AuditRecord, params: AuditQueryParams): boolean {
  if (params.method) {
    const methods = Array.isArray(params.method) ? params.method : [params.method];
    if (!methods.includes(record.method)) return false;
  }

  if (params.from) {
    const recordTime = new Date(record.timestamp).getTime();
    if (recordTime < params.from.getTime()) return false;
  }

  if (params.to) {
    const recordTime = new Date(record.timestamp).getTime();
    if (recordTime > params.to.getTime()) return false;
  }

  if (params.sessionId && record.sessionId !== params.sessionId) return false;
  if (params.correlationId && record.correlationId !== params.correlationId) return false;
  if (params.type && record.type !== params.type) return false;

  if (params.toolName) {
    if (!('toolName' in record) || (record as unknown as Record<string, unknown>).toolName !== params.toolName) {
      return false;
    }
  }

  if (params.resourceUri) {
    if (!('resourceUri' in record) || (record as unknown as Record<string, unknown>).resourceUri !== params.resourceUri) {
      return false;
    }
  }

  if (params.promptName) {
    if (!('promptName' in record) || (record as unknown as Record<string, unknown>).promptName !== params.promptName) {
      return false;
    }
  }

  if (params.errorsOnly) {
    const rec = record as unknown as Record<string, unknown>;
    const hasError = rec.error !== undefined || rec.isError === true;
    if (!hasError) return false;
  }

  return true;
}
