# Low-Level Design: Pod Gateway Hardening

## 1. Error Normalizer Regex & Envelope
**Files**: `src/errors/normalizer.ts`, `src/worker/router_handler.ts`

### Motivation
Errors emitted by the routing gateway or upstream LLM providers can inadvertently leak sensitive internal state.

### Design
Introduce an `ErrorNormalizer` module containing strict regex patterns to scrub sensitive data from any string.

**Signatures**:
```typescript
// src/errors/normalizer.ts
export const SECRET_REGEX = /(sk-[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9\-\._~+\/]+)/g;
export const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

export function sanitizeErrorMessage(message: string): string {
    return message
        .replace(SECRET_REGEX, '[REDACTED_SECRET]')
        .replace(IP_REGEX, '[REDACTED_IP]');
}
```

**Integration**:
Update `formatRouterError` in `src/worker/router_handler.ts` to pass the `message` string through `sanitizeErrorMessage` before constructing the `Response`.

## 2. /report Takedown Constant-Time Timing Shield
**Files**: `src/worker/router_handler.ts`, `src/contracts/v3_5_types.ts`

### Motivation
To support automated takedown and abuse reporting webhooks, we need a dedicated `POST /v1/report` endpoint. Validating a webhook secret with standard string equality `===` opens the gateway to timing side-channel attacks.

### Design
Add a new route handler in `RouterHandler` that uses `timingSafeEqualStrings` from `src/crypto/utils.ts`.

**Signatures**:
```typescript
// src/worker/router_handler.ts
import { timingSafeEqualStrings } from "../crypto/utils";

public async handleReport(request: Request, env: WorkerEnv): Promise<Response> {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const expectedSecret = env.REPORT_WEBHOOK_SECRET || "";
    
    // Constant-time timing shield
    if (!token || !expectedSecret || !timingSafeEqualStrings(token, expectedSecret)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    return Response.json({ success: true, message: "Report accepted" });
}
```

## 3. Midnight Freeze Guard
**Files**: `src/constants/security.ts`, `src/worker/router_handler.ts`

### Motivation
During critical incidents or maintenance windows, the platform must enter a "Midnight Freeze" state that blocks all traffic with a `503 Service Unavailable`.

### Design
Implement a middleware check that runs early in the request lifecycle in `RouterHandler.handle` reading a configuration flag from `WorkerEnv`.

**Signatures**:
```typescript
// src/worker/router_handler.ts
public async handle(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    injectedAuth?: AuthenticatedContext
): Promise<Response> {
    if (env.MIDNIGHT_FREEZE === "true" || env.MIDNIGHT_FREEZE === "1") {
        return new Response(
            JSON.stringify({
                error: {
                    message: "Service is temporarily unavailable due to a scheduled or emergency maintenance freeze (Midnight Freeze).",
                    type: "service_unavailable",
                    code: "MIDNIGHT_FREEZE",
                    statusCode: 503
                }
            }),
            {
                status: 503,
                headers: { "content-type": "application/json; charset=utf-8" }
            }
        );
    }
    // ... existing logic
}
```
