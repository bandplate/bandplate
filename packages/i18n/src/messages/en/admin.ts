// `/admin/*` — the screens only a member with `members:admin` reaches.
//
// One area for all four sections plus the eleven confirm pages, because they
// share a vocabulary (Label, Status, Actions, Save changes) and nothing here
// ever ships to a page a plain member can open.
export const admin = {
  title: "Admin",
  membersTitle: "Admin — Members",
  instrumentsTitle: "Admin — Instruments",
  tokensTitle: "Admin — Tokens",

  // --- the overview --------------------------------------------------------
  members: "Members",
  membersBlurb: "The band roster, roles and status.",
  instruments: "Instruments",
  instrumentsBlurb: "What a take can be recorded with.",
  serviceTokens: "Service tokens",
  tokensBlurb: "Credentials for the ingest bridge.",

  // --- shared table and sheet vocabulary -----------------------------------
  colName: "Name",
  colEmail: "Email",
  colRole: "Role",
  colStatus: "Status",
  colActions: "Actions",
  colLabel: "Label",
  colSlug: "Slug",
  colIcon: "Icon",
  colOrder: "Order",
  colInstruments: "Instruments",
  colLastSeen: "Last seen",
  colCreated: "Created",
  colLastUsed: "Last used",
  colScopes: "Scopes",
  edit: "Edit",
  cancel: "Cancel",
  saveChanges: "Save changes",
  archive: "Archive",
  unarchive: "Unarchive",

  // --- members -------------------------------------------------------------
  bandMembers: "Band members",
  addMember: "Add member",
  editingMember: "Editing member",
  emptyMembers: "No members yet — add the first one above.",
  memberAdded: "Member added.",
  memberAddedInvited: "Member added, and their invitation is on its way.",
  memberUpdated: "Member updated.",
  inviteResent: "Invitation sent again.",
  resendInvite: "Send the invitation again",
  revokeSessions: "Revoke sessions",
  sessionsRevoked: "Sessions revoked. They'll need a new login link.",
  inviteFailedTitle: "The invitation email didn't send",
  duplicateEmail: "A member with this email already exists.",
  memberNotFound: "Couldn't find that member — reload and try again.",
  memberUpdateFailed: "Couldn't update that member — reload and try again.",
  instrumentsInvalid: "That instrument selection didn't look right — reload and try again.",
  lastAdmin: "That would leave the band with no active admin. Promote someone else first.",
  /** Shown in the row, and as the error if the guard fires anyway. */
  selfRowNote: "This is you — another admin has to change your role or status.",
  selfError: "You can't change your own role or status — ask another admin to do it.",

  // --- instruments ---------------------------------------------------------
  addInstrument: "Add instrument",
  editingInstrument: "Editing instrument",
  emptyInstruments: "No instruments yet — add the first one above.",
  instrumentAdded: "Instrument added.",
  instrumentUpdated: "Instrument updated.",
  instrumentArchived: "Instrument archived. Its past takes still render fine.",
  instrumentUpdateFailed: "Couldn't update that instrument — reload and try again.",
  labelHint: "What members see — e.g. Rhythm guitar",
  slugHint: "Lowercase, no spaces — e.g. rhythm-guitar",
  sortOrder: "Sort order",
  sortOrderHint: "What members see on a take.",
  iconNone: "None",
  iconNoneHint: "No icon — show initials",
  /**
   * The track-colour picker. Names, not hexes: an admin is choosing an
   * identity for an instrument, and the value stored is a key whose actual
   * colour the theme decides — see `@bandplate/ui/tokens/track-colors`.
   */
  colColor: "Color",
  colorNone: "None",
  colorNoneHint: "No color — the mixer uses a neutral",
  colorHint: "What the mixer paints this instrument's track with.",
  trackColor: {
    rust: "Rust",
    amber: "Amber",
    lime: "Lime",
    fern: "Fern",
    jade: "Jade",
    sea: "Sea",
    sky: "Sky",
    indigo: "Indigo",
    orchid: "Orchid",
    rose: "Rose",
  },
  archiveInstrument: "Archive instrument",
  /** Row states. Lowercase — they render inside `.bp-kind`, which uppercases. */
  statusArchived: "archived",
  /**
   * An instrument ingest created for a slug it did not recognise.
   *
   * "unfinished", not "new" or "pending": nothing is waiting on approval —
   * the row already works and takes already reference it. What it lacks is a
   * label worth reading, an icon, a colour and a place in the order, and
   * saving the edit sheet is what completes it.
   */
  statusStub: "unfinished",
  statusRevoked: "revoked",
  statusInvited: "invited",
  statusDisabled: "disabled",
  revokedCount: (count: number): string => `${count} revoked.`,
  archiveInstrumentNote:
    "Archiving an instrument hides it from new takes but keeps every past take that used it rendering correctly.",
  /**
   * The archived ones are behind a toggle rather than mixed into the table.
   *
   * The count is in the label because that is the whole question the toggle
   * answers — whether there is anything back there worth a click. It is
   * parenthesised rather than written into a sentence so neither language
   * needs a plural form for it.
   */
  showArchived: (count: number): string => `Show archived (${count})`,
  hideArchived: "Hide archived",
  /** Every instrument this band has is archived — distinct from having none. */
  emptyActiveInstruments: "Every instrument is archived.",

  /**
   * Deleting, which is not archiving.
   *
   * Archiving is retirement and keeps every past take rendering. Deleting is
   * for the mistakes — a typo, a duplicate, a stub ingest invented from a
   * Reaper track name — and is only possible while nothing points at the
   * instrument at all.
   */
  deleteInstrument: "Delete instrument",
  deleteThisInstrument: "Delete this instrument",
  deleteInstrumentBody: (label: string): string =>
    `${label} is gone for good. Nothing uses it, so nothing else changes.`,
  /**
   * Why the delete is not on offer, as a list of what is holding it.
   *
   * Counts in parentheses rather than written into the sentence, the same way
   * the archived toggle does it — so neither language needs a plural form for
   * four different nouns.
   */
  instrumentInUse: (parts: string): string =>
    `In use, so it can't be deleted — ${parts}. Archive it instead.`,
  usedByTakes: "takes",
  usedByMembers: "members",
  usedByCharts: "song charts",
  usedByStems: "stems",
  /**
   * Other slugs that mean this instrument.
   *
   * "Also known as" rather than "aliases": the admin reading this is deciding
   * what their Reaper tracks are allowed to be called, not learning a data
   * model.
   */
  aliasesHeading: "Also known as",
  aliasesHint:
    "Slugs ingest should treat as this instrument — a track your session names differently, or the slug of an instrument merged into this one.",
  addAlias: "Add",
  aliasSlugLabel: "Another slug",
  removeAlias: (slug: string): string => `Remove ${slug}`,
  aliasAdded: "Slug added.",
  aliasRemoved: "Slug removed.",
  aliasTaken: (label: string): string => `That slug already belongs to ${label}.`,
  noAliases: "None yet.",

  instrumentDeleted: "Instrument deleted.",
  /** Something started using it between the page being drawn and the press. */
  instrumentDeleteBlocked: "Something started using that instrument — nothing was deleted.",
  /** Attribution for the icon set. The set's NAME and licence stay as they are. */
  iconCreditBefore: "Instrument icons from",
  iconCreditLicensed: ", licensed",

  // --- tokens --------------------------------------------------------------
  tokens: "Tokens",
  createToken: "Create token",
  editingToken: "Editing token",
  emptyTokens: "No service tokens yet — create one above.",
  tokenCreatedTitle: "Token created",
  copySecret: "Copy secret",
  copySecretNow: "Copy this secret now — it will not be shown again.",
  tokenLabelHint: "What this token is for — e.g. reaper-bridge",
  scopesUpdated: "Scopes updated.",
  scopesInvalid: "Couldn't update that token's scopes — choose at least one and try again.",
  revokeToken: "Revoke token",
  revokeThisToken: "Revoke this token",
  tokenRevoked: "Token revoked. Anything using it will stop working immediately.",

  // --- confirm pages -------------------------------------------------------
  archiveSong: "Archive song",
  unarchiveSong: "Unarchive song",
  unarchiveSongBody: "It returns to the song library and to the picker when you add a take.",
  deleteSong: "Delete song",
  archiveEvent: "Archive event",
  unarchiveEvent: "Unarchive event",
  unarchiveEventBody: "It returns to the event archive and to home.",
  mergeEvents: "Merge events",
  mergeThem: "Merge them",
  mergeNoTakes: "It has no takes, so nothing moves — it is just archived.",
  deleteTake: "Delete take",
  deleteFile: "Delete file",
  promoteToKeeper: "Promote to keeper",
  rejectTake: "Reject take",
  untitledTake: "Untitled take",
  takeWillBeMarked: "This take will be marked",
};
