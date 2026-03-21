import { describe, it, expect } from 'vitest';
import { buildRequestRecord, buildResponseRecord, buildNotificationRecord } from '../record.js';

const SERVER = 'test-server';
const SESSION = 'sess-001';

describe('buildRequestRecord', () => {
  describe('tools/call', () => {
    it('should build a tool call request record', () => {
      const { record, correlationId } = buildRequestRecord(
        SERVER, 'tools/call', 1,
        { name: 'get_weather', arguments: { location: 'NYC' } },
        SESSION, true,
      );
      expect(record.v).toBe(1);
      expect(record.type).toBe('request');
      expect(record.method).toBe('tools/call');
      expect(record.serverName).toBe(SERVER);
      expect(record.sessionId).toBe(SESSION);
      expect(record.requestId).toBe(1);
      expect(record.correlationId).toBe(correlationId);
      expect(record.recordId).toMatch(/^[0-9a-f-]{36}$/);
      expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect('toolName' in record && record.toolName).toBe('get_weather');
      expect('toolArguments' in record && record.toolArguments).toEqual({ location: 'NYC' });
    });

    it('should omit toolArguments when includeBody is false', () => {
      const { record } = buildRequestRecord(
        SERVER, 'tools/call', 2,
        { name: 'do_thing', arguments: { secret: 'val' } },
        SESSION, false,
      );
      expect('toolArguments' in record && record.toolArguments).toBeNull();
    });

    it('should capture progressToken from _meta', () => {
      const { record } = buildRequestRecord(
        SERVER, 'tools/call', 3,
        { name: 'slow_tool', arguments: {}, _meta: { progressToken: 'pt-1' } },
        SESSION, true,
      );
      expect('progressToken' in record && record.progressToken).toBe('pt-1');
    });

    it('should handle missing arguments gracefully', () => {
      const { record } = buildRequestRecord(
        SERVER, 'tools/call', 4,
        { name: 'no_args' },
        SESSION, true,
      );
      expect('toolArguments' in record && record.toolArguments).toBeNull();
    });
  });

  describe('resources/read', () => {
    it('should build a resource read request record', () => {
      const { record } = buildRequestRecord(
        SERVER, 'resources/read', 5,
        { uri: 'file:///data.txt' },
        SESSION, true,
      );
      expect(record.method).toBe('resources/read');
      expect('resourceUri' in record && record.resourceUri).toBe('file:///data.txt');
    });
  });

  describe('prompts/get', () => {
    it('should build a prompt get request record', () => {
      const { record } = buildRequestRecord(
        SERVER, 'prompts/get', 6,
        { name: 'summarize', arguments: { style: 'brief' } },
        SESSION, true,
      );
      expect(record.method).toBe('prompts/get');
      expect('promptName' in record && record.promptName).toBe('summarize');
      expect('promptArguments' in record && record.promptArguments).toEqual({ style: 'brief' });
    });

    it('should omit promptArguments when includeBody is false', () => {
      const { record } = buildRequestRecord(
        SERVER, 'prompts/get', 7,
        { name: 'test', arguments: { x: 'y' } },
        SESSION, false,
      );
      expect('promptArguments' in record && record.promptArguments).toBeNull();
    });
  });

  describe('sampling/createMessage', () => {
    it('should build a sampling request record', () => {
      const { record } = buildRequestRecord(
        SERVER, 'sampling/createMessage', 8,
        {
          messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
          systemPrompt: 'You are helpful.',
          modelPreferences: { hints: [{ name: 'claude' }] },
          maxTokens: 1000,
          temperature: 0.7,
          includeContext: 'thisServer',
        },
        SESSION, true,
      );
      expect(record.method).toBe('sampling/createMessage');
      expect('messageCount' in record && record.messageCount).toBe(1);
      expect('systemPrompt' in record && record.systemPrompt).toBe('You are helpful.');
      expect('maxTokens' in record && record.maxTokens).toBe(1000);
      expect('temperature' in record && record.temperature).toBe(0.7);
      expect('includeContext' in record && record.includeContext).toBe('thisServer');
    });
  });

  describe('initialize', () => {
    it('should build an initialize request record', () => {
      const { record } = buildRequestRecord(
        SERVER, 'initialize', 9,
        {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'test-client', version: '1.0' },
        },
        SESSION, true,
      );
      expect(record.method).toBe('initialize');
      expect('protocolVersion' in record && record.protocolVersion).toBe('2024-11-05');
      expect('clientInfo' in record && record.clientInfo).toEqual({ name: 'test-client', version: '1.0' });
    });
  });

  describe('list operations', () => {
    for (const method of ['tools/list', 'resources/list', 'resources/templates/list', 'prompts/list']) {
      it(`should build a ${method} request record`, () => {
        const { record } = buildRequestRecord(SERVER, method, 10, {}, SESSION, true);
        expect(record.method).toBe(method);
      });
    }

    it('should include cursor when provided', () => {
      const { record } = buildRequestRecord(
        SERVER, 'tools/list', 11,
        { cursor: 'next-page' },
        SESSION, true,
      );
      expect('cursor' in record && record.cursor).toBe('next-page');
    });
  });

  describe('generic request', () => {
    it('should build a generic request for unknown methods', () => {
      const { record } = buildRequestRecord(
        SERVER, 'ping', 12,
        { foo: 'bar' },
        SESSION, true,
      );
      expect(record.method).toBe('ping');
      expect('params' in record && record.params).toEqual({ foo: 'bar' });
    });

    it('should omit params when includeBody is false', () => {
      const { record } = buildRequestRecord(SERVER, 'ping', 13, { x: 1 }, SESSION, false);
      expect('params' in record && record.params).toBeNull();
    });
  });

  it('should generate unique correlationIds', () => {
    const { correlationId: c1 } = buildRequestRecord(SERVER, 'ping', 1, null, null, true);
    const { correlationId: c2 } = buildRequestRecord(SERVER, 'ping', 2, null, null, true);
    expect(c1).not.toBe(c2);
  });

  it('should generate unique recordIds', () => {
    const { record: r1 } = buildRequestRecord(SERVER, 'ping', 1, null, null, true);
    const { record: r2 } = buildRequestRecord(SERVER, 'ping', 2, null, null, true);
    expect(r1.recordId).not.toBe(r2.recordId);
  });

  it('should handle null sessionId', () => {
    const { record } = buildRequestRecord(SERVER, 'ping', 1, null, null, true);
    expect(record.sessionId).toBeNull();
  });
});

