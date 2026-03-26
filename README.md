# mcp-audit-log

Compliance-grade structured audit logging for MCP (Model Context Protocol) servers.

[![npm version](https://img.shields.io/npm/v/mcp-audit-log.svg)](https://www.npmjs.com/package/mcp-audit-log)
[![npm downloads](https://img.shields.io/npm/dt/mcp-audit-log.svg)](https://www.npmjs.com/package/mcp-audit-log)
[![license](https://img.shields.io/npm/l/mcp-audit-log.svg)](https://github.com/SiluPanda/mcp-audit-log/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/mcp-audit-log.svg)](https://nodejs.org)

---

## Description

`mcp-audit-log` records every MCP tool call, resource read, prompt request, and lifecycle event as append-only NDJSON (Newline-Delimited JSON). It produces immutable, structured audit records suitable for SOC 2, HIPAA, GDPR, and internal security reviews.

The package intercepts all JSON-RPC 2.0 message types -- requests, responses, and notifications -- and writes a structured record for each one. It never modifies, delays, or interferes with MCP server behavior. If audit logging fails, the MCP server continues operating normally.

Key capabilities:

- Append-only NDJSON output with a fixed record schema (version field `v: 1`)
- Automatic request/response correlation via shared `correlationId`
- Duration tracking in milliseconds for every response
- HMAC-SHA256/384/512 integrity chains for tamper evidence
- Field-level PII redaction by path, regex pattern, or custom function
- Log rotation by file size with configurable retention policies
- Async buffered I/O with configurable flush strategies
- Programmatic query API for reading and filtering audit log files
- Three sink types: file, stream, and custom backend
- Zero runtime dependencies beyond Node.js built-ins

---

## Installation

```bash
npm install mcp-audit-log
```

---

## Quick Start

```typescript
import { createAuditLog } from 'mcp-audit-log';

const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  serverName: 'my-mcp-server',
});

// Log a tool call request
const correlationId = logger.logRequest(
  'tools/call',
  1,
  { name: 'get_weather', arguments: { location: 'NYC' } },
  'session-123',
);

// Log the corresponding response
logger.logResponse(
  1,
  { content: [{ type: 'text', text: 'Sunny, 72F' }], isError: false },
  null,
  'session-123',
);

// Log a notification
logger.logNotification(
  'notifications/tools/list_changed',
  { reason: 'new tool registered' },
  'session-123',
  'outgoing',
);

// Flush and close on shutdown
await logger.close();
```

Each call above produces one NDJSON line. The request and response share the same `correlationId`, and the response includes `durationMs` measuring elapsed time since the request.

---

## Features

### Append-Only NDJSON Output

All records are written as newline-delimited JSON. Each line is a self-contained JSON object with mandatory base fields:

```json
{
  "v": 1,
  "recordId": "a1b2c3d4-...",
  "timestamp": "2026-03-22T10:30:00.000Z",
  "serverName": "my-mcp-server",
  "sessionId": "session-123",
  "type": "request",
  "method": "tools/call",
  "correlationId": "e5f6g7h8-...",
  "requestId": 1,
  "toolName": "get_weather",
  "toolArguments": { "location": "NYC" }
}
```

Files are opened with the append flag (`'a'`), ensuring the OS guarantees that every write extends the file rather than overwriting existing content.

### Request/Response Correlation

Every request is assigned a UUID `correlationId`. When the matching response arrives (identified by JSON-RPC `id`), it receives the same `correlationId` and a computed `durationMs`. Out-of-order and concurrent responses are handled correctly.

### Field-Level PII Redaction

Redact sensitive data before it reaches the audit log:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  redaction: {
    paths: ['toolArguments.password', 'toolArguments.apiKey'],
    patterns: [/\bsk-[a-zA-Z0-9]{48}\b/g],
    custom: (path, value) => {
      if (path.includes('email')) return value.replace(/@.*/, '@[REDACTED]');
      return value;
    },
    placeholder: '[REDACTED]',
    preserveLength: false,
  },
});
```

Redaction produces a deep clone of each record. The original record is never mutated.

### HMAC Integrity Chains

Enable tamper-evident hash chains where each record's HMAC depends on the previous record's HMAC:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  integrity: {
    secret: process.env.AUDIT_HMAC_SECRET!,
    algorithm: 'sha256', // or 'sha384', 'sha512'
    seed: 'optional-deterministic-seed',
  },
});

// Later: verify the entire chain
const result = await logger.verifyIntegrity();
if (!result.valid) {
  console.error(`Tampering detected at record index ${result.firstInvalidIndex}`);
}
```

The first record carries an `_integritySeed` field. Every record carries an `_integrity` field containing the hex-encoded HMAC.

### Method Filtering

Control which MCP methods produce audit records:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  filter: {
    // Use include OR exclude (mutually exclusive)
    include: ['tools/call', 'resources/read'],
    // Category toggles
    includeNotifications: false,
    includeLifecycle: false,
    includeListOperations: false,
  },
});
```

Specifying both `include` and `exclude` throws a `TypeError`.

### Log Rotation and Retention

Automatic file rotation by size with time-based retention:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  rotation: {
    maxFileSize: 50 * 1024 * 1024, // 50 MiB (default)
    maxFiles: 10,                   // Keep up to 10 rotated files (default)
  },
  retention: {
    maxAge: 90 * 24 * 60 * 60 * 1000, // Delete files older than 90 days
    checkIntervalMs: 3_600_000,         // Check every hour (default)
  },
});
```

Rotated files are named `audit.log.1`, `audit.log.2`, etc. Retention cleanup runs on startup and at the configured interval.

### Query API

Read and filter audit records from file sinks:

```typescript
for await (const record of logger.query({
  method: 'tools/call',
  toolName: 'get_weather',
  from: new Date('2026-01-01'),
  to: new Date('2026-03-01'),
  sessionId: 'session-123',
  errorsOnly: true,
  limit: 100,
  offset: 0,
  order: 'desc',
})) {
  console.log(record.correlationId, record.method);
}
```

The query API streams records from NDJSON files and applies all filters in a single pass.

### Buffered Writes

Control write batching to balance throughput and latency:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  buffer: {
    maxRecords: 100,       // Flush after 100 records (default)
    flushIntervalMs: 1000, // Or after 1 second (default)
    immediate: false,      // Set true to write every record immediately
  },
});
```

When `immediate` is `true`, each record is written synchronously to the sink with no buffering.

### Field Truncation

Large string fields are automatically truncated to prevent unbounded log growth:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  maxFieldSize: 1_048_576, // 1 MiB per field (default)
});
```

