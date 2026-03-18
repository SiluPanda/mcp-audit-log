# mcp-audit-log -- Specification

## 1. Overview

`mcp-audit-log` is a drop-in structured audit logger that records every MCP (Model Context Protocol) tool call, resource read, and prompt request as append-only NDJSON (Newline-Delimited JSON). It wraps an existing MCP `Server` instance from `@modelcontextprotocol/sdk` and transparently intercepts all protocol messages -- requests, responses, and notifications -- writing a structured audit record for each one. The server's behavior is completely unchanged; `mcp-audit-log` observes and records but never modifies message content or control flow.

The gap this package fills is concrete and urgent. Enterprise teams evaluating MCP consistently cite the absence of audit trails as a top concern. When an AI model calls a `tools/call` to execute a database query, delete a file, or hit an external API, there is no built-in mechanism to record what was called, with what arguments, what was returned, how long it took, or who initiated it. The MCP specification recommends that clients "log tool usage for audit purposes," but provides no tooling to do so. Security auditors need tamper-evident records. Compliance officers need exportable logs that prove what happened and when. Platform teams need correlation IDs to trace a chain of tool calls back to a single user session. No standalone package in the MCP ecosystem addresses any of these requirements.

`mcp-audit-log` provides a minimal, focused solution. It is not an application logger, an observability platform, or a monitoring dashboard. It is a compliance-grade audit recorder that writes immutable, structured records of every protocol-level interaction. It supports configurable output sinks (files, streams, custom backends), optional HMAC integrity chains for tamper evidence, field-level PII redaction, log rotation, and retention policies. It is designed to never block or slow down the MCP server it wraps, using async buffered I/O with configurable flush strategies.

---

## 2. Goals and Non-Goals

### Goals

- Provide a single `createAuditLogger(server, options)` function that wraps an MCP `Server` instance and begins recording all protocol messages as structured audit records.
- Record every auditable MCP interaction: `tools/call`, `tools/list`, `resources/read`, `resources/list`, `resources/templates/list`, `prompts/get`, `prompts/list`, `sampling/createMessage`, `initialize`/`initialized`, `ping`, `completions/complete`, `logging/setLevel`, and all notifications.
- Write audit records as append-only NDJSON (one JSON object per line, newline-terminated).
- Correlate request/response pairs using the JSON-RPC `id` field, assigning a shared `correlationId` to each pair.
- Capture timing information: record timestamp at request arrival and response completion, compute duration in milliseconds.
- Support multiple output sinks: file path (with append-only writes), `Writable` stream, or a custom sink interface.
- Provide optional HMAC-SHA256 integrity chains for tamper evidence, where each record includes a hash that depends on the previous record's hash.
- Support field-level PII redaction with configurable rules (regex patterns, JSONPath-like field paths, or custom redactor functions).
- Support log rotation by file size with configurable maximum file size and rotation count.
- Support retention policies that automatically delete rotated log files older than a configured duration.
- Provide a query/search API for reading and filtering audit log files programmatically.
- Never modify, delay, or interfere with MCP server behavior. If audit logging fails, the MCP server continues operating normally.
- Keep dependencies minimal: zero runtime dependencies beyond Node.js built-ins and the peer dependency on `@modelcontextprotocol/sdk`.

### Non-Goals

- **Not an application logger.** This package records protocol-level audit events, not application-level debug/info/warning messages. Use pino, winston, or the MCP protocol's own `logging` capability for application logging.
- **Not an observability platform.** This package does not provide metrics, dashboards, alerting, or distributed tracing. It produces raw audit records that can be ingested by observability platforms (ELK, Datadog, Splunk) via custom sinks or file tailing.
- **Not a real-time streaming system.** Audit records are written asynchronously in batches. There is no pub/sub, WebSocket, or SSE interface for real-time consumption. Custom sinks can forward records to streaming systems, but this package does not provide that integration.
- **Not a request/response modifier.** This package never alters, filters, blocks, or delays any MCP message. It is strictly read-only with respect to protocol traffic.
- **Not a rate limiter or access controller.** Use `mcp-rate-guard` for rate limiting. This package records what happened; it does not control what is allowed to happen.
- **Not a cloud storage backend.** Writing to S3, GCS, Azure Blob, or other cloud storage is out of scope for the core package. The custom sink interface enables users to build these integrations.
- **Not a schema validator.** This package does not validate that MCP messages conform to the protocol specification. It records whatever flows through the server, valid or not.

---

## 3. Target Users

### Enterprise Security and Compliance Teams

Organizations deploying MCP servers in regulated environments (finance, healthcare, government) need audit trails to satisfy SOC 2 Type II, HIPAA, GDPR, and internal security policies. These teams need immutable records proving what data was accessed, what tools were executed, and what arguments were passed -- with timestamps, correlation IDs, and tamper-evidence chains.

### MCP Server Developers

Developers building MCP servers who need to understand what their server is doing in production. Audit logs provide a complete record of every interaction for debugging, postmortem analysis, and regression investigation. Unlike application logs, audit logs capture the full request/response content at the protocol level.

### Platform and DevOps Engineers

Teams operating fleets of MCP servers who need centralized audit data for monitoring, anomaly detection, and incident response. The NDJSON output format and custom sink interface enable integration with log aggregation pipelines (Fluentd, Logstash, Vector).

### Security Auditors

External or internal auditors conducting periodic reviews of AI system behavior. The query API and HMAC integrity chains allow auditors to extract records for a specific time window, verify that no records have been modified or deleted, and produce compliance reports.

### AI Application Architects

Teams designing multi-agent systems where multiple MCP clients interact with multiple MCP servers. Audit logs with session IDs and correlation IDs enable end-to-end tracing of tool call chains across the system.

---

## 4. Core Concepts

### MCP Protocol Messages

The Model Context Protocol uses JSON-RPC 2.0 as its message format. Every interaction is either a **request** (with an `id`, expecting a response), a **response** (with the same `id`, containing `result` or `error`), or a **notification** (no `id`, no response expected). This package intercepts all three message types and records them.

The key auditable interactions are:

- **Tool calls**: `tools/call` request contains the tool `name` and `arguments`. The response contains `content` (text, image, audio, or embedded resource) and an `isError` flag. These are the highest-value audit records because tools represent executable actions.
- **Resource reads**: `resources/read` request contains a `uri`. The response contains `contents` (text or binary data). These track what data the AI model accessed.
- **Prompt requests**: `prompts/get` request contains a prompt `name` and `arguments`. The response contains `messages` (the expanded prompt template). These track which prompt templates were used.
- **Listing operations**: `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list` enumerate available capabilities. Auditing these tracks discovery behavior.
- **Sampling**: `sampling/createMessage` is a server-to-client request where the server asks the client to generate an LLM completion. These track nested AI invocations.
- **Lifecycle events**: `initialize`/`initialized` track session establishment. These anchor all subsequent records to a session.
- **Notifications**: `notifications/tools/list_changed`, `notifications/resources/list_changed`, `notifications/resources/updated`, `notifications/prompts/list_changed`, `notifications/cancelled`, `notifications/progress`, `notifications/message`, `notifications/initialized`, `notifications/roots/list_changed` track asynchronous state changes.

### Audit Logging vs. Application Logging

Application loggers (pino, winston) record diagnostic messages generated by application code: "user logged in," "database query took 50ms," "cache miss for key X." They are developer-facing, typically leveled (debug/info/warn/error), and routinely filtered, sampled, and rotated.

Audit loggers record a complete, unfiltered account of security-relevant events. The key differences are:

- **Completeness**: Every auditable event is recorded. No sampling, no level-based filtering of the core record types.
- **Immutability**: Records, once written, must not be modified or deleted (within the retention window). Append-only file writes enforce this at the filesystem level.
- **Structured content**: Each record has a fixed schema with mandatory fields. The record itself contains the full request/response payload, not a human-readable summary.
- **Tamper evidence**: Optional HMAC chains allow verification that no record has been inserted, modified, or removed.
- **Retention**: Records are kept for a configured duration and then deleted by policy, not by developer discretion.

### Append-Only Semantics

All writes to the audit log are append-only. The file is opened with the `a` (append) flag, meaning the operating system guarantees that every write extends the file rather than overwriting existing content. On POSIX systems with write sizes under `PIPE_BUF` (typically 4096 bytes on Linux), individual `write()` calls are atomic, preventing interleaving from concurrent writers. For records exceeding this limit, the logger serializes writes through an internal queue.

### Correlation IDs

Every JSON-RPC request carries an `id` field. When a response arrives, it carries the same `id`. The audit logger assigns a unique `correlationId` (a UUIDv4) when it sees a request and attaches the same `correlationId` to the corresponding response record. This enables consumers to pair requests with their responses without relying on the JSON-RPC `id` (which may be reused across sessions).

### NDJSON Format

Audit records are written as NDJSON (Newline-Delimited JSON), also known as JSON Lines. Each line is a self-contained, valid JSON object terminated by a newline character (`\n`). This format is:

- **Streamable**: Records can be read one line at a time without buffering the entire file.
- **Appendable**: New records are added by appending lines. No need to parse or rewrite existing content.
- **Tool-friendly**: Compatible with `jq`, `grep`, Unix pipelines, and log aggregation tools (Fluentd, Logstash, Vector).
- **Crash-safe**: A partial write (crash mid-line) produces an incomplete final line that is easily detected and skipped during reads.

