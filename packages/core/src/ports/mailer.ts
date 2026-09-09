// Mailer port. Implementations (console/null/smtp) live in `@bandplate/mail` —
// this package only declares the shape the domain depends on.

export interface SendLoginLinkOptions {
  /** The member's display name, for a friendlier email body. */
  displayName?: string;
  /**
   * How long the link is good for, in whole minutes. The CALLER computes it,
   * because the caller has the clock (`deps.clock`) and a mailer does not.
   *
   * This replaced an `expiresAt` epoch, which every mailer then rendered as
   * an ISO timestamp — "This link expires at 2026-09-09T12:49:33.412Z", in
   * UTC, which nobody reads.
   */
  expiresInMinutes?: number;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  /** Send a login-link email. The URL is fully formed by the caller. */
  sendLoginLink(to: string, url: string, opts?: SendLoginLinkOptions): Promise<void>;
  /** Send an arbitrary message (used for the bootstrap test email). */
  send(msg: MailMessage): Promise<void>;
}
