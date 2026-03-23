import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SinkConfig, AuditSink, RotationConfig, RetentionConfig, BufferConfig } from './types.js';

/**
 * Append-only NDJSON writer with support for file rotation, retention,
 * custom sinks, and stream sinks.
 */
export class NdjsonWriter {
  private sink: InternalSink;
  private buffer: string[] = [];
  private readonly maxRecords: number;
  private readonly flushIntervalMs: number;
  private readonly immediate: boolean;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private flushing = false;
  private flushQueue: Array<() => void> = [];
  private readonly onError: (error: Error) => void;

  constructor(
    sinkConfig: SinkConfig,
    onError: (error: Error) => void,
    bufferConfig?: BufferConfig,
    private readonly rotationConfig?: RotationConfig,
    private readonly retentionConfig?: RetentionConfig,
  ) {
    this.onError = onError;
    this.maxRecords = bufferConfig?.maxRecords ?? 100;
    this.flushIntervalMs = bufferConfig?.flushIntervalMs ?? 1000;
    this.immediate = bufferConfig?.immediate ?? false;
    this.sink = createSink(sinkConfig, onError, rotationConfig);
  }

  async open(): Promise<void> {
    await this.sink.open();

    if (!this.immediate && this.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        this.flush().catch((err) => this.onError(err as Error));
      }, this.flushIntervalMs);
      if (this.flushTimer.unref) {
        this.flushTimer.unref();
      }
    }

    if (this.retentionConfig?.maxAge && this.sink instanceof FileSink) {
      const checkInterval = this.retentionConfig.checkIntervalMs ?? 3_600_000;
      this.retentionTimer = setInterval(() => {
        this.runRetention().catch((err) => this.onError(err as Error));
      }, checkInterval);
      if (this.retentionTimer.unref) {
        this.retentionTimer.unref();
      }
      // Run retention on startup
      this.runRetention().catch((err) => this.onError(err as Error));
    }
  }

  async write(line: string): Promise<void> {
    if (this.closed) return;

    if (this.immediate) {
      await this.sink.write([line]);
      return;
    }

    this.buffer.push(line);
    if (this.buffer.length >= this.maxRecords) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.closed && this.buffer.length === 0) return;

    if (this.flushing) {
      return new Promise<void>((resolve) => {
        this.flushQueue.push(resolve);
      });
    }

    this.flushing = true;
    try {
      if (this.buffer.length > 0) {
        const batch = this.buffer.splice(0);
        await this.sink.write(batch);
      }
    } catch (err) {
      this.onError(err as Error);
    } finally {
      this.flushing = false;
      const waiters = this.flushQueue.splice(0);
      for (const resolve of waiters) {
        resolve();
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }

    await this.flush();
    await this.sink.close();
  }

  getFilePath(): string | null {
    if (this.sink instanceof FileSink) {
      return this.sink.filePath;
    }
    return null;
  }

  private async runRetention(): Promise<void> {
    if (!(this.sink instanceof FileSink) || !this.retentionConfig?.maxAge) return;

    const basePath = this.sink.filePath;
    const dir = path.dirname(basePath);
    const base = path.basename(basePath);
    const maxAge = this.retentionConfig.maxAge;
    const now = Date.now();

    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.startsWith(base + '.') && /\.\d+$/.test(entry)) {
          const fullPath = path.join(dir, entry);
          try {
            const stat = fs.statSync(fullPath);
            if (now - stat.mtimeMs > maxAge) {
              fs.unlinkSync(fullPath);
            }
          } catch {
            // Ignore individual file errors
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }
}

// ─── Internal Sink Interface ───────────────────────────────────────

interface InternalSink {
  open(): Promise<void>;
  write(lines: string[]): Promise<void>;
  close(): Promise<void>;
}

// ─── File Sink ─────────────────────────────────────────────────────

class FileSink implements InternalSink {
  private fd: number | null = null;
  readonly filePath: string;
  private readonly mode: number;
  private readonly maxFileSize: number;
  private readonly maxFiles: number;
  private currentSize = 0;