### Tamper Evidence (HMAC Chains)

When HMAC integrity chains are enabled, each audit record includes a `_integrity` field containing an HMAC-SHA256 computed over the record's content concatenated with the previous record's HMAC. The first record in a chain uses a configured seed value. This creates a hash chain where modifying, inserting, or deleting any record breaks the chain from that point forward. Verification walks the chain sequentially and recomputes each HMAC.

HMAC chains provide tamper _evidence_, not tamper _prevention_. An attacker with file access can rewrite the entire chain. The defense is to periodically export chain heads (the latest HMAC) to an external, append-only store (e.g., a separate database, a blockchain, or a remote logging service). This package provides the chain computation; external anchoring is the user's responsibility.

---

## 5. API Design

### Installation

```bash
npm install mcp-audit-log
```

### Peer Dependency

```json
{
  "peerDependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  }
}
```

### Main Export: `createAuditLogger`

The primary API is a factory function that wraps an existing MCP `Server` instance and returns an `AuditLogger` handle.

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createAuditLogger } from 'mcp-audit-log';

const server = new Server({ name: 'my-server', version: '1.0.0' }, {
  capabilities: { tools: {}, resources: {}, prompts: {} },
});

// Register tool/resource/prompt handlers on the server as normal...

const logger = createAuditLogger(server, {
  sink: { type: 'file', path: './audit.log' },
});

// Connect the server to a transport as normal. The logger is already active.
// ...

// On shutdown:
await logger.close();
```

### Function Signature

```typescript
function createAuditLogger(
  server: Server,
  options: AuditLoggerOptions,
): AuditLogger;
```

### `AuditLoggerOptions`

```typescript
interface AuditLoggerOptions {
  /**
   * Where to write audit records.
   * - `{ type: 'file', path: string }` — Append to a file at the given path.
   * - `{ type: 'stream', stream: NodeJS.WritableStream }` — Write to any Writable stream.
   * - `{ type: 'custom', sink: AuditSink }` — Use a custom sink implementation.
   *
   * Required. No default.
   */
  sink: SinkConfig;

  /**
   * A stable name identifying this MCP server in audit records.
   * Defaults to the `serverInfo.name` from the Server instance if not provided.
   */
  serverName?: string;

  /**
   * Controls which MCP methods are recorded.
   * By default, all methods are recorded.
   */
  filter?: AuditFilter;

  /**
   * PII redaction configuration.
   * When provided, matching fields in request arguments and response content
   * are replaced with a redaction placeholder before the record is written.
   */
  redaction?: RedactionConfig;

  /**
   * HMAC integrity chain configuration.
   * When provided, each record includes an `_integrity` field forming
   * a tamper-evident hash chain.
   */
  integrity?: IntegrityConfig;

  /**
   * Log rotation configuration. Only applicable when sink type is 'file'.
   */
  rotation?: RotationConfig;

  /**
   * Retention policy configuration. Only applicable when sink type is 'file'.
   */
  retention?: RetentionConfig;

  /**
   * Buffer and flush settings controlling how records are batched
   * before writing to the sink.
   */
  buffer?: BufferConfig;

  /**
   * Whether to include the full request/response body in audit records.
   * When false, only metadata (method, timing, IDs) is recorded.
   * Defaults to true.
   */
  includeBody?: boolean;

  /**
   * Maximum size in bytes for any single field value (e.g., tool arguments,
   * resource content) in the audit record. Values exceeding this limit are
   * truncated and a `_truncated: true` flag is added to the record.
   * Defaults to 1_048_576 (1 MiB). Set to 0 to disable truncation.
   */
  maxFieldSize?: number;

  /**
   * Called when the audit logger encounters an internal error
   * (e.g., file write failure, sink error). The MCP server continues
   * operating normally regardless.
   * Defaults to `console.error`.
   */
  onError?: (error: Error) => void;
}
```

### Sink Configuration Types

```typescript
/** Write audit records to a file as append-only NDJSON. */
interface FileSinkConfig {
  type: 'file';

  /**
   * Absolute or relative path to the audit log file.
   * The file is created if it does not exist.
   * Writes use the 'a' (append) flag.
   */
  path: string;

  /**
   * File mode (permissions) for newly created files.
   * Defaults to 0o600 (owner read/write only).
   */
  mode?: number;
}

/** Write audit records to a Node.js Writable stream. */
interface StreamSinkConfig {
  type: 'stream';

  /**
   * Any Node.js Writable stream (e.g., process.stdout, a TCP socket,
   * a Transform stream piping to another destination).
   */
  stream: NodeJS.WritableStream;
}

/** Write audit records to a custom sink implementation. */
interface CustomSinkConfig {
  type: 'custom';

  /** The custom sink instance. */
  sink: AuditSink;
}

type SinkConfig = FileSinkConfig | StreamSinkConfig | CustomSinkConfig;
```

### `AuditSink` Interface

```typescript
/**
 * Custom audit sink interface. Implement this to send audit records
 * to any backend (database, cloud storage, message queue, etc.).
 */
interface AuditSink {
  /**
   * Write one or more audit records. Called with a batch of records
   * that have been buffered according to the buffer configuration.
   *
   * Must not throw. If the write fails, the sink should handle the
   * error internally (e.g., retry, dead-letter queue) or report it
   * via the onError callback provided during initialization.
   *
   * @param records - Array of serialized audit records (JSON strings,
   *                  each terminated with a newline).
   * @returns A promise that resolves when the write is acknowledged.
   *          The audit logger does not block on this promise.
   */
  write(records: string[]): Promise<void>;

  /**
   * Flush any internally buffered data. Called during graceful shutdown.
   */
  flush(): Promise<void>;

  /**
   * Close the sink and release resources. Called during logger shutdown.
   */
  close(): Promise<void>;

  /**
   * Optional initialization hook. Called once when the audit logger starts.
   * Receives the onError callback for reporting internal sink errors.
   */
  init?(onError: (error: Error) => void): Promise<void>;
}
```

### `AuditLogger` Instance

```typescript
/**
 * Handle returned by `createAuditLogger`. Provides control over the
 * audit logger lifecycle and access to the query API.
 */
interface AuditLogger {
  /**
   * Flush all buffered records to the sink and close the logger.
   * Must be called during server shutdown to ensure no records are lost.
   * After close() resolves, no further records are written.
   */
  close(): Promise<void>;

  /**
   * Force-flush all buffered records to the sink immediately.
   * Returns when the flush is complete.
   */
  flush(): Promise<void>;

  /**
   * Whether the logger is currently active (not closed).
   */
  readonly active: boolean;

  /**
   * The total number of audit records written since the logger was created.
   */
  readonly recordCount: number;

  /**
   * The total number of records that failed to write (sink errors).
   */
  readonly errorCount: number;

  /**
   * Query the audit log. Only available when the sink type is 'file'.
   * Throws if called with a non-file sink.
   */
  query(params: AuditQueryParams): AsyncIterable<AuditRecord>;

  /**
   * Verify the HMAC integrity chain of the audit log.
   * Only available when integrity is configured and the sink type is 'file'.
   * Returns a verification result indicating whether the chain is intact.
   */
  verifyIntegrity(filePath?: string): Promise<IntegrityVerificationResult>;
}
```

### Audit Filter Configuration

```typescript
interface AuditFilter {
  /**
   * MCP methods to include. If specified, only these methods are recorded.
   * Cannot be used together with `exclude`.
   *
   * Examples: ['tools/call', 'resources/read', 'prompts/get']
   */
  include?: string[];

  /**
   * MCP methods to exclude. If specified, these methods are not recorded.
   * Cannot be used together with `include`.
   *
   * Examples: ['ping', 'notifications/progress']
   */
  exclude?: string[];

  /**
   * Whether to record lifecycle events (initialize, initialized).
   * Defaults to true.
   */
  includeLifecycle?: boolean;

  /**
   * Whether to record notification messages.
   * Defaults to true.
   */
  includeNotifications?: boolean;

  /**
   * Whether to record listing operations (tools/list, resources/list, etc.).
   * Defaults to true.
   */
  includeListOperations?: boolean;
}
```

### PII Redaction Configuration

```typescript
interface RedactionConfig {
  /**
   * Fields to redact, identified by dot-notation paths relative to the
   * request arguments or response content.
   *
   * Examples:
   *   - 'arguments.password' — redacts the password field in tool call arguments
   *   - 'arguments.headers.Authorization' — redacts the Authorization header
   *   - 'content.text' — redacts text content in responses
   */
  paths?: string[];

  /**
   * Regex patterns to match and redact within string values.
   * Applied to all string fields in the record body.
   *
   * Examples:
   *   - /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g — email addresses
   *   - /\b\d{3}-\d{2}-\d{4}\b/g — US SSN
   *   - /\bsk-[a-zA-Z0-9]{48}\b/g — OpenAI API keys
   */
  patterns?: RegExp[];

  /**
   * Custom redaction function. Receives a field path and value,
   * returns the redacted value. Called for every string field
   * in the record body.
   *
   * Return the original value unchanged to keep it, or return
   * the replacement string to redact it.
   */
  custom?: (path: string, value: string) => string;

