// Test mailer that records every send instead of doing anything with it.
// Used by this package's own tests, and by Task 4's E2E suite and the API
// package's route tests to assert on exactly what would have been sent.
import type { Mailer, MailMessage, SendLoginLinkOptions } from "@bandplate/core";

export interface CapturedLoginLink {
  kind: "login-link";
  to: string;
  url: string;
  opts?: SendLoginLinkOptions;
}

export interface CapturedMessage extends MailMessage {
  kind: "message";
}

export type CapturedMail = CapturedLoginLink | CapturedMessage;

export interface CapturingMailer extends Mailer {
  readonly sent: readonly CapturedMail[];
  clear(): void;
}

export function createCapturingMailer(): CapturingMailer {
  const sent: CapturedMail[] = [];

  return {
    sent,
    async sendLoginLink(to, url, opts) {
      sent.push({ kind: "login-link", to, url, opts });
    },
    async send(msg: MailMessage) {
      sent.push({ kind: "message", ...msg });
    },
    clear() {
      sent.length = 0;
    },
  };
}
