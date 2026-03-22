# mcp-audit-log — Task Breakdown

## Phase 1: Project Scaffolding & Configuration

- [ ] **Install dev dependencies** — Add `typescript`, `vitest`, `eslint`, and `@modelcontextprotocol/sdk` as dev dependencies. Add `@modelcontextprotocol/sdk` as a peer dependency (`^1.12.0`). Ensure `package.json` engines field requires Node.js >= 18. | Status: not_done

- [x] **Configure TypeScript** — Verify `tsconfig.json` targets ES2022 with `strict: true`, `declaration: true`, `declarationMap: true`, `sourceMap: true`. Output to `dist/`, root in `src/`. Ensure `resolveJsonModule` and `esModuleInterop` are enabled. | Status: done

- [x] **Configure ESLint** — Set up ESLint v9+ with TypeScript support. Add appropriate rules for the project (no-unused-vars, consistent-return, etc.). | Status: done

- [x] **Configure Vitest** — Add a `vitest.config.ts` with TypeScript support. Configure test file patterns to match `src/**/*.test.ts` and `src/**/*.spec.ts`. | Status: done

- [ ] **Set up project directory structure** — Create source directories: `src/`, `src/sinks/`, `src/pipeline/`, `src/interceptor/`, `src/query/`, `src/__tests__/`, `src/__tests__/unit/`, `src/__tests__/integration/`. | Status: not_done

- [x] **Configure package.json exports** — Ensure `main` points to `dist/index.js`, `types` to `dist/index.d.ts`, `files` includes only `dist`. Add `prepublishOnly: npm run build` script. | Status: done

---

## Phase 2: Type Definitions

- [x] **Define SinkConfig types** — Create `FileSinkConfig` (`type: 'file'`, `path: string`, optional `mode: number`), `StreamSinkConfig` (`type: 'stream'`, `stream: NodeJS.WritableStream`), `CustomSinkConfig` (`type: 'custom'`, `sink: AuditSink`), and the `SinkConfig` union type. | Status: done

- [x] **Define AuditSink interface** — Create the `AuditSink` interface with `write(records: string[]): Promise<void>`, `flush(): Promise<void>`, `close(): Promise<void>`, and optional `init?(onError: (error: Error) => void): Promise<void>`. | Status: done

- [x] **Define AuditLoggerOptions interface** — Create the main options interface with fields: `sink` (required), `serverName?`, `filter?`, `redaction?`, `integrity?`, `rotation?`, `retention?`, `buffer?`, `includeBody?` (default true), `maxFieldSize?` (default 1 MiB), `onError?`. | Status: done

- [x] **Define AuditFilter interface** — Create with `include?: string[]`, `exclude?: string[]`, `includeLifecycle?: boolean` (default true), `includeNotifications?: boolean` (default true), `includeListOperations?: boolean` (default true). Include validation rule that `include` and `exclude` are mutually exclusive. | Status: done

- [x] **Define RedactionConfig interface** — Create with `paths?: string[]`, `patterns?: RegExp[]`, `custom?: (path: string, value: string) => string`, `placeholder?: string` (default `'[REDACTED]'`), `preserveLength?: boolean` (default false). | Status: done

- [x] **Define IntegrityConfig interface** — Create with `algorithm?: 'sha256' | 'sha384' | 'sha512'` (default `'sha256'`), `secret: string | Buffer` (required), `seed?: string`. | Status: done

- [x] **Define BufferConfig interface** — Create with `maxRecords?: number` (default 100), `flushIntervalMs?: number` (default 1000), `immediate?: boolean` (default false). | Status: done

- [x] **Define RotationConfig interface** — Create with `maxFileSize?: number` (default 50 MiB), `maxFiles?: number` (default 10), `compress?: boolean` (default false). | Status: done

- [x] **Define RetentionConfig interface** — Create with `maxAge?: number` (no default), `checkIntervalMs?: number` (default 1 hour). | Status: done

- [x] **Define AuditRecordBase interface** — Create base record type with `v: 1`, `recordId: string` (UUIDv4), `timestamp: string` (ISO 8601 UTC), `serverName: string`, `sessionId: string | null`, `type: 'request' | 'response' | 'notification'`, `method: string`, `correlationId: string | null`, `requestId: string | number | null`, optional `_integrity?: string`, optional `_integritySeed?: string`. | Status: done

- [x] **Define ToolCallRequestRecord and ToolCallResponseRecord** — Request: `toolName`, `toolArguments`, optional `progressToken`. Response: `durationMs`, `isError`, `resultContent` (array with type/text/mimeType/binaryOmitted/resourceUri), optional `error`. | Status: done

- [x] **Define ResourceReadRequestRecord and ResourceReadResponseRecord** — Request: `resourceUri`. Response: `durationMs`, `contents` (array with uri/mimeType/size/contentType/text/binaryOmitted), optional `error`. | Status: done

- [x] **Define PromptGetRequestRecord and PromptGetResponseRecord** — Request: `promptName`, `promptArguments`. Response: `durationMs`, `messageCount`, `messages` (array with role/contentType/text/binaryOmitted), optional `error`. | Status: done

- [x] **Define SamplingRequestRecord and SamplingResponseRecord** — Request: `messageCount`, `systemPrompt`, `modelPreferences`, `maxTokens`, optional `includeContext`, `temperature`. Response: `durationMs`, `role`, `contentType`, `text?`, `model`, `stopReason`, optional `error`. | Status: done

- [x] **Define ListRequestRecord and ListResponseRecord** — Request: optional `cursor`. Response: `durationMs`, `itemCount`, `itemNames`, optional `nextCursor`, optional `error`. Covers methods `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`. | Status: done

- [x] **Define InitializeRequestRecord and InitializeResponseRecord** — Request: `protocolVersion`, `clientCapabilities`, `clientInfo`. Response: `durationMs`, `protocolVersion`, `serverCapabilities`, `serverInfo`, optional `instructions`. | Status: done

