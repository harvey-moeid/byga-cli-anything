export interface D1PreparedStatement {bind(...values:unknown[]):D1PreparedStatement;first<T=unknown>():Promise<T|null>;all<T=unknown>():Promise<{results:T[]}>;run():Promise<unknown>;}
export interface D1Database {prepare(sql:string):D1PreparedStatement;}
export interface Env {DB:D1Database;GITHUB_TOKEN:string;JOB_CALLBACK_SECRET:string;GITHUB_OWNER:string;GITHUB_REPO:string;ACCESS_TEAM_DOMAIN:string;ACCESS_AUD:string;ACCESS_JWKS_URL?:string;APP_ORIGIN:string;}
