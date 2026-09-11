// The three screens someone reaches with no session: `/login`,
// `/login/[token]` and `/setup`.
//
// These are the only pages in the app a member can hit before it knows who
// they are, which is why the locale for them is negotiated from
// `Accept-Language` and remembered in `bp_locale` — see `middleware.ts`.

export const auth = {
  /** `<title>` for both login screens. */
  signInTitle: "Sign in",
  setupTitle: "Set up bandplate",

  /** The form. */
  heading: "Sign in",
  lede: "Enter your email. We'll send you a link.",
  /**
   * Replaces `lede` when the invite mail's button brought them here: the
   * address is already in the field and locked, so "enter your email" would be
   * an instruction about a control they cannot use.
   */
  invitedLede: "We'll send your sign-in link to the address your invite went to.",
  emailLabel: "Email address",
  emailRequired: "Enter your email address.",
  submit: "Send me a link",

  /** After a link has been sent. */
  sentTitle: "Check your email",
  /**
   * Deliberately non-committal: a page that confirms an address IS registered
   * turns the members table into an enumeration oracle, which is exactly what
   * `handleLoginPost`'s uniform response prevents. The copy must not give back
   * what the server withholds.
   */
  sentLede: "If that address is registered, a link is on its way.",
  sentUseAnother: "Use a different address",

  /** Rate limited. */
  slowTitle: "Give it a minute",
  /**
   * The seconds arrive already formatted, and as their own argument, because
   * the page wraps them in `.bp-tabular` so the number does not jitter as it
   * counts down.
   */
  slowLede: (seconds: string): string =>
    `Too many sign-in requests from here. Try again in about ${seconds} seconds.`,
  /**
   * What this state actually provokes is "did the link I already asked for die
   * too?", so that is what the line answers.
   */
  slowNote: "any link already sent still works",

  /** The tap-to-sign-in screen the emailed link lands on. */
  signingInAs: "Signing in as",
  /** When the token is valid but the member has no display name yet. */
  yourself: "yourself",
  tokenSubmit: "Sign in to bandplate",
  notYou: "Not you?",
  notYouLink: "Ask for your own link",

  /**
   * One screen for both cases. The server deliberately cannot tell an expired
   * link from an already-used one without leaking which, and the member's next
   * move is the same either way.
   */
  spentTitle: "That link is spent",
  spentLede:
    "Sign-in links work once and last 15 minutes. This one has expired or has already been used.",
  spentAction: "Send me a new link",

  /** `/setup`, before. */
  setupHeading: "Set up the archive",
  setupLede:
    "Create the first admin. You'll need the bootstrap token from your server's environment.",
  setupTokenLabel: "Bootstrap token",
  setupNameLabel: "Your name",
  setupEmailLabel: "Your email address",
  setupSubmit: "Create the first admin",
  setupBadToken: "That bootstrap token isn't right. Check your server configuration.",
  setupAlreadyDone: "bandplate is already set up. Sign in instead.",

  /** `/setup`, after. */
  setupOkHeading: "You're in",
  setupOkLede: "You're signed in as the first admin, and bandplate is ready to use.",
  setupGoToAdmin: "Go to admin",

  setupMailOkTitle: "Test email sent",
  setupMailOkBody: "The mailer works — a confirmation email went out to your address.",

  /**
   * The mail self-test's failure, broken into whole clauses.
   *
   * It used to be one paragraph with a `<code>wrangler tail</code>` buried
   * mid-sentence, which no translation can reorder — Czech wants the command
   * somewhere English does not. Each clause now stands on its own and the page
   * assembles them, so a language can put the command where it belongs.
   */
  setupMailFailTitle: "Test email failed to send",
  setupMailFailLede:
    "Members won't be able to sign in by email until this is fixed. You're still signed in, so you can fix it and carry on.",
  setupMailFailWhere: "The provider's own error explains why, and it's only in the server log:",
  setupMailFailWorkers: "On Workers:",
  setupMailFailContainer: "On a container: read the app's stdout.",
  setupMailFailCommon:
    "Most often it's the wrong API key, or a From address the provider hasn't verified yet.",
};
