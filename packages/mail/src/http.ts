// http-api mailer — the mailer for the Cloudflare Workers profile
// (increment 7). Workers has no TCP sockets, so `smtp.ts`'s nodemailer
// transport cannot run there at all; this module talks to the provider
// over plain `fetch`, which is exactly what both profiles already use for
// object storage (`@bandplate/storage`'s `S3Storage`, via `aws4fetch`), so
// it needs nothing Workers-specific and runs unmodified under the
// container profile too.
//
// Unlike `smtp.ts`, this module is exported from the package barrel
// (`./index.ts`) — it is Workers-safe by construction: no `node:*`
// built-ins, no `nodemailer`, `fetch`/`Headers`/`Response` only. See
// `barrel-is-workers-safe.test.ts`, which proves this by bundling.
//
// The app has no non-email way in after bootstrap (see `factory.ts`'s doc
// comment): a Workers deploy with a broken mailer is a lockout exactly like
// a Node deploy with a broken SMTP config, so this fails the *send* loudly
// (throws) rather than swallowing a non-2xx provider response.
import type { Mailer, SendLoginLinkOptions } from "@bandplate/core";
import { buildLoginLinkMessage } from "@bandplate/core";

export type HttpMailProvider = "resend" | "postmark";

export interface HttpMailerConfig {
  provider: HttpMailProvider;
  /** The provider API key / server token. */
  apiKey: string;
  /** The `From:` address used for every outgoing message. */
  from: string;
  /**
   * Overrides the provider's API base URL. Tests point this at a local
   * fake HTTP server instead of the real provider; production leaves it
   * unset and gets the provider's real endpoint.
   */
  baseUrl?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface ProviderAdapter {
  endpoint(baseUrl: string | undefined): string;
  headers(apiKey: string): Record<string, string>;
  body(from: string, msg: { to: string; subject: string; text: string; html?: string }): unknown;
}

const RESEND: ProviderAdapter = {
  endpoint: (baseUrl) => `${baseUrl ?? "https://api.resend.com"}/emails`,
  headers: (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  }),
  body: (from, msg) => ({
    from,
    to: [msg.to],
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  }),
};

const POSTMARK: ProviderAdapter = {
  endpoint: (baseUrl) => `${baseUrl ?? "https://api.postmarkapp.com"}/email`,
  headers: (apiKey) => ({
    "X-Postmark-Server-Token": apiKey,
    Accept: "application/json",
    "content-type": "application/json",
  }),
  body: (from, msg) => ({
    From: from,
    To: msg.to,
    Subject: msg.subject,
    TextBody: msg.text,
    HtmlBody: msg.html,
    MessageStream: "outbound",
  }),
};

function adapterFor(provider: HttpMailProvider): ProviderAdapter {
  switch (provider) {
    case "resend":
      return RESEND;
    case "postmark":
      return POSTMARK;
  }
}

export function createHttpMailer(config: HttpMailerConfig): Mailer {
  const adapter = adapterFor(config.provider);
  const doFetch = config.fetchImpl ?? fetch;

  async function sendMessage(msg: { to: string; subject: string; text: string; html?: string }) {
    const res = await doFetch(adapter.endpoint(config.baseUrl), {
      method: "POST",
      headers: adapter.headers(config.apiKey),
      body: JSON.stringify(adapter.body(config.from, msg)),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<unreadable body>");
      throw new Error(
        `HttpMailer(${config.provider}): send to ${msg.to} failed: ${res.status} ${res.statusText} — ${body}`,
      );
    }
  }

  return {
    async sendLoginLink(to, url, opts?: SendLoginLinkOptions): Promise<void> {
      // Same builder the SMTP mailer uses — see its note. These two used to
      // hold separate copies of the same three strings.
      await sendMessage(
        buildLoginLinkMessage({
          locale: opts?.locale,
          to,
          url,
          displayName: opts?.displayName,
          expiresInMinutes: opts?.expiresInMinutes,
        }),
      );
    },
    async send(msg): Promise<void> {
      await sendMessage(msg);
    },
  };
}
