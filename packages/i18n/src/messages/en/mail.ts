// The words bandplate SENDS.
//
// Narrower than a web page and the constraints are not negotiable — no
// stylesheet, no web font, images blocked by default. See
// `packages/core/src/mail-messages.ts` for the full list; what lives here is
// only the text.
//
// The login message is the one that matters most: it is the ONLY way into the
// app, so a member who cannot read it cannot sign in.
export const mail = {
  greeting: (displayName: string): string => `Hi ${displayName},`,
  greetingAnonymous: "Hi,",
  signOff: "— bandplate",
  orPaste: "Or paste this into your browser:",

  // --- the sign-in link ----------------------------------------------------
  loginSubject: "Your sign-in link for bandplate",
  loginLead: (life: string): string => `Here is your link to sign in. ${life}`,
  loginLife: (minutes: number): string =>
    `It works once, and only for the next ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
  loginLifeNoExpiry: "It works once.",
  loginButton: "Sign in to bandplate",
  /**
   * Why this arrived. Deliberately does not confirm anything about the
   * address — the same reason `/login` answers identically whether or not an
   * address is on the whitelist.
   */
  loginFooter:
    "You are getting this because someone entered this address on the bandplate sign-in page. If that was not you, ignore it — nobody can sign in without the link.",

  // --- the invitation ------------------------------------------------------
  inviteSubject: "You've been added to bandplate",
  inviteWhat: "You've been added to bandplate — your band's rehearsal and recording archive.",
  inviteHow: (address: string): string =>
    `There's no password to set up. Go to the sign-in page, enter this address (${address}), and we'll email you a link that signs you in.`,
  inviteButton: "Go to the sign-in page",
  inviteFooter:
    "An admin of your band added this address. If you were not expecting it, you can ignore this message.",

  // --- the setup self-test -------------------------------------------------
  setupSubject: "bandplate is set up",
  setupWhat:
    "Mail is working. That was the last thing standing between your band and their archive — everyone signs in by a link sent to this address, so nothing else works without it.",
  setupNext:
    "Add your bandmates from the admin area, and they'll each get an invite like this one.",
  setupButton: "Open bandplate",
  setupFooter: "You are getting this because you just set up this bandplate deployment.",
};
