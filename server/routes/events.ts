import { Hono } from "@hono/hono";
import { eventBus } from "../events/eventBus.ts";

export function createEventRoutes(): Hono {
  const events = new Hono();

  events.get("/recent", (c) => {
    return c.json({
      ok: true,
      events: eventBus.recent(),
    });
  });

  events.get("/stream", (c) => {
    return new Response(eventBus.stream(c.req.raw.signal), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });

  return events;
}