- [x] **Define InitializedNotificationRecord** — Extends base with `type: 'notification'`, `method: 'notifications/initialized'`, `direction: 'incoming'`. | Status: done

- [x] **Define NotificationRecord** — Extends base with `type: 'notification'`, `direction: 'incoming' | 'outgoing'`, `notificationParams: Record<string, unknown> | null`. | Status: done

- [x] **Define GenericRequestRecord and GenericResponseRecord** — Request: `params: Record<string, unknown> | null`. Response: `durationMs`, `result: Record<string, unknown> | null`, optional `error`. For methods not covered by specific record types (ping, logging/setLevel, completions/complete, etc.). | Status: done

- [x] **Define AuditRecord union type** — Create the union of all specific record types: ToolCallRequestRecord, ToolCallResponseRecord, ResourceReadRequestRecord, ResourceReadResponseRecord, PromptGetRequestRecord, PromptGetResponseRecord, SamplingRequestRecord, SamplingResponseRecord, ListRequestRecord, ListResponseRecord, InitializeRequestRecord, InitializeResponseRecord, InitializedNotificationRecord, NotificationRecord, GenericRequestRecord, GenericResponseRecord. | Status: done

- [x] **Define AuditLogger interface** — Create the returned handle with `close(): Promise<void>`, `flush(): Promise<void>`, `readonly active: boolean`, `readonly recordCount: number`, `readonly errorCount: number`, `query(params: AuditQueryParams): AsyncIterable<AuditRecord>`, `verifyIntegrity(filePath?: string): Promise<IntegrityVerificationResult>`. | Status: done

- [x] **Define AuditQueryParams interface** — Create with `method?: string | string[]`, `from?: Date`, `to?: Date`, `sessionId?: string`, `correlationId?: string`, `type?: 'request' | 'response' | 'notification'`, `toolName?: string`, `resourceUri?: string`, `promptName?: string`, `errorsOnly?: boolean`, `limit?: number`, `offset?: number`, `order?: 'asc' | 'desc'`, `filePath?: string`. | Status: done

- [x] **Define IntegrityVerificationResult interface** — Create with `valid: boolean`, `recordCount: number`, `firstInvalidIndex: number`, `expectedHmac?: string`, `actualHmac?: string`, `error?: string`. | Status: done

- [x] **Define AuditWriter class types** — Create `AuditWriterOptions` interface with `sink`, `serverName`, `redaction?`, `integrity?`, `buffer?`, `includeBody?`, `maxFieldSize?`, `onError?`. Define `logRequest`, `logResponse`, `logNotification` parameter types. | Status: done

---

## Phase 3: Configuration Validation

- [ ] **Implement ConfigValidator** — Create a `validateConfig(options: AuditLoggerOptions)` function that validates all configuration rules and throws `TypeError` for invalid configurations. Apply default values to unspecified optional fields. | Status: not_done

- [ ] **Validate sink is required** — Throw `TypeError` if `sink` is not provided. | Status: not_done

- [ ] **Validate file sink path** — Throw `TypeError` if `sink.type === 'file'` and `path` is not a non-empty string. | Status: not_done

- [ ] **Validate stream sink** — Throw `TypeError` if `sink.type === 'stream'` and `stream` does not have a `write` method. | Status: not_done

- [ ] **Validate custom sink** — Throw `TypeError` if `sink.type === 'custom'` and the sink does not implement `write`, `flush`, and `close` methods. | Status: not_done

- [x] **Validate filter mutual exclusivity** — Throw `TypeError` if both `filter.include` and `filter.exclude` are provided. | Status: done

- [ ] **Validate integrity secret** — Throw `TypeError` if `integrity` is provided but `integrity.secret` is not a non-empty string or Buffer. | Status: not_done

- [ ] **Validate rotation/retention only for file sinks** — Emit a warning via `onError` if `rotation` or `retention` is configured with a non-file sink. Ignore the config rather than throwing. | Status: not_done

- [ ] **Validate numeric bounds** — Throw `TypeError` if `rotation.maxFileSize <= 0`, `rotation.maxFiles < 1`, `maxFieldSize < 0`, `buffer.maxRecords < 1`, or `buffer.flushIntervalMs <= 0`. | Status: not_done

---

## Phase 4: Core Infrastructure

### Correlation Tracker

- [x] **Implement CorrelationTracker** — Create a class that manages an in-memory `Map<string | number, { correlationId: string; timestamp: number; method: string }>`. On `trackRequest(requestId, method)`, generate a UUIDv4 `correlationId`, store it with the current timestamp, and return it. On `resolveResponse(requestId)`, look up and remove the entry, returning `{ correlationId, durationMs, method }`. | Status: done

- [x] **Handle missing correlations** — When `resolveResponse` is called for a `requestId` that has no tracked request, return `null` and handle gracefully (generate a new correlationId, set durationMs to -1 or 0). | Status: done

- [ ] **Implement stale entry cleanup** — Periodically prune entries older than 5 minutes from the correlation map to handle requests that never receive responses (e.g., client disconnect). | Status: not_done

- [ ] **Implement session cleanup** — Clear the correlation map when a new `initialize` request is received or when the transport closes. | Status: not_done

### Record Builder

- [x] **Implement RecordBuilder** — Create a class/module that constructs typed `AuditRecord` objects from raw JSON-RPC messages. Accept the message, record type (`request`/`response`/`notification`), method name, correlationId, sessionId, serverName, and options (includeBody, maxFieldSize). | Status: done

- [x] **Build ToolCallRequestRecord** — Extract `toolName` from `params.name`, `toolArguments` from `params.arguments`, optional `progressToken` from `params._meta.progressToken`. | Status: done

- [x] **Build ToolCallResponseRecord** — Extract `isError` from `result.isError`, `resultContent` from `result.content`. For each content item: include `type`, `text` (for text), `mimeType`, set `binaryOmitted: true` for image/audio data and exclude binary data. Compute `durationMs` from correlation tracker. | Status: done

