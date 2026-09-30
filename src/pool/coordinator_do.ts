import type { WorkerEnv } from "../worker/auth/index";
import { Clock, systemClock } from "../utils/clock";

export class PoolCoordinatorDO implements DurableObject {
    private tenantVolumes = new Map<string, { volume: number; timestamp: number }[]>();
    private activeBrakes = new Map<string, number>();
    private providers = new Map<string, { activeKeys: number; quarantineKeys: number; latencyMs: number; wProvider: number }>();

    private initializedPromise: Promise<void> | null = null;
    private clock: Clock = systemClock;

    constructor(
        private readonly ctx: DurableObjectState,
        private readonly env: WorkerEnv = {}
    ) {
        this.initializedPromise = this.initStorage();
        if (this.ctx.storage?.getAlarm) {
            this.ctx.storage.getAlarm().then((alarm: number | null) => {
                if (!alarm) {
                    this.scheduleNextAlarm();
                }
            });
        }
    }

    private async initStorage() {
        if (!this.ctx.storage) return;
        try {
            const storedBrakes = await this.ctx.storage.get("activeBrakes");
            if (storedBrakes && typeof storedBrakes === "object") {
                this.activeBrakes = new Map(Object.entries(storedBrakes));
            }
            const storedProviders = await this.ctx.storage.get("providers");
            if (storedProviders && typeof storedProviders === "object") {
                this.providers = new Map(Object.entries(storedProviders));
            }
        } catch {
            // storage error fallback to in-memory
        }
    }

    private async scheduleNextAlarm() {
        if (!this.ctx.storage?.setAlarm) return;
        await this.ctx.storage.setAlarm(this.clock.now() + 60_000);
    }

    public async alarm(): Promise<void> {
        await this.initializedPromise;
        const now = this.clock.now();
        let brakesChanged = false;
        
        // clean expired brakes
        for (const [tenant, expiry] of this.activeBrakes.entries()) {
            if (now > expiry) {
                this.activeBrakes.delete(tenant);
                brakesChanged = true;
            }
        }

        if (brakesChanged && this.ctx.storage?.put) {
            await this.ctx.storage.put("activeBrakes", Object.fromEntries(this.activeBrakes));
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

        if (url.pathname === "/__test__/clock") {
            if (req.method === "POST") {
                const body = (await req.json().catch(() => ({}))) as { ms?: number };
                this.setClockForTest(Number(body.ms));
                return Response.json({ now: this.clock.now() });
            }
            return Response.json({ now: this.clock.now() });
        }

        if (req.method === "GET" && url.pathname === "/coordinator/health") {
            const data: Record<string, any> = {};
            for (const [provider, stats] of this.providers.entries()) {
                data[provider] = stats;
            }
            return Response.json(data);
        }

        if (req.method === "POST" && url.pathname === "/coordinator/report-volume") {
            const body = await req.json() as { tenantId: string; volume: number };
            const now = this.clock.now();
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
                if (this.ctx.storage?.put) {
                    await this.ctx.storage.put("activeBrakes", Object.fromEntries(this.activeBrakes));
                }
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

            if (this.ctx.storage?.put) {
                await this.ctx.storage.put("providers", Object.fromEntries(this.providers));
            }

            return Response.json({ success: true, wProvider });
        }

        if (req.method === "GET" && url.pathname.startsWith("/coordinator/brake-status/")) {
            const parts = url.pathname.split("/");
            const tenantId = parts[parts.length - 1];
            const expiry = this.activeBrakes.get(tenantId);
            const braked = expiry ? this.clock.now() < expiry : false;
            return Response.json({ braked });
        }

        return new Response("Not Found", { status: 404 });
    }

    /**
     * Public RPC accessor for the DO's current clock timestamp.
     */
    public getNow(): number {
        return this.clock.now();
    }

    /**
     * Test-only RPC: switches this DO to a fixed clock. Throws outside the
     * test environment (env.KC_ENV !== "test").
     */
    public setClockForTest(ms: number): void {
        const envRecord = this.env as unknown as { KC_ENV?: string } | undefined;
        if (envRecord?.KC_ENV !== "test") {
            throw new Error("setClockForTest is only available when KC_ENV=test");
        }
        this.clock = { now: () => ms };
    }
}