  /**
   * The placeholder string used to replace redacted values.
   * Defaults to '[REDACTED]'.
   */
  placeholder?: string;

  /**
   * When true, the original value's character length is preserved
   * in the placeholder (e.g., '[REDACTED:12]' for a 12-character value).
   * Useful for debugging without exposing the actual value.
   * Defaults to false.
   */
  preserveLength?: boolean;
}
```

### HMAC Integrity Configuration

```typescript
interface IntegrityConfig {
  /**
   * The HMAC algorithm to use.
   * Defaults to 'sha256'.
   */
  algorithm?: 'sha256' | 'sha384' | 'sha512';

  /**
   * The secret key for HMAC computation.
   * Must be provided as a string or Buffer.
   * Required when integrity is enabled.
   */
  secret: string | Buffer;

  /**
   * The seed value for the first record in the chain.
   * If not provided, a random 32-byte hex string is generated
   * and recorded in the first audit record's `_integritySeed` field.
   */
  seed?: string;
}
```

### Buffer Configuration

```typescript
interface BufferConfig {
  /**
   * Maximum number of records to buffer before flushing.
   * Defaults to 100.
   */
  maxRecords?: number;

  /**
   * Maximum time in milliseconds to wait before flushing buffered records.
   * The buffer is flushed when either maxRecords or flushIntervalMs is reached,
   * whichever comes first.
   * Defaults to 1000 (1 second).
   */
  flushIntervalMs?: number;

  /**
   * Whether to flush immediately on every record (no buffering).
   * When true, maxRecords and flushIntervalMs are ignored.
   * Useful for development/debugging but reduces throughput.
   * Defaults to false.
   */
  immediate?: boolean;
}
```

### Rotation Configuration

```typescript
interface RotationConfig {
  /**
   * Maximum file size in bytes before rotation occurs.
   * When the active log file exceeds this size, it is renamed
   * with a numeric suffix (e.g., audit.log.1) and a new file is created.
   * Defaults to 52_428_800 (50 MiB).
   */
  maxFileSize?: number;

  /**
   * Maximum number of rotated files to keep.
   * Older rotated files beyond this count are deleted.
   * Defaults to 10.
   */
  maxFiles?: number;

  /**
   * Whether to compress rotated files with gzip.
   * When true, rotated files are named with a .gz suffix
   * (e.g., audit.log.1.gz).
   * Defaults to false.
   */
  compress?: boolean;
}
```

### Retention Configuration

```typescript
interface RetentionConfig {
  /**
   * Maximum age in milliseconds for rotated log files.
   * Files older than this are deleted during rotation or
   * when the logger starts.
   * Defaults to undefined (no age-based retention).
   *
   * Common values:
   *   - 7 * 24 * 60 * 60 * 1000 — 7 days
   *   - 30 * 24 * 60 * 60 * 1000 — 30 days
   *   - 90 * 24 * 60 * 60 * 1000 — 90 days
   *   - 365 * 24 * 60 * 60 * 1000 — 1 year
   */
  maxAge?: number;

  /**
   * How often (in milliseconds) to run the retention cleanup check.
   * Defaults to 3_600_000 (1 hour).
   */
  checkIntervalMs?: number;
}
```

### Query API

```typescript
interface AuditQueryParams {
  /**
   * Filter by MCP method name.
   * Examples: 'tools/call', 'resources/read'
   */
  method?: string | string[];

  /**
   * Filter by time range. Records with timestamp >= from are included.
   */
  from?: Date;

  /**
   * Filter by time range. Records with timestamp <= to are included.
   */
  to?: Date;

  /**
   * Filter by session ID.
   */
  sessionId?: string;

  /**
   * Filter by correlation ID.
   */
  correlationId?: string;

  /**
   * Filter by record type.
   */
  type?: 'request' | 'response' | 'notification';

  /**
   * Filter by tool name (for tools/call records).
   */
  toolName?: string;

  /**
   * Filter by resource URI (for resources/read records).
   */
  resourceUri?: string;

  /**
   * Filter by prompt name (for prompts/get records).
   */
  promptName?: string;

  /**
   * Only return records where the response had an error.
   */
  errorsOnly?: boolean;

  /**
   * Maximum number of records to return.
   * Defaults to unlimited.
   */
  limit?: number;

  /**
   * Number of records to skip (for pagination).
   * Defaults to 0.
   */
  offset?: number;

  /**
   * Sort order by timestamp.
   * Defaults to 'asc'.
   */
  order?: 'asc' | 'desc';

  /**
   * Path to a specific log file to query.
   * When not provided, queries the active log file and all rotated files.
   */
  filePath?: string;
}
```

### Integrity Verification Result

```typescript
interface IntegrityVerificationResult {
  /** Whether the entire chain is intact (no tampering detected). */
  valid: boolean;

  /** Total number of records verified. */
  recordCount: number;

  /** Index of the first invalid record, if any. -1 if all valid. */
  firstInvalidIndex: number;

  /** The expected HMAC at the invalid index, if applicable. */
  expectedHmac?: string;

  /** The actual HMAC found at the invalid index, if applicable. */
  actualHmac?: string;

  /** Error message if verification itself failed (e.g., file not found). */
  error?: string;
}
```

### Manual Logging API

For users who do not use `@modelcontextprotocol/sdk` or need to log events from custom MCP implementations, the package also exports a standalone `AuditWriter` class.

```typescript
import { AuditWriter } from 'mcp-audit-log';

const writer = new AuditWriter({
  sink: { type: 'file', path: './audit.log' },
  serverName: 'my-custom-server',
});

await writer.open();

// Manually write an audit record for a tool call request
const correlationId = writer.logRequest({
  method: 'tools/call',
  id: 1,
  params: { name: 'get_weather', arguments: { location: 'NYC' } },
  sessionId: 'session-abc',
});

// Later, log the response with the same correlationId
writer.logResponse({
  id: 1,
  correlationId,
  result: { content: [{ type: 'text', text: 'Sunny, 72F' }], isError: false },
  sessionId: 'session-abc',
});

await writer.close();
```

```typescript
class AuditWriter {
  constructor(options: AuditWriterOptions);

  /** Open the writer and initialize the sink. */
  open(): Promise<void>;

  /**
   * Log an incoming JSON-RPC request.
   * Returns the correlationId assigned to this request.
   */
  logRequest(params: {
    method: string;
    id: string | number;
    params?: Record<string, unknown>;
    sessionId?: string;
    meta?: Record<string, unknown>;
  }): string;

  /**
   * Log an outgoing JSON-RPC response.
   */
  logResponse(params: {
    id: string | number;
    correlationId: string;
    result?: Record<string, unknown>;
    error?: { code: number; message: string; data?: unknown };
    sessionId?: string;
    meta?: Record<string, unknown>;
  }): void;

  /**
   * Log a JSON-RPC notification.
   */
  logNotification(params: {
    method: string;
    params?: Record<string, unknown>;
    sessionId?: string;
    direction: 'incoming' | 'outgoing';
    meta?: Record<string, unknown>;
  }): void;

  /** Flush buffered records and close the writer. */
  close(): Promise<void>;

  /** Force-flush buffered records. */
  flush(): Promise<void>;
}

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

---

## 6. Audit Record Schema

Every audit record is a JSON object written as a single line in the NDJSON output. All records share a common set of fields, with additional fields specific to the record type.

### Common Fields

Every audit record contains these fields:

```typescript
interface AuditRecordBase {
  /**
   * Schema version for forward compatibility.
   * Current version: 1.
   */
  v: 1;

  /**
   * Unique identifier for this audit record.
   * UUIDv4, generated by the audit logger.
   */
  recordId: string;

  /**
   * ISO 8601 timestamp with millisecond precision and UTC timezone.
   * Example: '2026-03-18T14:30:00.123Z'
   */
  timestamp: string;

  /**
   * The MCP server name, from AuditLoggerOptions.serverName or
   * the Server instance's serverInfo.name.
   */
  serverName: string;

  /**
   * The MCP session ID, if available. Populated from the transport's
   * session management (Mcp-Session-Id header for HTTP, or a synthetic
   * ID for stdio sessions).
   */
  sessionId: string | null;

  /**
   * Record type: 'request', 'response', or 'notification'.
   */
  type: 'request' | 'response' | 'notification';

  /**
   * The JSON-RPC method name.
   * Examples: 'tools/call', 'resources/read', 'notifications/tools/list_changed'
   */
  method: string;

  /**
   * Correlation ID linking a request to its response.
   * Both the request record and its corresponding response record
   * share the same correlationId.
   * Null for notifications.
   */
  correlationId: string | null;

  /**
   * The JSON-RPC request ID, if applicable.
   * Present for requests and responses. Null for notifications.
   */
  requestId: string | number | null;

  /**
   * HMAC integrity hash. Present only when integrity is configured.
   * Computed as HMAC-SHA256(previousHmac + canonicalRecordJson, secret).
   */
  _integrity?: string;

  /**
   * Integrity chain seed. Present only on the first record when
   * integrity is configured.
   */
  _integritySeed?: string;
}
```

### Tool Call Request Record

