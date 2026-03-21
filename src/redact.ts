import type { RedactionConfig } from './types.js';

const DEFAULT_PLACEHOLDER = '[REDACTED]';

/**
 * Redact sensitive fields from an audit record object.
 * Returns a deep clone with redacted values — never mutates the input.
 */
export function redactRecord<T>(record: T, config: RedactionConfig): T {
  if (!config) return record;
  const clone = structuredClone(record);
  return applyRedaction(clone, config, '') as T;
}

function applyRedaction(obj: unknown, config: RedactionConfig, currentPath: string): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return redactString(obj, config, currentPath);
  }

  if (Array.isArray(obj)) {
    return obj.map((item, i) => applyRedaction(item, config, `${currentPath}[${i}]`));
  }

  if (typeof obj === 'object') {
    const result = obj as Record<string, unknown>;
    for (const key of Object.keys(result)) {
      const fieldPath = currentPath ? `${currentPath}.${key}` : key;

      // Check if this exact path should be redacted
      if (config.paths && isPathMatch(fieldPath, config.paths)) {
        result[key] = makePlaceholder(result[key], config);
      } else {
        result[key] = applyRedaction(result[key], config, fieldPath);
      }
    }
    return result;
  }

  return obj;
}

function redactString(value: string, config: RedactionConfig, currentPath: string): string {
  let result = value;

  // Apply regex patterns
  if (config.patterns) {
    for (const pattern of config.patterns) {
      // Reset regex state for global patterns
      const re = new RegExp(pattern.source, pattern.flags);
      result = result.replace(re, () => makePlaceholderStr(value.length, config));
    }
  }

  // Apply custom redactor
  if (config.custom) {
    result = config.custom(currentPath, result);
  }

  return result;
}

function isPathMatch(fieldPath: string, paths: string[]): boolean {
  // Normalize path: remove array indices for matching
  const normalized = fieldPath.replace(/\[\d+\]/g, '');
  return paths.some((p) => normalized === p || normalized.endsWith(`.${p}`));
}

function makePlaceholder(value: unknown, config: RedactionConfig): string {
  const placeholder = config.placeholder ?? DEFAULT_PLACEHOLDER;
  if (config.preserveLength && typeof value === 'string') {
    return `${placeholder.replace(']', '')}:${value.length}]`;
  }
  return placeholder;
}

function makePlaceholderStr(length: number, config: RedactionConfig): string {
  const placeholder = config.placeholder ?? DEFAULT_PLACEHOLDER;
  if (config.preserveLength) {
    return `${placeholder.replace(']', '')}:${length}]`;
  }
  return placeholder;
}
