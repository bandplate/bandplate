// `/takes/[id]/mix` — všechny stopy jedné nahrávky naráz.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ Angličtina na každém řádku v komentáři. Oprav tady; ta oprava JE fix.   │
// │ Register je NEFORMÁLNÍ (tykání).                                        │
// │                                                                        │
// │ GLOSÁŘ: stem → stopa · master → master · take → nahrávka · mix → mix    │
// │         loop → smyčka                                                  │
// │                                                                        │
// │ ZA ZVÁŽENÍ:                                                             │
// │   "Mixér" vs "Mixážní pult" — zvolen "Mixér", protože je to jméno té    │
// │   stránky, ne popis nábytku. Zkontroluj, jak to říká kapela.            │
// │   `muteShort`/`soloShort` zůstávají M a S: jsou to popisky na tlačítkách│
// │   a v každé DAW v zemi jsou takhle.                                     │
// └────────────────────────────────────────────────────────────────────────┘
import type { mixer as enMixer } from "../en/mixer.js";

export const mixer = {
  title: "Mixér", // en: Mixer
  // en: `Mixer: ${take}`
  pageTitle: (take: string): string => `Mixér: ${take}`,
  backToTake: "Zpátky na nahrávku", // en: Back to the take
  openInMixer: "Otevřít v mixéru", // en: Open in mixer

  play: "Přehrát", // en: Play
  pause: "Pozastavit", // en: Pause
  starting: "Srovnávám stopy…", // en: Lining the tracks up…
  seek: "Přetočit", // en: Seek

  mute: (instrument: string): string => `Ztlumit ${instrument}`, // en: `Mute ${instrument}`
  unmute: (instrument: string): string => `Zase pustit ${instrument}`, // en: `Unmute ${instrument}`
  solo: (instrument: string): string => `Sólo ${instrument}`, // en: `Solo ${instrument}`
  // en: `Stop soloing ${instrument}`
  unsolo: (instrument: string): string => `Zrušit sólo ${instrument}`,
  volume: (instrument: string): string => `Hlasitost ${instrument}`, // en: `${instrument} volume`
  muteShort: "M", // en: M — stejné, popisek tlačítka jako v každé DAW
  soloShort: "S", // en: S — stejné, popisek tlačítka jako v každé DAW

  loopFrom: "Smyčka odtud", // en: Loop from here
  loopTo: "Smyčka sem", // en: Loop to here
  loopClear: "Zrušit smyčku", // en: Clear the loop
  loopStartHandle: "Začátek smyčky", // en: Loop start
  loopEndHandle: "Konec smyčky", // en: Loop end
  // en: `Looping ${from} to ${to}`
  loopRegion: (from: string, to: string): string => `Smyčka ${from} až ${to}`,
  loopHint: "Tažením tady zopakuješ pasáž", // en: Drag here to repeat a passage

  muteMine: "Ztlumit moje nástroje", // en: Mute my instruments
  unmuteMine: "Vrátit moje nástroje", // en: Bring my instruments back

  // en: `Only in the full mix, so muting will not remove them: ${instruments}.`
  onlyInMaster: (instruments: string): string =>
    `Jsou jen v celém mixu, takže je ztlumení neodstraní: ${instruments}.`,

  // en: Couldn't start every track. Reload and try again.
  cantStart: "Nepodařilo se spustit všechny stopy. Načti stránku znovu.",
  trackFailed: (instrument: string): string => `${instrument} se nenačetl.`, // en: `${instrument} wouldn't load.`

  // en: Hearing nothing on a phone? Check the silent switch.
  silenceHint: "Na telefonu nic neslyšíš? Zkontroluj postranní přepínač zvuku.",

  // en: The mixer needs JavaScript. The take page plays each stem on its own without it.
  noScript: "Mixér potřebuje JavaScript. Bez něj ti stránka nahrávky pustí každou stopu zvlášť.",
} satisfies typeof enMixer;
