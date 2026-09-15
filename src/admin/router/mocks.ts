import type { Request, Response } from "./types";

export function createMockRequest(options: {
  method?: string;
  url?: string;
  role?: string;
  user?: { id?: string; email?: string; role?: string; tier?: string };
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
} = {}): Request {
  return {
    method: options.method || "GET",
    url: options.url || "/",
    path: options.url || "/",
    role: options.role,
    user: options.user,
    headers: options.headers || {},
    body: options.body,
    params: options.params || {},
    query: options.query || {},
  };
}

export function createMockResponse(): Response {
  const res: Response = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.body = data;
      return this;
    },
    send(data?: unknown) {
      this.body = data;
      return this;
    },
    setHeader(name: string, value: string) {
      if (!this.headers) this.headers = {};
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}
