import type {
  AuditWriterOptions,
  LogRequestParams,
  LogResponseParams,
  LogNotificationParams,
} from './types.js';
import { AuditLogger } from './logger.js';

/**
 * Standalone audit writer for custom MCP implementations
 * that don't use @modelcontextprotocol/sdk.
 */
export class AuditWriter {
  private logger: AuditLogger;

  constructor(options: AuditWriterOptions) {
    this.logger = new AuditLogger(
      {
        sink: options.sink,
        serverName: options.serverName,
        redaction: options.redaction,
        integrity: options.integrity,
        buffer: options.buffer,
        includeBody: options.includeBody,
        maxFieldSize: options.maxFieldSize,
        onError: options.onError,
      },
      options.serverName,
    );
  }

  /** Open the writer and initialize the sink. */
  async open(): Promise<void> {
    await this.logger.open();
  }

  /**
   * Log an incoming JSON-RPC request.
   * Returns the correlationId assigned to this request.
   */
  logRequest(params: LogRequestParams): string {
    const correlationId = this.logger.logRequest(
      params.method,
      params.id,
      params.params,
      params.sessionId ?? null,
    );
    return correlationId ?? '';
  }

  /**
   * Log an outgoing JSON-RPC response.
   */
  logResponse(params: LogResponseParams): void {
    this.logger.logResponse(
      params.id,
      params.result as Record<string, unknown> | undefined,
      params.error ? { code: params.error.code, message: params.error.message } : undefined,
      params.sessionId ?? null,
    );
  }

  /**
   * Log a JSON-RPC notification.
   */
  logNotification(params: LogNotificationParams): void {
    this.logger.logNotification(
      params.method,
      params.params,
      params.sessionId ?? null,
      params.direction,
    );
  }

  /** Flush buffered records and close the writer. */
  async close(): Promise<void> {
    await this.logger.close();
  }

  /** Force-flush buffered records. */
  async flush(): Promise<void> {
    await this.logger.flush();
  }
}