Truncated records receive a `_truncated: true` flag. Metadata fields (`v`, `recordId`, `timestamp`, `serverName`, `sessionId`, `type`, `method`, `correlationId`, `requestId`, `_integrity`, `_integritySeed`) are never truncated.

### Body Omission

Disable recording of request/response body content entirely:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  includeBody: false,
});
```

When `false`, fields like `toolArguments`, `promptArguments`, `resultContent`, `contents`, `messages`, `params`, and `result` are set to `null`. Structural metadata (tool name, resource URI, prompt name, duration, error status) is always recorded.

---

## API Reference

### `createAuditLog(options)`

```typescript
function createAuditLog(options: AuditLoggerOptions): Promise<AuditLogger>
```

Factory function. Creates an `AuditLogger` instance, initializes the sink, and returns the ready-to-use logger. This is the primary entry point.

---

### Class: `AuditLogger`

The core audit logger. Implements the `AuditLoggerHandle` interface.

#### `constructor(options: AuditLoggerOptions, serverName?: string)`

Creates a new logger instance. Validates the filter configuration. Does not open the sink -- call `open()` before logging. Prefer `createAuditLog()` which handles this automatically.

#### `open(): Promise<void>`

Opens the underlying sink (creates the file, starts the flush timer, starts the retention timer). Must be called before any logging methods.

#### `logRequest(method, requestId, params, sessionId?): string | null`

```typescript
logRequest(
  method: string,
  requestId: string | number,
  params: Record<string, unknown> | undefined | null,
  sessionId?: string | null,
): string | null
```

Logs an incoming JSON-RPC request. Returns the assigned `correlationId` for pairing with the subsequent response, or `null` if the method was filtered out or the logger is closed.

#### `logResponse(requestId, result, error, sessionId?): void`

```typescript
logResponse(
  requestId: string | number,
  result: Record<string, unknown> | undefined | null,
  error: { code: number; message: string } | undefined | null,
  sessionId?: string | null,
): void
```

Logs an outgoing JSON-RPC response. The `requestId` must match a previously logged request. If no matching request is found, the response is silently dropped. Duration is computed automatically.

#### `logNotification(method, params, sessionId?, direction?): void`

```typescript
logNotification(
  method: string,
  params: Record<string, unknown> | undefined | null,
  sessionId?: string | null,
  direction?: 'incoming' | 'outgoing',
): void
```

Logs a JSON-RPC notification. Notifications have no `correlationId` or `requestId`.

#### `writeRecordDirect(record: AuditRecord): void`

Writes a pre-built `AuditRecord` directly to the pipeline (truncation, redaction, integrity, and sink).

#### `query(params: AuditQueryParams): AsyncIterable<AuditRecord>`

Streams matching records from the audit log file. Throws an `Error` if the sink is not a file sink.

#### `verifyIntegrity(filePath?: string): Promise<IntegrityVerificationResult>`

Verifies the HMAC integrity chain of the audit log file. Returns `{ valid: false }` if integrity is not configured.

#### `flush(): Promise<void>`

Forces all buffered records to be written to the sink immediately.

#### `close(): Promise<void>`

Flushes remaining records and closes the sink. The logger becomes inactive. Safe to call multiple times.

#### `getStats(): { recordCount, errorCount, active, pendingCorrelations }`

Returns current logger statistics including the number of requests awaiting a matching response.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `active` | `boolean` | `true` while the logger is open and accepting records |
| `recordCount` | `number` | Total number of records written (including failed writes) |
| `errorCount` | `number` | Total number of write failures |

---

### Class: `AuditWriter`

Standalone audit writer for custom MCP implementations that do not use `@modelcontextprotocol/sdk`. Wraps `AuditLogger` with a structured parameter interface.

#### `constructor(options: AuditWriterOptions)`

```typescript
interface AuditWriterOptions {
  sink: SinkConfig;
  serverName: string;
  redaction?: RedactionConfig;
  integrity?: IntegrityConfig;
  buffer?: BufferConfig;
  includeBody?: boolean;
  maxFieldSize?: number;
  onError?: (error: Error) => void;
}
```

#### `open(): Promise<void>`

Initialize the sink. Must be called before logging.

#### `logRequest(params: LogRequestParams): string`

```typescript
interface LogRequestParams {
  method: string;
  id: string | number;
  params?: Record<string, unknown>;
  sessionId?: string;
  meta?: Record<string, unknown>;
}
```

Returns the `correlationId` (empty string if filtered).

#### `logResponse(params: LogResponseParams): void`

```typescript
interface LogResponseParams {
  id: string | number;
  correlationId: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
  sessionId?: string;
  meta?: Record<string, unknown>;
}
```

#### `logNotification(params: LogNotificationParams): void`

```typescript
interface LogNotificationParams {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  direction: 'incoming' | 'outgoing';
  meta?: Record<string, unknown>;
}
```

#### `flush(): Promise<void>`

Force-flush buffered records.

#### `close(): Promise<void>`

Flush and close.

---

### Class: `NdjsonWriter`

Low-level NDJSON writer with buffering, rotation, and retention. Used internally by `AuditLogger`.

#### `constructor(sinkConfig, onError, bufferConfig?, rotationConfig?, retentionConfig?)`

#### `open(): Promise<void>`

#### `write(line: string): Promise<void>`

#### `flush(): Promise<void>`

#### `close(): Promise<void>`

#### `getFilePath(): string | null`

Returns the resolved file path for file sinks, or `null` for stream/custom sinks.

---

### Class: `IntegrityChain`

Manages HMAC integrity chain state for a sequence of records.

#### `constructor(config: IntegrityConfig)`

#### `sign(record: AuditRecord): AuditRecord`

Computes the HMAC for the record, attaches `_integrity` (and `_integritySeed` on the first record), and returns the record. Updates internal chain state.

---

### `verifyIntegrityChain(records, secret, algorithm?)`

```typescript
function verifyIntegrityChain(
  records: AuditRecord[],
  secret: string | Buffer,
  algorithm?: string,
): IntegrityVerificationResult
```

Standalone function to verify an integrity chain from an array of parsed records. Returns:

```typescript
interface IntegrityVerificationResult {
  valid: boolean;
  recordCount: number;
  firstInvalidIndex: number;  // -1 if valid
  expectedHmac?: string;
  actualHmac?: string;
  error?: string;
}
```

---

### `buildRequestRecord(serverName, method, requestId, params, sessionId, includeBody)`

```typescript
function buildRequestRecord(
  serverName: string,
  method: string,
  requestId: string | number,
  params: Record<string, unknown> | undefined | null,
  sessionId: string | null,
  includeBody: boolean,
): { record: AuditRecord; correlationId: string }
```

Builds a typed request record based on the MCP method. Returns the record and the generated `correlationId`.

---

### `buildResponseRecord(serverName, method, requestId, correlationId, result, error, durationMs, sessionId, includeBody)`

```typescript
function buildResponseRecord(
  serverName: string,
  method: string,
  requestId: string | number,
  correlationId: string,
  result: Record<string, unknown> | undefined | null,
  error: { code: number; message: string } | undefined | null,
  durationMs: number,
  sessionId: string | null,
  includeBody: boolean,
): AuditRecord
```

Builds a typed response record. Binary content (images, audio) is omitted with a `binaryOmitted: true` flag.

---

### `buildNotificationRecord(serverName, method, params, sessionId, direction, includeBody)`

```typescript
function buildNotificationRecord(
  serverName: string,
  method: string,
  params: Record<string, unknown> | undefined | null,
  sessionId: string | null,
  direction: 'incoming' | 'outgoing',
  includeBody: boolean,
): AuditRecord
```

---

### `redactRecord(record, config)`

```typescript
function redactRecord<T>(record: T, config: RedactionConfig): T
```

Returns a deep clone of the record with redacted values. Never mutates the input.

---

### `shouldRecord(method, filter?)`

```typescript
function shouldRecord(method: string, filter: AuditFilter | undefined): boolean
```

Returns `true` if the given MCP method should produce an audit record under the provided filter configuration.

---

### `validateFilter(filter?)`

```typescript
function validateFilter(filter: AuditFilter | undefined): void
```

Throws `TypeError` if the filter specifies both `include` and `exclude`.

---

### `truncateRecord(record, maxSize)`

```typescript
function truncateRecord(record: AuditRecord, maxSize: number): AuditRecord
```

Returns a deep clone with string fields exceeding `maxSize` bytes truncated to `...[truncated]`. Adds `_truncated: true` to the record if any field was truncated.

---

## Configuration

### `AuditLoggerOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `sink` | `SinkConfig` | *required* | Output destination for audit records |
| `serverName` | `string` | `'unknown'` | Stable identifier for the MCP server |
| `filter` | `AuditFilter` | `undefined` | Method filtering rules |
| `redaction` | `RedactionConfig` | `undefined` | PII redaction rules |
| `integrity` | `IntegrityConfig` | `undefined` | HMAC integrity chain settings |
| `rotation` | `RotationConfig` | `undefined` | File rotation settings (file sink only) |
| `retention` | `RetentionConfig` | `undefined` | File retention policy (file sink only) |
| `buffer` | `BufferConfig` | `undefined` | Write buffering settings |
| `includeBody` | `boolean` | `true` | Whether to include request/response bodies |
| `maxFieldSize` | `number` | `1048576` (1 MiB) | Maximum size in bytes for any single field |
| `onError` | `(error: Error) => void` | `console.error` | Error callback for write failures |
| `correlationTtlMs` | `number` | `300000` (5 min) | TTL in ms for correlation map entries; stale entries are pruned to prevent memory leaks from unanswered requests |
| `correlationMaxSize` | `number` | `10000` | Maximum pending correlations before TTL pruning is triggered |

