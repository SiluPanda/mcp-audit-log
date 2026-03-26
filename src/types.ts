// ─── Sink Configuration ─────────────────────────────────────────────

/** Write audit records to a file as append-only NDJSON. */
export interface FileSinkConfig {
  type: 'file';
  /** Absolute or relative path to the audit log file. */
  path: string;
  /** File mode (permissions) for newly created files. Defaults to 0o600. */
  mode?: number;
}

/** Write audit records to a Node.js Writable stream. */
export interface StreamSinkConfig {
  type: 'stream';
  stream: NodeJS.WritableStream;
}

/** Write audit records to a custom sink implementation. */
export interface CustomSinkConfig {
  type: 'custom';
  sink: AuditSink;
}

export type SinkConfig = FileSinkConfig | StreamSinkConfig | CustomSinkConfig;

// ─── AuditSink Interface ───────────────────────────────────────────

export interface AuditSink {
  write(records: string[]): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
  init?(onError: (error: Error) => void): Promise<void>;
}

// ─── Filter ────────────────────────────────────────────────────────

export interface AuditFilter {
  /** MCP methods to include. Mutually exclusive with `exclude`. */
  include?: string[];
  /** MCP methods to exclude. Mutually exclusive with `include`. */
  exclude?: string[];
  /** Whether to record lifecycle events (initialize, initialized). Defaults to true. */
  includeLifecycle?: boolean;
  /** Whether to record notification messages. Defaults to true. */
  includeNotifications?: boolean;
  /** Whether to record listing operations. Defaults to true. */
  includeListOperations?: boolean;
}

// ─── Redaction ─────────────────────────────────────────────────────

export interface RedactionConfig {
  /** Fields to redact, identified by dot-notation paths. */
  paths?: string[];
  /** Regex patterns to match and redact within string values. */
  patterns?: RegExp[];
  /** Custom redaction function. */
  custom?: (path: string, value: string) => string;
  /** Placeholder string for redacted values. Defaults to '[REDACTED]'. */
  placeholder?: string;
  /** Whether to preserve original value length in placeholder. Defaults to false. */
  preserveLength?: boolean;
}

// ─── Integrity ─────────────────────────────────────────────────────

export interface IntegrityConfig {
  /** HMAC algorithm. Defaults to 'sha256'. */
  algorithm?: 'sha256' | 'sha384' | 'sha512';
  /** Secret key for HMAC computation. Required. */
  secret: string | Buffer;
  /** Seed value for the first record in the chain. */
  seed?: string;
}

// ─── Buffer ────────────────────────────────────────────────────────

export interface BufferConfig {
  /** Maximum number of records to buffer before flushing. Defaults to 100. */
  maxRecords?: number;
  /** Maximum time in ms to wait before flushing. Defaults to 1000. */
  flushIntervalMs?: number;
  /** Whether to flush immediately on every record. Defaults to false. */
  immediate?: boolean;
}

// ─── Rotation ──────────────────────────────────────────────────────

export interface RotationConfig {
  /** Maximum file size in bytes before rotation. Defaults to 50 MiB. */
  maxFileSize?: number;
  /** Maximum number of rotated files to keep. Defaults to 10. */
  maxFiles?: number;
  /** Whether to compress rotated files with gzip. Defaults to false. */
  compress?: boolean;
}

// ─── Retention ─────────────────────────────────────────────────────

export interface RetentionConfig {
  /** Maximum age in ms for rotated log files. */
  maxAge?: number;
  /** How often (in ms) to run the retention cleanup check. Defaults to 1 hour. */
  checkIntervalMs?: number;
}

// ─── Audit Logger Options ──────────────────────────────────────────

export interface AuditLoggerOptions {
  /** Where to write audit records. Required. */
  sink: SinkConfig;
  /** A stable name identifying this MCP server. */
  serverName?: string;
  /** Controls which MCP methods are recorded. */
  filter?: AuditFilter;
  /** PII redaction configuration. */
  redaction?: RedactionConfig;
  /** HMAC integrity chain configuration. */
  integrity?: IntegrityConfig;
  /** Log rotation configuration. Only for file sinks. */
  rotation?: RotationConfig;
  /** Retention policy configuration. Only for file sinks. */
  retention?: RetentionConfig;
  /** Buffer and flush settings. */
  buffer?: BufferConfig;
  /** Whether to include request/response bodies. Defaults to true. */
  includeBody?: boolean;
  /** Maximum size in bytes for any single field value. Defaults to 1 MiB. */
  maxFieldSize?: number;
  /** Error handler. Defaults to console.error. */
  onError?: (error: Error) => void;
  /** TTL in ms for correlation map entries. Entries older than this are pruned
   *  to prevent memory leaks from unanswered requests. Defaults to 300000 (5 minutes). */
  correlationTtlMs?: number;
  /** Maximum number of pending correlations before TTL pruning is triggered.
   *  Defaults to 10000. */
  correlationMaxSize?: number;
}

// ─── Audit Record Types ────────────────────────────────────────────

export interface AuditRecordBase {
  v: 1;
  recordId: string;
  timestamp: string;
  serverName: string;
  sessionId: string | null;
  type: 'request' | 'response' | 'notification';
  method: string;
  correlationId: string | null;
  requestId: string | number | null;
  _integrity?: string;
  _integritySeed?: string;
}