- [x] **Build ResourceReadRequestRecord** — Extract `resourceUri` from `params.uri`. | Status: done

- [x] **Build ResourceReadResponseRecord** — Extract `contents` array with `uri`, `mimeType`, `size`, `contentType` (text vs blob), `text` (for text content), `binaryOmitted` for binary content. Compute `durationMs`. | Status: done

- [x] **Build PromptGetRequestRecord** — Extract `promptName` from `params.name`, `promptArguments` from `params.arguments`. | Status: done

- [x] **Build PromptGetResponseRecord** — Extract `messageCount`, `messages` array with `role`, `contentType`, `text`, `binaryOmitted`. Compute `durationMs`. | Status: done

- [x] **Build SamplingRequestRecord** — Extract `messageCount`, `systemPrompt`, `modelPreferences`, `maxTokens`, `includeContext`, `temperature` from params. | Status: done

- [x] **Build SamplingResponseRecord** — Extract `role`, `contentType`, `text`, `model`, `stopReason`. Compute `durationMs`. | Status: done

- [x] **Build ListRequestRecord** — Extract optional `cursor` from params. Applicable for `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`. | Status: done

- [x] **Build ListResponseRecord** — Extract `itemCount`, `itemNames` (tool names, resource URIs, prompt names depending on method), optional `nextCursor`. Compute `durationMs`. | Status: done

- [x] **Build InitializeRequestRecord** — Extract `protocolVersion`, `clientCapabilities`, `clientInfo` from params. | Status: done

- [x] **Build InitializeResponseRecord** — Extract `protocolVersion`, `serverCapabilities`, `serverInfo`, optional `instructions` from result. Compute `durationMs`. | Status: done

- [x] **Build InitializedNotificationRecord** — Set `direction: 'incoming'`, `method: 'notifications/initialized'`. | Status: done

- [x] **Build NotificationRecord** — Extract `direction` (incoming/outgoing), `notificationParams` from the notification. | Status: done

- [x] **Build GenericRequestRecord** — For methods not covered by specific record types (`ping`, `logging/setLevel`, `completions/complete`, `resources/subscribe`, `resources/unsubscribe`). Store full `params`. | Status: done

- [x] **Build GenericResponseRecord** — For methods not covered by specific record types. Store full `result`, compute `durationMs`. | Status: done

- [x] **Handle error responses** — For all response record types, extract `error.code` and `error.message` from JSON-RPC error responses. | Status: done

- [x] **Handle includeBody=false** — When `includeBody` is false, omit request arguments, response content, and notification params from records. Only include metadata (method, timing, IDs). | Status: done

- [ ] **Handle malformed messages** — When a message is not valid JSON-RPC (missing `method`, missing `id` for request, etc.), construct a generic record with available fields and set `_malformed: true`. Never silently drop malformed messages. | Status: not_done

- [x] **Generate common fields** — For every record: generate `recordId` (UUIDv4 via `crypto.randomUUID()`), `timestamp` (ISO 8601 with milliseconds and UTC timezone), `v: 1`, `serverName`, `sessionId`, `type`, `method`, `correlationId`, `requestId`. | Status: done

### Truncator

- [x] **Implement field truncation** — Create a `Truncator` class/function that enforces `maxFieldSize` on string field values. When a string exceeds `maxFieldSize` bytes, truncate it and add `_truncated: true` to the record. When `maxFieldSize` is 0, disable truncation. | Status: done

- [x] **Apply truncation to appropriate fields** — Truncate `toolArguments`, `resultContent[].text`, `contents[].text`, `messages[].text`, `systemPrompt`, `params`, `result`, and `notificationParams` string values. | Status: done

### Redactor

- [x] **Implement path-based redaction** — Create a `Redactor` class that traverses record body objects and replaces values at configured dot-notation paths with the placeholder string. Handle nested paths (e.g., `arguments.headers.Authorization`). | Status: done

- [x] **Implement pattern-based redaction** — Scan all string values in the record body and replace regex matches with the placeholder. Apply all configured patterns. | Status: done

- [x] **Implement custom redaction** — Call the custom redactor function for every string field in the record body, passing the field path and value. Use the returned value (which may be the original or a replacement). | Status: done

- [x] **Implement preserveLength option** — When `preserveLength` is true, format the placeholder as `[REDACTED:N]` where N is the original value's character length. | Status: done

- [x] **Ensure redaction is non-destructive** — Redaction must operate on a copy of the data used for the audit record. The original MCP message must never be modified. | Status: done

### Filter

- [x] **Implement AuditFilter logic** — Create a `shouldRecord(method: string, messageType: 'request' | 'response' | 'notification')` function that applies the filter configuration. Check `include`/`exclude` lists, `includeLifecycle`, `includeNotifications`, `includeListOperations`. | Status: done

- [x] **Include filter** — When `include` is set, only record methods present in the list. | Status: done

- [x] **Exclude filter** — When `exclude` is set, record all methods except those in the list. | Status: done

- [x] **Lifecycle filter** — When `includeLifecycle` is false, skip `initialize` and `notifications/initialized`. | Status: done

- [x] **Notification filter** — When `includeNotifications` is false, skip all notification records. | Status: done

- [x] **List operations filter** — When `includeListOperations` is false, skip `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`. | Status: done

---

## Phase 5: Record Pipeline

### Record Serializer

- [x] **Implement JSON serialization** — Serialize `AuditRecord` objects to JSON strings. Each JSON string must be terminated with a newline character (`\n`). | Status: done

- [ ] **Implement deterministic key ordering** — When integrity is enabled, use deterministic (alphabetically sorted) key ordering in `JSON.stringify` to ensure reproducible serialization for HMAC computation. | Status: not_done

### HMAC Integrity Chain

- [x] **Implement IntegrityChain** — Create a class that computes HMAC chains. Store the previous HMAC value (initially the seed). For each record, compute `HMAC(secret, previousHmac + JSON.stringify(recordWithoutIntegrity))` using the configured algorithm. Set the `_integrity` field on the record. | Status: done

