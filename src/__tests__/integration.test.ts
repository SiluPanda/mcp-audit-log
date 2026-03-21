import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createAuditLog } from '../index.js';
import type { AuditRecord } from '../types.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-audit-int-test-'));
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

describe('Integration: createAuditLog', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) cleanup(d);
    dirs.length = 0;
  });

  it('should create logger via createAuditLog factory', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const logger = await createAuditLog({
      sink: { type: 'file', path: filePath },
      serverName: 'integration-test',
      buffer: { immediate: true },
    });

    expect(logger.active).toBe(true);
    logger.logRequest('tools/call', 1, { name: 'test_tool', arguments: { x: 1 } }, 'sess-1');
    logger.logResponse(1, { content: [{ type: 'text', text: 'ok' }], isError: false }, null, 'sess-1');
    logger.logNotification('notifications/tools/list_changed', null, 'sess-1', 'outgoing');

    await new Promise((r) => setTimeout(r, 50));
    await logger.close();

    const records = readRecords(filePath);
    expect(records).toHaveLength(3);
    expect(records[0].type).toBe('request');
    expect(records[1].type).toBe('response');
    expect(records[2].type).toBe('notification');
  });

  it('should produce valid NDJSON', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const logger = await createAuditLog({
      sink: { type: 'file', path: filePath },
      serverName: 'ndjson-test',
      buffer: { immediate: true },
    });

    for (let i = 0; i < 10; i++) {
      logger.logRequest('ping', i + 1, null);
    }

    await new Promise((r) => setTimeout(r, 50));
    await logger.close();

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(10);

    // Each line must be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    // Each line must end with \n in the original content
    expect(content.endsWith('\n')).toBe(true);
  });

  it('should produce records with all required base fields', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const logger = await createAuditLog({
      sink: { type: 'file', path: filePath },
      serverName: 'field-test',
      buffer: { immediate: true },
    });

    logger.logRequest('tools/call', 42, { name: 'my_tool', arguments: {} }, 'sess-abc');
    await new Promise((r) => setTimeout(r, 50));
    await logger.close();

    const records = readRecords(filePath);
    const rec = records[0];

    expect(rec.v).toBe(1);
    expect(rec.recordId).toMatch(/^[0-9a-f-]{36}$/);
    expect(rec.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(rec.serverName).toBe('field-test');
    expect(rec.sessionId).toBe('sess-abc');
    expect(rec.type).toBe('request');
    expect(rec.method).toBe('tools/call');
    expect(rec.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(rec.requestId).toBe(42);
  });

  it('should handle a full tool call lifecycle', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const logger = await createAuditLog({
      sink: { type: 'file', path: filePath },
      serverName: 'lifecycle-test',
      buffer: { immediate: true },
    });

    // Initialize
    logger.logRequest('initialize', 0, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'test-client', version: '1.0' },
    }, 'sess-1');

    logger.logResponse(0, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'lifecycle-test', version: '1.0' },
    }, null, 'sess-1');

    // Initialized notification
    logger.logNotification('notifications/initialized', null, 'sess-1', 'incoming');

    // Tool call
    logger.logRequest('tools/call', 1, {
      name: 'get_weather',
      arguments: { location: 'NYC' },
    }, 'sess-1');

    await new Promise((r) => setTimeout(r, 20));

    logger.logResponse(1, {
      content: [{ type: 'text', text: 'Sunny, 72F' }],
      isError: false,
    }, null, 'sess-1');

    // Resource read
    logger.logRequest('resources/read', 2, {
      uri: 'file:///data.csv',
    }, 'sess-1');

    logger.logResponse(2, {
      contents: [{ uri: 'file:///data.csv', text: 'a,b,c\n1,2,3' }],
    }, null, 'sess-1');

    await new Promise((r) => setTimeout(r, 50));
    await logger.close();

    const records = readRecords(filePath);
    expect(records).toHaveLength(7);

    // Verify methods
    expect(records[0].method).toBe('initialize');
    expect(records[1].method).toBe('initialize');
    expect(records[2].method).toBe('notifications/initialized');
    expect(records[3].method).toBe('tools/call');
    expect(records[4].method).toBe('tools/call');
    expect(records[5].method).toBe('resources/read');
    expect(records[6].method).toBe('resources/read');

    // Verify types
    expect(records[0].type).toBe('request');
    expect(records[1].type).toBe('response');
    expect(records[2].type).toBe('notification');
  });

  it('should handle concurrent requests', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const logger = await createAuditLog({
      sink: { type: 'file', path: filePath },
      serverName: 'concurrent-test',
      buffer: { immediate: true },
    });

    // Start multiple requests
    logger.logRequest('tools/call', 1, { name: 'tool_a' });
    logger.logRequest('tools/call', 2, { name: 'tool_b' });
    logger.logRequest('tools/call', 3, { name: 'tool_c' });

    // Respond out of order
    logger.logResponse(2, { content: [{ type: 'text', text: 'b' }], isError: false }, null);
    logger.logResponse(3, { content: [{ type: 'text', text: 'c' }], isError: false }, null);
    logger.logResponse(1, { content: [{ type: 'text', text: 'a' }], isError: false }, null);

    await new Promise((r) => setTimeout(r, 50));
    await logger.close();

    const records = readRecords(filePath);
    expect(records).toHaveLength(6);

    // Each request/response pair should share a correlationId
    const requests = records.filter((r) => r.type === 'request');
    const responses = records.filter((r) => r.type === 'response');
    expect(requests).toHaveLength(3);
    expect(responses).toHaveLength(3);

    for (const req of requests) {
      const matchingResp = responses.find((r) => r.correlationId === req.correlationId);
      expect(matchingResp).toBeDefined();
    }
  });

  it('should work with filtering, redaction, and integrity together', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const logger = await createAuditLog({
      sink: { type: 'file', path: filePath },
      serverName: 'combined-test',
      filter: { exclude: ['ping'] },
      redaction: { paths: ['toolArguments.secret'] },
      integrity: { secret: 'test-key', seed: 'test-seed' },
      buffer: { immediate: true },
    });

    // Ping should be filtered out
    logger.logRequest('ping', 1, null);

    // Tool call with redacted field
    logger.logRequest('tools/call', 2, {
      name: 'sensitive_tool',
      arguments: { query: 'safe', secret: 'hidden-value' },
    });

    logger.logResponse(2, {
      content: [{ type: 'text', text: 'result' }],
      isError: false,
    }, null);

    await new Promise((r) => setTimeout(r, 50));

    // Verify integrity
    const integrityResult = await logger.verifyIntegrity();
    expect(integrityResult.valid).toBe(true);
    expect(integrityResult.recordCount).toBe(2); // ping was filtered

    await logger.close();

    const records = readRecords(filePath);
    expect(records).toHaveLength(2);

    // Check redaction
    const requestRec = records[0] as Record<string, unknown>;
    const args = requestRec.toolArguments as Record<string, string>;
    expect(args.query).toBe('safe');
    expect(args.secret).toBe('[REDACTED]');

    // Check integrity fields
    expect(requestRec._integritySeed).toBe('test-seed');
    expect(requestRec._integrity).toBeDefined();
  });

  it('should handle query with time range', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const logger = await createAuditLog({
      sink: { type: 'file', path: filePath },
      serverName: 'time-test',
      buffer: { immediate: true },
    });

    await new Promise((r) => setTimeout(r, 20));

    logger.logRequest('ping', 1, null);
    await new Promise((r) => setTimeout(r, 20));

    const middleTime = new Date();
    await new Promise((r) => setTimeout(r, 20));

    logger.logRequest('ping', 2, null);
    await new Promise((r) => setTimeout(r, 50));

    // Query from middle onwards
    const results: AuditRecord[] = [];
    for await (const record of logger.query({ from: middleTime })) {
      results.push(record);
    }
    expect(results).toHaveLength(1);
    expect(results[0].requestId).toBe(2);

    // Query up to middle
    const results2: AuditRecord[] = [];
    for await (const record of logger.query({ to: middleTime })) {
      results2.push(record);
    }
    expect(results2).toHaveLength(1);
    expect(results2[0].requestId).toBe(1);

    await logger.close();
  });
});
