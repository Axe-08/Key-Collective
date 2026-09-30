/**
 * Host URL builders for Key Collective test suites.
 */

export function api(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `https://api.test${normalized}`;
}

export function console(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `https://console.test${normalized}`;
}

export function admin(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `https://admin.test${normalized}`;
}

export { console as consoleHost, console as consoleUrl };
export { api as apiHost, admin as adminHost };
