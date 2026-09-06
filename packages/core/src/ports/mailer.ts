// Mailer port. Implementations (console/null/smtp) live in `@bandlib/mail` —
// this package only declares the shape the domain depends on.

export interface SendLoginLinkOptions {
  /** The member's display name, for a friendlier email body. */
  displayName?: string;
  /** Epoch ms the link expires at, for "this link expires at ..." copy. */
  expiresAt?: number;
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
