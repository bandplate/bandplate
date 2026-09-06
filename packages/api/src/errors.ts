import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Structured error body — never raw exception text. */
export function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
): Response {
  return c.json({ error: { code, message } }, status);
}
