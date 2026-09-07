// Tests-only mailer: discards everything. Never construct this directly —
// go through `createDevMailer` in `factory.ts`, which refuses it unless the
// caller explicitly opts into a dev-unsafe mailer. Prefer the capturing
// mailer (`capturing.ts`) in tests that need to assert on what was sent.
import type { Mailer } from "@bandplate/core";

export function createNullMailer(): Mailer {
  return {
    async sendLoginLink(): Promise<void> {},
    async send(): Promise<void> {},
  };
}
