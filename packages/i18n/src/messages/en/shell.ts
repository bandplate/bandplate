// The frame every page is drawn in: navigation, the skip link, and the one
// sentence the product says about itself.
//
// The nav was already key-based before any of this — `AppLayout.astro` types a
// `NavKey` union and maps over it — so translating it is a lookup rather than
// a rewrite. That is why these are records keyed by the same unions the layout
// already uses: a new nav item is a typecheck error here until it has a word.

export const shell = {
  nav: {
    home: "Home",
    songs: "Songs",
    events: "Events",
    takes: "Takes",
    me: "Me",
    admin: "Admin",
  },

  adminNav: {
    overview: "Overview",
    members: "Members",
    instruments: "Instruments",
    tokens: "Tokens",
  },

  /** Accessible name for the admin section nav. */
  adminSectionsLabel: "Admin sections",

  /** Accessible name for both the sidebar and the phone tab bar. */
  navLabel: "Main",

  /** The eyebrow over the admin group in the sidebar. */
  adminGroupLabel: "Admin",

  skipToContent: "Skip to content",

  /**
   * What a shared bandplate link says about itself, and the one line of pitch
   * on the sign-in screen.
   *
   * The same sentence in both places, deliberately: it is the only description
   * anyone outside the band will ever see, because every other page is behind
   * the session middleware and an unauthenticated crawler following a link to
   * `/songs/dub-corner` previews `/login` instead — which is the correct
   * outcome for a private archive.
   */
  shareDescription:
    "Every rehearsal your band has recorded, in one place, with the keepers marked.",

  shareImageAlt: "The bandplate wordmark beside a record, on a dark ground.",
};
