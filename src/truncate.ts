import type { AuditRecord } from './types.js';

/**
 * Truncate large string fields in an audit record to maxSize bytes.
 * Returns a new record (deep clone) with truncated fields.
 * Adds a `_truncated: true` flag to the record if any field was truncated.
 */
export function truncateRecord(record: AuditRecord, maxSize: number): AuditRecord {
  if (maxSize <= 0) return record;

  const clone = structuredClone(record);
  let didTruncate = false;

  const result = truncateObject(clone, maxSize, () => {
    didTruncate = true;
  });

  if (didTruncate) {
    (result as Record<string, unknown>)._truncated = true;
  }

  return result as AuditRecord;
}

function truncateObject(
  obj: unknown,
  maxSize: number,
  onTruncate: () => void,
): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    const byteLength = Buffer.byteLength(obj, 'utf8');
    if (byteLength > maxSize) {
      onTruncate();
      const suffix = '...[truncated]';
      const suffixLen = Buffer.byteLength(suffix, 'utf8');
      const targetSize = Math.max(0, maxSize - suffixLen);
      let truncated = obj;
      while (Buffer.byteLength(truncated, 'utf8') > targetSize && truncated.length > 0) {
        truncated = truncated.slice(0, Math.floor(truncated.length * (targetSize / Buffer.byteLength(truncated, 'utf8'))));
      }
      return truncated + suffix;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => truncateObject(item, maxSize, onTruncate));
  }

  if (typeof obj === 'object') {
    const result = obj as Record<string, unknown>;
    for (const key of Object.keys(result)) {
      // Skip metadata fields
      if (key === 'v' || key === 'recordId' || key === 'timestamp' || key === 'serverName' ||
          key === 'sessionId' || key === 'type' || key === 'method' || key === 'correlationId' ||
          key === 'requestId' || key === '_integrity' || key === '_integritySeed') {
        continue;
      }
      result[key] = truncateObject(result[key], maxSize, onTruncate);
    }
    return result;
  }

  return obj;
}
