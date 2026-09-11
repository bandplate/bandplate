// The words bandplate SENDS.
//
// Narrower than a web page and the constraints are not negotiable — no
// stylesheet, no web font, images blocked by default. See
// `packages/core/src/mail-messages.ts` for the full list; what lives here is
// only the text.
//
// The login message is the one that matters most: it is the ONLY way into the
// app, so a member who cannot read it cannot sign in.
//
// These are SHORT on purpose. A transactional mail is read in two seconds on
// a phone, and every sentence that is not the greeting, the one fact, or the
// button is a sentence between the reader and the thing they came for. The
// small print below the rule is the exception — it says why the mail arrived,
// which the body no longer has to.
export const mail = {
  greeting: (displayName: string): string => `Hi ${displayName},`,
  greetingAnonymous: "Hi,",
  orPaste: "Or open this address in your browser:",

  // --- the sign-in link ----------------------------------------------------
  loginSubject: "Your sign-in link for bandplate",
  loginLead: (life: string): string => `Here is your link to sign in. ${life}`,
  loginLife: (minutes: number): string =>
    `It works once and lasts ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
  loginLifeNoExpiry: "It works once.",
  loginButton: "Sign in to bandplate",
  /**
   * Why this arrived. Deliberately does not confirm anything about the
   * address — the same reason `/login` answers identically whether or not an
   * address is on the whitelist.
   */
  loginFooter:
    "Someone entered this address on the bandplate sign-in page. If that was not you, ignore this — nobody can sign in without the link.",

  // --- the invitation ------------------------------------------------------
  /**
   * Subject and opening line, in two versions each: with the sender named,
   * and without, for a caller that has no acting member to name. The two read
   * the same way — the second is not a lesser message, just one that cannot
   * point at a person.
   *
   * Czech uses the PRESENT tense — "zve", invites — because the past tense it
   * would otherwise want ("pozval" / "pozvala") carries the sender's gender,
   * and nothing here knows it.
   */
  inviteSubject: "You've been invited to bandplate",
  inviteSubjectBy: (name: string): string => `${name} invited you to bandplate`,
  inviteWhat: "You've been invited to bandplate, your band's online archive.",
  inviteWhatBy: (name: string): string =>
    `${name} invited you to bandplate, your band's online archive.`,
  inviteButton: "Accept invite",
  /**
   * No "an admin of your band added this address" any more: the opening line
   * names them. What is left is the one thing the body does not say.
   */
  inviteFooter: "If this was a mistake, just ignore this message.",

  // --- the setup self-test -------------------------------------------------
  setupSubject: "bandplate is set up",
  setupWhat:
    "Everything works now. Add your bandmates in the bandplate admin and start creating stuff!",
  setupButton: "Open bandplate",
  setupFooter: "You are getting this because you just set up this bandplate deployment.",
};
