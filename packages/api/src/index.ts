import { Hono } from "hono";

/**
 * Dependencies injected into the API app. Kept minimal for now — later
 * increments will add repositories, storage, and mail ports from
 * @bandlib/core here.
 */
// biome-ignore lint/suspicious/noEmptyInterface: placeholder, grows in later increments
export interface AppDeps {}

export function createApp(_deps: AppDeps = {}): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  return app;
}