describe('buildResponseRecord', () => {
  describe('tools/call', () => {
    it('should build a tool call response record', () => {
      const record = buildResponseRecord(
        SERVER, 'tools/call', 1, 'corr-1',
        {
          content: [{ type: 'text', text: 'Result here' }],
          isError: false,
        },
        null, 150, SESSION, true,
      );
      expect(record.type).toBe('response');
      expect(record.method).toBe('tools/call');
      expect(record.correlationId).toBe('corr-1');
      expect('durationMs' in record && record.durationMs).toBe(150);
      expect('isError' in record && record.isError).toBe(false);
      expect('resultContent' in record && record.resultContent).toEqual([{ type: 'text', text: 'Result here' }]);
    });

    it('should handle tool error responses', () => {
      const record = buildResponseRecord(
        SERVER, 'tools/call', 2, 'corr-2',
        { content: [{ type: 'text', text: 'Failed' }], isError: true },
        null, 50, SESSION, true,
      );
      expect('isError' in record && record.isError).toBe(true);
    });

    it('should handle JSON-RPC error responses', () => {
      const record = buildResponseRecord(
        SERVER, 'tools/call', 3, 'corr-3',
        null,
        { code: -32600, message: 'Invalid Request' },
        10, SESSION, true,
      );
      expect('error' in record && record.error).toEqual({ code: -32600, message: 'Invalid Request' });
    });

    it('should mark binary content as omitted', () => {
      const record = buildResponseRecord(
        SERVER, 'tools/call', 4, 'corr-4',
        { content: [{ type: 'image', mimeType: 'image/png', data: 'base64data' }], isError: false },
        null, 100, SESSION, true,
      );
      expect('resultContent' in record && record.resultContent?.[0]?.binaryOmitted).toBe(true);
    });

    it('should handle resource content type', () => {
      const record = buildResponseRecord(
        SERVER, 'tools/call', 5, 'corr-5',
        {
          content: [{ type: 'resource', resource: { uri: 'file:///a.txt', text: 'content' } }],
          isError: false,
        },
        null, 100, SESSION, true,
      );
      expect('resultContent' in record && record.resultContent?.[0]?.resourceUri).toBe('file:///a.txt');
    });

    it('should omit resultContent when includeBody is false', () => {
      const record = buildResponseRecord(
        SERVER, 'tools/call', 6, 'corr-6',
        { content: [{ type: 'text', text: 'secret' }], isError: false },
        null, 50, SESSION, false,
      );
      expect('resultContent' in record && record.resultContent).toBeNull();
    });
  });

  describe('resources/read', () => {
    it('should build a resource read response record', () => {
      const record = buildResponseRecord(
        SERVER, 'resources/read', 7, 'corr-7',
        { contents: [{ uri: 'file:///a.txt', text: 'Hello world' }] },
        null, 200, SESSION, true,
      );
      expect(record.method).toBe('resources/read');
      expect('contents' in record && record.contents?.[0]?.uri).toBe('file:///a.txt');
      expect('contents' in record && record.contents?.[0]?.contentType).toBe('text');
      expect('contents' in record && record.contents?.[0]?.text).toBe('Hello world');
    });

    it('should handle blob content', () => {
      const record = buildResponseRecord(
        SERVER, 'resources/read', 8, 'corr-8',
        { contents: [{ uri: 'file:///img.png', blob: 'AAAA', mimeType: 'image/png' }] },
        null, 100, SESSION, true,
      );
      expect('contents' in record && record.contents?.[0]?.contentType).toBe('blob');
      expect('contents' in record && record.contents?.[0]?.binaryOmitted).toBe(true);
    });
  });

  describe('prompts/get', () => {
    it('should build a prompt get response record', () => {
      const record = buildResponseRecord(
        SERVER, 'prompts/get', 9, 'corr-9',
        {
          messages: [
            { role: 'user', content: { type: 'text', text: 'Summarize this' } },
            { role: 'assistant', content: { type: 'text', text: 'Sure' } },
          ],
        },
        null, 300, SESSION, true,
      );
      expect(record.method).toBe('prompts/get');
      expect('messageCount' in record && record.messageCount).toBe(2);
      expect('messages' in record && record.messages?.[0]?.role).toBe('user');
      expect('messages' in record && record.messages?.[0]?.text).toBe('Summarize this');
    });
  });

  describe('sampling/createMessage', () => {
    it('should build a sampling response record', () => {
      const record = buildResponseRecord(
        SERVER, 'sampling/createMessage', 10, 'corr-10',
        {
          role: 'assistant',
          content: { type: 'text', text: 'Generated text' },
          model: 'claude-3',
          stopReason: 'endTurn',
        },
        null, 500, SESSION, true,
      );
      expect(record.method).toBe('sampling/createMessage');
      expect('role' in record && record.role).toBe('assistant');
      expect('model' in record && record.model).toBe('claude-3');
      expect('text' in record && record.text).toBe('Generated text');
    });
  });

  describe('initialize', () => {
    it('should build an initialize response record', () => {
      const record = buildResponseRecord(
        SERVER, 'initialize', 11, 'corr-11',
        {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'my-server', version: '1.0' },
          instructions: 'Be helpful',
        },
        null, 50, SESSION, true,
      );
      expect(record.method).toBe('initialize');
      expect('protocolVersion' in record && record.protocolVersion).toBe('2024-11-05');
      expect('instructions' in record && record.instructions).toBe('Be helpful');
    });
  });

  describe('list operations', () => {
    it('should build a tools/list response record', () => {
      const record = buildResponseRecord(
        SERVER, 'tools/list', 12, 'corr-12',
        { tools: [{ name: 'tool_a' }, { name: 'tool_b' }] },
        null, 20, SESSION, true,
      );
      expect('itemCount' in record && record.itemCount).toBe(2);
      expect('itemNames' in record && record.itemNames).toEqual(['tool_a', 'tool_b']);
    });

    it('should build a resources/list response record', () => {
      const record = buildResponseRecord(
        SERVER, 'resources/list', 13, 'corr-13',
        { resources: [{ uri: 'file:///a.txt', name: 'A' }] },
        null, 20, SESSION, true,
      );
      expect('itemCount' in record && record.itemCount).toBe(1);
      expect('itemNames' in record && record.itemNames).toEqual(['file:///a.txt']);
    });

    it('should build a prompts/list response record', () => {
      const record = buildResponseRecord(
        SERVER, 'prompts/list', 14, 'corr-14',
        { prompts: [{ name: 'summarize' }, { name: 'translate' }] },
        null, 20, SESSION, true,
      );
      expect('itemCount' in record && record.itemCount).toBe(2);
    });

    it('should include nextCursor when present', () => {
      const record = buildResponseRecord(
        SERVER, 'tools/list', 15, 'corr-15',
        { tools: [{ name: 'tool_a' }], nextCursor: 'page2' },
        null, 20, SESSION, true,
      );
      expect('nextCursor' in record && record.nextCursor).toBe('page2');
    });
  });

  describe('generic response', () => {
    it('should build a generic response for unknown methods', () => {
      const record = buildResponseRecord(
        SERVER, 'ping', 16, 'corr-16',
        { pong: true },
        null, 5, SESSION, true,
      );
      expect(record.method).toBe('ping');
      expect('result' in record && record.result).toEqual({ pong: true });
      expect('durationMs' in record && record.durationMs).toBe(5);
    });
  });
});

describe('buildNotificationRecord', () => {
  it('should build a notification record', () => {
    const record = buildNotificationRecord(
      SERVER, 'notifications/tools/list_changed',
      { reason: 'tool added' },
      SESSION, 'outgoing', true,
    );
    expect(record.type).toBe('notification');
    expect(record.method).toBe('notifications/tools/list_changed');
    expect(record.correlationId).toBeNull();
    expect(record.requestId).toBeNull();
    expect('direction' in record && record.direction).toBe('outgoing');
    expect('notificationParams' in record && record.notificationParams).toEqual({ reason: 'tool added' });
  });

  it('should omit notificationParams when includeBody is false', () => {
    const record = buildNotificationRecord(
      SERVER, 'notifications/progress',
      { progress: 50 },
      SESSION, 'outgoing', false,
    );
    expect('notificationParams' in record && record.notificationParams).toBeNull();
  });

  it('should handle incoming notifications', () => {
    const record = buildNotificationRecord(
      SERVER, 'notifications/initialized',
      null, SESSION, 'incoming', true,
    );
    expect('direction' in record && record.direction).toBe('incoming');
  });
});