  constructor(
    filePath: string,
    mode: number = 0o600,
    rotation?: RotationConfig,
  ) {
    this.filePath = path.resolve(filePath);
    this.mode = mode;
    this.maxFileSize = rotation?.maxFileSize ?? 52_428_800;
    this.maxFiles = rotation?.maxFiles ?? 10;
  }

  async open(): Promise<void> {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    this.fd = fs.openSync(this.filePath, 'a', this.mode);
    try {
      const stat = fs.fstatSync(this.fd);
      this.currentSize = stat.size;
    } catch {
      this.currentSize = 0;
    }
  }

  async write(lines: string[]): Promise<void> {
    if (this.fd === null) return;

    const data = lines.join('');
    const buf = Buffer.from(data, 'utf8');

    // Check if rotation is needed
    if (this.maxFileSize > 0 && this.currentSize + buf.length > this.maxFileSize) {
      await this.rotate();
    }

    fs.writeSync(this.fd, buf);
    this.currentSize += buf.length;
  }

  async close(): Promise<void> {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  private async rotate(): Promise<void> {
    // Close current file
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }

    // Shift existing rotated files
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = i === 1 ? `${this.filePath}.1` : `${this.filePath}.${i}`;
      const dst = `${this.filePath}.${i + 1}`;
      try {
        if (fs.existsSync(src)) {
          if (i + 1 >= this.maxFiles) {
            fs.unlinkSync(src);
          } else {
            fs.renameSync(src, dst);
          }
        }
      } catch {
        // Ignore rotation errors for individual files
      }
    }

    // Rename current to .1
    try {
      fs.renameSync(this.filePath, `${this.filePath}.1`);
    } catch {
      // Ignore if file doesn't exist
    }

    // Delete files beyond maxFiles
    for (let i = this.maxFiles + 1; i <= this.maxFiles + 5; i++) {
      const old = `${this.filePath}.${i}`;
      try {
        if (fs.existsSync(old)) {
          fs.unlinkSync(old);
        }
      } catch {
        // Ignore
      }
    }

    // Open a new file
    this.fd = fs.openSync(this.filePath, 'a', this.mode);
    this.currentSize = 0;
  }
}

// ─── Stream Sink ───────────────────────────────────────────────────

class StreamSink implements InternalSink {
  constructor(
    private readonly stream: NodeJS.WritableStream,
    private readonly onError: (error: Error) => void,
  ) {}

  async open(): Promise<void> {
    // Stream is already open
  }

  async write(lines: string[]): Promise<void> {
    const data = lines.join('');
    return new Promise<void>((resolve, reject) => {
      const ok = this.stream.write(data, (err) => {
        if (err) {
          this.onError(err);
          reject(err);
        }
      });
      if (ok) {
        resolve();
      } else {
        // Wait for drain
        this.stream.once('drain', () => resolve());
      }
    });
  }

  async close(): Promise<void> {
    // Don't close streams we don't own
  }
}

// ─── Custom Sink Adapter ──────────────────────────────────────────

class CustomSinkAdapter implements InternalSink {
  constructor(
    private readonly sink: AuditSink,
    private readonly onError: (error: Error) => void,
  ) {}

  async open(): Promise<void> {
    if (this.sink.init) {
      await this.sink.init(this.onError);
    }
  }

  async write(lines: string[]): Promise<void> {
    await this.sink.write(lines);
  }

  async close(): Promise<void> {
    await this.sink.flush();
    await this.sink.close();
  }
}

// ─── Factory ──────────────────────────────────────────────────────

function createSink(
  config: SinkConfig,
  onError: (error: Error) => void,
  rotation?: RotationConfig,
): InternalSink {
  switch (config.type) {
    case 'file':
      return new FileSink(config.path, config.mode, rotation);
    case 'stream':
      return new StreamSink(config.stream, onError);
    case 'custom':
      return new CustomSinkAdapter(config.sink, onError);
  }
}