### Sink Configurations

**File sink** -- writes append-only NDJSON to disk:

```typescript
{ type: 'file', path: './audit.log', mode?: 0o600 }
```

**Stream sink** -- writes to any `Writable` stream:

```typescript
{ type: 'stream', stream: process.stdout }
```

**Custom sink** -- implement the `AuditSink` interface:

```typescript
{
  type: 'custom',
  sink: {
    write(records: string[]): Promise<void>,
    flush(): Promise<void>,
    close(): Promise<void>,
    init?(onError: (error: Error) => void): Promise<void>,
  }
}
```

### `AuditFilter`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `include` | `string[]` | `undefined` | MCP methods to include (mutually exclusive with `exclude`) |
| `exclude` | `string[]` | `undefined` | MCP methods to exclude (mutually exclusive with `include`) |
| `includeLifecycle` | `boolean` | `true` | Record `initialize` and `notifications/initialized` |
| `includeNotifications` | `boolean` | `true` | Record all `notifications/*` methods |
| `includeListOperations` | `boolean` | `true` | Record `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list` |

### `RedactionConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `paths` | `string[]` | `undefined` | Dot-notation field paths to redact (e.g., `'toolArguments.password'`) |
| `patterns` | `RegExp[]` | `undefined` | Regex patterns to match within string values |
| `custom` | `(path: string, value: string) => string` | `undefined` | Custom redaction function |
| `placeholder` | `string` | `'[REDACTED]'` | Replacement text for redacted values |
| `preserveLength` | `boolean` | `false` | Include original value length in placeholder |

