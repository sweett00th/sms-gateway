import { Hono } from "@hono/hono";
import { type Database, getOverview } from "../db/index.ts";
import { APP_NAME, APP_VERSION, getBuildInfo, getEnvironment } from "../lib/config.ts";

export function createAdminRoutes(db: Database): Hono {
  const admin = new Hono();

  admin.get("/version", (c) => {
    return c.json({
      ok: true,
      app: APP_NAME,
      version: APP_VERSION,
      runtime: "Deno",
      environment: getEnvironment(),
      build: getBuildInfo(),
    });
  });

  admin.get("/admin/overview", (c) => {
    return c.json({
      ok: true,
      app: APP_NAME,
      ...getOverview(db),
    });
  });

  return admin;
}
