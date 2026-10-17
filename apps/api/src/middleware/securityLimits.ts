import type { RequestHandler } from "express";
import { verificationStore } from "../auth/verificationRepository.js";

export type RateConsumer = (
  key: string,
  maximum: number,
  windowMs: number,
  now: Date
) => Promise<void>;
export const durableLimit: RateConsumer = (...args) => verificationStore.consume(...args);
export function securityLimit(
  scope: string,
  maximum: number,
  windowMs: number,
  consume: RateConsumer = durableLimit,
  identity?: (body: Record<string, unknown>) => string | null
): RequestHandler {
  return async (req, res, next) => {
    try {
      if (req.method === "OPTIONS") return next();
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      await consume(
        `${scope}:ip:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`,
        maximum,
        windowMs,
        new Date()
      );
      const account = identity?.(req.body && typeof req.body === "object" ? req.body : {});
      if (account)
        await consume(
          `${scope}:account:${account}`,
          Math.max(5, Math.floor(maximum / 3)),
          windowMs,
          new Date()
        );
      res.removeHeader("Retry-After");
      next();
    } catch (error) {
      next(error);
    }
  };
}
