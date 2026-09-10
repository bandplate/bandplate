// The words bandplate sends, in one place.
//
// The sign-in message used to be built TWICE — once in the SMTP mailer, once
// in the HTTP one — as two copies of the same strings with nothing keeping
// them in step. A transport should decide how to put a message on the wire,
// not what it says.
//
// --- What email can actually render ---------------------------------------
//
// Narrower than a web page, and the constraints are not negotiable:
//
//  - NO stylesheet. Every rule is an inline `style` attribute; `<style>` in
//    the head is stripped or ignored by enough clients to be useless.
//  - NO web font. Google Fonts never loads, so the app's Zilla Slab and Chivo
//    are unavailable. Georgia is on effectively every machine and reads as the
//    serif the wordmark wants.
//  - NO SVG, and NO `data:` URI in an `<img>`. Gmail strips both — which
//    rules out the app's actual logo, drawn in `currentColor` behind a mask.
//    The mark here is `icon-192.png`, which the app already serves, at the
//    origin taken from the link itself.
//  - IMAGES ARE BLOCKED by default in most clients until the reader allows
//    them. So the mark is decorative (`alt=""`) and the word "bandplate"
//    beside it is TEXT: the identity survives with images off, and a screen
//    reader is not told the name twice.
//  - LIGHT BACKGROUND. A dark email is a rendering minefield — Gmail and
//    Outlook rewrite colours in dark mode by rules nobody controls, and a
//    half-inverted dark message is unreadable rather than merely off-brand.
//    The project's plan already made this call for the sign-in message,
//    because it is the only way into the app.
//
// The text part is the real message and always carries everything the HTML
// does. That is the plan's "plain-text-first" in practice: a client that
// shows only text loses styling, never information.
import { DEFAULT_LOCALE, type Locale, mailMessages } from "@bandplate/i18n";
import type { MailMessage } from "./ports/mailer.js";

/** Escapes the five HTML-significant characters. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const INK = "#1c0f06";
const MUTED = "#6d5947";
const RULE = "#ddd0ba";
/** `--bp-burnt`, the LIGHT theme's accent — this message is always light. */
const ACCENT = "#7a4e05";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * The shell every message shares: the mark, the wordmark, the body, and a
 * footer that says why this arrived.
 *
 * `origin` is taken from the link the message carries rather than from
 * configuration — it is by construction the host the reader is about to
 * visit, so the mark can never point somewhere the app is not.
 */
function shell(origin: string | undefined, bodyHtml: string, footer: string): string {
  const mark = origin
    ? `<img src="${escapeHtml(origin)}/icon-192.png" alt="" width="40" height="40" style="width:40px;height:40px;border-radius:9px;vertical-align:middle;display:inline-block;">`
    : "";
  return [
    `<div style="background:#ffffff;color:${INK};font-family:${SANS};font-size:16px;line-height:1.55;padding:32px 28px;max-width:600px;">`,
    `<p style="margin:0 0 24px;">${mark}<b style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:19px;color:${INK};vertical-align:middle;${mark ? "margin-left:10px;" : ""}">bandplate</b></p>`,
    bodyHtml,
    `<p style="margin:26px 0 0;padding-top:18px;border-top:1px solid ${RULE};font-size:13px;color:${MUTED};">${footer}</p>`,
    "</div>",
  ].join("");
}

function button(href: string, label: string): string {
  return `<p style="margin:0 0 16px;"><a href="${escapeHtml(href)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:6px;font-weight:600;font-size:16px;">${escapeHtml(label)}</a></p>`;
}

function para(text: string): string {
  return `<p style="margin:0 0 16px;">${escapeHtml(text)}</p>`;
}

/**
 * The URL printed under the button.
 *
 * Not optional decoration: a button that does not render — an image-blocking
 * client, a text-only reader, a forwarded message — leaves nothing to click,
 * and this is the only way into the app.
 */