### `IntegrityConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `algorithm` | `'sha256' \| 'sha384' \| 'sha512'` | `'sha256'` | HMAC algorithm |
| `secret` | `string \| Buffer` | *required* | HMAC secret key |
| `seed` | `string` | random 32-byte hex | Seed for the first record in the chain |

### `BufferConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxRecords` | `number` | `100` | Flush after this many buffered records |
| `flushIntervalMs` | `number` | `1000` | Flush at this interval in milliseconds |
| `immediate` | `boolean` | `false` | Write every record immediately (no buffering) |

### `RotationConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxFileSize` | `number` | `52428800` (50 MiB) | Maximum file size in bytes before rotation |
| `maxFiles` | `number` | `10` | Number of rotated files to keep |
| `compress` | `boolean` | `false` | Compress rotated files with gzip |

### `RetentionConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxAge` | `number` | `undefined` | Maximum age in milliseconds for rotated files |
| `checkIntervalMs` | `number` | `3600000` (1 hour) | How often to run retention cleanup |

### `AuditQueryParams`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `method` | `string \| string[]` | `undefined` | Filter by MCP method(s) |
| `from` | `Date` | `undefined` | Records on or after this time |
| `to` | `Date` | `undefined` | Records on or before this time |
| `sessionId` | `string` | `undefined` | Filter by session ID |
| `correlationId` | `string` | `undefined` | Filter by correlation ID |
| `type` | `'request' \| 'response' \| 'notification'` | `undefined` | Filter by record type |
| `toolName` | `string` | `undefined` | Filter by tool name |
| `resourceUri` | `string` | `undefined` | Filter by resource URI |
| `promptName` | `string` | `undefined` | Filter by prompt name |
| `errorsOnly` | `boolean` | `undefined` | Only return records with errors |
| `limit` | `number` | `Infinity` | Maximum number of records to return |
| `offset` | `number` | `0` | Number of matching records to skip |
| `order` | `'asc' \| 'desc'` | `'asc'` | Sort order by timestamp |
| `filePath` | `string` | current log file | Path to the NDJSON file to query |

