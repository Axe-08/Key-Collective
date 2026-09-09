export interface AuthToken {
    id: string;
    tenantId: string;
    tokenHash: string;
    createdAt: number;
    expiresAt: number | null;
}

export interface AuthContext {
    tenantId: string;
    isAuthenticated: boolean;
}

export interface AuthContract {
    verifyToken(bearerToken: string): Promise<AuthContext>;
}