```typescript
interface ToolCallRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'tools/call';

  /** The tool being called. */
  toolName: string;

  /** The arguments passed to the tool. Subject to redaction and truncation. */
  toolArguments: Record<string, unknown> | null;

  /**
   * Progress token, if the client requested progress updates.
   */
  progressToken?: string | number;
}
```

Example NDJSON line:

```json
{"v":1,"recordId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","timestamp":"2026-03-18T14:30:00.123Z","serverName":"my-mcp-server","sessionId":"sess-001","type":"request","method":"tools/call","correlationId":"corr-001","requestId":42,"toolName":"get_weather","toolArguments":{"location":"New York"}}
```

### Tool Call Response Record

```typescript
interface ToolCallResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'tools/call';

  /** Duration in milliseconds from request to response. */
  durationMs: number;

  /** Whether the tool execution reported an error (isError flag). */
  isError: boolean;

  /**
   * The tool result content. Subject to redaction and truncation.
   * Contains the content array from the CallToolResult.
   */
  resultContent: Array<{
    type: 'text' | 'image' | 'audio' | 'resource';
    /** Text content (for type 'text'). */
    text?: string;
    /** MIME type (for type 'image', 'audio', or 'resource'). */
    mimeType?: string;
    /** Whether binary data was present but excluded from the record. */
    binaryOmitted?: boolean;
    /** Resource URI (for type 'resource'). */
    resourceUri?: string;
  }> | null;

  /**
   * JSON-RPC error, if the response was an error response
   * (as opposed to a tool execution error via isError).
   */
  error?: {
    code: number;
    message: string;
  };
}
```

Example NDJSON line:

```json
{"v":1,"recordId":"b2c3d4e5-f6a7-8901-bcde-f12345678901","timestamp":"2026-03-18T14:30:00.456Z","serverName":"my-mcp-server","sessionId":"sess-001","type":"response","method":"tools/call","correlationId":"corr-001","requestId":42,"durationMs":333,"isError":false,"resultContent":[{"type":"text","text":"Current weather in New York: 72F, Partly Cloudy"}]}
```

### Resource Read Request Record

```typescript
interface ResourceReadRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'resources/read';

  /** The URI of the resource being read. */
  resourceUri: string;
}
```

### Resource Read Response Record

```typescript
interface ResourceReadResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'resources/read';

  /** Duration in milliseconds from request to response. */
  durationMs: number;

  /**
   * Summary of the resource contents returned.
   */
  contents: Array<{
    uri: string;
    mimeType?: string;
    /** Size in bytes of the text content or decoded binary data. */
    size: number;
    /** Whether this was text or binary (blob) content. */
    contentType: 'text' | 'blob';
    /** Text content, if included. Subject to redaction and truncation. */
    text?: string;
    /** Whether binary data was present but excluded from the record. */
    binaryOmitted?: boolean;
  }> | null;

  error?: {
    code: number;
    message: string;
  };
}
```

### Prompt Get Request Record

```typescript
interface PromptGetRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'prompts/get';

  /** The name of the prompt being retrieved. */
  promptName: string;

  /** The arguments passed to the prompt. Subject to redaction. */
  promptArguments: Record<string, string> | null;
}
```

### Prompt Get Response Record

```typescript
interface PromptGetResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'prompts/get';

  /** Duration in milliseconds from request to response. */
  durationMs: number;

  /** Number of messages in the prompt result. */
  messageCount: number;

  /** The prompt messages. Subject to redaction and truncation. */
  messages: Array<{
    role: 'user' | 'assistant';
    contentType: 'text' | 'image' | 'audio' | 'resource';
    /** Text content, if included. */
    text?: string;
    /** Whether binary data was present but excluded. */
    binaryOmitted?: boolean;
  }> | null;

  error?: {
    code: number;
    message: string;
  };
}
```

### Sampling Request Record

```typescript
interface SamplingRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'sampling/createMessage';

  /** Number of messages in the sampling request. */
  messageCount: number;

  /** The system prompt, if provided. Subject to redaction. */
  systemPrompt: string | null;

  /** The model preferences, if provided. */
  modelPreferences: {
    hints?: Array<{ name: string }>;
    costPriority?: number;
    speedPriority?: number;
    intelligencePriority?: number;
  } | null;

  /** Max tokens requested. */
  maxTokens: number;

  /** Include context setting. */
  includeContext?: string;

  /** Temperature setting. */
  temperature?: number;
}
```

### Sampling Response Record

```typescript
interface SamplingResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'sampling/createMessage';

  /** Duration in milliseconds. */
  durationMs: number;

  /** The role of the generated message. */
  role: string;

  /** The content type of the generated message. */
  contentType: 'text' | 'image' | 'audio';

  /** Text content, if included. Subject to redaction. */
  text?: string;

  /** The model that was actually used. */
  model: string;

  /** The reason the generation stopped. */
  stopReason: string;

  error?: {
    code: number;
    message: string;
  };
}
```

### List Operation Records

List operations (`tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`) share a common shape.

```typescript
interface ListRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'tools/list' | 'resources/list' | 'resources/templates/list' | 'prompts/list';

  /** Pagination cursor, if provided. */
  cursor?: string;
}

interface ListResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'tools/list' | 'resources/list' | 'resources/templates/list' | 'prompts/list';

  /** Duration in milliseconds. */
  durationMs: number;

  /** Number of items returned in the list. */
  itemCount: number;

  /** Names of the items returned (tool names, resource URIs, prompt names). */
  itemNames: string[];

  /** Next pagination cursor, if present. */
  nextCursor?: string;

  error?: {
    code: number;
    message: string;
  };
}
```

### Lifecycle Records

```typescript
interface InitializeRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'initialize';

  /** The protocol version requested by the client. */
  protocolVersion: string;

  /** The client's declared capabilities. */
  clientCapabilities: Record<string, unknown>;

  /** The client's name and version. */
  clientInfo: { name: string; version: string };
}

interface InitializeResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'initialize';

  /** Duration in milliseconds. */
  durationMs: number;

  /** The protocol version agreed upon. */
  protocolVersion: string;

  /** The server's declared capabilities. */
  serverCapabilities: Record<string, unknown>;

  /** The server's name and version. */
  serverInfo: { name: string; version: string };

  /** Server instructions, if provided. */
  instructions?: string;
}

interface InitializedNotificationRecord extends AuditRecordBase {
  type: 'notification';
  method: 'notifications/initialized';
  direction: 'incoming';
}
```

### Notification Records

```typescript
interface NotificationRecord extends AuditRecordBase {
  type: 'notification';

  /**
   * The notification method.
   * Examples:
   *   'notifications/tools/list_changed'
   *   'notifications/resources/list_changed'
   *   'notifications/resources/updated'
   *   'notifications/prompts/list_changed'
   *   'notifications/cancelled'
   *   'notifications/progress'
   *   'notifications/message'
   *   'notifications/roots/list_changed'
   */
  method: string;

  /** Whether this notification was incoming (from client) or outgoing (from server). */
  direction: 'incoming' | 'outgoing';

  /** Notification parameters. Subject to redaction. */
  notificationParams: Record<string, unknown> | null;
}
```

### Generic Request/Response Records

For methods not covered by the specific record types above (e.g., `ping`, `logging/setLevel`, `completions/complete`, `resources/subscribe`, `resources/unsubscribe`), a generic format is used.

```typescript
interface GenericRequestRecord extends AuditRecordBase {
  type: 'request';
  /** The method name. */
  method: string;
  /** The full request params. Subject to redaction and truncation. */
  params: Record<string, unknown> | null;
}

interface GenericResponseRecord extends AuditRecordBase {
  type: 'response';
  method: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** The full response result. Subject to redaction and truncation. */
  result: Record<string, unknown> | null;
  error?: {
    code: number;
    message: string;
  };
}
```

### Union Type

```typescript
type AuditRecord =
  | ToolCallRequestRecord
  | ToolCallResponseRecord
  | ResourceReadRequestRecord
  | ResourceReadResponseRecord
  | PromptGetRequestRecord
  | PromptGetResponseRecord
  | SamplingRequestRecord
  | SamplingResponseRecord
  | ListRequestRecord
  | ListResponseRecord
  | InitializeRequestRecord
  | InitializeResponseRecord
  | InitializedNotificationRecord
  | NotificationRecord
  | GenericRequestRecord
  | GenericResponseRecord;
```

---

## 7. Integration Patterns

### Pattern 1: Wrapping an Existing MCP Server (Recommended)

The primary integration pattern wraps the `Server` instance before connecting it to a transport. This is fully transparent to the server's handler code.

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAuditLogger } from 'mcp-audit-log';

const server = new Server(
  { name: 'my-server', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } },
);

// Register handlers as normal
server.setRequestHandler(/* ... */);

// Wrap with audit logging
const logger = createAuditLogger(server, {
  sink: { type: 'file', path: '/var/log/mcp/my-server-audit.log' },
});

// Connect to transport as normal
const transport = new StdioServerTransport();
await server.connect(transport);

// On shutdown
process.on('SIGTERM', async () => {
  await logger.close();
  await server.close();
  process.exit(0);
});
```

### Pattern 2: Wrapping with McpServer (High-Level API)

When using the high-level `McpServer` class, access the underlying `Server` instance.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAuditLogger } from 'mcp-audit-log';

const mcpServer = new McpServer(
  { name: 'my-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

mcpServer.tool('get_weather', { location: { type: 'string' } }, async (args) => {
  return { content: [{ type: 'text', text: `Weather for ${args.location}` }] };
});

// Access the underlying Server instance for audit wrapping
const logger = createAuditLogger(mcpServer.server, {
  sink: { type: 'file', path: './audit.log' },
});

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
```