- [x] **Handle first record in chain** — For the first record, use the configured `seed` (or generate a random 32-byte hex string). Set `_integritySeed` on the first record. | Status: done

- [x] **Support multiple algorithms** — Support `sha256`, `sha384`, and `sha512` via `node:crypto.createHmac()`. Default to `sha256`. | Status: done

- [ ] **Handle HMAC computation errors** — If HMAC computation fails (e.g., invalid algorithm), write the record without `_integrity`, call `onError`, and continue the chain from the last successful HMAC. | Status: not_done

---

## Phase 6: Write Buffer

- [x] **Implement WriteBuffer** — Create a class that batches serialized record strings (each newline-terminated) into an internal array. Provide `add(record: string)` and `flush(): string[]` methods. | Status: done

- [x] **Implement maxRecords flush trigger** — Flush the buffer automatically when it reaches `maxRecords` entries. | Status: done

- [x] **Implement flushIntervalMs timer** — Set up a `setInterval` timer that flushes the buffer periodically. Use `unref()` on the timer so it does not prevent Node.js process exit. | Status: done

- [x] **Implement immediate mode** — When `buffer.immediate` is true, flush on every record addition, bypassing `maxRecords` and `flushIntervalMs`. | Status: done

- [x] **Implement explicit flush** — `flush()` returns all buffered records and clears the buffer. | Status: done

- [x] **Implement close** — On close, clear the flush timer, flush any remaining buffered records, and stop accepting new records. | Status: done

- [ ] **Implement buffer overflow warning** — When the buffer grows beyond `maxRecords * 10`, emit a warning via `onError` but continue buffering. | Status: not_done

---

## Phase 7: Sink Implementations

### File Sink

- [x] **Implement FileSink** — Create a file sink that opens the log file with `fs.open(path, 'a', mode)` in append mode with configurable permissions (default `0o600`). | Status: done

- [x] **Implement write method** — Write batched records as a single `fileHandle.appendFile(data)` call. Concatenate all records in the batch (already newline-terminated) into a single string. | Status: done

- [ ] **Implement write serialization** — Serialize all file operations through a write queue (promise chain) to prevent concurrent writes or rotation during a write. | Status: not_done

- [ ] **Implement atomic write size awareness** — For large batches exceeding PIPE_BUF (4096 bytes), split into multiple writes to maintain atomicity guarantees on POSIX systems. | Status: not_done

- [x] **Implement file size check after write** — After each write, call `fileHandle.stat()` to check file size. If it exceeds `maxFileSize`, trigger rotation. | Status: done

- [x] **Implement log rotation** — When file size exceeds `maxFileSize`: close the current file handle, rename existing rotated files with incremented suffixes (audit.log.1 -> audit.log.2, etc.), rename the current file to audit.log.1, delete files exceeding `maxFiles`, open a new file handle. | Status: done

- [ ] **Implement gzip compression on rotation** — When `rotation.compress` is true, compress the newly rotated file with `node:zlib.createGzip()` in a background stream pipeline. Name compressed files with `.gz` suffix (e.g., `audit.log.1.gz`). | Status: not_done

- [x] **Implement file creation on external deletion** — If the log file is deleted externally, the next write should create a new file (append mode creates if not exists). | Status: done

- [x] **Implement flush and close** — `flush()` calls `fileHandle.datasync()` or equivalent. `close()` flushes then calls `fileHandle.close()`. | Status: done

### Stream Sink

- [x] **Implement StreamSink** — Create a stream sink adapter that wraps a `NodeJS.WritableStream`. Write batched records by calling `stream.write()` for each batch. | Status: done

- [x] **Handle stream backpressure** — Respect the `write()` return value and `drain` event for backpressure handling. | Status: done

- [x] **Implement flush and close** — `flush()` is a no-op for streams (the caller manages the stream lifecycle). `close()` does not close the stream (it was provided by the user). | Status: done

### Custom Sink

- [x] **Implement CustomSink adapter** — Create an adapter that delegates to a user-provided `AuditSink` implementation. Call `sink.init(onError)` during initialization if the method exists. Call `sink.write(records)` for batches, `sink.flush()` for flush, `sink.close()` for close. | Status: done

- [ ] **Handle custom sink errors** — Catch errors from `sink.write()` (thrown or rejected), report via `onError`, discard the failed batch, and continue operating. | Status: not_done

---

## Phase 8: Retention Manager

- [x] **Implement RetentionManager** — Create a class that periodically checks for and deletes rotated log files older than `maxAge`. Only active when sink type is `'file'` and `retention.maxAge` is configured. | Status: done

- [x] **Implement startup cleanup** — On logger initialization, run a retention check immediately to clean up files that aged out while the server was stopped. | Status: done

- [x] **Implement periodic cleanup** — Set up a `setInterval` timer at `checkIntervalMs` to run retention checks. Use `unref()` on the timer. | Status: done

- [x] **Implement file age detection** — Determine rotated file age from file modification time (`fs.stat().mtime`). Delete files where `Date.now() - mtime > maxAge`. | Status: done

- [ ] **Handle compressed rotated files** — Delete both compressed (`.gz`) and uncompressed rotated files that exceed `maxAge`. | Status: not_done

- [x] **Implement cleanup on close** — Clear the retention check interval when the logger closes. | Status: done

---

## Phase 9: Transport Interceptor

- [ ] **Implement TransportInterceptor** — Create the core interception logic that monkey-patches `server.connect()` to intercept the transport's message-passing interface. | Status: not_done

- [ ] **Intercept incoming messages** — Wrap the transport's `onmessage` callback. Before the server processes an incoming message, inspect it: if it has an `id` and `method`, record as request; if it has `method` but no `id`, record as incoming notification. | Status: not_done