---

## Audit Record Types

The package produces method-specific record types with structured fields beyond the base schema:

| MCP Method | Request Record Fields | Response Record Fields |
|---|---|---|
| `tools/call` | `toolName`, `toolArguments`, `progressToken?` | `durationMs`, `isError`, `resultContent`, `error?` |
| `resources/read` | `resourceUri` | `durationMs`, `contents` (uri, size, contentType, text), `error?` |
| `prompts/get` | `promptName`, `promptArguments` | `durationMs`, `messageCount`, `messages`, `error?` |
| `sampling/createMessage` | `messageCount`, `systemPrompt`, `modelPreferences`, `maxTokens`, `temperature?` | `durationMs`, `role`, `contentType`, `text?`, `model`, `stopReason`, `error?` |
| `initialize` | `protocolVersion`, `clientCapabilities`, `clientInfo` | `durationMs`, `protocolVersion`, `serverCapabilities`, `serverInfo`, `instructions?`, `error?` |
| `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list` | `cursor?` | `durationMs`, `itemCount`, `itemNames`, `nextCursor?`, `error?` |
| Other methods | `params` | `durationMs`, `result`, `error?` |
| Notifications | `direction`, `notificationParams` | -- |

Binary content (images, audio) is never written to the audit log. These fields are replaced with `binaryOmitted: true`.

