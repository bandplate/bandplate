// The handful of things that belong to no single page.
//
// Deliberately small, and it should stay that way. A form error belongs to the
// page that raises it; only strings that are genuinely said in several
// unrelated places live here. Today that is two, and both of them were already
// copy-pasted around the codebase — the origin message appears verbatim in
// seven files.
export const common = {
  /**
   * A mutating request whose `Origin` did not match.
   *
   * Vague on purpose: whoever sees this is either behind a proxy that strips
   * the header or is being CSRF'd, and neither is helped by naming the
   * mechanism.
   */
  originError: "Something about that request looked wrong. Reload the page and try again.",

  /** The last resort, when a write failed for a reason the page cannot name. */
  genericError: "That didn't work. Try again.",
};
