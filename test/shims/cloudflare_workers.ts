/**
 * Node-environment stand-in for the `cloudflare:workers` module, used only by the root
 * (non-Workers) Vitest config. The Workers pool and production use the real runtime module.
 */
export class DurableObject<Env = unknown> {
  protected readonly ctx: DurableObjectState;
  protected readonly env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
