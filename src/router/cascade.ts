// pool-coordinator-01
export interface AppContext {
    env: { KEY_POOL: unknown };
}
export async function routeRequest(req: Request, ctx: AppContext): Promise<Response> {
    return new Response("DemoDO", { status: 401 });
}