- [ ] **Intercept outgoing messages** — Wrap the transport's `send()` method. When the server sends a message: if it has an `id` but no `method`, record as response (look up correlation); if it has `method` but no `id`, record as outgoing notification. | Status: not_done

- [ ] **Extract session ID** — Extract session ID from the transport-level session management. For stdio transports without native session IDs, generate a synthetic UUIDv4 session ID on the first `initialize` request and use it for all subsequent records in that session. | Status: not_done

- [ ] **Handle multiple transports** — If `server.connect()` is called multiple times (e.g., for HTTP transport with multiple sessions), intercept each transport independently. | Status: not_done

- [ ] **Non-blocking guarantee** — Ensure the interception path never `await`s I/O. Record construction and buffer insertion must be synchronous. Flush operations run independently. | Status: not_done

---

## Phase 10: Main API — `createAuditLogger`

- [ ] **Implement createAuditLogger factory function** — Create the main entry point that accepts a `Server` instance and `AuditLoggerOptions`, validates config, initializes all internal components (ConfigValidator, TransportInterceptor, CorrelationTracker, RecordBuilder, Redactor, Truncator, IntegrityChain, WriteBuffer, SinkAdapter, RetentionManager), and returns an `AuditLogger` handle. | Status: not_done

- [ ] **Wire up the record pipeline** — Connect the components: TransportInterceptor produces raw messages -> Filter decides whether to record -> RecordBuilder constructs typed records -> Redactor applies PII redaction -> Truncator enforces field size limits -> IntegrityChain adds HMAC (optional) -> RecordSerializer produces JSON strings -> WriteBuffer batches -> SinkAdapter writes to output. | Status: not_done

- [x] **Implement AuditLogger.close()** — Set `active = false`, clear flush timer, flush buffered records, call sink `flush()` and `close()`, clear retention interval, clear correlation map. | Status: done

- [x] **Implement AuditLogger.flush()** — Force-flush all buffered records to the sink immediately. Return when the flush is complete. | Status: done

- [x] **Implement AuditLogger.active property** — Read-only boolean that is `true` until `close()` is called. | Status: done

- [x] **Implement AuditLogger.recordCount property** — Read-only counter of total audit records written since logger creation. | Status: done

- [x] **Implement AuditLogger.errorCount property** — Read-only counter of records that failed to write (sink errors). | Status: done

- [ ] **Register process.on('beforeExit') safety net** — Register a `process.once('beforeExit')` handler that calls `close()` if it has not already been called. Ensure this only fires on natural event loop drain, not on `SIGKILL` or unhandled exceptions. | Status: not_done

- [x] **Stop recording after close** — After `close()` resolves, any subsequent messages intercepted from the transport should be silently ignored (not recorded, not errored). | Status: done

---

## Phase 11: Manual Logging API — `AuditWriter`

- [x] **Implement AuditWriter class** — Create a standalone class that provides `logRequest`, `logResponse`, `logNotification` methods for users who do not use `@modelcontextprotocol/sdk` or need manual audit event logging. | Status: done

- [x] **Implement AuditWriter.open()** — Initialize the sink (call `sink.init()` for custom sinks, open the file handle for file sinks), start the write buffer timer. | Status: done

- [x] **Implement AuditWriter.logRequest()** — Accept `method`, `id`, optional `params`, optional `sessionId`, optional `meta`. Generate a `correlationId`, build the appropriate request record, apply redaction/truncation, add to buffer. Return the `correlationId`. | Status: done

- [x] **Implement AuditWriter.logResponse()** — Accept `id`, `correlationId`, optional `result`, optional `error`, optional `sessionId`, optional `meta`. Resolve the correlation, build the appropriate response record, apply redaction/truncation, add to buffer. | Status: done

- [x] **Implement AuditWriter.logNotification()** — Accept `method`, optional `params`, optional `sessionId`, `direction` (`incoming`/`outgoing`), optional `meta`. Build a notification record, apply redaction/truncation, add to buffer. | Status: done

- [x] **Implement AuditWriter.close() and flush()** — Delegate to the internal buffer and sink, following the same lifecycle as the main logger. | Status: done

---

## Phase 12: Query Engine

- [x] **Implement QueryEngine** — Create a class that reads NDJSON files line by line and filters records based on `AuditQueryParams`. Only available for file sinks. | Status: done

- [ ] **Implement file scanning** — Read the active log file and all rotated log files. For compressed rotated files, decompress with `node:zlib` before reading. | Status: not_done

- [x] **Implement method filter** — Filter records by `method` field. Support single string or array of strings. | Status: done

- [x] **Implement time range filter** — Filter records where `timestamp >= from` and `timestamp <= to`. | Status: done

- [x] **Implement sessionId filter** — Filter records by `sessionId` field. | Status: done

- [x] **Implement correlationId filter** — Filter records by `correlationId` field. | Status: done

- [x] **Implement type filter** — Filter records by `type` field (`request`, `response`, `notification`). | Status: done

- [x] **Implement toolName filter** — Filter records by `toolName` field (for `tools/call` records). | Status: done

- [x] **Implement resourceUri filter** — Filter records by `resourceUri` field (for `resources/read` records). | Status: done

- [x] **Implement promptName filter** — Filter records by `promptName` field (for `prompts/get` records). | Status: done

- [x] **Implement errorsOnly filter** — Only return records where the response had an error (`isError: true` or `error` field present). | Status: done

- [x] **Implement pagination (limit/offset)** — Support `limit` (max records to return) and `offset` (records to skip). | Status: done

- [x] **Implement sort order** — Support `order: 'asc'` (default) and `order: 'desc'` by timestamp. | Status: done

- [x] **Implement filePath filter** — When `filePath` is specified, query only that specific file. | Status: done

- [x] **Return AsyncIterable** — The `query()` method returns `AsyncIterable<AuditRecord>`, allowing streaming consumption of results without loading all records into memory. | Status: done

- [x] **Handle malformed lines** — Skip incomplete or malformed JSON lines (e.g., from a crash mid-write) gracefully without failing the query. | Status: done

