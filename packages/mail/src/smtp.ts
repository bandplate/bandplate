// SMTP mailer — the ONLY module in this package (and per the task-3 brief,
// in the whole `packages/core`/`packages/db`/`packages/api`/`packages/mail`
// surface) allowed to touch Node built-ins, via nodemailer.
//
// This lives at its own subpath export (`@bandlib/mail/smtp`), separate
// from the package barrel (`@bandlib/mail`, `./index.ts`). `./index.ts`
// never imports this file, in either direction, so importing the barrel
// from Workers-bound code can never pull nodemailer or `node:*` into the
// bundle. Callers who need real SMTP (the Node container profile) import
// this subpath directly and pass the resulting `Mailer` into `AppDeps`
// themselves — there is no generic factory that can reach this module,
// by design (see `factory.ts`).
import type { Mailer } from "@bandlib/core";
import nodemailer from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
  /** The `From:` address used for every outgoing message. */
  from: string;
}

/** Escapes the five HTML-significant characters. Used before interpolating
 * any caller-supplied string (display name, URL) into the HTML body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createSmtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure ?? false,
    auth: config.auth,
  });

  return {
    async sendLoginLink(to, url, opts) {
      const expiresLine = opts?.expiresAt
        ? ` This link expires at ${new Date(opts.expiresAt).toISOString()}.`
        : "";
      const greeting = opts?.displayName ? `Hi ${opts.displayName},\n\n` : "";
      // `displayName` is admin-set and `url` is server-built (from a
      // generated token), so this is low severity either way — but both
      // are escaped before landing in the HTML body regardless, since
      // neither is a compile-time constant.
      const safeUrl = escapeHtml(url);
      const safeGreeting = opts?.displayName ? `Hi ${escapeHtml(opts.displayName)},<br><br>` : "";
      const safeExpiresLine = opts?.expiresAt
        ? ` This link expires at ${escapeHtml(new Date(opts.expiresAt).toISOString())}.`
        : "";
      await transport.sendMail({
        from: config.from,
        to,
        subject: "Your bandlib login link",
        text: `${greeting}Use this link to sign in:\n${url}\n${expiresLine}`,
        html: `<p>${safeGreeting}Use this link to sign in: <a href="${safeUrl}">${safeUrl}</a>${safeExpiresLine}</p>`,
      });
    },
    async send(msg) {
      await transport.sendMail({
        from: config.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
    },
  };
}
