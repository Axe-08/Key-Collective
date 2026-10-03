export interface RouteRequest {
    modelAlias: string;
    messages: unknown[];
    stream: boolean;
}

export interface RouteResponse {
    content: string;
    costCu: bigint;
}

export interface RouterContract {
    route(request: RouteRequest): Promise<RouteResponse>;
}
