// Selects a dev-safe Mailer implementation from config. Deliberately does
// NOT know about "smtp" — the app has no non-email way in after bootstrap,
// so a mailer that silently discards login links would lock a real
// deployment out, and `console`/`null` must never be reachable without an
// explicit opt-in. The real SMTP mailer lives behind its own entry point
// (`@bandplate/mail/smtp`, see the module doc comment there) precisely so
// this barrel — and this factory — never has to import nodemailer or any
// `node:*` built-in; callers construct it directly instead of through here.
import type { Mailer } from "@bandplate/core";
import { createConsoleMailer } from "./console.js";
import { createNullMailer } from "./null.js";

export type DevMailerKind = "console" | "null";

export interface CreateDevMailerOptions {
  /**
   * Must be explicitly `true` to construct a dev-unsafe mailer. There is no
   * default of `true` anywhere in this function — a missing/undefined
   * value refuses construction, the same as `false`.
   */
  allowDevMailer: boolean;
}

/**
 * Construct a `console` or `null` mailer. Refuses unless
 * `options.allowDevMailer` is `true`. For a real deployment, construct
 * `createSmtpMailer` from `@bandplate/mail/smtp` directly instead of calling
 * this factory.
 */
export function createDevMailer(kind: DevMailerKind, options: CreateDevMailerOptions): Mailer {
  if (options.allowDevMailer !== true) {
    throw new Error(
      `Refusing to construct the "${kind}" mailer without allowDevMailer: true. The app has no non-email way in after bootstrap, so a mailer that discards login links would lock a real deployment out. Only pass allowDevMailer: true for local development.`,
    );
  }

  switch (kind) {
    case "console":
      return createConsoleMailer();
    case "null":
      return createNullMailer();
  }
}