function fallbackUrl(url: string, orPaste: string): string {
  return `<p style="margin:0 0 16px;font-size:13px;color:${MUTED};word-break:break-all;">${escapeHtml(orPaste)}<br>${escapeHtml(url)}</p>`;
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export interface LoginLinkMessageInput {
  /**
   * Which language to write in. Omitted means English.
   *
   * The login mail uses the MEMBER's own setting (the row is already in scope
   * in `requestLogin`); the invite has no recipient locale yet, so it inherits
   * the inviting admin's — which is also what `createMember` writes into the
   * new row, so the two agree; the setup test uses the request's negotiated
   * locale.
   */
  locale?: Locale;
  to: string;
  url: string;
  displayName?: string;
  /**
   * How long the link is good for, in whole minutes — computed by the caller,
   * which has the clock. Previously the body printed `expiresAt` as an ISO
   * timestamp ("2026-09-09T12:49:33.412Z"), which is machine output, in UTC,
   * and which nobody reads.
   */
  expiresInMinutes?: number;
}

export function buildLoginLinkMessage(input: LoginLinkMessageInput): MailMessage {
  const t = mailMessages(input.locale ?? DEFAULT_LOCALE);
  const greeting = input.displayName ? t.greeting(input.displayName) : t.greetingAnonymous;
  const life =
    input.expiresInMinutes && input.expiresInMinutes > 0
      ? t.loginLife(input.expiresInMinutes)
      : t.loginLifeNoExpiry;
  // Said because this address is on a whitelist: an unexpected sign-in mail
  // means somebody typed it into the login form, and saying nothing about that
  // invites a support question.
  const why = t.loginFooter;

  return {
    to: input.to,
    subject: t.loginSubject,
    text: [greeting, "", t.loginLead(life), "", input.url, "", why, "", t.signOff].join("\n"),
    html: shell(
      originOf(input.url),
      [
        para(greeting),
        para(t.loginLead(life)),
        button(input.url, t.loginButton),
        fallbackUrl(input.url, t.orPaste),
      ].join(""),
      escapeHtml(why),
    ),
  };
}

export interface InviteMessageInput {
  /**
   * Which language to write in. Omitted means English.
   *
   * The login mail uses the MEMBER's own setting (the row is already in scope
   * in `requestLogin`); the invite has no recipient locale yet, so it inherits
   * the inviting admin's — which is also what `createMember` writes into the
   * new row, so the two agree; the setup test uses the request's negotiated
   * locale.
   */
  locale?: Locale;
  to: string;
  displayName: string;
  /** Where they sign in — `${appOrigin}/login`. */
  signInUrl: string;
}

export function buildInviteMessage(input: InviteMessageInput): MailMessage {
  const t = mailMessages(input.locale ?? DEFAULT_LOCALE);
  const greeting = t.greeting(input.displayName);
  const what = t.inviteWhat;
  const how = t.inviteHow(input.to);

  return {
    to: input.to,
    subject: t.inviteSubject,
    text: [greeting, "", what, "", how, "", input.signInUrl, "", t.signOff].join("\n"),
    html: shell(
      originOf(input.signInUrl),
      [para(greeting), para(what), para(how), button(input.signInUrl, t.inviteButton)].join(""),
      t.inviteFooter,
    ),
  };
}

export interface SetupTestMessageInput {
  /**
   * Which language to write in. Omitted means English.
   *
   * The login mail uses the MEMBER's own setting (the row is already in scope
   * in `requestLogin`); the invite has no recipient locale yet, so it inherits
   * the inviting admin's — which is also what `createMember` writes into the
   * new row, so the two agree; the setup test uses the request's negotiated
   * locale.
   */
  locale?: Locale;
  to: string;
  /**
   * The app's own origin, so the message can point at the deployment it came
   * from. The only message that has to be TOLD its origin — the other two
   * carry a link and take it from that.
   *
   * Optional: a deployment that never set `BANDPLATE_APP_ORIGIN` still gets
   * the confirmation, minus the button and the mark. Losing the proof that
   * mail works because a cosmetic env var is missing would be the wrong
   * trade for the one message whose whole job is to prove mail works.
   */
  appOrigin?: string;
}

/**
 * The first thing a new deployer ever sees from their own install — and the
 * proof that outbound mail works, which is the one thing that has to be true
 * before anyone can sign in.
 */
export function buildSetupTestMessage(input: SetupTestMessageInput): MailMessage {
  const t = mailMessages(input.locale ?? DEFAULT_LOCALE);
  const what = t.setupWhat;
  const next = t.setupNext;
  const origin = input.appOrigin ? originOf(input.appOrigin) : undefined;

  return {
    to: input.to,
    subject: t.setupSubject,
    text: [what, "", next, ...(origin ? ["", origin] : []), "", t.signOff].join("\n"),
    html: shell(
      origin,
      [para(what), para(next), ...(origin ? [button(origin, t.setupButton)] : [])].join(""),
      t.setupFooter,
    ),
  };
}