### Pattern 3: HTTP Transport with Session Tracking

When using Streamable HTTP transport, session IDs from the `Mcp-Session-Id` header are automatically captured in audit records.

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createAuditLogger } from 'mcp-audit-log';
import express from 'express';

const app = express();
const server = new Server(
  { name: 'my-http-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

const logger = createAuditLogger(server, {
  sink: { type: 'file', path: '/var/log/mcp/http-audit.log' },
  rotation: { maxFileSize: 100 * 1024 * 1024, maxFiles: 20 },
  retention: { maxAge: 90 * 24 * 60 * 60 * 1000 }, // 90 days
});

// Set up HTTP transport and Express routes as normal
// Session IDs are extracted from the transport layer automatically
```

### Pattern 4: Manual Logging for Custom MCP Implementations

For servers not built with `@modelcontextprotocol/sdk`, use the `AuditWriter` directly.

```typescript
import { AuditWriter } from 'mcp-audit-log';

const writer = new AuditWriter({
  sink: { type: 'file', path: './audit.log' },
  serverName: 'custom-mcp-server',
});

await writer.open();

// In your custom JSON-RPC handler:
function handleRequest(request: any) {
  const correlationId = writer.logRequest({
    method: request.method,
    id: request.id,
    params: request.params,
    sessionId: getCurrentSessionId(),
  });

  // Process the request...
  const result = processRequest(request);

  writer.logResponse({
    id: request.id,
    correlationId,
    result: result,
    sessionId: getCurrentSessionId(),
  });

  return result;
}
```

### Pattern 5: Stream Sink (stdout for Container Logging)

In containerized environments, logging to stdout is often preferred so the container runtime captures the output.

```typescript
import { createAuditLogger } from 'mcp-audit-log';

const logger = createAuditLogger(server, {
  sink: { type: 'stream', stream: process.stdout },
  buffer: { immediate: true }, // No buffering for real-time output
});
```

---

## 8. Configuration

### Complete Default Configuration

The following shows every configuration option with its default value:

```typescript
const defaults: Required<AuditLoggerOptions> = {
  sink: /* required, no default */,
  serverName: /* from server.serverInfo.name */,
  filter: {
    include: undefined,    // all methods included
    exclude: undefined,    // no methods excluded
    includeLifecycle: true,
    includeNotifications: true,
    includeListOperations: true,
  },
  redaction: {
    paths: [],
    patterns: [],
    custom: undefined,
    placeholder: '[REDACTED]',
    preserveLength: false,
  },
  integrity: undefined,  // disabled by default
  rotation: {
    maxFileSize: 52_428_800,  // 50 MiB
    maxFiles: 10,
    compress: false,
  },
  retention: {
    maxAge: undefined,        // no age-based retention
    checkIntervalMs: 3_600_000, // 1 hour
  },
  buffer: {
    maxRecords: 100,
    flushIntervalMs: 1000,
    immediate: false,
  },
  includeBody: true,
  maxFieldSize: 1_048_576,  // 1 MiB
  onError: (error) => console.error('[mcp-audit-log]', error),
};
```

### Configuration Validation Rules

The following validation rules are enforced when `createAuditLogger` is called. Invalid configurations throw a synchronous `TypeError`.

| Rule | Condition |
|---|---|
| Sink is required | `sink` must be provided |
| File path must be a non-empty string | `sink.type === 'file'` requires `path` to be a non-empty string |
| Stream must be writable | `sink.type === 'stream'` requires `stream` to have a `write` method |
| Custom sink must implement AuditSink | `sink.type === 'custom'` requires `sink` to have `write`, `flush`, and `close` methods |
| Include and exclude are mutually exclusive | `filter.include` and `filter.exclude` cannot both be set |
| Integrity secret is required when integrity is enabled | If `integrity` is provided, `integrity.secret` must be a non-empty string or Buffer |
| Rotation only applies to file sinks | `rotation` is ignored with a warning for non-file sinks |
| Retention only applies to file sinks | `retention` is ignored with a warning for non-file sinks |
| maxFileSize must be positive | `rotation.maxFileSize` must be > 0 |
| maxFiles must be positive | `rotation.maxFiles` must be >= 1 |
| maxFieldSize must be non-negative | `maxFieldSize` must be >= 0 |
| buffer.maxRecords must be positive | `buffer.maxRecords` must be >= 1 |
| buffer.flushIntervalMs must be positive | `buffer.flushIntervalMs` must be > 0 |

---

## 9. Architecture

### Message Interception Strategy

The audit logger intercepts messages by hooking into the MCP SDK `Server` instance at the transport level. When `createAuditLogger` is called, it performs the following:

1. **Monkey-patches `server.connect()`**: The logger wraps the server's `connect` method. When the server connects to a transport, the logger intercepts the transport's message-passing interface to observe all incoming and outgoing JSON-RPC messages.

2. **Incoming message interception**: The logger wraps the transport's `onmessage` callback (or equivalent message handler). Before the server's Protocol layer dispatches an incoming message, the logger records it as a request or notification audit record. For requests, the logger stores the request's `id` and a timestamp in an in-memory `Map<RequestId, { correlationId: string; timestamp: number; method: string }>` for later correlation.

3. **Outgoing message interception**: The logger wraps the transport's `send()` method. When the server sends a response, the logger looks up the request's `id` in the correlation map, computes the duration, and writes a response audit record with the matching `correlationId`. For outgoing notifications, the logger writes a notification record.

4. **Session ID extraction**: For transports that support sessions, the logger extracts the session ID from the `RequestHandlerExtra.sessionId` property or from transport-level session headers. For stdio transports that do not have native session IDs, the logger generates a synthetic session ID (UUIDv4) when the first `initialize` request is received, and uses it for all subsequent records in that session.

This approach has several advantages:

- **No handler modification**: The server's registered request handlers (`setRequestHandler`, `tool()`, etc.) are never modified, wrapped, or replaced. The interception happens at the transport layer, below the handler dispatch.
- **Complete coverage**: Every message that passes through the transport is captured, including messages handled by the SDK internally (like `initialize`) and messages for methods the server does not explicitly handle (which produce error responses).
- **Transport agnostic**: The interception works identically for stdio, Streamable HTTP, and custom transports, because all transports implement the same `Transport` interface.

### Internal Components

```
createAuditLogger(server, options)
  |
  +-- ConfigValidator          Validates options, applies defaults
  |
  +-- TransportInterceptor     Wraps transport.send() and onmessage
  |     |
  |     +-- CorrelationTracker   Maps requestId -> { correlationId, timestamp, method }
  |     |
  |     +-- RecordBuilder        Constructs typed AuditRecord objects from raw messages
  |           |
  |           +-- Redactor       Applies PII redaction rules
  |           +-- Truncator      Enforces maxFieldSize limits
  |
  +-- RecordPipeline           Processes records through the pipeline
  |     |
  |     +-- IntegrityChain     Computes HMAC chain (optional)
  |     +-- RecordSerializer   Serializes record to JSON string
  |
  +-- WriteBuffer              Batches serialized records
  |     |
  |     +-- FlushTimer         Periodic flush based on flushIntervalMs
  |
  +-- SinkAdapter              Writes batches to the configured sink
  |     |
  |     +-- FileSink           File append with rotation support
  |     +-- StreamSink         Writable stream adapter
  |     +-- CustomSink         Delegates to user-provided AuditSink
  |
  +-- RetentionManager         Periodically cleans old rotated files (file sink only)
  |
  +-- QueryEngine              Reads and filters NDJSON files (file sink only)
```

### Buffering and Flush Strategy

The audit logger uses an internal write buffer to batch records before writing to the sink. This reduces I/O overhead and improves throughput.

1. When a record is produced, it is serialized to a JSON string and appended to the buffer (an array of strings).
2. The buffer is flushed when any of these conditions is met:
   - The buffer reaches `maxRecords` entries.
   - `flushIntervalMs` has elapsed since the last flush.
   - `flush()` is called explicitly.
   - `close()` is called.
3. On flush, all buffered strings are concatenated (each already newline-terminated) and written to the sink in a single `write()` call. For file sinks, this results in a single `fs.appendFile()` call.
4. When `buffer.immediate` is true, each record is flushed individually as soon as it is produced. This bypasses the buffer entirely.

The flush timer is implemented with `setInterval`. The interval is cleared on `close()`. The timer uses `unref()` so it does not prevent the Node.js process from exiting.

### File Sink Implementation

The file sink uses `node:fs/promises` for all I/O operations:

- **Open**: `fs.open(path, 'a', mode)` to get a file handle in append mode.
- **Write**: `fileHandle.appendFile(data)` to write batched records. Each batch is a single string containing multiple newline-terminated JSON lines.
- **Rotation check**: After each write, `fileHandle.stat()` checks the file size. If the size exceeds `maxFileSize`, rotation is triggered.
- **Rotation**: The current file handle is closed. Existing rotated files are renamed with incremented suffixes (`audit.log.1` becomes `audit.log.2`, etc.). Files exceeding `maxFiles` are deleted. If compression is enabled, the newly rotated file is compressed with `node:zlib.createGzip()`. A new file handle is opened for the active log file.
- **Close**: `fileHandle.close()` flushes the OS buffer and closes the file descriptor.

All file operations are serialized through a write queue (a chain of promises) to prevent concurrent writes or rotation during a write.

### HMAC Chain Computation

When integrity is enabled, each record receives an `_integrity` field computed as follows:

```
record._integrity = HMAC(secret, previousHmac + JSON.stringify(recordWithoutIntegrity))
```

Where:
- `secret` is the configured HMAC secret.
- `previousHmac` is the `_integrity` value of the immediately preceding record, or the `seed` value for the very first record.
- `recordWithoutIntegrity` is the record object with the `_integrity` and `_integritySeed` fields removed.
- `JSON.stringify` uses deterministic key ordering (keys sorted alphabetically) to ensure reproducible serialization.

The HMAC is computed synchronously using `node:crypto.createHmac()`. This is fast enough (sub-microsecond for SHA-256) to not impact throughput.

The first record in a chain includes an `_integritySeed` field containing the seed value (either configured or randomly generated). This allows verifiers to start the chain from the beginning.

### Async I/O and Non-Blocking Guarantees

The audit logger is designed to never block the MCP server's message processing:

1. **Record construction** is synchronous and fast (object creation, string operations). It happens in the same tick as the message interception.
2. **Buffering** is synchronous (array push). No I/O occurs at this point.
3. **Flushing** is asynchronous. The flush operation returns a promise but the caller does not await it in the message interception path. If the flush fails, the error is reported via `onError` but the MCP server continues.
4. **Rotation** is asynchronous and serialized behind the write queue. If rotation is slow, writes queue up but the MCP server is not blocked.

The only exception is `close()`, which is explicitly awaited by the caller during shutdown. This ensures all buffered records are flushed before the process exits.

### Graceful Shutdown

When `logger.close()` is called:

1. The logger sets `active = false` to stop accepting new records.
2. The flush timer is cleared.
3. Any buffered records are flushed to the sink.
4. The sink's `flush()` and `close()` methods are called.
5. The retention manager's interval (if running) is cleared.
6. The correlation map is cleared.

If `close()` is not called (e.g., the process crashes), buffered records that have not been flushed are lost. For maximum durability, use `buffer.immediate: true` or set `flushIntervalMs` to a low value (e.g., 100ms).

The logger also registers a `process.on('beforeExit')` handler that calls `close()` as a safety net. This handler is registered with `process.once()` and only fires if the event loop drains naturally (not on `SIGKILL` or unhandled exceptions).

---

## 10. Security and Compliance

### Append-Only Guarantees

The file sink opens log files with the `'a'` (append) flag. This means:

- The OS file cursor is always at the end of the file. Every `write()` call appends data; it never overwrites existing content.
- On POSIX systems, append-mode writes are atomic for sizes up to `PIPE_BUF` (4096 bytes on Linux, 512 bytes POSIX minimum). The logger concatenates multiple records into single writes, but respects atomic write size limits by splitting large batches.
- The file cannot be truncated through the logger's file handle. Truncation requires opening the file with a different flag, which is outside the logger's control.

**Limitations**: Append-only at the application level does not prevent a privileged user (root) or an attacker with filesystem access from modifying the file directly. HMAC integrity chains detect such tampering after the fact.

### HMAC Integrity Chains

HMAC chains provide cryptographic tamper evidence:

- **Insertion detection**: Inserting a record breaks the chain because the new record's previous HMAC will not match the next record's expected input.
- **Deletion detection**: Deleting a record breaks the chain because the record after the deleted one will have an HMAC computed against the wrong predecessor.
- **Modification detection**: Modifying a record changes its content hash, breaking the chain from that point forward.
- **Recomputation attack**: An attacker who knows the HMAC secret can recompute the entire chain. To defend against this, periodically export the chain head (latest HMAC) to an external, trusted store. Compare the stored head against the file's head to detect recomputation.

**Verification**: The `verifyIntegrity()` method reads the log file line by line, recomputes each HMAC, and compares it to the stored value. It returns the index of the first mismatch, or reports success if all match.

### PII Handling

The redaction system supports three complementary approaches:

1. **Path-based redaction**: Specify dot-notation paths to fields that always contain PII (e.g., `'arguments.email'`, `'arguments.ssn'`). These fields are replaced with the placeholder before the record is serialized.

2. **Pattern-based redaction**: Specify regex patterns that match PII in any string value (e.g., email addresses, SSNs, API keys). All string values in the record body are scanned and matches are replaced.

3. **Custom redaction**: Provide a function that receives each string field's path and value, and returns the (possibly redacted) value. This supports arbitrary redaction logic including context-dependent rules.

Redaction happens in-memory before serialization. The original MCP message is never modified; redaction applies only to the audit record copy.

**GDPR considerations**: Under GDPR, audit logs containing personal data are themselves subject to data protection requirements. Redaction reduces the GDPR surface area. For logs that must contain personal data (e.g., to audit who did what), ensure that retention policies are configured and that access to log files is restricted.

**HIPAA considerations**: HIPAA requires audit controls (45 CFR 164.312(b)). This package provides the audit recording mechanism. The covered entity is responsible for access controls on the log files, encryption at rest, and retention policies appropriate to their compliance requirements.

### SOC 2 Considerations

SOC 2 Type II requires evidence of continuous monitoring and logging. `mcp-audit-log` supports this by:

- Recording every tool call, resource read, and prompt request with timestamps.
- Providing tamper-evident HMAC chains to demonstrate log integrity during the audit period.
- Supporting retention policies that match the audit period (typically 12 months).
- Producing machine-readable NDJSON that can be ingested by SIEM and GRC platforms.

### Log File Access Control

This package creates log files with mode `0o600` (owner read/write only) by default. This is configurable via `sink.mode`. Recommendations:

- Run the MCP server under a dedicated service account.
- Set log file permissions to `0o600` or `0o640` (owner read/write, group read-only).
- Store log files in a directory with restricted permissions (`0o700` or `0o750`).
- Consider filesystem-level immutability (e.g., `chattr +a` on Linux) for defense in depth.
- Use separate storage volumes for audit logs to prevent log flooding from filling the application's primary disk.

---

## 11. Error Handling

### Principle: Never Block the MCP Server

The audit logger's error handling is governed by a single principle: **logging failures must never affect the MCP server's ability to process messages.** All error handling follows this rule.

### File System Errors

| Error | Behavior |
|---|---|
| Log file cannot be created (permissions, disk full) | `onError` is called with the error. Records are buffered in memory (up to `maxRecords`). The logger retries on the next flush. |
| Write fails mid-operation | `onError` is called. The failed batch is discarded (records are lost). The next flush attempts a new write. |
| Rotation fails (cannot rename, cannot create new file) | `onError` is called. The logger continues writing to the current file, which may exceed `maxFileSize`. Rotation is retried on the next size check. |
| Disk runs out of space | `onError` is called. Writes fail silently. The logger continues attempting writes; they will succeed once space is freed. |
| Log file is deleted externally | The next write creates a new file (append mode creates if not exists). Records written between the deletion and the next flush are in the buffer and will be written to the new file. |

### Buffer Overflow

If the sink is consistently slower than the record production rate, the buffer will grow. The buffer has no hard size limit to prevent record loss. If the buffer grows beyond `maxRecords * 10`, the logger emits a warning via `onError` but continues buffering. In extreme cases (sustained high volume with a blocked sink), this can lead to increased memory usage. The `onError` callback gives the user visibility into this condition.

### Malformed Messages

If the logger intercepts a message that is not valid JSON-RPC (no `method`, no `id` for a request, etc.), it records a generic audit record with whatever fields are available and sets a `_malformed: true` flag on the record. Malformed messages are never silently dropped.

### Sink Errors

For custom sinks, if `sink.write()` throws or rejects:

1. The error is caught and reported via `onError`.
2. The failed batch of records is discarded.
3. The logger continues operating and will attempt the next batch.
4. Custom sinks are responsible for their own retry logic.

### HMAC Computation Errors

HMAC computation uses Node.js built-in `crypto` module and is not expected to fail in normal operation. If it does (e.g., invalid algorithm string), the record is written without the `_integrity` field, `onError` is called, and subsequent records continue the chain from the last successful HMAC.

---

## 12. Testing Strategy

### Unit Tests

Unit tests cover each internal component in isolation with mock dependencies.

**Record Builder tests:**
- Constructs correct `ToolCallRequestRecord` from a raw `tools/call` JSON-RPC message.
- Constructs correct `ResourceReadResponseRecord` with computed `durationMs`.
- Handles binary content by setting `binaryOmitted: true` and excluding `data`.
- Truncates field values exceeding `maxFieldSize` and sets `_truncated: true`.
- Handles malformed messages gracefully (missing fields, wrong types).

**Redactor tests:**
- Redacts fields at specified paths (`arguments.password` -> `[REDACTED]`).
- Redacts string values matching regex patterns (email, SSN, API key patterns).
- Custom redactor function is called for every string field.
- Preserves non-string fields unchanged.
- `preserveLength` flag produces `[REDACTED:N]` format.
- Nested object traversal redacts deeply nested fields.

**Correlation Tracker tests:**
- Assigns a unique `correlationId` to each request and returns it.
- Looks up `correlationId` by `requestId` for response records.
- Computes `durationMs` as the difference between response and request timestamps.
- Cleans up entries after the response is recorded.
- Handles missing correlations (response without a prior request) gracefully.

**HMAC Chain tests:**
- First record includes `_integritySeed` and correct HMAC.
- Second record's HMAC is computed using the first record's HMAC as input.
- Verification of a valid chain returns `{ valid: true }`.
- Modification of any record causes verification to report `{ valid: false }` with correct `firstInvalidIndex`.
- Insertion of a record causes verification to fail.
- Deletion of a record causes verification to fail.
- Different algorithms (sha256, sha384, sha512) produce different but valid chains.

**Buffer tests:**
- Buffer flushes when `maxRecords` is reached.
- Buffer flushes when `flushIntervalMs` elapses.
- `immediate: true` flushes on every record.
- `flush()` flushes all buffered records immediately.
- `close()` flushes remaining records before closing.

**Filter tests:**
- `include: ['tools/call']` records only `tools/call` messages.
- `exclude: ['ping']` records everything except `ping`.
- `includeLifecycle: false` skips `initialize` and `notifications/initialized`.
- `includeNotifications: false` skips all notification records.
- `includeListOperations: false` skips `tools/list`, `resources/list`, etc.

**Serializer tests:**
- Produces valid JSON for each record type.
- JSON output is newline-terminated.
- Deterministic key ordering when integrity is enabled.

### Integration Tests

Integration tests use a real MCP `Server` instance with in-memory transport.

**End-to-end recording test:**
- Create a Server with tool, resource, and prompt handlers.
- Wrap with `createAuditLogger` using a stream sink (collecting output in memory).
- Connect a Client to the Server.
- Execute `tools/list`, `tools/call`, `resources/read`, `prompts/get`.
- Parse the collected NDJSON and verify: correct record count, correct types, correct correlation IDs, correct timing (durationMs > 0), correct tool names/URIs/prompt names.

**Session tracking test:**
- Verify that all records from a single client session share the same `sessionId`.
- Verify that records from different sessions have different `sessionId` values.

**Error recording test:**
- Call a tool that throws an error. Verify the response record has `isError: true` and the error content.
- Call a non-existent tool. Verify the response record has a protocol error.

**Lifecycle recording test:**
- Verify that `initialize` request and response records are captured with correct `protocolVersion`, `clientInfo`, `serverInfo`.
- Verify that `notifications/initialized` is recorded.

**Notification recording test:**
- Trigger `notifications/tools/list_changed` from the server. Verify the notification record with `direction: 'outgoing'`.

### Compliance Verification Tests

**HMAC chain end-to-end test:**
- Write 100 records with integrity enabled.
- Verify the chain with `verifyIntegrity()`.
- Modify a record in the middle of the file.
- Verify that `verifyIntegrity()` reports the correct `firstInvalidIndex`.

**Redaction end-to-end test:**
- Configure path-based and pattern-based redaction.
- Execute tool calls with arguments containing PII.
- Verify that the audit records contain `[REDACTED]` in the expected positions.
- Verify that the original MCP messages were not modified (the server handler received the unredacted arguments).

**Retention test:**
- Write enough data to trigger multiple rotations.
- Set a short `maxAge` (e.g., 1 second).
- Wait for the retention check to run.
- Verify that old rotated files were deleted.

### Performance and Benchmark Tests

**Throughput benchmark:**
- Measure records per second with file sink, varying buffer sizes.
- Target: at least 10,000 records/second with default buffer settings on a standard disk.

**Latency impact benchmark:**
- Measure MCP request/response round-trip time with and without audit logging.
- Target: less than 1ms of additional latency per request.

**Memory usage benchmark:**
- Measure memory growth over 100,000 records.
- Verify that memory usage is bounded (buffer is flushed, correlation map is cleaned up).

---

## 13. Dependencies

### Runtime Dependencies

None. The package uses only Node.js built-in modules:

| Module | Purpose |
|---|---|
| `node:fs/promises` | File creation, append writes, stat, rename, unlink |
| `node:crypto` | HMAC computation (`createHmac`), UUID generation (`randomUUID`) |
| `node:path` | File path manipulation for rotation |
| `node:zlib` | Gzip compression for rotated files (optional) |
| `node:stream` | Writable stream type checking |

### Peer Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.12.0` | Provides the `Server` class and transport types that are wrapped |

### Development Dependencies

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.5.0` | Type checking and compilation |
| `vitest` | `^2.0.0` | Test runner |
| `eslint` | `^9.0.0` | Linting |
| `@modelcontextprotocol/sdk` | `^1.12.0` | Used in integration tests |

### Dependency Philosophy

Zero runtime dependencies beyond Node.js built-ins. This is a deliberate choice:

- **Audit loggers must be reliable.** Every additional dependency is a potential source of supply-chain risk, version conflicts, and unexpected behavior. For a package whose entire purpose is security and compliance, minimizing the attack surface is paramount.
- **Node.js built-ins are sufficient.** File I/O, cryptographic hashing, UUID generation, gzip compression, and stream handling are all available in Node.js 18+. No third-party package provides meaningfully better implementations for these use cases.
- **The MCP SDK peer dependency is unavoidable.** The primary integration pattern wraps the SDK's `Server` class. Making it a peer dependency ensures the user controls the SDK version and avoids duplicate installations.

---

## 14. Performance Considerations

### Async I/O

All sink writes are asynchronous. The message interception path (record construction, buffering) is synchronous and takes microseconds. The actual I/O (file writes, custom sink writes) happens asynchronously on the next tick or when the buffer flushes.

### Buffering Impact

Default buffer settings (100 records, 1-second flush interval) batch multiple records into a single I/O operation. This reduces system call overhead by orders of magnitude compared to writing each record individually. On a typical NVMe SSD, a single `appendFile` call with 100 concatenated JSON lines (approximately 50-100 KB) takes under 1ms.

### Serialization Cost

`JSON.stringify` for a typical audit record (tool call with arguments and result) takes 5-50 microseconds, depending on payload size. For most MCP workloads (interactive tool calls, not bulk data processing), this is negligible.

When HMAC integrity is enabled, the additional `createHmac` + `update` + `digest` adds approximately 1-5 microseconds per record (SHA-256 is hardware-accelerated on modern CPUs).

### Correlation Map Memory

The correlation map stores one entry per in-flight request. Each entry is approximately 200 bytes (correlationId string, timestamp number, method string). In normal MCP usage, there are rarely more than a few concurrent requests, so the map is trivially small. Entries are cleaned up when the response is recorded.

Entries that never receive a response (e.g., client disconnects before the server responds) are cleaned up when the session ends (detected by a new `initialize` request or transport close). As a safety measure, entries older than 5 minutes are periodically pruned.

### File Rotation Overhead

Rotation involves renaming files, which is an atomic metadata operation on most filesystems and takes microseconds. The optional gzip compression of rotated files happens in a background stream pipeline and does not block new writes (the new active file is opened immediately).

### Impact on MCP Server Latency

The audit logger adds latency to MCP request processing in two places:

1. **On message receipt**: Synchronous record construction and buffer insertion. This adds approximately 10-100 microseconds per message.
2. **On message send**: Synchronous record construction and buffer insertion for the response record. Same overhead as above.

Total added latency per request/response round trip: approximately 20-200 microseconds. This is well below the threshold of human perception and negligible compared to typical tool execution times (milliseconds to seconds).

The logger never `await`s I/O in the interception path. Flush operations run independently.

---

## 15. Future Considerations

The following features are explicitly deferred from the initial release. They may be added in future versions based on user demand.

### Cloud Storage Sinks

Built-in sinks for S3, GCS, Azure Blob Storage. Currently achievable via the custom `AuditSink` interface, but first-party implementations with proper retry logic, multipart uploads, and credential management would reduce integration effort.

### Log Aggregator Integrations

Direct integrations with ELK (Elasticsearch/Logstash/Kibana), Datadog, Splunk, and Grafana Loki. Currently achievable via file tailing (Filebeat, Fluent Bit) or custom sinks, but native integrations would provide better metadata handling and structured field mapping.

### Real-Time Streaming

A pub/sub or EventEmitter interface for consuming audit records in real-time within the same process. This would enable live dashboards, real-time alerting, and in-process audit event processing without file I/O.

### Dashboard UI

A web-based dashboard for browsing, searching, and visualizing audit logs. This is a separate package concern but would pair naturally with `mcp-audit-log`'s query API.

### Multi-Server Aggregation

Aggregating audit logs from multiple MCP servers into a single, unified log with cross-server correlation. This requires a central collector service and is beyond the scope of a single-server audit logger.

### Encryption at Rest

Encrypting audit log files with AES-256 before writing to disk. Currently, filesystem-level encryption (LUKS, FileVault, BitLocker) is the recommended approach. Application-level encryption of log files would add complexity (key management, authenticated encryption) that may be warranted for specific compliance requirements.

### Structured Log Queries (SQL-like)

A richer query API supporting complex predicates, aggregations, and joins across record types. The current query API supports simple filtering and pagination. SQL-like queries over NDJSON files would require a query parser and execution engine that is better served by a dedicated tool (e.g., DuckDB with JSON support).

### OpenTelemetry Integration

Emitting audit events as OpenTelemetry spans or logs for integration with OTel-based observability stacks. This would enable audit records to be correlated with application traces and metrics.

---

## 16. Example Use Cases

### Example 1: Basic File-Based Audit Logging

The simplest setup: wrap an MCP server and write audit records to a file.

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createAuditLogger } from 'mcp-audit-log';

const server = new Server(
  { name: 'weather-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'get_weather') {
    const location = request.params.arguments?.location as string;
    return {
      content: [{ type: 'text', text: `Weather in ${location}: Sunny, 72F` }],
    };
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

// Add audit logging with a single line
const logger = createAuditLogger(server, {
  sink: { type: 'file', path: './audit.log' },
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Shutdown handler
process.on('SIGTERM', async () => {
  await logger.close();
  await server.close();
});
```

The resulting `audit.log` file contains one JSON object per line:

```
{"v":1,"recordId":"...","timestamp":"2026-03-18T14:30:00.100Z","serverName":"weather-server","sessionId":"sess-001","type":"request","method":"initialize","correlationId":"corr-001","requestId":1,"protocolVersion":"2025-03-26","clientCapabilities":{"roots":{"listChanged":true}},"clientInfo":{"name":"claude-desktop","version":"1.0.0"}}
{"v":1,"recordId":"...","timestamp":"2026-03-18T14:30:00.105Z","serverName":"weather-server","sessionId":"sess-001","type":"response","method":"initialize","correlationId":"corr-001","requestId":1,"durationMs":5,"protocolVersion":"2025-03-26","serverCapabilities":{"tools":{}},"serverInfo":{"name":"weather-server","version":"1.0.0"}}
{"v":1,"recordId":"...","timestamp":"2026-03-18T14:30:00.106Z","serverName":"weather-server","sessionId":"sess-001","type":"notification","method":"notifications/initialized","correlationId":null,"requestId":null,"direction":"incoming","notificationParams":null}
{"v":1,"recordId":"...","timestamp":"2026-03-18T14:30:01.200Z","serverName":"weather-server","sessionId":"sess-001","type":"request","method":"tools/call","correlationId":"corr-002","requestId":2,"toolName":"get_weather","toolArguments":{"location":"New York"}}
{"v":1,"recordId":"...","timestamp":"2026-03-18T14:30:01.215Z","serverName":"weather-server","sessionId":"sess-001","type":"response","method":"tools/call","correlationId":"corr-002","requestId":2,"durationMs":15,"isError":false,"resultContent":[{"type":"text","text":"Weather in New York: Sunny, 72F"}]}
```

### Example 2: Enterprise Setup with HMAC, PII Redaction, and Retention

A production configuration for a regulated environment.

```typescript
import { createAuditLogger } from 'mcp-audit-log';

const logger = createAuditLogger(server, {
  sink: {
    type: 'file',
    path: '/var/log/mcp/patient-records-server/audit.log',
    mode: 0o640, // Owner read/write, group read
  },

  // Record only high-value operations
  filter: {
    include: [
      'initialize',
      'tools/call',
      'resources/read',
      'prompts/get',
      'sampling/createMessage',
    ],
  },

  // Redact patient data
  redaction: {
    paths: [
      'arguments.patientName',
      'arguments.ssn',
      'arguments.dateOfBirth',
      'arguments.medicalRecordNumber',
    ],
    patterns: [
      /\b\d{3}-\d{2}-\d{4}\b/g,                              // SSN
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
      /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,                       // Phone numbers
    ],
    placeholder: '[PHI_REDACTED]',
  },

  // Tamper-evident integrity chain
  integrity: {
    algorithm: 'sha256',
    secret: process.env.AUDIT_HMAC_SECRET!,
  },

  // Rotate at 100 MiB, keep 50 files, compress old files
  rotation: {
    maxFileSize: 100 * 1024 * 1024,
    maxFiles: 50,
    compress: true,
  },

  // Retain for 7 years (HIPAA requirement)
  retention: {
    maxAge: 7 * 365 * 24 * 60 * 60 * 1000,
    checkIntervalMs: 24 * 60 * 60 * 1000, // Check daily
  },

  // Flush frequently for durability
  buffer: {
    maxRecords: 10,
    flushIntervalMs: 500,
  },
});
```

### Example 3: CI/CD Audit Verification

A test that verifies audit logging after a CI run.

```typescript
import { createAuditLogger } from 'mcp-audit-log';
import { describe, it, expect, afterAll } from 'vitest';
import { PassThrough } from 'node:stream';

describe('MCP server audit trail', () => {
  const outputChunks: string[] = [];
  const captureStream = new PassThrough();
  captureStream.on('data', (chunk) => outputChunks.push(chunk.toString()));

  const logger = createAuditLogger(server, {
    sink: { type: 'stream', stream: captureStream },
    buffer: { immediate: true },
  });

  afterAll(async () => {
    await logger.close();
  });

  it('records all tool calls with correct arguments', async () => {
    // Execute the tool call via the MCP client...
    await client.callTool('get_weather', { location: 'London' });

    await logger.flush();

    const records = outputChunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const toolCallRequest = records.find(
      (r) => r.type === 'request' && r.method === 'tools/call',
    );
    expect(toolCallRequest).toBeDefined();
    expect(toolCallRequest.toolName).toBe('get_weather');
    expect(toolCallRequest.toolArguments).toEqual({ location: 'London' });

    const toolCallResponse = records.find(
      (r) => r.type === 'response' && r.method === 'tools/call',
    );
    expect(toolCallResponse).toBeDefined();
    expect(toolCallResponse.correlationId).toBe(toolCallRequest.correlationId);
    expect(toolCallResponse.isError).toBe(false);
    expect(toolCallResponse.durationMs).toBeGreaterThan(0);
  });
});
```

### Example 4: Compliance Audit Export

Export audit records for a specific time window for compliance review.

```typescript
import { createAuditLogger } from 'mcp-audit-log';

// Assuming the logger was set up with a file sink:
const logger = createAuditLogger(server, {
  sink: { type: 'file', path: '/var/log/mcp/audit.log' },
  integrity: { secret: process.env.AUDIT_HMAC_SECRET! },
});

// Later, during a compliance audit:
async function exportAuditReport(from: Date, to: Date) {
  // First, verify the integrity of the log
  const verification = await logger.verifyIntegrity();
  if (!verification.valid) {
    throw new Error(
      `Audit log integrity check failed at record ${verification.firstInvalidIndex}`,
    );
  }

  console.log(`Integrity verified: ${verification.recordCount} records intact.`);

  // Query records for the audit period
  const records: AuditRecord[] = [];
  for await (const record of logger.query({
    from,
    to,
    method: ['tools/call', 'resources/read'],
    order: 'asc',
  })) {
    records.push(record);
  }

  console.log(`Found ${records.length} auditable events in the period.`);

  // Produce a summary report
  const toolCallCount = records.filter((r) => r.method === 'tools/call').length;
  const resourceReadCount = records.filter((r) => r.method === 'resources/read').length;
  const errorCount = records.filter(
    (r) => r.type === 'response' && 'isError' in r && r.isError,
  ).length;

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    integrityVerified: true,
    totalRecords: verification.recordCount,
    auditableEvents: records.length,
    toolCalls: toolCallCount,
    resourceReads: resourceReadCount,
    errors: errorCount,
  };
}
```

### Example 5: Custom Sink (PostgreSQL Database)

Sending audit records to a PostgreSQL database via the custom sink interface.

```typescript
import { createAuditLogger, AuditSink } from 'mcp-audit-log';
import pg from 'pg';

class PostgresAuditSink implements AuditSink {
  private pool: pg.Pool;
  private onError: (error: Error) => void = console.error;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async init(onError: (error: Error) => void): Promise<void> {
    this.onError = onError;

    // Create the audit table if it doesn't exist
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS mcp_audit_log (
        id SERIAL PRIMARY KEY,
        record_id UUID NOT NULL UNIQUE,
        timestamp TIMESTAMPTZ NOT NULL,
        server_name TEXT NOT NULL,
        session_id TEXT,
        type TEXT NOT NULL,
        method TEXT NOT NULL,
        correlation_id UUID,
        request_id TEXT,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  async write(records: string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const recordJson of records) {
        const record = JSON.parse(recordJson.trim());
        await client.query(
          `INSERT INTO mcp_audit_log
           (record_id, timestamp, server_name, session_id, type, method,
            correlation_id, request_id, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            record.recordId,
            record.timestamp,
            record.serverName,
            record.sessionId,
            record.type,
            record.method,
            record.correlationId,
            record.requestId?.toString() ?? null,
            record,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      this.onError(error as Error);
    } finally {
      client.release();
    }
  }

  async flush(): Promise<void> {
    // No internal buffering; writes go directly to the database.
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Usage
const logger = createAuditLogger(server, {
  sink: {
    type: 'custom',
    sink: new PostgresAuditSink(process.env.DATABASE_URL!),
  },
  buffer: {
    maxRecords: 50,
    flushIntervalMs: 2000,
  },
});
```
