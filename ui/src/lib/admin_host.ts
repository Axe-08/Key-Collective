/**
 * True on the admin hosts: admin.<domain> (production) and admin-dev.<domain> (dev).
 * The server decides who is an admin; this only picks which panel the SPA shows.
 */
export function isAdminHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host.startsWith('admin.') || host.startsWith('admin-dev.');
}
