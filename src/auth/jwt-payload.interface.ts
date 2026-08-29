export interface JwtPayload {
  sub: string;
  scope?: string;
  tokenVersion?: number;
}
