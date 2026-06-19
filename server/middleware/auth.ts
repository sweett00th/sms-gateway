import type { Context, Next } from "@hono/hono";
import type { Database } from "../db/index.ts";
import { getSessionTokenFromRequest, getSessionUser } from "../lib/sessions.ts";

export function requireAdmin(db: Database) {
  return async (c: Context, next: Next) => {
    const user = await getSessionUser(db, getSessionTokenFromRequest(c));

    if (!user || user.role !== "admin") {
      return c.json(
        {
          ok: false,
          status: "unauthorized",
          error: "Authentication required",
        },
        401,
      );
    }

    await next();
  };
}
