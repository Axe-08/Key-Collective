// pool-coordinator-03
export class LeakyBucket { 
    constructor(capacity: number, leakRate: number) {}
    public tryConsume(tokens: number): boolean { return true; }
}
