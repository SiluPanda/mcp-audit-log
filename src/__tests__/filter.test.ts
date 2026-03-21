import { describe, it, expect } from 'vitest';
import { shouldRecord, validateFilter } from '../filter.js';

describe('shouldRecord', () => {
  it('should record all methods when no filter is provided', () => {
    expect(shouldRecord('tools/call', undefined)).toBe(true);
    expect(shouldRecord('resources/read', undefined)).toBe(true);
    expect(shouldRecord('notifications/progress', undefined)).toBe(true);
    expect(shouldRecord('initialize', undefined)).toBe(true);
  });

  it('should record all methods when filter is empty', () => {
    expect(shouldRecord('tools/call', {})).toBe(true);
    expect(shouldRecord('ping', {})).toBe(true);
  });

  describe('include list', () => {
    it('should only record included methods', () => {
      const filter = { include: ['tools/call', 'resources/read'] };
      expect(shouldRecord('tools/call', filter)).toBe(true);
      expect(shouldRecord('resources/read', filter)).toBe(true);
      expect(shouldRecord('prompts/get', filter)).toBe(false);
      expect(shouldRecord('ping', filter)).toBe(false);
    });
  });

  describe('exclude list', () => {
    it('should record all methods except excluded ones', () => {
      const filter = { exclude: ['ping', 'notifications/progress'] };
      expect(shouldRecord('tools/call', filter)).toBe(true);
      expect(shouldRecord('ping', filter)).toBe(false);
      expect(shouldRecord('notifications/progress', filter)).toBe(false);
    });
  });

  describe('includeLifecycle', () => {
    it('should exclude lifecycle methods when false', () => {
      const filter = { includeLifecycle: false };
      expect(shouldRecord('initialize', filter)).toBe(false);
      expect(shouldRecord('notifications/initialized', filter)).toBe(false);
      expect(shouldRecord('tools/call', filter)).toBe(true);
    });

    it('should include lifecycle methods by default', () => {
      expect(shouldRecord('initialize', {})).toBe(true);
      expect(shouldRecord('notifications/initialized', {})).toBe(true);
    });
  });

  describe('includeNotifications', () => {
    it('should exclude notifications when false', () => {
      const filter = { includeNotifications: false };
      expect(shouldRecord('notifications/tools/list_changed', filter)).toBe(false);
      expect(shouldRecord('notifications/progress', filter)).toBe(false);
      expect(shouldRecord('notifications/initialized', filter)).toBe(false);
      expect(shouldRecord('tools/call', filter)).toBe(true);
    });

    it('should include notifications by default', () => {
      expect(shouldRecord('notifications/progress', {})).toBe(true);
    });
  });

  describe('includeListOperations', () => {
    it('should exclude list operations when false', () => {
      const filter = { includeListOperations: false };
      expect(shouldRecord('tools/list', filter)).toBe(false);
      expect(shouldRecord('resources/list', filter)).toBe(false);
      expect(shouldRecord('resources/templates/list', filter)).toBe(false);
      expect(shouldRecord('prompts/list', filter)).toBe(false);
      expect(shouldRecord('tools/call', filter)).toBe(true);
    });

    it('should include list operations by default', () => {
      expect(shouldRecord('tools/list', {})).toBe(true);
    });
  });

  describe('combined filters', () => {
    it('should apply lifecycle filter before include list', () => {
      const filter = { include: ['initialize', 'tools/call'], includeLifecycle: false };
      expect(shouldRecord('initialize', filter)).toBe(false);
      expect(shouldRecord('tools/call', filter)).toBe(true);
    });

    it('should apply notification filter before exclude list', () => {
      const filter = { exclude: ['ping'], includeNotifications: false };
      expect(shouldRecord('notifications/progress', filter)).toBe(false);
      expect(shouldRecord('ping', filter)).toBe(false);
      expect(shouldRecord('tools/call', filter)).toBe(true);
    });
  });
});

describe('validateFilter', () => {
  it('should not throw for valid filters', () => {
    expect(() => validateFilter(undefined)).not.toThrow();
    expect(() => validateFilter({})).not.toThrow();
    expect(() => validateFilter({ include: ['tools/call'] })).not.toThrow();
    expect(() => validateFilter({ exclude: ['ping'] })).not.toThrow();
    expect(() => validateFilter({ include: [] })).not.toThrow();
    expect(() => validateFilter({ exclude: [] })).not.toThrow();
  });

  it('should throw when both include and exclude are non-empty', () => {
    expect(() =>
      validateFilter({ include: ['tools/call'], exclude: ['ping'] }),
    ).toThrow(TypeError);
  });

  it('should not throw when one is empty', () => {
    expect(() =>
      validateFilter({ include: ['tools/call'], exclude: [] }),
    ).not.toThrow();
    expect(() =>
      validateFilter({ include: [], exclude: ['ping'] }),
    ).not.toThrow();
  });
});
