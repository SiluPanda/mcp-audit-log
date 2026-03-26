import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AuditLogger } from '../logger.js';
import type { AuditRecord, AuditSink } from '../types.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-audit-log-test-'));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

function readRecords(filePath: string): AuditRecord[] {
  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe('AuditLogger', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) cleanup(d);
    dirs.length = 0;
  });

  describe('lifecycle', () => {
    it('should start active and become inactive after close', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const logger = new AuditLogger({
        sink: { type: 'file', path: path.join(dir, 'audit.log') },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      expect(logger.active).toBe(true);
      await logger.close();
      expect(logger.active).toBe(false);
    });

    it('should not write after close', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();
      logger.logRequest('tools/call', 1, { name: 'test' });
      await logger.close();

      logger.logRequest('tools/call', 2, { name: 'test2' });
      // Wait for async write
      await new Promise((r) => setTimeout(r, 50));

      const records = readRecords(filePath);
      expect(records).toHaveLength(1);
    });

    it('should handle double close gracefully', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const logger = new AuditLogger({
        sink: { type: 'file', path: path.join(dir, 'audit.log') },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();
      await logger.close();
      await expect(logger.close()).resolves.toBeUndefined();
    });
  });

  describe('request/response logging', () => {
    it('should log a request and return correlationId', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test-server',
        buffer: { immediate: true },
      });
      await logger.open();

      const correlationId = logger.logRequest('tools/call', 1, { name: 'my_tool', arguments: { x: 1 } }, 'sess-1');
      expect(correlationId).toBeDefined();
      expect(correlationId).not.toBeNull();

      // Wait for write
      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      const records = readRecords(filePath);
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe('request');
      expect(records[0].method).toBe('tools/call');
      expect(records[0].correlationId).toBe(correlationId);
    });

    it('should log a response paired with the request', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test-server',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('tools/call', 1, { name: 'my_tool', arguments: {} }, 'sess-1');

      // Small delay to ensure distinct timestamps
      await new Promise((r) => setTimeout(r, 10));

      logger.logResponse(
        1,
        { content: [{ type: 'text', text: 'result' }], isError: false },
        null,
        'sess-1',
      );

      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      const records = readRecords(filePath);
      expect(records).toHaveLength(2);
      expect(records[0].type).toBe('request');
      expect(records[1].type).toBe('response');
      // Same correlationId
      expect(records[0].correlationId).toBe(records[1].correlationId);
      // Duration should be >= 0
      expect('durationMs' in records[1] && records[1].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should ignore response without matching request', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logResponse(999, { result: true }, null, null);
      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      const content = fs.readFileSync(filePath, 'utf8').trim();
      expect(content).toBe('');
    });
  });

  describe('notification logging', () => {
    it('should log notifications', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logNotification('notifications/tools/list_changed', { reason: 'new tool' }, 'sess-1', 'outgoing');
      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      const records = readRecords(filePath);
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe('notification');
      expect(records[0].method).toBe('notifications/tools/list_changed');
    });
  });

  describe('filtering', () => {
    it('should filter out excluded methods', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        filter: { exclude: ['ping'] },
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('ping', 1, null);
      logger.logRequest('tools/call', 2, { name: 'test' });
      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      const records = readRecords(filePath);
      expect(records).toHaveLength(1);
      expect(records[0].method).toBe('tools/call');
    });

    it('should only include specified methods', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        filter: { include: ['tools/call'] },
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('tools/call', 1, { name: 'test' });
      logger.logRequest('resources/read', 2, { uri: 'file:///a' });
      logger.logRequest('ping', 3, null);
      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      const records = readRecords(filePath);
      expect(records).toHaveLength(1);
      expect(records[0].method).toBe('tools/call');
    });

    it('should return null correlationId for filtered requests', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const logger = new AuditLogger({
        sink: { type: 'file', path: path.join(dir, 'audit.log') },
        serverName: 'test',
        filter: { exclude: ['ping'] },
        buffer: { immediate: true },
      });
      await logger.open();

      const correlationId = logger.logRequest('ping', 1, null);
      expect(correlationId).toBeNull();

      await logger.close();
    });
  });

  describe('redaction', () => {
    it('should redact configured fields', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        redaction: { paths: ['toolArguments.password'] },
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('tools/call', 1, {
        name: 'login',
        arguments: { username: 'alice', password: 'secret123' },
      });
      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      const records = readRecords(filePath);
      expect(records).toHaveLength(1);
      const rec = records[0] as Record<string, unknown>;
      const args = rec.toolArguments as Record<string, string>;
      expect(args.username).toBe('alice');
      expect(args.password).toBe('[REDACTED]');
    });
  });

  describe('integrity', () => {
    it('should add integrity chain to records', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        integrity: { secret: 'my-secret', seed: 'my-seed' },
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('ping', 1, null);
      logger.logRequest('ping', 2, null);
      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      const records = readRecords(filePath);
      expect(records).toHaveLength(2);
      expect((records[0] as Record<string, unknown>)._integritySeed).toBe('my-seed');
      expect((records[0] as Record<string, unknown>)._integrity).toBeDefined();
      expect((records[1] as Record<string, unknown>)._integrity).toBeDefined();
      expect((records[1] as Record<string, unknown>)._integritySeed).toBeUndefined();
    });

    it('should verify integrity chain', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        integrity: { secret: 'my-secret', seed: 'my-seed' },
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('ping', 1, null);
      logger.logRequest('ping', 2, null);
      logger.logRequest('ping', 3, null);
      await new Promise((r) => setTimeout(r, 50));

      const result = await logger.verifyIntegrity();
      expect(result.valid).toBe(true);
      expect(result.recordCount).toBe(3);

      await logger.close();
    });

    it('should detect tampering in integrity verification', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        integrity: { secret: 'my-secret', seed: 'my-seed' },
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('ping', 1, null);
      logger.logRequest('ping', 2, null);
      await new Promise((r) => setTimeout(r, 50));

      // Tamper with the file
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n');
      const record = JSON.parse(lines[0]);
      record.method = 'tampered';
      lines[0] = JSON.stringify(record);
      fs.writeFileSync(filePath, lines.join('\n') + '\n');

      const result = await logger.verifyIntegrity();
      expect(result.valid).toBe(false);

      await logger.close();
    });
  });

  describe('stats', () => {
    it('should track record count', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const logger = new AuditLogger({
        sink: { type: 'file', path: path.join(dir, 'audit.log') },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      expect(logger.recordCount).toBe(0);
      logger.logRequest('ping', 1, null);
      logger.logRequest('ping', 2, null);
      expect(logger.recordCount).toBe(2);

      await logger.close();
    });

    it('should track error count', async () => {
      const errors: Error[] = [];
      const customSink: AuditSink = {
        write: async () => { throw new Error('write failed'); },
        flush: async () => {},
        close: async () => {},
      };
      const logger = new AuditLogger({
        sink: { type: 'custom', sink: customSink },
        serverName: 'test',
        buffer: { immediate: true },
        onError: (err) => errors.push(err),
      });
      await logger.open();

      logger.logRequest('ping', 1, null);
      // Wait for async error
      await new Promise((r) => setTimeout(r, 100));

      expect(logger.errorCount).toBe(1);
      expect(errors).toHaveLength(1);

      await logger.close();
    });

    it('should provide stats via getStats', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const logger = new AuditLogger({
        sink: { type: 'file', path: path.join(dir, 'audit.log') },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('tools/call', 1, { name: 'test' });

      const stats = logger.getStats();
      expect(stats.recordCount).toBe(1);
      expect(stats.errorCount).toBe(0);
      expect(stats.active).toBe(true);
      expect(stats.pendingCorrelations).toBe(1);

      await logger.close();
    });
  });

  describe('query', () => {
    it('should query records by method', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('tools/call', 1, { name: 'a' });
      logger.logRequest('resources/read', 2, { uri: 'file:///b' });
      logger.logRequest('tools/call', 3, { name: 'c' });
      await new Promise((r) => setTimeout(r, 50));

      const results: AuditRecord[] = [];
      for await (const record of logger.query({ method: 'tools/call' })) {
        results.push(record);
      }
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.method === 'tools/call')).toBe(true);

      await logger.close();
    });

    it('should query records by type', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('tools/call', 1, { name: 'a' });
      logger.logResponse(1, { content: [{ type: 'text', text: 'r' }], isError: false }, null);
      logger.logNotification('notifications/progress', { progress: 50 });
      await new Promise((r) => setTimeout(r, 50));

      const requests: AuditRecord[] = [];
      for await (const record of logger.query({ type: 'request' })) {
        requests.push(record);
      }
      expect(requests).toHaveLength(1);
      expect(requests[0].type).toBe('request');

      await logger.close();
    });

    it('should support limit and offset', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      for (let i = 0; i < 5; i++) {
        logger.logRequest('ping', i + 1, null);
      }
      await new Promise((r) => setTimeout(r, 50));

      const results: AuditRecord[] = [];
      for await (const record of logger.query({ limit: 2, offset: 1 })) {
        results.push(record);
      }
      expect(results).toHaveLength(2);

      await logger.close();
    });

    it('should support desc order', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('ping', 1, null);
      await new Promise((r) => setTimeout(r, 10));
      logger.logRequest('ping', 2, null);
      await new Promise((r) => setTimeout(r, 50));

      const results: AuditRecord[] = [];
      for await (const record of logger.query({ order: 'desc' })) {
        results.push(record);
      }
      expect(results).toHaveLength(2);
      // desc order: second record first
      expect(results[0].requestId).toBe(2);
      expect(results[1].requestId).toBe(1);

      await logger.close();
    });

    it('should query by sessionId', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('ping', 1, null, 'sess-a');
      logger.logRequest('ping', 2, null, 'sess-b');
      logger.logRequest('ping', 3, null, 'sess-a');
      await new Promise((r) => setTimeout(r, 50));

      const results: AuditRecord[] = [];
      for await (const record of logger.query({ sessionId: 'sess-a' })) {
        results.push(record);
      }
      expect(results).toHaveLength(2);

      await logger.close();
    });

    it('should query by correlationId', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      const corrId = logger.logRequest('tools/call', 1, { name: 'a' })!;
      logger.logResponse(1, { content: [{ type: 'text', text: 'r' }], isError: false }, null);
      logger.logRequest('ping', 2, null); // different correlationId
      await new Promise((r) => setTimeout(r, 50));

      const results: AuditRecord[] = [];
      for await (const record of logger.query({ correlationId: corrId })) {
        results.push(record);
      }
      expect(results).toHaveLength(2);

      await logger.close();
    });

    it('should query by toolName', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('tools/call', 1, { name: 'get_weather' });
      logger.logRequest('tools/call', 2, { name: 'run_query' });
      await new Promise((r) => setTimeout(r, 50));

      const results: AuditRecord[] = [];
      for await (const record of logger.query({ toolName: 'get_weather' })) {
        results.push(record);
      }
      expect(results).toHaveLength(1);

      await logger.close();
    });

    it('should query errorsOnly', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('tools/call', 1, { name: 'a' });
      logger.logResponse(1, null, { code: -32600, message: 'Error' });
      logger.logRequest('tools/call', 2, { name: 'b' });
      logger.logResponse(2, { content: [], isError: false }, null);
      await new Promise((r) => setTimeout(r, 50));

      const results: AuditRecord[] = [];
      for await (const record of logger.query({ errorsOnly: true })) {
        results.push(record);
      }
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('response');

      await logger.close();
    });

    it('should throw when querying non-file sink', async () => {
      const { PassThrough } = await import('node:stream');
      const stream = new PassThrough();
      const logger = new AuditLogger({
        sink: { type: 'stream', stream },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      await expect(async () => {
        for await (const _record of logger.query({})) {
          // Should throw
        }
      }).rejects.toThrow('Query is only available with file sinks');

      await logger.close();
    });
  });

  describe('includeBody', () => {
    it('should omit body content when includeBody is false', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        includeBody: false,
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('tools/call', 1, { name: 'test', arguments: { secret: 'val' } });
      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      const records = readRecords(filePath);
      const rec = records[0] as Record<string, unknown>;
      expect(rec.toolArguments).toBeNull();
    });
  });

  describe('custom sink', () => {
    it('should write to custom sink', async () => {
      const written: string[][] = [];
      const customSink: AuditSink = {
        write: async (records) => { written.push(records); },
        flush: async () => {},
        close: async () => {},
      };

      const logger = new AuditLogger({
        sink: { type: 'custom', sink: customSink },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('ping', 1, null);
      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      expect(written.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('filter validation', () => {
    it('should throw on invalid filter (include + exclude)', () => {
      const dir = tmpDir();
      dirs.push(dir);
      expect(() => {
        new AuditLogger({
          sink: { type: 'file', path: path.join(dir, 'audit.log') },
          serverName: 'test',
          filter: { include: ['ping'], exclude: ['tools/call'] },
        });
      }).toThrow(TypeError);
    });
  });

  describe('serverName', () => {
    it('should use provided serverName', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'my-mcp-server',
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('ping', 1, null);
      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      const records = readRecords(filePath);
      expect(records[0].serverName).toBe('my-mcp-server');
    });

    it('should default to "unknown" when no serverName', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        buffer: { immediate: true },
      });
      await logger.open();

      logger.logRequest('ping', 1, null);
      await new Promise((r) => setTimeout(r, 50));
      await logger.close();

      const records = readRecords(filePath);
      expect(records[0].serverName).toBe('unknown');
    });
  });

  describe('correlation map TTL pruning', () => {
    it('should prune stale correlation entries when map exceeds max size', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const logger = new AuditLogger({
        sink: { type: 'file', path: path.join(dir, 'audit.log') },
        serverName: 'test',
        buffer: { immediate: true },
        correlationTtlMs: 1000,    // 1 second TTL
        correlationMaxSize: 5,     // trigger pruning after 5 entries
      });
      await logger.open();

      // Use fake timers to control time
      vi.useFakeTimers();

      try {
        const baseTime = Date.now();

        // Add 5 requests (no responses) — these will become stale
        for (let i = 1; i <= 5; i++) {
          vi.setSystemTime(baseTime);
          logger.logRequest('ping', i, null);
        }
        expect(logger.getStats().pendingCorrelations).toBe(5);

        // Advance time past the TTL
        vi.setSystemTime(baseTime + 2000);

        // Add a 6th request — this pushes size to 6, exceeding maxSize of 5,
        // triggering pruning of the 5 stale entries
        logger.logRequest('ping', 6, null);

        // The 5 stale entries should be pruned, leaving only request 6
        expect(logger.getStats().pendingCorrelations).toBe(1);
      } finally {
        vi.useRealTimers();
        await logger.close();
      }
    });

    it('should not prune entries that are still within TTL', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const logger = new AuditLogger({
        sink: { type: 'file', path: path.join(dir, 'audit.log') },
        serverName: 'test',
        buffer: { immediate: true },
        correlationTtlMs: 5000,    // 5 second TTL
        correlationMaxSize: 3,     // trigger pruning after 3 entries
      });
      await logger.open();

      vi.useFakeTimers();

      try {
        const baseTime = Date.now();
        vi.setSystemTime(baseTime);

        // Add 3 requests
        logger.logRequest('ping', 1, null);
        logger.logRequest('ping', 2, null);
        logger.logRequest('ping', 3, null);
        expect(logger.getStats().pendingCorrelations).toBe(3);

        // Advance time but stay within TTL
        vi.setSystemTime(baseTime + 1000);

        // Add a 4th — triggers pruning check but nothing is stale
        logger.logRequest('ping', 4, null);

        // All 4 entries should remain
        expect(logger.getStats().pendingCorrelations).toBe(4);
      } finally {
        vi.useRealTimers();
        await logger.close();
      }
    });

    it('should not prune when map size is within threshold', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const logger = new AuditLogger({
        sink: { type: 'file', path: path.join(dir, 'audit.log') },
        serverName: 'test',
        buffer: { immediate: true },
        correlationTtlMs: 100,
        correlationMaxSize: 10000,  // high threshold
      });
      await logger.open();

      vi.useFakeTimers();

      try {
        const baseTime = Date.now();
        vi.setSystemTime(baseTime);

        // Add a few requests — well under threshold
        for (let i = 1; i <= 5; i++) {
          logger.logRequest('ping', i, null);
        }

        // Advance past TTL
        vi.setSystemTime(baseTime + 500);

        // Add another — still under threshold so no pruning
        logger.logRequest('ping', 6, null);
        expect(logger.getStats().pendingCorrelations).toBe(6);
      } finally {
        vi.useRealTimers();
        await logger.close();
      }
    });

    it('should use default TTL and max size when not configured', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const logger = new AuditLogger({
        sink: { type: 'file', path: path.join(dir, 'audit.log') },
        serverName: 'test',
        buffer: { immediate: true },
      });
      await logger.open();

      // Just verify defaults don't cause errors — add a few requests
      for (let i = 1; i <= 10; i++) {
        logger.logRequest('ping', i, null);
      }
      expect(logger.getStats().pendingCorrelations).toBe(10);

      await logger.close();
    });

    it('should still allow logResponse for non-pruned entries after pruning', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const logger = new AuditLogger({
        sink: { type: 'file', path: filePath },
        serverName: 'test',
        buffer: { immediate: true },
        correlationTtlMs: 500,
        correlationMaxSize: 3,
      });
      await logger.open();

      vi.useFakeTimers();

      try {
        const baseTime = Date.now();
        vi.setSystemTime(baseTime);

        // Add 3 old requests
        logger.logRequest('ping', 1, null);
        logger.logRequest('ping', 2, null);
        logger.logRequest('ping', 3, null);

        // Advance past TTL
        vi.setSystemTime(baseTime + 1000);

        // Add a fresh request (id=4) — triggers pruning of stale 1,2,3
        logger.logRequest('ping', 4, null);
        expect(logger.getStats().pendingCorrelations).toBe(1);

        // The fresh entry (4) should still be matchable
        logger.logResponse(4, { result: true }, null);
        expect(logger.getStats().pendingCorrelations).toBe(0);
      } finally {
        vi.useRealTimers();
        await logger.close();
      }
    });
  });
});
