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
  statusRevoked: "revoked",
  statusInvited: "invited",
  statusDisabled: "disabled",
  revokedCount: (count: number): string => `${count} revoked.`,
  archiveInstrumentNote:
    "Archiving an instrument hides it from new takes but keeps every past take that used it rendering correctly.",
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
