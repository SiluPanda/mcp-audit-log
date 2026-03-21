import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AuditWriter } from '../audit-writer.js';
import type { AuditRecord } from '../types.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-audit-writer-test-'));
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

describe('AuditWriter', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) cleanup(d);
    dirs.length = 0;
  });

  it('should log a request and return correlationId', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const writer = new AuditWriter({
      sink: { type: 'file', path: filePath },
      serverName: 'my-server',
      buffer: { immediate: true },
    });
    await writer.open();

    const correlationId = writer.logRequest({
      method: 'tools/call',
      id: 1,
      params: { name: 'get_weather', arguments: { location: 'NYC' } },
      sessionId: 'sess-1',
    });

    expect(correlationId).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    await writer.close();

    const records = readRecords(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe('request');
    expect(records[0].method).toBe('tools/call');
    expect(records[0].serverName).toBe('my-server');
  });

  it('should log a request/response pair', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const writer = new AuditWriter({
      sink: { type: 'file', path: filePath },
      serverName: 'my-server',
      buffer: { immediate: true },
    });
    await writer.open();

    const correlationId = writer.logRequest({
      method: 'tools/call',
      id: 1,
      params: { name: 'get_weather', arguments: { location: 'NYC' } },
    });

    writer.logResponse({
      id: 1,
      correlationId,
      result: { content: [{ type: 'text', text: 'Sunny' }], isError: false },
    });

    await new Promise((r) => setTimeout(r, 50));
    await writer.close();

    const records = readRecords(filePath);
    expect(records).toHaveLength(2);
    expect(records[0].correlationId).toBe(records[1].correlationId);
  });

  it('should log a notification', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const writer = new AuditWriter({
      sink: { type: 'file', path: filePath },
      serverName: 'my-server',
      buffer: { immediate: true },
    });
    await writer.open();

    writer.logNotification({
      method: 'notifications/tools/list_changed',
      direction: 'outgoing',
      params: { reason: 'new tool' },
    });

    await new Promise((r) => setTimeout(r, 50));
    await writer.close();

    const records = readRecords(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe('notification');
  });

  it('should log an error response', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const writer = new AuditWriter({
      sink: { type: 'file', path: filePath },
      serverName: 'my-server',
      buffer: { immediate: true },
    });
    await writer.open();

    const correlationId = writer.logRequest({
      method: 'tools/call',
      id: 1,
      params: { name: 'fail_tool' },
    });

    writer.logResponse({
      id: 1,
      correlationId,
      error: { code: -32600, message: 'Bad request' },
    });

    await new Promise((r) => setTimeout(r, 50));
    await writer.close();

    const records = readRecords(filePath);
    expect(records).toHaveLength(2);
    const response = records[1] as Record<string, unknown>;
    expect(response.error).toEqual({ code: -32600, message: 'Bad request' });
  });

  it('should flush on demand', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const writer = new AuditWriter({
      sink: { type: 'file', path: filePath },
      serverName: 'my-server',
      buffer: { maxRecords: 100, flushIntervalMs: 60000 },
    });
    await writer.open();

    writer.logRequest({ method: 'ping', id: 1 });
    await writer.flush();

    const records = readRecords(filePath);
    expect(records).toHaveLength(1);

    await writer.close();
  });

  it('should apply redaction', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const writer = new AuditWriter({
      sink: { type: 'file', path: filePath },
      serverName: 'my-server',
      redaction: { paths: ['toolArguments.apiKey'] },
      buffer: { immediate: true },
    });
    await writer.open();

    writer.logRequest({
      method: 'tools/call',
      id: 1,
      params: { name: 'api_call', arguments: { apiKey: 'sk-secret', query: 'test' } },
    });

    await new Promise((r) => setTimeout(r, 50));
    await writer.close();

    const records = readRecords(filePath);
    const rec = records[0] as Record<string, unknown>;
    const args = rec.toolArguments as Record<string, string>;
    expect(args.apiKey).toBe('[REDACTED]');
    expect(args.query).toBe('test');
  });

  it('should apply integrity chain', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'audit.log');
    const writer = new AuditWriter({
      sink: { type: 'file', path: filePath },
      serverName: 'my-server',
      integrity: { secret: 'secret', seed: 'seed-val' },
      buffer: { immediate: true },
    });
    await writer.open();

    writer.logRequest({ method: 'ping', id: 1 });
    writer.logRequest({ method: 'ping', id: 2 });

    await new Promise((r) => setTimeout(r, 50));
    await writer.close();

    const records = readRecords(filePath);
    expect((records[0] as Record<string, unknown>)._integritySeed).toBe('seed-val');
    expect((records[0] as Record<string, unknown>)._integrity).toBeDefined();
    expect((records[1] as Record<string, unknown>)._integrity).toBeDefined();
  });
});
