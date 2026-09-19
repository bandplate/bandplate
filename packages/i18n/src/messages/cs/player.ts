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
  previous: "Předchozí nahrávka", // en: Previous take
  next: "Další nahrávka", // en: Next take
  // en: `${current} of ${total}`
  position: ({ current, total }: { current: number; total: number }): string =>
    `${current} z ${total}`,
  // en: `${title}. Show what's playing`
  openNowPlaying: (title: string): string => `${title}. Ukázat, co hraje`,
  nowPlayingHeading: "Hraje", // en: Now playing
  sourceHeading: "Zdroj", // en: Source
  orderHeading: "Pořadí", // en: Order
  closeSheet: "Zavřít", // en: Close
  close: "Zastavit a zavřít přehrávač", // en: Stop and close the player
  seek: "Přetočit", // en: Seek
  openInMixer: "Otevřít v mixéru", // en: Open in mixer
} satisfies typeof enPlayer;
