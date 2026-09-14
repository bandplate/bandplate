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
  colColor: "Barva", // en: Color
  colorNone: "Žádná", // en: None
  // en: No color — the mixer uses a neutral
  colorNoneHint: "Bez barvy — mixér použije neutrální",
  // en: What the mixer paints this instrument's track with.
  colorHint: "Čím mixér obarví stopu tohohle nástroje.",
  // Názvy, ne kódy — správce vybírá identitu nástroje, ne odstín.
  trackColor: {
    rust: "Rez", // en: Rust
    amber: "Jantar", // en: Amber
    lime: "Limetka", // en: Lime
    fern: "Kapradí", // en: Fern
    jade: "Nefrit", // en: Jade
    sea: "Moře", // en: Sea
    sky: "Nebe", // en: Sky
    indigo: "Indigo", // en: Indigo — stejné slovo v obou jazycích
    orchid: "Orchidej", // en: Orchid
    rose: "Růže", // en: Rose
  },
  archiveInstrument: "Archivovat nástroj", // en: Archive instrument
  statusArchived: "archivováno", // en: archived
  statusStub: "nedokončeno", // en: unfinished
  statusRevoked: "zneplatněno", // en: revoked
  statusInvited: "pozván", // en: invited
  statusDisabled: "vypnutý", // en: disabled
  // en: `${count} revoked.` — 1 zneplatněný · 2–4 zneplatněné · 5+ zneplatněných
  revokedCount: (count: number): string =>
    `${count} ${count === 1 ? "zneplatněný" : count < 5 ? "zneplatněné" : "zneplatněných"}.`,
  // en: Archiving an instrument hides it from new takes but keeps every past take that used it rendering correctly.
  archiveInstrumentNote:
    "Archivovaný nástroj zmizí z nových nahrávek, ale všechny starší, které ho použily, se dál zobrazují správně.",
  // en: `Show archived (${count})`
  showArchived: (count: number): string => `Zobrazit archivované (${count})`,
  hideArchived: "Skrýt archivované", // en: Hide archived
  emptyActiveInstruments: "Všechny nástroje jsou archivované.", // en: Every instrument is archived.

  deleteInstrument: "Smazat nástroj", // en: Delete instrument
  deleteThisInstrument: "Smazat tenhle nástroj", // en: Delete this instrument
  // en: `${label} is gone for good. Nothing uses it, so nothing else changes.`
  deleteInstrumentBody: (label: string): string =>
    `${label} bude nenávratně pryč. Nic ho nepoužívá, takže se nic dalšího nezmění.`,
  // en: `In use, so it can't be deleted — ${parts}. Archive it instead.`
  instrumentInUse: (parts: string): string =>
    `Používá se, takže ho nejde smazat — ${parts}. Radši ho archivuj.`,
  usedByTakes: "nahrávky", // en: takes
  usedByMembers: "členové", // en: members
  usedByCharts: "zápisy skladeb", // en: song charts
  usedByStems: "stopy", // en: stems
  aliasesHeading: "Taky známý jako", // en: Also known as
  // en: Slugs ingest should treat as this instrument — a track your session names differently, or the slug of an instrument merged into this one.
  aliasesHint:
    "Slugy, které má ingest brát jako tenhle nástroj — stopa, co se ve tvé session jmenuje jinak, nebo slug nástroje, který jsi do tohohle sloučil.",
  addAlias: "Přidat", // en: Add
  aliasSlugLabel: "Další slug", // en: Another slug
  aliasSlugPlaceholder: "dalsi-slug", // en: another-slug
  removeAlias: (slug: string): string => `Odebrat ${slug}`, // en: `Remove ${slug}`
  aliasAdded: "Slug přidán.", // en: Slug added.
  aliasRemoved: "Slug odebrán.", // en: Slug removed.
  // en: `That slug already belongs to ${label}.`
  aliasTaken: (label: string): string => `Tenhle slug už patří nástroji ${label}.`,
  noAliases: "Zatím žádné.", // en: None yet.

  mergeInto: "Sloučit do", // en: Merge into
  mergeInstrument: "Sloučit nástroj", // en: Merge instrument
  // en: `Merge ${source} into ${target}?`
  mergeConfirmTitle: (source: string, target: string): string =>
    `Sloučit ${source} do nástroje ${target}?`,
  // en: `${source} stops existing. Everything that used it is moved to ${target}, and its slug keeps working — ingest will resolve it as ${target} from now on.`
  mergeBody: (source: string, target: string): string =>
    `${source} přestane existovat. Všechno, co ho používalo, přejde na ${target}, a jeho slug dál funguje — ingest ho od teď bude brát jako ${target}.`,
  mergeCollisions: "Tohle už nevrátíš:", // en: This cannot be undone:
  // en: `${song}'s chart for this instrument is deleted.`
  mergeLosesChart: (song: string): string => `Zápis skladby ${song} pro tenhle nástroj se smaže.`,
  // en: `A stem on the ${date} take of ${song} is deleted — the audio file too.`
  mergeLosesStem: (song: string, date: string): string =>
    `Stopa u nahrávky skladby ${song} z ${date} se smaže — i zvukový soubor.`,
  // en: Nothing is lost — no take or song has both.
  mergeNoCollisions: "Nic se neztratí — žádná nahrávka ani skladba nemá oba.",
  merged: "Nástroje sloučeny.", // en: Instruments merged.
  mergeTargetLabel: "Do kterého nástroje sloučit", // en: Merge into which instrument

  instrumentDeleted: "Nástroj smazán.", // en: Instrument deleted.
  // en: Something started using that instrument — nothing was deleted.
  instrumentDeleteBlocked: "Nástroj se mezitím začal používat — nic se nesmazalo.",
  iconCreditBefore: "Ikony nástrojů od", // en: Instrument icons from
  iconCreditLicensed: ", licence", // en: , licensed

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
