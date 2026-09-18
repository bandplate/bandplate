// Co bandplate posílá jako push notifikaci — text na uzamčené obrazovce, ne
// stránka. Kratší než e-mail a bez HTML záložní varianty: `title` a `body`
// jsou úplně všechno, co čtenář uvidí.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání).                                     │
// │                                                                        │
// │ GLOSSARY: rehearsal → zkouška (f.) · concert → koncert (m.) ·           │
// │ session → studio (s.) — stejné slovo jako `events.ts`'s `kindLabel`.    │
// │                                                                        │
// │ Skloňování dne v týdnu: přivlastňovací přídavné jméno na "-ní" má v     │
// │ ženském rodě genitiv shodný s nominativem ("čtvrteční"), v mužském a    │
// │ středním rodě genitiv končí na "-ího" ("čtvrtečního") — odtud dvě       │
// │ tabulky níže. "studio" je střední rod, ale genitiv má stejnou koncovku  │
// │ přídavného jména jako mužský ("čtvrtečního studia").                   │
// │                                                                        │
// │ PŘEDLOŽKA "z"/"ze" SE ŘÍDÍ SLOVEM DNE, NE DRUHEM AKCE: "ze středeční/   │
// │ čtvrteční/sobotní" (obtížná souhlásková skupina na začátku slova dne),  │
// │ "z nedělní/pondělní/úterní/páteční" jinde — stejně pro obě tabulky,     │
// │ protože mužský/střední tvar dne začíná stejnou hláskou jako ženský.     │
// │ Datum bez dne v týdnu naopak předložku odvozuje od NÁSLEDUJÍCÍHO        │
// │ podstatného jména: "ze zkoušky", "z koncertu", "ze studia".            │
// └────────────────────────────────────────────────────────────────────────┘
import { plural } from "../../plural.js";
import type { push as enPush } from "../en/push.js";

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * One weekday's adjective, in the two genitive shapes this area needs, and
 * the preposition that precedes it — "z" before a day whose word starts
 * cleanly, "ze" before one whose consonant cluster makes "z" hard to say
 * ("z středeční" / "z čtvrteční" / "z sobotní" would all trip on the
 * leading consonant cluster).
 */
const WEEKDAY: Record<Weekday, { fem: string; masc: string; prep: "z" | "ze" }> = {
  0: { fem: "nedělní", masc: "nedělního", prep: "z" },
  1: { fem: "pondělní", masc: "pondělního", prep: "z" },
  2: { fem: "úterní", masc: "úterního", prep: "z" },
  3: { fem: "středeční", masc: "středečního", prep: "ze" },
  4: { fem: "čtvrteční", masc: "čtvrtečního", prep: "ze" },
  5: { fem: "páteční", masc: "pátečního", prep: "z" },
  6: { fem: "sobotní", masc: "sobotního", prep: "ze" },
};

/** Capitalizes the first letter — every notification body starts a sentence, same as the English catalog's "From ...". */
function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]?.toUpperCase() + s.slice(1);
}

export const push = {
  // --- nové nahrávky ------------------------------------------------------
  newTakesTitle: "Nové nahrávky", // en: New takes
  // en: `From ${weekdayPossessive} ${kindNoun}`
  //
  // `weekday` odpovídá `zonedParts`: 0 = neděle. Předložka jde vždy s dnem
  // v týdnu, ne s druhem akce — viz hlavička souboru.
  newTakesByWeekday: (kind: string, weekday: Weekday): string => {
    const { fem, masc, prep } = WEEKDAY[weekday];
    switch (kind) {
      case "concert":
        return capitalize(`${prep} ${masc} koncertu`);
      case "rehearsal":
        return capitalize(`${prep} ${fem} zkoušky`);
      case "session":
        return capitalize(`${prep} ${masc} studia`);
      default:
        return capitalize(kind);
    }
  },
  // en: `From the ${kindNoun} on ${monthAbbr} ${day}`
  //
  // "12. 9." — den a měsíc oddělené tečkou, bez roku, jak se datum krátce
  // píše všude jinde v aplikaci. Bez dne v týdnu volí předložku podle
  // podstatného jména samotného.
  newTakesByDate: (kind: string, day: number, month: number): string => {
    const date = `${day}. ${month}.`;
    switch (kind) {
      case "concert":
        return capitalize(`z koncertu ${date}`);
      case "rehearsal":
        return capitalize(`ze zkoušky ${date}`);
      case "session":
        return capitalize(`ze studia ${date}`);
      default:
        return capitalize(`${kind} ${date}`);
    }
  },

  // --- týdenní připomínka --------------------------------------------------
  weeklyTitle: "Čeká na tebe hlasování", // en: Takes waiting for your vote
  // en: `${count} ${count === 1 ? "take is" : "takes are"} waiting for your vote.`
  //
  // 1 nahrávka · 2–4 nahrávky · 5+ nahrávek — stejná skloňování jako
  // `events.takeCount`. Sloveso se shoduje s podmětem v čísle: "čeká" je
  // jednotné číslo (1, 5+), "čekají" množné (2–4).
  weeklyBody: (count: number): string =>
    `${plural("cs", count, { one: "Čeká", few: "Čekají", many: "Čekají", other: "Čeká" })} na tebe ${count} ${plural("cs", count, { one: "nahrávka", few: "nahrávky", many: "nahrávky", other: "nahrávek" })} k hlasování.`,

  // --- změny ve skladbě -----------------------------------------------------
  songCreatedTitle: "Nová skladba", // en: New song
  songEditedTitle: "Změna ve skladbě", // en: Song updated
  songEditedBody: (title: string): string => `Akordy nebo text: ${title}`, // en: `Chords or lyrics: ${title}`
} satisfies typeof enPush;
