export interface DurableObjectState {
    storage: any;
}
export interface DurableObject {
    fetch(req: Request): Promise<Response>;
    alarm(): Promise<void>;
}

export class PoolCoordinatorDO implements DurableObject {
    private tenantVolumes = new Map<string, { volume: number; timestamp: number }[]>();
    private activeBrakes = new Map<string, number>();
    private providers = new Map<string, { activeKeys: number; quarantineKeys: number; latencyMs: number; wProvider: number }>();

    constructor(private readonly ctx: DurableObjectState) {
        this.ctx.storage.getAlarm().then((alarm: number | null) => {
            if (!alarm) {
                this.scheduleNextAlarm();
            }
        });
    }

    private async scheduleNextAlarm() {
        const now = Date.now();
        // schedule next midnight alarm with random jitter (0-300s)
        const tomorrow = new Date(now);
        tomorrow.setUTCHours(24, 0, 0, 0); // next midnight
        const jitter = Math.floor(Math.random() * 300_000);
        await this.ctx.storage.setAlarm(tomorrow.getTime() + jitter);
    }

    public async alarm(): Promise<void> {
        const now = Date.now();
        
        // clean expired brakes
        for (const [tenant, expiry] of this.activeBrakes.entries()) {
            if (now > expiry) {
                this.activeBrakes.delete(tenant);
            }
        }

        // clean expired 5-minute volumes
        const cutoff = now - 5 * 60 * 1000;
        for (const [tenant, vols] of this.tenantVolumes.entries()) {
            const fresh = vols.filter(v => v.timestamp > cutoff);
            if (fresh.length === 0) {
                this.tenantVolumes.delete(tenant);
            } else {
                this.tenantVolumes.set(tenant, fresh);
            }
        }

        await this.scheduleNextAlarm();
    }

    public async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);

        if (req.method === "GET" && url.pathname === "/coordinator/health") {
            const data: Record<string, any> = {};
            for (const [provider, stats] of this.providers.entries()) {
                data[provider] = stats;
            }
            return Response.json(data);
        }

        if (req.method === "POST" && url.pathname === "/coordinator/report-volume") {
            const body = await req.json() as { tenantId: string; volume: number };
            const now = Date.now();
            const cutoff = now - 5 * 60 * 1000;

            let vols = this.tenantVolumes.get(body.tenantId) || [];
            vols.push({ volume: body.volume, timestamp: now });
            vols = vols.filter(v => v.timestamp > cutoff);
            this.tenantVolumes.set(body.tenantId, vols);

            let tenantTotal = vols.reduce((sum, v) => sum + v.volume, 0);
            
            let poolTotal = 0;
            for (const [t, tvols] of this.tenantVolumes.entries()) {
                const tvolsFresh = tvols.filter(v => v.timestamp > cutoff);
                poolTotal += tvolsFresh.reduce((sum, v) => sum + v.volume, 0);
                this.tenantVolumes.set(t, tvolsFresh); // cleanup inline to be safe
            }

            let brakeApplied = false;
            // >35% of total pool volume in 5 min -> 60s emergency brake
            if (poolTotal > 0 && tenantTotal > 0.35 * poolTotal) {
                this.activeBrakes.set(body.tenantId, now + 60 * 1000);
                brakeApplied = true;
            }

            return Response.json({ brakeApplied });
        }

        if (req.method === "POST" && url.pathname === "/coordinator/update-provider") {
            const body = await req.json() as { provider: string; activeKeys: number; quarantineKeys: number; latencyMs: number };
            const total = body.activeKeys + body.quarantineKeys;
            let wProvider = 1.0;
            if (total > 0) {
                const ratio = body.activeKeys / total;
                wProvider = ratio * (1000 / (body.latencyMs || 1000));
            }

            this.providers.set(body.provider, {
                activeKeys: body.activeKeys,
                quarantineKeys: body.quarantineKeys,
                latencyMs: body.latencyMs,
                wProvider
            });

            return Response.json({ success: true, wProvider });
        }

        if (req.method === "GET" && url.pathname.startsWith("/coordinator/brake-status/")) {
            const parts = url.pathname.split("/");
            const tenantId = parts[parts.length - 1];
            const expiry = this.activeBrakes.get(tenantId);
            const braked = expiry ? Date.now() < expiry : false;
            return Response.json({ braked });
        }

        return new Response("Not Found", { status: 404 });
    }
}
