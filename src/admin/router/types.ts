export type {
  TenantSurveillanceRow,
  AdminActionPayload,
  ProviderCircuitOverridePayload,
} from "../../contracts/v3_5_types";

export type NextFunction = (err?: unknown) => void;

export interface Request {
  method?: string;
  url?: string;
  path?: string;
  params?: Record<string, string>;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string | string[] | undefined> | Headers;
  body?: unknown;
  role?: string;
  user?: {
    id?: string;
    email?: string;
    role?: string;
    tier?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface Response {
  status(code: number): this;
  json(data: unknown): this;
  send(data?: unknown): this;
  setHeader?(name: string, value: string): this;
  statusCode?: number;
  body?: unknown;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export type RouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void> | void;

export interface Route {
  method: string;
  path: string;
  handlers: RouteHandler[];
  paramNames: string[];
  regex: RegExp;
}

export interface RouterInstance {
  (req: Request, res: Response, next?: NextFunction): Promise<void>;
  use(handler: RouteHandler): RouterInstance;
  use(path: string, ...handlers: RouteHandler[]): RouterInstance;
  get(path: string, ...handlers: RouteHandler[]): RouterInstance;
  post(path: string, ...handlers: RouteHandler[]): RouterInstance;
  put(path: string, ...handlers: RouteHandler[]): RouterInstance;
  delete(path: string, ...handlers: RouteHandler[]): RouterInstance;
  handle(req: Request, res: Response, next?: NextFunction): Promise<void>;
  routes: Route[];
  stack: Array<{ path?: string; handler: RouteHandler; method?: string }>;
}

export interface ProviderPoolHealth {
  status: "healthy" | "degraded" | "unhealthy";
  activeKeys: number;
  circuitBreaker: "closed" | "open" | "half-open";
  failureRate: number;
  totalRequestsToday: number;
}

export interface AdminPoolHealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  pools: Record<"gemini" | "groq" | "cerebras" | "deepseek", ProviderPoolHealth>;
  timestamp: number;
}