---

## Error Handling

`mcp-audit-log` is designed to never interfere with MCP server operation. All errors are handled gracefully:

- **Write failures**: Caught and forwarded to the `onError` callback (defaults to `console.error`). The `errorCount` property is incremented. The MCP server is unaffected.
- **Sink errors**: Custom sinks that throw during `write()` are caught. The record is lost, but the logger remains operational.
- **Orphaned responses**: If `logResponse` is called with a `requestId` that has no matching tracked request, the response is silently dropped.
- **Closed logger**: Calling `logRequest`, `logResponse`, or `logNotification` after `close()` is a no-op.
- **Double close**: Calling `close()` multiple times is safe.
- **Filter validation**: Specifying both `include` and `exclude` in the filter throws a `TypeError` at construction time.
- **Query on non-file sink**: Calling `query()` on a stream or custom sink throws an `Error`.
- **Integrity verification without config**: Returns `{ valid: false, error: 'Integrity not configured' }`.

---

## Advanced Usage

### Custom Sink for Log Aggregation

Forward audit records to an external system:

```typescript
import { createAuditLog, type AuditSink } from 'mcp-audit-log';

const elasticSink: AuditSink = {
  async init(onError) {
    // Initialize connection
  },
  async write(records) {
    const body = records.map((r) => {
      const doc = JSON.parse(r);
      return `{"index":{}}\n${r}`;
    }).join('');
    await fetch('http://localhost:9200/audit/_bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body,
    });
  },
  async flush() {},
  async close() {},
};

const logger = await createAuditLog({
  sink: { type: 'custom', sink: elasticSink },
  serverName: 'production-mcp',
});
```

### Streaming to stdout

```typescript
const logger = await createAuditLog({
  sink: { type: 'stream', stream: process.stdout },
  serverName: 'debug-server',
  buffer: { immediate: true },
});
```

### Building Records Manually

Use the low-level record builders for custom pipelines:

```typescript
import {
  buildRequestRecord,
  buildResponseRecord,
  buildNotificationRecord,
  redactRecord,
  truncateRecord,
} from 'mcp-audit-log';

const { record, correlationId } = buildRequestRecord(
  'my-server',
  'tools/call',
  42,
  { name: 'run_query', arguments: { sql: 'SELECT *' } },
  'session-1',
  true,
);

const redacted = redactRecord(record, {
  paths: ['toolArguments.sql'],
});

const truncated = truncateRecord(redacted, 4096);
const line = JSON.stringify(truncated) + '\n';
```

