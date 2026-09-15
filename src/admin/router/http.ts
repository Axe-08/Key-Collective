import type { Request, Response, NextFunction, RouteHandler, Route, RouterInstance } from "./types";

export function pathToRegex(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = path
    .replace(/\/:([a-zA-Z0-9_]+)/g, (_match, name) => {
      paramNames.push(name);
      return "/([^/]+)";
    })
    .replace(/\//g, "\/");
  return {
    regex: new RegExp(`^${regexStr}\/?$`),
    paramNames,
  };
}

/**
 * Strict Zero-Knowledge Denial Middleware
 * Returns HTTP 404 Not Found if role is not strictly "admin".
 */
export const verifyAdmin = (req: Request, res: Response, next: NextFunction): void => {
  let role: string | undefined = undefined;

  if (typeof req.role === "string") {
    role = req.role;
  } else if (
    req.user &&
    typeof req.user === "object" &&
    typeof (req.user as Record<string, unknown>).role === "string"
  ) {
    role = (req.user as Record<string, unknown>).role as string;
  } else if (req.headers) {
    if (typeof (req.headers as Headers).get === "function") {
      role = (req.headers as Headers).get("x-user-role") || undefined;
    } else if (typeof req.headers === "object") {
      const headerRole = (req.headers as Record<string, string | string[] | undefined>)["x-user-role"];
      if (typeof headerRole === "string") {
        role = headerRole;
      }
    }
  }

  // Strict role checking (role === "admin")
  if (role === "admin") {
    next();
    return;
  }

  // Zero-knowledge denial (returns 404 Not Found if role is not admin)
  res.status(404).json({
    error: "Not Found",
  });
};

/**
 * Router Factory function creating a lightweight, composable HTTP router.
 */
export function Router(): RouterInstance {
  const routes: Route[] = [];
  const globalMiddlewares: RouteHandler[] = [];
  const stack: Array<{ path?: string; handler: RouteHandler; method?: string }> = [];

  const handle = async (
    req: Request,
    res: Response,
    finalNext?: NextFunction
  ): Promise<void> => {
    req.params = req.params ?? {};
    req.query = req.query ?? {};

    const rawUrl = req.url || req.path || "/";
    const [pathname, queryString] = rawUrl.split("?");

    if (queryString && Object.keys(req.query).length === 0) {
      const searchParams = new URLSearchParams(queryString);
      searchParams.forEach((val, key) => {
        if (req.query) {
          req.query[key] = val;
        }
      });
    }

    const method = (req.method || "GET").toUpperCase();

    // Find matching route
    for (const route of routes) {
      if (route.method !== method && route.method !== "ALL") {
        continue;
      }

      const match = pathname.match(route.regex);
      if (match) {
        for (let i = 0; i < route.paramNames.length; i++) {
          req.params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
        }

        const pipeline = [...globalMiddlewares, ...route.handlers];
        let index = 0;

        const next: NextFunction = (err?: unknown) => {
          if (err) {
            if (finalNext) {
              finalNext(err);
              return;
            }
            res.status(500).json({ error: String(err) });
            return;
          }

          if (index < pipeline.length) {
            const handler = pipeline[index++];
            try {
              const result = handler(req, res, next);
              if (result && typeof (result as Promise<void>).then === "function") {
                (result as Promise<void>).catch((asyncErr) => next(asyncErr));
              }
            } catch (syncErr) {
              next(syncErr);
            }
          } else if (finalNext) {
            finalNext();
          }
        };

        next();
        return;
      }
    }

    if (finalNext) {
      finalNext();
    } else {
      res.status(404).json({ error: "Not Found" });
    }
  };

  const routerFn = ((req: Request, res: Response, next?: NextFunction) => {
    return handle(req, res, next);
  }) as RouterInstance;

  routerFn.routes = routes;
  routerFn.stack = stack;
  routerFn.handle = handle;

  routerFn.use = (
    pathOrHandler: string | RouteHandler,
    ...handlers: RouteHandler[]
  ): RouterInstance => {
    if (typeof pathOrHandler === "function") {
      globalMiddlewares.push(pathOrHandler);
      stack.push({ handler: pathOrHandler });
      for (const h of handlers) {
        globalMiddlewares.push(h);
        stack.push({ handler: h });
      }
    } else if (typeof pathOrHandler === "string") {
      for (const h of handlers) {
        const { regex, paramNames } = pathToRegex(
          pathOrHandler.endsWith("*") ? pathOrHandler.slice(0, -1) + ".*" : pathOrHandler
        );
        routes.push({
          method: "ALL",
          path: pathOrHandler,
          handlers: [h],
          paramNames,
          regex,
        });
        stack.push({ path: pathOrHandler, handler: h });
      }
    }
    return routerFn;
  };

  routerFn.get = (path: string, ...handlers: RouteHandler[]): RouterInstance => {
    const { regex, paramNames } = pathToRegex(path);
    routes.push({
      method: "GET",
      path,
      handlers,
      paramNames,
      regex,
    });
    stack.push({ path, handler: handlers[handlers.length - 1], method: "GET" });
    return routerFn;
  };

  routerFn.post = (path: string, ...handlers: RouteHandler[]): RouterInstance => {
    const { regex, paramNames } = pathToRegex(path);
    routes.push({
      method: "POST",
      path,
      handlers,
      paramNames,
      regex,
    });
    stack.push({ path, handler: handlers[handlers.length - 1], method: "POST" });
    return routerFn;
  };

  routerFn.put = (path: string, ...handlers: RouteHandler[]): RouterInstance => {
    const { regex, paramNames } = pathToRegex(path);
    routes.push({
      method: "PUT",
      path,
      handlers,
      paramNames,
      regex,
    });
    stack.push({ path, handler: handlers[handlers.length - 1], method: "PUT" });
    return routerFn;
  };

  routerFn.delete = (path: string, ...handlers: RouteHandler[]): RouterInstance => {
    const { regex, paramNames } = pathToRegex(path);
    routes.push({
      method: "DELETE",
      path,
      handlers,
      paramNames,
      regex,
    });
    stack.push({ path, handler: handlers[handlers.length - 1], method: "DELETE" });
    return routerFn;
  };

  return routerFn;
}
