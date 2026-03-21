# mcp-audit-log

Structured audit logger for MCP (Model Context Protocol) servers. Records tool calls, resource reads, and prompt requests as append-only NDJSON with optional HMAC integrity chains, field-level PII redaction, and log rotation.

## Installation

```bash
npm install mcp-audit-log
```

## Quick Start

```typescript
import { createAuditLog } from 'mcp-audit-log';

const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  serverName: 'my-mcp-server',
});

// Log a tool call request
const correlationId = logger.logRequest('tools/call', 1, {
  name: 'get_weather',
  arguments: { location: 'NYC' },
}, 'session-123');

// Log the response
logger.logResponse(1, {
  content: [{ type: 'text', text: 'Sunny, 72F' }],
  isError: false,
}, null, 'session-123');

// On shutdown
await logger.close();
```

## Standalone AuditWriter

For custom MCP implementations that don't use `@modelcontextprotocol/sdk`:

```typescript
import { AuditWriter } from 'mcp-audit-log';

const writer = new AuditWriter({
  sink: { type: 'file', path: './audit.log' },
  serverName: 'custom-server',
});

await writer.open();

const correlationId = writer.logRequest({
  method: 'tools/call',
  id: 1,
  params: { name: 'get_weather', arguments: { location: 'NYC' } },
  sessionId: 'session-123',
});

writer.logResponse({
  id: 1,
  correlationId,
  result: { content: [{ type: 'text', text: 'Sunny, 72F' }], isError: false },
  sessionId: 'session-123',
});

await writer.close();
```

## Features

### NDJSON Output

All records are written as newline-delimited JSON. Each line is a self-contained JSON object with a fixed schema.

### Field Redaction

Redact sensitive fields by path, regex pattern, or custom function:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  redaction: {
    paths: ['toolArguments.password', 'toolArguments.apiKey'],
    patterns: [/\bsk-[a-zA-Z0-9]{48}\b/g],
    placeholder: '[REDACTED]',
    preserveLength: false,
  },
});
```

### HMAC Integrity Chains

Enable tamper-evident hash chains:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  integrity: {
    secret: 'your-hmac-secret',
    algorithm: 'sha256',
  },
});

// Verify the chain
const result = await logger.verifyIntegrity();
console.log(result.valid); // true if no tampering detected
```

### Filtering

Control which methods are recorded:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  filter: {
    include: ['tools/call', 'resources/read'],
    includeNotifications: false,
    includeLifecycle: false,
  },
});
```

### Log Rotation

Automatic file rotation by size:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  rotation: {
    maxFileSize: 50 * 1024 * 1024, // 50 MiB
    maxFiles: 10,
  },
  retention: {
    maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
  },
});
```

### Query API

Read and filter audit records programmatically:

```typescript
for await (const record of logger.query({
  method: 'tools/call',
  from: new Date('2026-01-01'),
  errorsOnly: true,
  limit: 100,
})) {
  console.log(record);
}
```

### Sink Types

- **File**: Append-only NDJSON file
- **Stream**: Any `Writable` stream (stdout, TCP socket, etc.)
- **Custom**: Implement the `AuditSink` interface for any backend

### Buffering

Control write batching:

```typescript
const logger = await createAuditLog({
  sink: { type: 'file', path: './audit.log' },
  buffer: {
    maxRecords: 100,      // Flush after 100 records
    flushIntervalMs: 1000, // Or after 1 second
    immediate: false,      // Set true to disable buffering
  },
});
```

## API

### `createAuditLog(options): Promise<AuditLogger>`

Factory function that creates and opens an `AuditLogger`.

### `AuditLogger`

- `logRequest(method, requestId, params, sessionId?)` - Log a request, returns correlationId
- `logResponse(requestId, result, error, sessionId?)` - Log a response
- `logNotification(method, params, sessionId?, direction?)` - Log a notification
- `query(params)` - Query audit records (file sink only)
- `verifyIntegrity(filePath?)` - Verify HMAC integrity chain
- `flush()` - Force flush buffered records
- `close()` - Flush and close the logger
- `active` - Whether the logger is open
- `recordCount` - Total records written
- `errorCount` - Total write failures

### Supported MCP Methods

| Method | Record Type |
|--------|-------------|
| `tools/call` | Tool call with name, arguments, result content |
| `resources/read` | Resource read with URI, contents |
| `prompts/get` | Prompt get with name, arguments, messages |
| `sampling/createMessage` | Sampling with message count, model, stop reason |
| `initialize` | Lifecycle with protocol version, capabilities |
| `tools/list`, `resources/list`, `prompts/list` | List with item count, names |
| `ping`, `logging/setLevel`, etc. | Generic with full params/result |
| `notifications/*` | Notification with direction, params |

## Requirements

- Node.js >= 18
- Zero runtime dependencies

## License

MIT
