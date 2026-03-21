import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { NdjsonWriter } from '../writer.js';
import { PassThrough } from 'node:stream';

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

describe('NdjsonWriter', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) cleanup(d);
    dirs.length = 0;
  });

  describe('file sink', () => {
    it('should create file and write lines', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const writer = new NdjsonWriter(
        { type: 'file', path: filePath },
        console.error,
        { immediate: true },
      );

      await writer.open();
      await writer.write('{"test":1}\n');
      await writer.write('{"test":2}\n');
      await writer.close();

      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual({ test: 1 });
      expect(JSON.parse(lines[1])).toEqual({ test: 2 });
    });

    it('should append to existing file', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      fs.writeFileSync(filePath, '{"existing":true}\n');

      const writer = new NdjsonWriter(
        { type: 'file', path: filePath },
        console.error,
        { immediate: true },
      );

      await writer.open();
      await writer.write('{"new":true}\n');
      await writer.close();

      const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('should create parent directories', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'sub', 'dir', 'audit.log');
      const writer = new NdjsonWriter(
        { type: 'file', path: filePath },
        console.error,
        { immediate: true },
      );

      await writer.open();
      await writer.write('{"test":1}\n');
      await writer.close();

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should return file path from getFilePath', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const writer = new NdjsonWriter(
        { type: 'file', path: filePath },
        console.error,
        { immediate: true },
      );

      await writer.open();
      expect(writer.getFilePath()).toBe(path.resolve(filePath));
      await writer.close();
    });
  });

  describe('buffering', () => {
    it('should buffer records and flush on maxRecords', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const writer = new NdjsonWriter(
        { type: 'file', path: filePath },
        console.error,
        { maxRecords: 3, flushIntervalMs: 60000, immediate: false },
      );

      await writer.open();
      await writer.write('{"a":1}\n');
      await writer.write('{"a":2}\n');

      // Not flushed yet
      expect(fs.readFileSync(filePath, 'utf8')).toBe('');

      await writer.write('{"a":3}\n'); // triggers flush

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content.trim().split('\n')).toHaveLength(3);

      await writer.close();
    });

    it('should flush remaining on close', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const writer = new NdjsonWriter(
        { type: 'file', path: filePath },
        console.error,
        { maxRecords: 100, flushIntervalMs: 60000, immediate: false },
      );

      await writer.open();
      await writer.write('{"a":1}\n');
      await writer.write('{"a":2}\n');
      await writer.close();

      const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('should not write after close', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const writer = new NdjsonWriter(
        { type: 'file', path: filePath },
        console.error,
        { immediate: true },
      );

      await writer.open();
      await writer.write('{"a":1}\n');
      await writer.close();
      await writer.write('{"a":2}\n'); // should be silently dropped

      const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
    });
  });

  describe('rotation', () => {
    it('should rotate when file exceeds maxFileSize', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const writer = new NdjsonWriter(
        { type: 'file', path: filePath },
        console.error,
        { immediate: true },
        { maxFileSize: 50, maxFiles: 3 },
      );

      await writer.open();

      // Write enough to trigger rotation
      for (let i = 0; i < 10; i++) {
        await writer.write(`{"record":${i},"padding":"${'x'.repeat(20)}"}\n`);
      }

      await writer.close();

      // Check that rotation happened
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    });

    it('should limit rotated files to maxFiles', async () => {
      const dir = tmpDir();
      dirs.push(dir);
      const filePath = path.join(dir, 'audit.log');
      const writer = new NdjsonWriter(
        { type: 'file', path: filePath },
        console.error,
        { immediate: true },
        { maxFileSize: 30, maxFiles: 2 },
      );

      await writer.open();

      for (let i = 0; i < 20; i++) {
        await writer.write(`{"record":${i},"data":"${'y'.repeat(10)}"}\n`);
      }

      await writer.close();

      // Should have at most maxFiles rotated files
      expect(fs.existsSync(filePath)).toBe(true);
      const entries = fs.readdirSync(dir);
      const rotatedFiles = entries.filter((e) => e.startsWith('audit.log.'));
      expect(rotatedFiles.length).toBeLessThanOrEqual(2);
    });
  });

  describe('stream sink', () => {
    it('should write to a writable stream', async () => {
      const chunks: string[] = [];
      const stream = new PassThrough();
      stream.on('data', (chunk) => chunks.push(chunk.toString()));

      const writer = new NdjsonWriter(
        { type: 'stream', stream },
        console.error,
        { immediate: true },
      );

      await writer.open();
      await writer.write('{"test":1}\n');
      await writer.write('{"test":2}\n');
      await writer.close();

      const combined = chunks.join('');
      const lines = combined.trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('should return null from getFilePath for stream sinks', async () => {
      const stream = new PassThrough();
      const writer = new NdjsonWriter(
        { type: 'stream', stream },
        console.error,
        { immediate: true },
      );

      await writer.open();
      expect(writer.getFilePath()).toBeNull();
      await writer.close();
    });
  });

  describe('custom sink', () => {
    it('should delegate to custom sink', async () => {
      const records: string[][] = [];
      const customSink = {
        write: async (r: string[]) => { records.push(r); },
        flush: async () => {},
        close: async () => {},
      };

      const writer = new NdjsonWriter(
        { type: 'custom', sink: customSink },
        console.error,
        { immediate: true },
      );

      await writer.open();
      await writer.write('{"test":1}\n');
      await writer.write('{"test":2}\n');
      await writer.close();

      expect(records).toHaveLength(2);
    });

    it('should call init on custom sink', async () => {
      let initialized = false;
      const customSink = {
        init: async () => { initialized = true; },
        write: async () => {},
        flush: async () => {},
        close: async () => {},
      };

      const writer = new NdjsonWriter(
        { type: 'custom', sink: customSink },
        console.error,
        { immediate: true },
      );

      await writer.open();
      expect(initialized).toBe(true);
      await writer.close();
    });
  });
});
