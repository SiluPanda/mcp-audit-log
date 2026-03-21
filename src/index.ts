// mcp-audit-log - Structured audit logger for MCP tool calls

export { AuditLogger } from './logger.js';
export { AuditWriter } from './audit-writer.js';
export { NdjsonWriter } from './writer.js';
export { redactRecord } from './redact.js';
export { shouldRecord, validateFilter } from './filter.js';
export { IntegrityChain, verifyIntegrityChain } from './integrity.js';
export { truncateRecord } from './truncate.js';
export {
  buildRequestRecord,
  buildResponseRecord,
  buildNotificationRecord,
} from './record.js';

// Re-export all types
export type {
  // Sink
  FileSinkConfig,
  StreamSinkConfig,
  CustomSinkConfig,
  SinkConfig,
  AuditSink,
  // Options
  AuditLoggerOptions,
  AuditFilter,
  RedactionConfig,
  IntegrityConfig,
  BufferConfig,
  RotationConfig,
  RetentionConfig,
  // Records
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
  // Query
  AuditQueryParams,
  IntegrityVerificationResult,
  // Logger handle
  AuditLoggerHandle,
  // Writer
  AuditWriterOptions,
  LogRequestParams,
  LogResponseParams,
  LogNotificationParams,
} from './types.js';

/**
 * Create an AuditLogger instance with the given options.
 * This is the main entry point for the package.
 */
export async function createAuditLog(options: import('./types.js').AuditLoggerOptions): Promise<import('./logger.js').AuditLogger> {
  const { AuditLogger: Logger } = await import('./logger.js');
  const logger = new Logger(options);
  await logger.open();
  return logger;
}
