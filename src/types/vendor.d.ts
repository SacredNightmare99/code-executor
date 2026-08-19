declare module "express" {
  import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http";
  import type { Server } from "net";

  export type ParamsDictionary = Record<string, string>;
  export type QueryDictionary = Record<string, string | undefined>;
  export type RequestBody = Record<string, any>;

  export interface Request<
    Params = ParamsDictionary,
    _ResBody = unknown,
    ReqBody = RequestBody,
    ReqQuery = QueryDictionary,
  > extends IncomingMessage {
    params: Params;
    body: ReqBody;
    query: ReqQuery;
    headers: IncomingHttpHeaders;
    ip?: string;
    originalUrl: string;
    path: string;
    requestId?: string;
    user: {
      id: string;
      username: string;
      email?: string;
      tier?: string;
      rateLimit?: number;
      role?: "admin" | "user";
      authMethod?: "jwt" | "apikey";
    };
    apiKey?: string;
    get(name: string): string | undefined;
    header(name: string): string | undefined;
  }

  export interface Response<ResBody = unknown> extends ServerResponse {
    status(code: number): this;
    json(body: ResBody): this;
    send(body?: unknown): this;
    type(contentType: string): this;
    set(field: string, value: string): this;
    set(fields: Record<string, string>): this;
    header(field: string, value: string): this;
  }

  export type NextFunction = (err?: unknown) => void;
  export type RequestHandler = (req: Request, res: Response, next: NextFunction) => unknown;
  export type ErrorRequestHandler = (
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction
  ) => unknown;

  export interface Router {
    use(...handlers: Array<string | RequestHandler | ErrorRequestHandler | Router>): this;
    get(path: string, ...handlers: RequestHandler[]): this;
    post(path: string, ...handlers: RequestHandler[]): this;
    put(path: string, ...handlers: RequestHandler[]): this;
    patch(path: string, ...handlers: RequestHandler[]): this;
    delete(path: string, ...handlers: RequestHandler[]): this;
  }

  export interface Express extends Router {
    listen(port: number, hostname: string, callback?: () => void): Server;
    listen(port: number, callback?: () => void): Server;
  }

  interface ExpressFactory {
    (): Express;
    Router(): Router;
    json(options?: { limit?: string | number }): RequestHandler;
  }

  const express: ExpressFactory;
  export default express;
}

declare module "cors" {
  import type { RequestHandler } from "express";

  export interface CorsOptions {
    origin?: boolean | string | string[];
    methods?: string[];
    allowedHeaders?: string[];
    credentials?: boolean;
  }

  export default function cors(options?: CorsOptions): RequestHandler;
}

declare module "bcryptjs" {
  export function hash(data: string, saltOrRounds: string | number): Promise<string>;
  export function compare(data: string, encrypted: string): Promise<boolean>;

  const bcrypt: {
    hash: typeof hash;
    compare: typeof compare;
  };

  export default bcrypt;
}

declare module "jsonwebtoken" {
  export interface JwtPayload {
    [key: string]: unknown;
    exp?: number;
    iat?: number;
    sub?: string;
  }

  export interface SignOptions {
    expiresIn?: string | number;
  }

  export type Secret = string | Buffer;
  export type VerifyResult = string | JwtPayload;
  export type DecodeResult = null | string | JwtPayload;

  export function sign(payload: string | Buffer | object, secret: Secret, options?: SignOptions): string;
  export function verify(token: string, secret: Secret): VerifyResult;
  export function decode(token: string): DecodeResult;

  const jwt: {
    sign: typeof sign;
    verify: typeof verify;
    decode: typeof decode;
  };

  export default jwt;
}

declare module "k6/http" {
  export interface RefinedResponse<ResponseType = "text"> {
    status: number;
    body: ResponseType extends "none" ? null : string;
    json<T = unknown>(): T;
  }

  export interface RequestParams {
    headers?: Record<string, string>;
    timeout?: string;
  }

  export function get(url: string, params?: RequestParams): RefinedResponse;
  export function post(url: string, body?: string, params?: RequestParams): RefinedResponse;
}

declare module "k6" {
  export function check<T>(
    value: T,
    sets: Record<string, (value: T) => boolean>
  ): boolean;
  export function sleep(seconds: number): void;
}

declare const __ENV: Record<string, string | undefined>;

interface Body {
  json(): Promise<any>;
}

interface Response {
  json(): Promise<any>;
}