### Standalone Integrity Verification

Verify an NDJSON audit file independently of the logger:

```typescript
import * as fs from 'node:fs';
import { verifyIntegrityChain, type AuditRecord } from 'mcp-audit-log';

const content = fs.readFileSync('./audit.log', 'utf8');
const records = content
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as AuditRecord);

const result = verifyIntegrityChain(records, 'your-hmac-secret', 'sha256');
console.log(result.valid ? 'Chain is intact' : `Tampered at index ${result.firstInvalidIndex}`);
```

### Full MCP Lifecycle Example

```typescript
import { createAuditLog } from 'mcp-audit-log';

const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  serverName: 'production-server',
  filter: { exclude: ['ping'] },
  redaction: { paths: ['toolArguments.credentials'] },
  integrity: { secret: process.env.AUDIT_SECRET! },
  rotation: { maxFileSize: 100 * 1024 * 1024, maxFiles: 20 },
  retention: { maxAge: 180 * 24 * 60 * 60 * 1000 },
  buffer: { maxRecords: 200, flushIntervalMs: 2000 },
});

// Initialize
logger.logRequest('initialize', 0, {
  protocolVersion: '2024-11-05',
  capabilities: { tools: {} },
  clientInfo: { name: 'my-client', version: '1.0' },
}, 'sess-1');

logger.logResponse(0, {
  protocolVersion: '2024-11-05',
  capabilities: { tools: {} },
  serverInfo: { name: 'production-server', version: '2.0' },
}, null, 'sess-1');

logger.logNotification('notifications/initialized', null, 'sess-1', 'incoming');

// Tool calls, resource reads, prompt requests...
// The logger tracks correlation IDs and durations automatically.

// Graceful shutdown
process.on('SIGTERM', async () => {
  await logger.close();
  process.exit(0);
});
```

---

## TypeScript

`mcp-audit-log` is written in TypeScript and ships type declarations (`dist/index.d.ts`). All interfaces and types are exported from the package root:

```typescript
import type {
  // Sink types
  FileSinkConfig,
  StreamSinkConfig,
  CustomSinkConfig,
  SinkConfig,
  AuditSink,
  // Configuration
  AuditLoggerOptions,
  AuditFilter,
  RedactionConfig,
  IntegrityConfig,
  BufferConfig,
  RotationConfig,
  RetentionConfig,
  // Record types
  AuditRecordBase,
  ToolCallRequestRecord,
  ToolCallResponseRecord,
  ResourceReadRequestRecord,
  ResourceReadResponseRecord,
  PromptGetRequestRecord,
  PromptGetResponseRecord,
  SamplingRequestRecord,
  SamplingResponseRecord,
  ListRequestRecord,
  ListResponseRecord,
  InitializeRequestRecord,
  InitializeResponseRecord,
  InitializedNotificationRecord,
  NotificationRecord,
  GenericRequestRecord,
  GenericResponseRecord,
  AuditRecord,
  // Query and verification
  AuditQueryParams,
  IntegrityVerificationResult,
  // Logger handle
  AuditLoggerHandle,
  // Writer types
  AuditWriterOptions,
  LogRequestParams,
  LogResponseParams,
  LogNotificationParams,
} from 'mcp-audit-log';
```

The `AuditRecord` union type enables exhaustive pattern matching:

```typescript
function processRecord(record: AuditRecord): void {
  switch (record.method) {
    case 'tools/call':
      if (record.type === 'request') {
        console.log(`Tool: ${record.toolName}`);
      }
      break;
    case 'resources/read':
      if (record.type === 'request') {
        console.log(`Resource: ${record.resourceUri}`);
      }
      break;
  }
}
```

Compiled with TypeScript 5.x targeting ES2022, strict mode enabled.

---

## License

MIT