---

## Phase 13: Integrity Verification

- [x] **Implement verifyIntegrity()** — Read the log file line by line, recompute each HMAC using the stored seed and secret, and compare with the stored `_integrity` field. | Status: done

- [x] **Return IntegrityVerificationResult** — Return `{ valid: true, recordCount, firstInvalidIndex: -1 }` on success. Return `{ valid: false, recordCount, firstInvalidIndex, expectedHmac, actualHmac }` on failure. Return `{ valid: false, recordCount: 0, firstInvalidIndex: -1, error: '...' }` on system errors (file not found, etc.). | Status: done

- [x] **Support filePath parameter** — Allow verifying a specific file (including rotated files) rather than just the active log. | Status: done

- [x] **Handle missing integrity config** — Throw an error if `verifyIntegrity()` is called when integrity is not configured. | Status: done

- [x] **Handle non-file sinks** — Throw an error if `verifyIntegrity()` is called with a non-file sink. | Status: done

---

## Phase 14: Public Exports

- [x] **Set up src/index.ts exports** — Export `createAuditLogger` as the primary API. Export `AuditWriter` class. Export all TypeScript interfaces and types: `AuditLoggerOptions`, `AuditLogger`, `AuditSink`, `SinkConfig`, `FileSinkConfig`, `StreamSinkConfig`, `CustomSinkConfig`, `AuditFilter`, `RedactionConfig`, `IntegrityConfig`, `BufferConfig`, `RotationConfig`, `RetentionConfig`, `AuditQueryParams`, `IntegrityVerificationResult`, `AuditRecord` and all specific record types, `AuditWriterOptions`. | Status: done

---

## Phase 15: Unit Tests

### ConfigValidator Tests

- [ ] **Test: missing sink throws TypeError** — Verify that calling `createAuditLogger` without a `sink` option throws `TypeError`. | Status: not_done

- [ ] **Test: empty file path throws TypeError** — Verify that `sink: { type: 'file', path: '' }` throws `TypeError`. | Status: not_done

- [ ] **Test: non-writable stream throws TypeError** — Verify that `sink: { type: 'stream', stream: {} }` (missing `write`) throws `TypeError`. | Status: not_done

- [ ] **Test: invalid custom sink throws TypeError** — Verify that `sink: { type: 'custom', sink: {} }` (missing required methods) throws `TypeError`. | Status: not_done

- [x] **Test: include and exclude together throws TypeError** — Verify mutual exclusivity of `filter.include` and `filter.exclude`. | Status: done

- [ ] **Test: integrity without secret throws TypeError** — Verify that `integrity: {}` (missing `secret`) throws `TypeError`. | Status: not_done

- [ ] **Test: invalid numeric bounds throw TypeError** — Verify validation for `maxFileSize`, `maxFiles`, `maxFieldSize`, `maxRecords`, `flushIntervalMs`. | Status: not_done

- [ ] **Test: defaults are applied correctly** — Verify that omitted optional fields receive their documented default values. | Status: not_done

### RecordBuilder Tests

- [x] **Test: builds correct ToolCallRequestRecord** — Verify correct extraction of `toolName`, `toolArguments`, `progressToken` from a raw `tools/call` JSON-RPC message. | Status: done

- [x] **Test: builds correct ToolCallResponseRecord** — Verify correct extraction of `isError`, `resultContent`, `durationMs`. Verify binary content results in `binaryOmitted: true`. | Status: done

- [x] **Test: builds correct ResourceReadRequestRecord** — Verify extraction of `resourceUri`. | Status: done

- [x] **Test: builds correct ResourceReadResponseRecord** — Verify extraction of `contents` array with `uri`, `mimeType`, `size`, `contentType`, `text`, `binaryOmitted`. Verify `durationMs`. | Status: done

- [x] **Test: builds correct PromptGetRequestRecord** — Verify extraction of `promptName`, `promptArguments`. | Status: done

- [x] **Test: builds correct PromptGetResponseRecord** — Verify extraction of `messageCount`, `messages`, `durationMs`. | Status: done

- [x] **Test: builds correct SamplingRequestRecord** — Verify extraction of `messageCount`, `systemPrompt`, `modelPreferences`, `maxTokens`, `includeContext`, `temperature`. | Status: done

- [x] **Test: builds correct SamplingResponseRecord** — Verify extraction of `role`, `contentType`, `text`, `model`, `stopReason`, `durationMs`. | Status: done

- [x] **Test: builds correct ListRequestRecord** — Verify extraction of optional `cursor`. | Status: done

- [x] **Test: builds correct ListResponseRecord** — Verify extraction of `itemCount`, `itemNames`, `nextCursor`, `durationMs`. | Status: done

- [x] **Test: builds correct InitializeRequestRecord** — Verify extraction of `protocolVersion`, `clientCapabilities`, `clientInfo`. | Status: done

- [x] **Test: builds correct InitializeResponseRecord** — Verify extraction of `protocolVersion`, `serverCapabilities`, `serverInfo`, `instructions`, `durationMs`. | Status: done

- [x] **Test: builds correct NotificationRecord** — Verify extraction of `direction`, `notificationParams`. | Status: done

- [x] **Test: builds correct GenericRequestRecord** — Verify full `params` stored for unhandled methods. | Status: done

- [x] **Test: builds correct GenericResponseRecord** — Verify full `result` stored, `durationMs` computed. | Status: done

- [x] **Test: truncates fields exceeding maxFieldSize** — Verify that large string fields are truncated and `_truncated: true` is set. | Status: done

- [ ] **Test: handles malformed messages** — Verify that messages with missing fields produce records with `_malformed: true` and whatever fields are available. | Status: not_done

- [x] **Test: handles includeBody=false** — Verify that request arguments, response content, and notification params are omitted when `includeBody` is false. | Status: done

