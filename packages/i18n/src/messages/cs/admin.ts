// `/admin/*` — obrazovky, na které se dostane jen správce.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání), same as the rest.                   │
// │                                                                        │
// │ GLOSSARY: member → člen · role → role · status → stav · scope → oprávnění│
// │           token → token · slug → slug · instrument → nástroj            │
// │                                                                        │
// │ "slug" and "token" stay as they are: both are what they are called in   │
// │ Czech developer speech, and the person reading this screen is the one   │
// │ who set up the server.                                                  │
// └────────────────────────────────────────────────────────────────────────┘
import type { admin as enAdmin } from "../en/admin.js";

export const admin = {
  title: "Správa", // en: Admin
  membersTitle: "Správa — Členové", // en: Admin — Members
  instrumentsTitle: "Správa — Nástroje", // en: Admin — Instruments
  tokensTitle: "Správa — Tokeny", // en: Admin — Tokens

  members: "Členové", // en: Members
  membersBlurb: "Sestava kapely, role a stavy.", // en: The band roster, roles and status.
  instruments: "Nástroje", // en: Instruments
  instrumentsBlurb: "Čím se dá nahrávka pořídit.", // en: What a take can be recorded with.
  serviceTokens: "Servisní tokeny", // en: Service tokens
  tokensBlurb: "Přístupové údaje pro ingest bridge.", // en: Credentials for the ingest bridge.

  colName: "Jméno", // en: Name
  colEmail: "E-mail", // en: Email
  colRole: "Role", // en: Role
  colStatus: "Stav", // en: Status
  colActions: "Akce", // en: Actions
  colLabel: "Označení", // en: Label
  colSlug: "Slug", // en: Slug
  colIcon: "Ikona", // en: Icon
  colOrder: "Pořadí", // en: Order
  colInstruments: "Nástroje", // en: Instruments
  colLastSeen: "Naposled viděn", // en: Last seen
  colCreated: "Vytvořeno", // en: Created
  colLastUsed: "Naposled použit", // en: Last used
  colScopes: "Oprávnění", // en: Scopes
  edit: "Upravit", // en: Edit
  cancel: "Zrušit", // en: Cancel
  saveChanges: "Uložit změny", // en: Save changes
  archive: "Archivovat", // en: Archive
  unarchive: "Vrátit z archivu", // en: Unarchive

  bandMembers: "Členové kapely", // en: Band members
  addMember: "Přidat člena", // en: Add member
  editingMember: "Úprava člena", // en: Editing member
  emptyMembers: "Zatím žádní členové — přidej prvního nahoře.", // en: No members yet — add the first one above.
  memberAdded: "Člen přidán.", // en: Member added.
  // en: Member added, and their invitation is on its way.
  memberAddedInvited: "Člen přidán a pozvánka je na cestě.",
  memberUpdated: "Člen upraven.", // en: Member updated.
  inviteResent: "Pozvánka odeslána znovu.", // en: Invitation sent again.
  resendInvite: "Poslat pozvánku znovu", // en: Send the invitation again
  revokeSessions: "Zrušit přihlášení", // en: Revoke sessions
  // en: Sessions revoked. They'll need a new login link.
  sessionsRevoked: "Přihlášení zrušena. Budou potřebovat nový přihlašovací odkaz.",
  inviteFailedTitle: "Pozvánka se neodeslala", // en: The invitation email didn't send
  duplicateEmail: "Člen s tímhle e-mailem už existuje.", // en: A member with this email already exists.
  // en: Couldn't find that member — reload and try again.
  memberNotFound: "Toho člena se nepodařilo najít — načti stránku znovu.",
  // en: Couldn't update that member — reload and try again.
  memberUpdateFailed: "Toho člena se nepodařilo upravit — načti stránku znovu.",
  // en: That instrument selection didn't look right — reload and try again.
  instrumentsInvalid: "Ten výběr nástrojů nevypadal dobře — načti stránku znovu.",
  // en: That would leave the band with no active admin. Promote someone else first.
  lastAdmin: "Kapela by zůstala bez aktivního správce. Nejdřív povyš někoho jiného.",
  // en: This is you — another admin has to change your role or status.
  selfRowNote: "Tohle jsi ty — tvoji roli nebo stav musí změnit jiný správce.",
  // en: You can't change your own role or status — ask another admin to do it.
  selfError: "Vlastní roli ani stav si změnit nemůžeš — požádej jiného správce.",

  addInstrument: "Přidat nástroj", // en: Add instrument
  editingInstrument: "Úprava nástroje", // en: Editing instrument
  // en: No instruments yet — add the first one above.
  emptyInstruments: "Zatím žádné nástroje — přidej první nahoře.",
  instrumentAdded: "Nástroj přidán.", // en: Instrument added.
  instrumentUpdated: "Nástroj upraven.", // en: Instrument updated.
  // en: Instrument archived. Its past takes still render fine.
  instrumentArchived: "Nástroj archivován. Starší nahrávky se pořád zobrazují správně.",
  // en: Couldn't update that instrument — reload and try again.
  instrumentUpdateFailed: "Ten nástroj se nepodařilo upravit — načti stránku znovu.",
  labelHint: "Co uvidí členové — např. Doprovodná kytara", // en: What members see — e.g. Rhythm guitar
  slugHint: "Malá písmena, bez mezer — např. doprovodna-kytara", // en: Lowercase, no spaces — e.g. rhythm-guitar
  sortOrder: "Pořadí řazení", // en: Sort order
  sortOrderHint: "Co členové vidí u nahrávky.", // en: What members see on a take.
  iconNone: "Žádná", // en: None
  iconNoneHint: "Bez ikony — zobrazí se iniciály", // en: No icon — show initials
  archiveInstrument: "Archivovat nástroj", // en: Archive instrument

  tokens: "Tokeny", // en: Tokens
  createToken: "Vytvořit token", // en: Create token
  editingToken: "Úprava tokenu", // en: Editing token
  emptyTokens: "Zatím žádné servisní tokeny — vytvoř jeden nahoře.", // en: No service tokens yet — create one above.
  tokenCreatedTitle: "Token vytvořen", // en: Token created
  copySecret: "Zkopírovat tajný klíč", // en: Copy secret
  // en: Copy this secret now — it will not be shown again.
  copySecretNow: "Zkopíruj si klíč hned — už se znovu nezobrazí.",
  tokenLabelHint: "K čemu ten token je — např. reaper-bridge", // en: What this token is for — e.g. reaper-bridge
  scopesUpdated: "Oprávnění upravena.", // en: Scopes updated.
  // en: Couldn't update that token's scopes — choose at least one and try again.
  scopesInvalid: "Oprávnění se nepodařilo upravit — vyber aspoň jedno a zkus to znovu.",
  revokeToken: "Zneplatnit token", // en: Revoke token
  revokeThisToken: "Zneplatnit tenhle token", // en: Revoke this token
  // en: Token revoked. Anything using it will stop working immediately.
  tokenRevoked: "Token zneplatněn. Cokoli, co ho používá, okamžitě přestane fungovat.",

  archiveSong: "Archivovat skladbu", // en: Archive song
  unarchiveSong: "Vrátit skladbu z archivu", // en: Unarchive song
  // en: It returns to the song library and to the picker when you add a take.
  unarchiveSongBody: "Vrátí se do knihovny i do výběru, když přidáváš nahrávku.",
  deleteSong: "Smazat skladbu", // en: Delete song
  archiveEvent: "Archivovat akci", // en: Archive event
  unarchiveEvent: "Vrátit akci z archivu", // en: Unarchive event
  unarchiveEventBody: "Vrátí se do archivu akcí a na úvodní stránku.", // en: It returns to the event archive and to home.
  mergeEvents: "Sloučit akce", // en: Merge events
  mergeThem: "Sloučit", // en: Merge them
  // en: It has no takes, so nothing moves — it is just archived.
  mergeNoTakes: "Nemá žádné nahrávky, takže se nic nepřesouvá — jen se archivuje.",
  deleteTake: "Smazat nahrávku", // en: Delete take
  deleteFile: "Smazat soubor", // en: Delete file
  promoteToKeeper: "Označit jako držák", // en: Promote to keeper
  rejectTake: "Odmítnout nahrávku", // en: Reject take
  untitledTake: "Nahrávka bez názvu", // en: Untitled take
  takeWillBeMarked: "Tahle nahrávka bude označena jako", // en: This take will be marked
} satisfies typeof enAdmin;