export interface ToolCallRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'tools/call';
  toolName: string;
  toolArguments: Record<string, unknown> | null;
  progressToken?: string | number;
}

export interface ToolCallResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'tools/call';
  durationMs: number;
  isError: boolean;
  resultContent: Array<{
    type: 'text' | 'image' | 'audio' | 'resource';
    text?: string;
    mimeType?: string;
    binaryOmitted?: boolean;
    resourceUri?: string;
  }> | null;
  error?: { code: number; message: string };
}

export interface ResourceReadRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'resources/read';
  resourceUri: string;
}

export interface ResourceReadResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'resources/read';
  durationMs: number;
  contents: Array<{
    uri: string;
    mimeType?: string;
    size: number;
    contentType: 'text' | 'blob';
    text?: string;
    binaryOmitted?: boolean;
  }> | null;
  error?: { code: number; message: string };
}

export interface PromptGetRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'prompts/get';
  promptName: string;
  promptArguments: Record<string, string> | null;
}

export interface PromptGetResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'prompts/get';
  durationMs: number;
  messageCount: number;
  messages: Array<{
    role: 'user' | 'assistant';
    contentType: 'text' | 'image' | 'audio' | 'resource';
    text?: string;
    binaryOmitted?: boolean;
  }> | null;
  error?: { code: number; message: string };
}

export interface SamplingRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'sampling/createMessage';
  messageCount: number;
  systemPrompt: string | null;
  modelPreferences: {
    hints?: Array<{ name: string }>;
    costPriority?: number;
    speedPriority?: number;
    intelligencePriority?: number;
  } | null;
  maxTokens: number;
  includeContext?: string;
  temperature?: number;
}

export interface SamplingResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'sampling/createMessage';
  durationMs: number;
  role: string;
  contentType: 'text' | 'image' | 'audio';
  text?: string;
  model: string;
  stopReason: string;
  error?: { code: number; message: string };
}

export interface ListRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'tools/list' | 'resources/list' | 'resources/templates/list' | 'prompts/list';
  cursor?: string;
}

export interface ListResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'tools/list' | 'resources/list' | 'resources/templates/list' | 'prompts/list';
  durationMs: number;
  itemCount: number;
  itemNames: string[];
  nextCursor?: string;
  error?: { code: number; message: string };
}

export interface InitializeRequestRecord extends AuditRecordBase {
  type: 'request';
  method: 'initialize';
  protocolVersion: string;
  clientCapabilities: Record<string, unknown>;
  clientInfo: { name: string; version: string };
}

export interface InitializeResponseRecord extends AuditRecordBase {
  type: 'response';
  method: 'initialize';
  durationMs: number;
  protocolVersion: string;
  serverCapabilities: Record<string, unknown>;
  serverInfo: { name: string; version: string };
  instructions?: string;
  error?: { code: number; message: string };
}

export interface InitializedNotificationRecord extends AuditRecordBase {
  type: 'notification';
  method: 'notifications/initialized';
  direction: 'incoming';
}

export interface NotificationRecord extends AuditRecordBase {
  type: 'notification';
  method: string;
  direction: 'incoming' | 'outgoing';
  notificationParams: Record<string, unknown> | null;
}

export interface GenericRequestRecord extends AuditRecordBase {
  type: 'request';
  method: string;
  params: Record<string, unknown> | null;
}

export interface GenericResponseRecord extends AuditRecordBase {
  type: 'response';
  method: string;
  durationMs: number;
  result: Record<string, unknown> | null;
  error?: { code: number; message: string };
}

export type AuditRecord =
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

// ─── Query Types ───────────────────────────────────────────────────

export interface AuditQueryParams {
  method?: string | string[];
  from?: Date;
  to?: Date;
  sessionId?: string;
  correlationId?: string;
  type?: 'request' | 'response' | 'notification';
  toolName?: string;
  resourceUri?: string;
  promptName?: string;
  errorsOnly?: boolean;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
  filePath?: string;
}

export interface IntegrityVerificationResult {
  valid: boolean;
  recordCount: number;
  firstInvalidIndex: number;
  expectedHmac?: string;
  actualHmac?: string;
  error?: string;
}

// ─── AuditLogger Handle ────────────────────────────────────────────

export interface AuditLoggerHandle {
  close(): Promise<void>;
  flush(): Promise<void>;
  readonly active: boolean;
  readonly recordCount: number;
  readonly errorCount: number;
  query(params: AuditQueryParams): AsyncIterable<AuditRecord>;
  verifyIntegrity(filePath?: string): Promise<IntegrityVerificationResult>;
}

// ─── AuditWriter Types ────────────────────────────────────────────

export interface AuditWriterOptions {
  sink: SinkConfig;
  serverName: string;
  redaction?: RedactionConfig;
  integrity?: IntegrityConfig;
  buffer?: BufferConfig;
  includeBody?: boolean;
  maxFieldSize?: number;
  onError?: (error: Error) => void;
}

export interface LogRequestParams {
  method: string;
  id: string | number;
  params?: Record<string, unknown>;
  sessionId?: string;
  meta?: Record<string, unknown>;
}

export interface LogResponseParams {
  id: string | number;
  correlationId: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
  sessionId?: string;
  meta?: Record<string, unknown>;
}

export interface LogNotificationParams {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  direction: 'incoming' | 'outgoing';
  meta?: Record<string, unknown>;
}
