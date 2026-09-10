// Přehrávač.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání).                                     │
// │                                                                        │
// │ "Master" and "Solo" stay as they are — both are what a Czech studio     │
// │ calls them, and "Sólo" with the accent is the musical term, which is    │
// │ the same word. Change them if the band says otherwise.                  │
// └────────────────────────────────────────────────────────────────────────┘
import type { player as enPlayer } from "../en/player.js";

export const player = {
  master: "Master", // en: Master
  solo: (instrument: string): string => `Sólo: ${instrument}`, // en: `Solo: ${instrument}`

  nowPlaying: (title: string): string => `Hraje: ${title}`, // en: `Now playing: ${title}`
  // en: `Now playing: ${title} — ${source}`
  nowPlayingSource: ({ title, source }: { title: string; source: string }): string =>
    `Hraje: ${title} — ${source}`,

  play: (title: string): string => `Přehrát ${title}`, // en: `Play ${title}`
  pause: (title: string): string => `Pozastavit ${title}`, // en: `Pause ${title}`
  // en: `Back ${seconds} seconds` — "o N sekund zpět", the number always 5+ so genitive plural
  back: (seconds: number): string => `O ${seconds} sekund zpět`,
  forward: (seconds: number): string => `O ${seconds} sekund vpřed`, // en: `Forward ${seconds} seconds`
  changeSource: "Změnit zdroj, teď hraje", // en: Change source, currently
  sourceGroup: "Zdroj", // en: Source
  close: "Zastavit a zavřít přehrávač", // en: Stop and close the player
  seek: "Přetočit", // en: Seek
} satisfies typeof enPlayer;
