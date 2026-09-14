// Throwaway: renders every outbound message, in both languages, to one HTML
// page so the whole set can be proofread at once. Not a test — it asserts
// nothing; it exists because these three builders are the only way to see
// what an email actually says.
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import {
  buildInviteMessage,
  buildLoginLinkMessage,
  buildSetupTestMessage,
} from "./mail-messages.js";

const OUT = process.env.MAIL_PREVIEW_OUT;
const ORIGIN = "https://bandplate.example";

const CASES = [
  {
    group: "Invitation",
    note: "What a brand-new member gets. The only message that names its sender.",
    variants: [
      {
        label: "with a named sender",
        build: (locale: "cs" | "en") =>
          buildInviteMessage({
            locale,
            to: "sam@example.com",
            displayName: "Sam",
            signInUrl: `${ORIGIN}/login?email=sam%40example.com`,
            invitedBy: "Vařič",
          }),
      },
      {
        label: "no sender to name (a script, or a caller with no acting admin)",
        build: (locale: "cs" | "en") =>
          buildInviteMessage({
            locale,
            to: "sam@example.com",
            displayName: "Sam",
            signInUrl: `${ORIGIN}/login?email=sam%40example.com`,
          }),
      },
    ],
  },
  {
    group: "Sign-in link",
    note: "Every sign-in, forever — the most-read message the app sends.",
    variants: [
      {
        label: "a member we can greet by name",
        build: (locale: "cs" | "en") =>
          buildLoginLinkMessage({
            locale,
            to: "sam@example.com",
            displayName: "Sam",
            url: `${ORIGIN}/login/tok-abc123`,
            expiresInMinutes: 15,
          }),
      },
      {
        label: "no display name yet",
        build: (locale: "cs" | "en") =>
          buildLoginLinkMessage({
            locale,
            to: "sam@example.com",
            url: `${ORIGIN}/login/tok-abc123`,
            expiresInMinutes: 15,
          }),
      },
    ],
  },
  {
    group: "Setup self-test",
    note: "Sent once, to the first admin, to prove outbound mail works at all.",
    variants: [
      {
        label: "normal",
        build: (locale: "cs" | "en") =>
          buildSetupTestMessage({ locale, to: "op@example.com", appOrigin: ORIGIN }),
      },
    ],
  },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

it("renders the mail preview", () => {
  if (!OUT) return;
  let body = "";
  for (const c of CASES) {
    body += `<section><h2>${esc(c.group)}</h2><p class="note">${esc(c.note)}</p>`;
    for (const v of c.variants) {
      body += `<h3>${esc(v.label)}</h3><div class="pair">`;
      for (const [loc, locName] of [
        ["cs", "Čeština"],
        ["en", "English"],
      ] as const) {
        const m = v.build(loc);
        body += `<article>
  <div class="lang">${esc(locName)}</div>
  <div class="subject"><span class="k">Subject</span> ${esc(m.subject)}</div>
  <div class="rendered">${m.html ?? ""}</div>
  <details><summary>Plain text</summary><pre>${esc(m.text)}</pre></details>
</article>`;
      }
      body += "</div>";
    }
    body += "</section>";
  }
  writeFileSync(OUT, body, "utf8");
});