- [x] **Test: common fields are always present** — Verify `v`, `recordId`, `timestamp`, `serverName`, `sessionId`, `type`, `method`, `correlationId`, `requestId` are set on every record. | Status: done

### Redactor Tests

- [x] **Test: redacts fields at specified paths** — Verify that `arguments.password` is replaced with `[REDACTED]`. | Status: done

- [x] **Test: redacts nested paths** — Verify that `arguments.headers.Authorization` is correctly traversed and redacted. | Status: done

- [x] **Test: redacts by regex patterns** — Verify that email addresses, SSNs, and API keys matching configured patterns are replaced. | Status: done

- [x] **Test: custom redactor function** — Verify that the custom function is called for every string field and its return value is used. | Status: done

- [ ] **Test: preserves non-string fields** — Verify that numbers, booleans, nulls, and objects are not modified by pattern-based redaction. | Status: not_done

- [x] **Test: preserveLength produces correct format** — Verify `[REDACTED:12]` for a 12-character redacted value. | Status: done

- [x] **Test: deeply nested object traversal** — Verify redaction works on objects nested several levels deep. | Status: done

- [x] **Test: redaction does not modify original message** — Verify the original MCP message remains unchanged after redaction. | Status: done

### CorrelationTracker Tests

- [ ] **Test: assigns unique correlationId to each request** — Verify that `trackRequest` returns a UUIDv4 and stores the entry. | Status: not_done

- [ ] **Test: resolves response with correct correlationId** — Verify `resolveResponse` returns the matching `correlationId` and computed `durationMs`. | Status: not_done

- [ ] **Test: cleans up entry after resolution** — Verify that the entry is removed from the map after `resolveResponse`. | Status: not_done

- [ ] **Test: handles missing correlation** — Verify graceful behavior when `resolveResponse` is called for an untracked `requestId`. | Status: not_done

- [ ] **Test: stale entry cleanup** — Verify that entries older than 5 minutes are pruned. | Status: not_done

### IntegrityChain Tests

- [x] **Test: first record includes _integritySeed and correct HMAC** — Verify chain initialization with seed. | Status: done

- [x] **Test: second record HMAC depends on first record HMAC** — Verify chaining of HMACs. | Status: done

- [x] **Test: valid chain verifies successfully** — Verify `verifyIntegrity()` returns `{ valid: true }` for an unmodified chain. | Status: done

- [x] **Test: modified record breaks chain** — Verify that modifying a record causes verification to report `{ valid: false }` with correct `firstInvalidIndex`. | Status: done

- [ ] **Test: inserted record breaks chain** — Verify insertion detection. | Status: not_done

- [x] **Test: deleted record breaks chain** — Verify deletion detection. | Status: done

- [x] **Test: sha256, sha384, sha512 all produce valid chains** — Verify each supported algorithm works correctly. | Status: done

- [x] **Test: auto-generated seed** — Verify that when no seed is configured, a random 32-byte hex seed is generated and stored in `_integritySeed`. | Status: done

### WriteBuffer Tests

- [x] **Test: flushes at maxRecords** — Verify automatic flush when buffer reaches `maxRecords`. | Status: done

- [ ] **Test: flushes at flushIntervalMs** — Verify timed flush after interval elapses. | Status: not_done

- [x] **Test: immediate mode flushes every record** — Verify each add triggers a flush when `immediate` is true. | Status: done

- [ ] **Test: explicit flush() drains buffer** — Verify all buffered records are returned. | Status: not_done

- [x] **Test: close() flushes remaining records** — Verify close drains the buffer. | Status: done

- [ ] **Test: buffer overflow warning** — Verify `onError` is called when buffer exceeds `maxRecords * 10`. | Status: not_done

### Filter Tests

- [x] **Test: include filter records only specified methods** — Verify `include: ['tools/call']` only records `tools/call`. | Status: done

- [x] **Test: exclude filter skips specified methods** — Verify `exclude: ['ping']` records everything except `ping`. | Status: done

- [x] **Test: includeLifecycle=false skips lifecycle events** — Verify `initialize` and `notifications/initialized` are skipped. | Status: done

- [x] **Test: includeNotifications=false skips notifications** — Verify all notification records are skipped. | Status: done

- [x] **Test: includeListOperations=false skips list methods** — Verify `tools/list`, `resources/list`, etc. are skipped. | Status: done

### Serializer Tests

- [x] **Test: produces valid JSON** — Verify output parses as valid JSON for each record type. | Status: done

- [x] **Test: output is newline-terminated** — Verify each serialized record ends with `\n`. | Status: done

- [ ] **Test: deterministic key ordering when integrity enabled** — Verify keys are sorted alphabetically. | Status: not_done

---

## Phase 16: Integration Tests

- [ ] **Test: end-to-end recording with real MCP Server** — Create a Server with tool, resource, and prompt handlers. Wrap with `createAuditLogger` using a stream sink. Connect a Client. Execute `tools/list`, `tools/call`, `resources/read`, `prompts/get`. Parse NDJSON output and verify correct record count, types, correlation IDs, timing, tool names, URIs, and prompt names. | Status: not_done

- [ ] **Test: session tracking** — Verify all records from a single client session share the same `sessionId`. Verify records from different sessions have different `sessionId` values. | Status: not_done

- [ ] **Test: error recording for tool failures** — Call a tool that throws an error. Verify the response record has `isError: true` and error content. Call a non-existent tool. Verify protocol error in the response record. | Status: not_done

- [x] **Test: lifecycle event recording** — Verify `initialize` request and response records with correct `protocolVersion`, `clientInfo`, `serverInfo`. Verify `notifications/initialized` is recorded. | Status: done

- [ ] **Test: notification recording** — Trigger `notifications/tools/list_changed` from the server. Verify the notification record with `direction: 'outgoing'`. | Status: not_done

- [x] **Test: file sink end-to-end** — Write records to a file, read the file, verify valid NDJSON with correct records. | Status: done

