// Co bandplate posílá jako push notifikaci — text na uzamčené obrazovce, ne
// stránka. Kratší než e-mail a bez HTML záložní varianty: `title` a `body`
// jsou úplně všechno, co čtenář uvidí.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání).                                     │
// │                                                                        │
// │ GLOSSARY: rehearsal → zkouška (f.) · concert → koncert (m.) ·           │
// │ session → session (nesklonné, po vzoru "ze session")                    │
// │                                                                        │
// │ Skloňování dne v týdnu: přivlastňovací přídavné jméno na "-ní" má v     │
// │ ženském rodě genitiv shodný s nominativem ("čtvrteční"), v mužském      │
// │ rodě genitiv končí na "-ího" ("čtvrtečního") — odtud dvě tabulky níže.  │
// │ Předložka "ze" před slovy začínajícími na z/s ("zkoušky", "session"),   │
// │ "z" jinde ("koncertu").                                                 │
// └────────────────────────────────────────────────────────────────────────┘
import { plural } from "../../plural.js";
import type { push as enPush } from "../en/push.js";

// en: { rehearsal: "rehearsal", concert: "concert", session: "session" }
const WEEKDAY_FEM: Record<number, string> = {
  0: "nedělní",
  1: "pondělní",
  2: "úterní",
  3: "středeční",
  4: "čtvrteční",
  5: "páteční",
  6: "sobotní",
};

const WEEKDAY_MASC_GEN: Record<number, string> = {
  0: "nedělního",
  1: "pondělního",
  2: "úterního",
  3: "středečního",
  4: "čtvrtečního",
  5: "pátečního",
  6: "sobotního",
};

export const push = {
  // --- nové nahrávky ------------------------------------------------------
  newTakesTitle: "Nové nahrávky", // en: New takes
  // en: `From ${weekdayPossessive} ${kindNoun}`
  //
  // "session" se chová jako "zkoušky" — ženský/nesklonný vzor, předložka
  // "ze". `weekday` odpovídá `zonedParts`: 0 = neděle.
  newTakesByWeekday: (kind: string, weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6): string => {
    switch (kind) {
      case "concert":
        return `z ${WEEKDAY_MASC_GEN[weekday]} koncertu`;
      case "rehearsal":
        return `ze ${WEEKDAY_FEM[weekday]} zkoušky`;
      case "session":
        return `ze ${WEEKDAY_FEM[weekday]} session`;
      default:
        return kind;
    }
  },
  // en: `From the ${kindNoun} on ${monthAbbr} ${day}`
  //
  // "12. 9." — den a měsíc oddělené tečkou, bez roku, jak se datum krátce
  // píše všude jinde v aplikaci.
  newTakesByDate: (kind: string, day: number, month: number): string => {
    const date = `${day}. ${month}.`;
    switch (kind) {
      case "concert":
        return `z koncertu ${date}`;
      case "rehearsal":
        return `ze zkoušky ${date}`;
      case "session":
        return `ze session ${date}`;
      default:
        return `${kind} ${date}`;
    }
  },

  // --- týdenní připomínka --------------------------------------------------
  weeklyTitle: "Čeká na tebe hlasování", // en: Takes waiting for your vote
  // en: `${count} ${count === 1 ? "take is" : "takes are"} waiting for your vote.`
  //
  // 1 nahrávka · 2–4 nahrávky · 5+ nahrávek — stejná skloňování jako
  // `events.takeCount`.
  weeklyBody: (count: number): string =>
    `Čeká na tebe ${count} ${plural("cs", count, { one: "nahrávka", few: "nahrávky", many: "nahrávky", other: "nahrávek" })} k hlasování.`,

  // --- změny ve skladbě -----------------------------------------------------
  songCreatedTitle: "Nová skladba", // en: New song
  songEditedTitle: "Změna ve skladbě", // en: Song updated
  songEditedBody: (title: string): string => `Akordy nebo text: ${title}`, // en: `Chords or lyrics: ${title}`
} satisfies typeof enPush;
