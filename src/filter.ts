import type { AuditFilter } from './types.js';

const LIFECYCLE_METHODS = new Set(['initialize', 'notifications/initialized']);

const LIST_METHODS = new Set([
  'tools/list',
  'resources/list',
  'resources/templates/list',
  'prompts/list',
]);

/**
 * Determine whether a given MCP method should be recorded
 * based on the filter configuration.
 */
export function shouldRecord(method: string, filter: AuditFilter | undefined): boolean {
  if (!filter) return true;

  // Check lifecycle exclusion
  if (filter.includeLifecycle === false && LIFECYCLE_METHODS.has(method)) {
    return false;
  }

  // Check notification exclusion
  if (filter.includeNotifications === false && method.startsWith('notifications/')) {
    return false;
  }

  // Check list operation exclusion
  if (filter.includeListOperations === false && LIST_METHODS.has(method)) {
    return false;
  }

  // Include list takes precedence (mutually exclusive with exclude)
  if (filter.include && filter.include.length > 0) {
    return filter.include.includes(method);
  }

  // Exclude list
  if (filter.exclude && filter.exclude.length > 0) {
    return !filter.exclude.includes(method);
  }

  return true;
}

/**
 * Validate filter configuration.
 * Throws TypeError if include and exclude are both specified.
 */
export function validateFilter(filter: AuditFilter | undefined): void {
  if (!filter) return;

  if (
    filter.include &&
    filter.include.length > 0 &&
    filter.exclude &&
    filter.exclude.length > 0
  ) {
    throw new TypeError(
      'AuditFilter: "include" and "exclude" are mutually exclusive. Specify one or neither.',
    );
  }
}
