import { describe, expect, it } from 'vitest';
import * as adminHostModule from './admin_host';

describe('isAdminHost (T-F.9.2)', () => {
  const isAdminHost = (host: string): boolean => adminHostModule.isAdminHost(host);

  it('treats admin. and admin-dev. hosts as admin', () => {
    expect(isAdminHost('admin.key-col.axe08.tech')).toBe(true);
    expect(isAdminHost('admin-dev.key-col.axe08.tech')).toBe(true);
    expect(isAdminHost('ADMIN-DEV.key-col.axe08.tech')).toBe(true);
  });

  it('does not treat console or look-alike hosts as admin', () => {
    expect(isAdminHost('console.key-col.axe08.tech')).toBe(false);
    expect(isAdminHost('console-dev.key-col.axe08.tech')).toBe(false);
    expect(isAdminHost('administrator.example.com')).toBe(false);
    expect(isAdminHost('admin-devx.example.com')).toBe(false);
    expect(isAdminHost('')).toBe(false);
  });
});
