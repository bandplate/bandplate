// Dev-only mailer: logs instead of sending. Never construct this directly —
// go through `createDevMailer` in `factory.ts`, which refuses it unless the
// caller explicitly opts into a dev-unsafe mailer.
import type { Mailer, SendLoginLinkOptions } from "@bandlib/core";

export function createConsoleMailer(): Mailer {
  return {
    async sendLoginLink(to: string, url: string, opts?: SendLoginLinkOptions): Promise<void> {
      console.log(`[mail:console] login link for ${to}: ${url}`, opts ?? {});
    },
    async send(msg): Promise<void> {
      console.log(
        `[mail:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text}`,
      );
    },
  };
}
