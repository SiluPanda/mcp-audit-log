import { randomUUID } from 'node:crypto';
import type {
  AuditRecord,
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
  NotificationRecord,
  GenericRequestRecord,
  GenericResponseRecord,
} from './types.js';

const LIST_METHODS = new Set([
  'tools/list',
  'resources/list',
  'resources/templates/list',
  'prompts/list',
]);

function makeBase(
  serverName: string,
  sessionId: string | null,
  type: 'request' | 'response' | 'notification',
  method: string,
  correlationId: string | null,
  requestId: string | number | null,
): AuditRecordBase {
  return {
    v: 1,
    recordId: randomUUID(),
    timestamp: new Date().toISOString(),
    serverName,
    sessionId,
    type,
    method,
    correlationId,
    requestId,
  };
}

// ─── Request Records ───────────────────────────────────────────────

export function buildRequestRecord(
  serverName: string,
  method: string,
  requestId: string | number,
  params: Record<string, unknown> | undefined | null,
  sessionId: string | null,
  includeBody: boolean,
): { record: AuditRecord; correlationId: string } {
  const correlationId = randomUUID();
  const base = makeBase(serverName, sessionId, 'request', method, correlationId, requestId);

  if (method === 'tools/call') {
    const rec: ToolCallRequestRecord = {
      ...base,
      type: 'request',
      method: 'tools/call',
      toolName: (params?.name as string) ?? '',
      toolArguments: includeBody ? ((params?.arguments as Record<string, unknown>) ?? null) : null,
    };
    if (params?._meta && typeof params._meta === 'object') {
      const meta = params._meta as Record<string, unknown>;
      if (meta.progressToken !== undefined) {
        rec.progressToken = meta.progressToken as string | number;
      }
    }
    return { record: rec, correlationId };
  }

  if (method === 'resources/read') {
    const rec: ResourceReadRequestRecord = {
      ...base,
      type: 'request',
      method: 'resources/read',
      resourceUri: (params?.uri as string) ?? '',
    };
    return { record: rec, correlationId };
  }

  if (method === 'prompts/get') {
    const rec: PromptGetRequestRecord = {
      ...base,
      type: 'request',
      method: 'prompts/get',
      promptName: (params?.name as string) ?? '',
      promptArguments: includeBody
        ? ((params?.arguments as Record<string, string>) ?? null)
        : null,
    };
    return { record: rec, correlationId };
  }

  if (method === 'sampling/createMessage') {
    const messages = (params?.messages as unknown[]) ?? [];
    const rec: SamplingRequestRecord = {
      ...base,
      type: 'request',
      method: 'sampling/createMessage',
      messageCount: messages.length,
      systemPrompt: includeBody ? ((params?.systemPrompt as string) ?? null) : null,
      modelPreferences: (params?.modelPreferences as SamplingRequestRecord['modelPreferences']) ?? null,
      maxTokens: (params?.maxTokens as number) ?? 0,
    };
    if (params?.includeContext !== undefined) {
      rec.includeContext = params.includeContext as string;
    }
    if (params?.temperature !== undefined) {
      rec.temperature = params.temperature as number;
    }
    return { record: rec, correlationId };
  }

  if (method === 'initialize') {
    const rec: InitializeRequestRecord = {
      ...base,
      type: 'request',
      method: 'initialize',
      protocolVersion: (params?.protocolVersion as string) ?? '',
      clientCapabilities: (params?.capabilities as Record<string, unknown>) ?? {},
      clientInfo: (params?.clientInfo as { name: string; version: string }) ?? { name: '', version: '' },
    };
    return { record: rec, correlationId };
  }

  if (LIST_METHODS.has(method)) {
    const rec: ListRequestRecord = {
      ...base,
      type: 'request',
      method: method as ListRequestRecord['method'],
    };
    if (params?.cursor !== undefined) {
      rec.cursor = params.cursor as string;
    }
    return { record: rec, correlationId };
  }

  // Generic request
  const rec: GenericRequestRecord = {
    ...base,
    type: 'request',
    method,
    params: includeBody ? (params as Record<string, unknown> ?? null) : null,
  };
  return { record: rec, correlationId };
}

// ─── Response Records ──────────────────────────────────────────────

