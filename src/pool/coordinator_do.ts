// pool-coordinator-02
export interface DurableObjectState {}
export interface DurableObject {}
export class PoolCoordinatorDO implements DurableObject { 
    constructor(private readonly ctx: DurableObjectState) {} 
    public async alarm(): Promise<void> {}
    public async fetch(req: Request): Promise<Response> { return new Response("OK"); }
}
