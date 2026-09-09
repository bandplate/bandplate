// SMTP mailer — the ONLY module in this package (and per the task-3 brief,
// in the whole `packages/core`/`packages/db`/`packages/api`/`packages/mail`
// surface) allowed to touch Node built-ins, via nodemailer.
//
// This lives at its own subpath export (`@bandplate/mail/smtp`), separate
// from the package barrel (`@bandplate/mail`, `./index.ts`). `./index.ts`
// never imports this file, in either direction, so importing the barrel
// from Workers-bound code can never pull nodemailer or `node:*` into the
// bundle. Callers who need real SMTP (the Node container profile) import
// this subpath directly and pass the resulting `Mailer` into `AppDeps`
// themselves — there is no generic factory that can reach this module,
// by design (see `factory.ts`).
import { type Mailer, buildLoginLinkMessage } from "@bandplate/core";
import nodemailer from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
  /** The `From:` address used for every outgoing message. */
  from: string;
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
      // The words live in `@bandplate/core`'s `buildLoginLinkMessage`. This
      // used to build subject, text and html here — and the HTTP mailer built
      // the same three strings again, with nothing keeping the two in step.
      // A transport decides how a message goes on the wire, not what it says.
      const msg = buildLoginLinkMessage({
        to,
        url,
        displayName: opts?.displayName,
        expiresInMinutes: opts?.expiresInMinutes,
      });
      await transport.sendMail({ from: config.from, ...msg });
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
