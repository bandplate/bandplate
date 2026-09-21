// `/logout`'s own decidable piece (Task 5): whether the sign-out POST
// carried a push endpoint worth deleting. The rest of the route — reading
// the session cookie, revoking it, deleting the DB row — is side effects
// that stay in `pages/logout.astro`; this is the one branch that can be
// checked without booting Astro.
//
// A device with no live subscription submits the hidden field empty (see
// `client/push-logout.ts#endpointFieldValue`), and a member who never had
// JS run at all submits it absent — both mean "nothing to delete server
// side", not an error. Whitespace-only counts the same as absent: a stray
// space is not an endpoint.
export function pushEndpointFromForm(formData: FormData): string | null {
  const raw = formData.get("pushEndpoint");
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