export function buildResponseRecord(
  serverName: string,
  method: string,
  requestId: string | number,
  correlationId: string,
  result: Record<string, unknown> | undefined | null,
  error: { code: number; message: string } | undefined | null,
  durationMs: number,
  sessionId: string | null,
  includeBody: boolean,
): AuditRecord {
  const base = makeBase(serverName, sessionId, 'response', method, correlationId, requestId);

  if (method === 'tools/call') {
    const content = result?.content as Array<Record<string, unknown>> | undefined;
    const rec: ToolCallResponseRecord = {
      ...base,
      type: 'response',
      method: 'tools/call',
      durationMs,
      isError: (result?.isError as boolean) ?? false,
      resultContent: includeBody && content
        ? content.map((c) => {
            const entry: ToolCallResponseRecord['resultContent'] extends (infer U)[] | null ? U : never = {
              type: c.type as 'text' | 'image' | 'audio' | 'resource',
            };
            if (c.type === 'text' && c.text !== undefined) {
              entry.text = c.text as string;
            }
            if (c.mimeType !== undefined) {
              entry.mimeType = c.mimeType as string;
            }
            if (c.type === 'image' || c.type === 'audio') {
              entry.binaryOmitted = true;
            }
            if (c.type === 'resource' && c.resource && typeof c.resource === 'object') {
              entry.resourceUri = (c.resource as Record<string, unknown>).uri as string;
            }
            return entry;
          })
        : null,
    };
    if (error) {
      rec.error = { code: error.code, message: error.message };
    }
    return rec;
  }

  if (method === 'resources/read') {
    const rawContents = result?.contents as Array<Record<string, unknown>> | undefined;
    const rec: ResourceReadResponseRecord = {
      ...base,
      type: 'response',
      method: 'resources/read',
      durationMs,
      contents: includeBody && rawContents
        ? rawContents.map((c) => {
            const isBlob = c.blob !== undefined;
            const textVal = c.text as string | undefined;
            const entry: ResourceReadResponseRecord['contents'] extends (infer U)[] | null ? U : never = {
              uri: (c.uri as string) ?? '',
              size: isBlob
                ? Buffer.byteLength(c.blob as string, 'base64')
                : Buffer.byteLength(textVal ?? '', 'utf8'),
              contentType: isBlob ? 'blob' : 'text',
            };
            if (c.mimeType !== undefined) {
              entry.mimeType = c.mimeType as string;
            }
            if (!isBlob && textVal !== undefined) {
              entry.text = textVal;
            }
            if (isBlob) {
              entry.binaryOmitted = true;
            }
            return entry;
          })
        : null,
    };
    if (error) {
      rec.error = { code: error.code, message: error.message };
    }
    return rec;
  }

  if (method === 'prompts/get') {
    const msgs = result?.messages as Array<Record<string, unknown>> | undefined;
    const rec: PromptGetResponseRecord = {
      ...base,
      type: 'response',
      method: 'prompts/get',
      durationMs,
      messageCount: msgs?.length ?? 0,
      messages: includeBody && msgs
        ? msgs.map((m) => {
            const content = m.content as Record<string, unknown>;
            const cType = (content?.type as string) ?? 'text';
            const entry: PromptGetResponseRecord['messages'] extends (infer U)[] | null ? U : never = {
              role: m.role as 'user' | 'assistant',
              contentType: cType as 'text' | 'image' | 'audio' | 'resource',
            };
            if (cType === 'text' && content?.text !== undefined) {
              entry.text = content.text as string;
            }
            if (cType !== 'text') {
              entry.binaryOmitted = true;
            }
            return entry;
          })
        : null,
    };
    if (error) {
      rec.error = { code: error.code, message: error.message };
    }
    return rec;
  }

  if (method === 'sampling/createMessage') {
    const content = result?.content as Record<string, unknown> | undefined;
    const rec: SamplingResponseRecord = {
      ...base,
      type: 'response',
      method: 'sampling/createMessage',
      durationMs,
      role: (result?.role as string) ?? '',
      contentType: (content?.type as 'text' | 'image' | 'audio') ?? 'text',
      model: (result?.model as string) ?? '',
      stopReason: (result?.stopReason as string) ?? '',
    };
    if (content?.type === 'text' && content?.text !== undefined && includeBody) {
      rec.text = content.text as string;
    }
    if (error) {
      rec.error = { code: error.code, message: error.message };
    }
    return rec;
  }

  if (method === 'initialize') {
    const rec: InitializeResponseRecord = {
      ...base,
      type: 'response',
      method: 'initialize',
      durationMs,
      protocolVersion: (result?.protocolVersion as string) ?? '',
      serverCapabilities: (result?.capabilities as Record<string, unknown>) ?? {},
      serverInfo: (result?.serverInfo as { name: string; version: string }) ?? { name: '', version: '' },
    };
    if (result?.instructions !== undefined) {
      rec.instructions = result.instructions as string;
    }
    if (error) {
      rec.error = { code: error.code, message: error.message };
    }
    return rec;
  }

  if (LIST_METHODS.has(method)) {
    const items = extractListItems(method, result);
    const rec: ListResponseRecord = {
      ...base,
      type: 'response',
      method: method as ListResponseRecord['method'],
      durationMs,
      itemCount: items.length,
      itemNames: items,
    };
    if (result?.nextCursor !== undefined) {
      rec.nextCursor = result.nextCursor as string;
    }
    if (error) {
      rec.error = { code: error.code, message: error.message };
    }
    return rec;
  }

  // Generic response
  const rec: GenericResponseRecord = {
    ...base,
    type: 'response',
    method,
    durationMs,
    result: includeBody ? (result as Record<string, unknown> ?? null) : null,
  };
  if (error) {
    rec.error = { code: error.code, message: error.message };
  }
  return rec;
}

// ─── Notification Records ──────────────────────────────────────────

export function buildNotificationRecord(
  serverName: string,
  method: string,
  params: Record<string, unknown> | undefined | null,
  sessionId: string | null,
  direction: 'incoming' | 'outgoing',
  includeBody: boolean,
): AuditRecord {
  const base = makeBase(serverName, sessionId, 'notification', method, null, null);

  const rec: NotificationRecord = {
    ...base,
    type: 'notification',
    method,
    direction,
    notificationParams: includeBody ? (params as Record<string, unknown> ?? null) : null,
  };
  return rec;
}

// ─── Helpers ───────────────────────────────────────────────────────

function extractListItems(method: string, result: Record<string, unknown> | undefined | null): string[] {
  if (!result) return [];

  if (method === 'tools/list') {
    const tools = result.tools as Array<Record<string, unknown>> | undefined;
    return tools?.map((t) => t.name as string) ?? [];
  }
  if (method === 'resources/list') {
    const resources = result.resources as Array<Record<string, unknown>> | undefined;
    return resources?.map((r) => (r.uri ?? r.name) as string) ?? [];
  }
  if (method === 'resources/templates/list') {
    const templates = result.resourceTemplates as Array<Record<string, unknown>> | undefined;
    return templates?.map((t) => (t.uriTemplate ?? t.name) as string) ?? [];
  }
  if (method === 'prompts/list') {
    const prompts = result.prompts as Array<Record<string, unknown>> | undefined;
    return prompts?.map((p) => p.name as string) ?? [];
  }
  return [];
}
