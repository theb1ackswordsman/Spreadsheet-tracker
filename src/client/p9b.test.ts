import { describe, it, expect, beforeEach } from 'vitest';
import { parseRoute, serializeRoute } from './router';
import { mapGisError } from './auth';
import {
  resetForSheet as storeResetForSheet,
  applyPatch,
  setRawMirror,
  getCell,
  getRaw,
  getMeta,
  setPendingCount,
} from './store';
import { resetForSheet as socketResetForSheet, sendEdit, getPendingOpCount } from './socket';

describe('router parse/serialize', () => {
  it('parses / as landing', () => {
    expect(parseRoute('/')).toEqual({ page: 'landing' });
  });

  it('parses /s/:id as sheet route', () => {
    expect(parseRoute('/s/sheet-123')).toEqual({ page: 'sheet', sheetId: 'sheet-123' });
    expect(parseRoute('/s/abc_XYZ-123')).toEqual({ page: 'sheet', sheetId: 'abc_XYZ-123' });
  });

  it('parses unknown routes as 404', () => {
    expect(parseRoute('/s/')).toEqual({ page: '404' });
    expect(parseRoute('/s/foo/bar')).toEqual({ page: '404' });
    expect(parseRoute('/unknown')).toEqual({ page: '404' });
    expect(parseRoute('/api/me')).toEqual({ page: '404' });
  });

  it('serializes routes to pathnames', () => {
    expect(serializeRoute({ page: 'landing' })).toBe('/');
    expect(serializeRoute({ page: 'sheet', sheetId: 'sheet-456' })).toBe('/s/sheet-456');
    expect(serializeRoute({ page: '404' })).toBe('/404');
  });
});

describe('resetForSheet', () => {
  beforeEach(() => {
    storeResetForSheet();
    socketResetForSheet();
  });

  it('store resetForSheet clears cells, raw mirror, and pending count', () => {
    setRawMirror('A1', '42');
    applyPatch([['A1', 42, null]], { scope: 1, populated: 1, ms: 0.1, mode: 'inc' });
    setPendingCount(5);

    expect(getCell('A1').v).toBe(42);
    expect(getRaw('A1')).toBe('42');
    expect(getMeta().pendingCount).toBe(5);

    storeResetForSheet();

    expect(getCell('A1').v).toBeNull();
    expect(getRaw('A1')).toBe('');
    expect(getMeta().pendingCount).toBe(0);
  });

  it('socket resetForSheet clears cells, pending ops, and store pending count', () => {
    setRawMirror('B2', '=10*2');
    applyPatch([['B2', 20, null]], { scope: 1, populated: 1, ms: 0.1, mode: 'inc' });
    sendEdit([{ cell: 'B2', raw: '=10*2' }]);

    expect(getPendingOpCount()).toBeGreaterThan(0);
    expect(getMeta().pendingCount).toBeGreaterThan(0);
    expect(getCell('B2').v).toBe(20);

    socketResetForSheet();

    expect(getPendingOpCount()).toBe(0);
    expect(getMeta().pendingCount).toBe(0);
    expect(getCell('B2').v).toBeNull();
    expect(getRaw('B2')).toBe('');
  });
});

describe('sign-in error mapping', () => {
  it('maps popup_closed and popup_closed_by_user to friendly message', () => {
    expect(mapGisError('popup_closed')).toBe('Sign-in popup was closed');
    expect(mapGisError('popup_closed_by_user')).toBe('Sign-in popup was closed');
  });

  it('maps popup_blocked and popup_blocked_by_browser to friendly message', () => {
    expect(mapGisError('popup_blocked')).toBe('Sign-in popup was blocked. Allow popups and try again.');
    expect(mapGisError('popup_blocked_by_browser')).toBe('Sign-in popup was blocked. Allow popups and try again.');
  });

  it('maps access_denied to friendly message', () => {
    expect(mapGisError('access_denied')).toBe('Access was denied');
  });

  it('maps arbitrary errors with prefix', () => {
    expect(mapGisError('unknown_code')).toBe('Sign-in error: unknown_code');
  });
});