- [x] **Test: log rotation end-to-end** — Write enough data to trigger rotation. Verify rotated files are created with correct naming. Verify the active file is a new, smaller file. Verify old files beyond `maxFiles` are deleted. | Status: done

- [ ] **Test: gzip compression on rotation** — Enable compression. Trigger rotation. Verify rotated file is gzipped and readable. | Status: not_done

- [x] **Test: HMAC chain end-to-end** — Write 100 records with integrity enabled. Verify the chain with `verifyIntegrity()`. Modify a record in the file. Verify `verifyIntegrity()` reports the correct `firstInvalidIndex`. | Status: done

- [x] **Test: PII redaction end-to-end** — Configure path-based and pattern-based redaction. Execute tool calls with PII in arguments. Verify audit records contain `[REDACTED]`. Verify original MCP messages were not modified (server handler received unredacted arguments). | Status: done

- [ ] **Test: retention policy** — Write enough data for multiple rotations. Set a short `maxAge`. Wait for the retention check. Verify old rotated files were deleted. | Status: not_done

- [x] **Test: query API end-to-end** — Write diverse records, then query with various filters (method, time range, sessionId, toolName, errorsOnly, limit/offset, order). Verify correct results. | Status: done

- [ ] **Test: query across rotated files** — Write records across multiple rotated files. Query without specifying `filePath`. Verify results span all files. | Status: not_done

- [x] **Test: AuditWriter manual logging** — Use `AuditWriter` to manually log requests, responses, and notifications. Verify correct NDJSON output with correlation. | Status: done

- [ ] **Test: McpServer high-level API wrapping** — Verify `createAuditLogger(mcpServer.server, ...)` works correctly with the high-level `McpServer` class. | Status: not_done

- [x] **Test: stream sink with stdout** — Verify records written to a PassThrough stream are correctly formatted NDJSON. | Status: done

- [x] **Test: custom sink integration** — Implement a mock `AuditSink`, configure it, verify `init`, `write`, `flush`, and `close` are called correctly. | Status: done

- [x] **Test: graceful shutdown** — Verify `logger.close()` flushes all buffered records before resolving. Verify no records are lost. | Status: done

- [ ] **Test: audit logging never blocks MCP server** — Verify that even when the sink is slow (e.g., delayed write), MCP request/response processing continues normally. | Status: not_done

- [x] **Test: audit logging continues when sink fails** — Configure a sink that throws on `write()`. Verify `onError` is called, `errorCount` increments, and the MCP server continues operating. | Status: done

---

## Phase 17: Error Handling Tests

- [ ] **Test: file creation failure** — Verify `onError` is called when the log file cannot be created (e.g., permission denied). Verify records are buffered and retried on next flush. | Status: not_done

- [ ] **Test: write failure** — Verify `onError` is called on write errors. Verify the failed batch is discarded and the next flush succeeds. | Status: not_done

- [ ] **Test: rotation failure** — Verify `onError` is called if rotation fails (cannot rename). Verify the logger continues writing to the current file. | Status: not_done

- [ ] **Test: disk full** — Verify `onError` is called when writes fail due to full disk. Verify the logger recovers when space is freed. | Status: not_done

- [ ] **Test: external file deletion** — Verify the logger creates a new file on the next write if the log file is deleted externally. | Status: not_done

- [ ] **Test: custom sink write throws** — Verify error is caught, `onError` is called, batch is discarded, logger continues. | Status: not_done

- [ ] **Test: custom sink write rejects** — Verify rejected promise is handled the same as a thrown error. | Status: not_done

- [ ] **Test: malformed message handling** — Verify that non-JSON-RPC messages are recorded with `_malformed: true` and not silently dropped. | Status: not_done

---

## Phase 18: Performance Tests

- [ ] **Test: throughput benchmark** — Measure records per second with file sink, varying buffer sizes. Target at least 10,000 records/second with default buffer settings. | Status: not_done

- [ ] **Test: latency impact benchmark** — Measure MCP request/response round-trip time with and without audit logging. Target less than 1ms additional latency per request. | Status: not_done

- [ ] **Test: memory usage benchmark** — Measure memory growth over 100,000 records. Verify memory usage is bounded (buffer flushes, correlation map is cleaned up). | Status: not_done

---

## Phase 19: Documentation

- [ ] **Write README.md** — Create a comprehensive README with: overview/motivation, installation instructions, quick start example, API reference for `createAuditLogger` and `AuditWriter`, configuration reference for all options, integration pattern examples (Server wrapping, McpServer wrapping, HTTP transport, manual logging, stream sink), audit record schema documentation, HMAC integrity verification example, PII redaction example, query API example, log rotation and retention explanation, security and compliance notes (GDPR, HIPAA, SOC 2), and troubleshooting guide. | Status: not_done

- [ ] **Add JSDoc comments to all public APIs** — Ensure `createAuditLogger`, `AuditWriter`, and all exported interfaces/types have complete JSDoc comments matching the spec. | Status: not_done

- [ ] **Add inline code comments** — Add explanatory comments for non-obvious implementation details: transport interception strategy, HMAC chain computation, write serialization, rotation logic. | Status: not_done

---

## Phase 20: Build & Publish Preparation

- [ ] **Verify build succeeds** — Run `npm run build` (tsc). Ensure it compiles without errors and produces correct output in `dist/`. | Status: not_done

- [ ] **Verify lint passes** — Run `npm run lint`. Fix any linting issues. | Status: not_done

- [ ] **Verify all tests pass** — Run `npm run test` (vitest). Ensure all unit, integration, and performance tests pass. | Status: not_done

- [ ] **Verify package contents** — Run `npm pack --dry-run` to inspect what will be published. Ensure only `dist/` is included (no source, no tests, no config files). | Status: not_done

- [ ] **Bump version in package.json** — Set version appropriately for initial release (e.g., `1.0.0`). | Status: not_done

- [ ] **Add LICENSE file** — Ensure MIT license file exists at the package root. | Status: not_done
