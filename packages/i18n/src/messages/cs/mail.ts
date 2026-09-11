// Co bandplate posílá e-mailem.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání).                                     │
// │                                                                        │
// │ THE SIGN-IN MESSAGE IS THE ONLY WAY INTO THE APP. If a member cannot    │
// │ read it, they cannot get in — so this is the one file where clarity     │
// │ beats voice if the two ever pull apart.                                 │
// │                                                                        │
// │ NOTHING HERE MAY DECLARE THE READER'S OR THE SENDER'S GENDER. These     │
// │ messages go to people the app knows only by name and address. That      │
// │ rules out the Czech past tense in every sentence about a PERSON —       │
// │ "pozval/pozvala", "nebyl jsi to ty" — so the invitation uses the        │
// │ present ("zve") and the footers are phrased around a thing rather than  │
// │ a person ("pokud to byl omyl", agreeing with "omyl", not the reader).   │
// │                                                                        │
// │ `loginFooter` must stay as non-committal as the English: it deliberately│
// │ does NOT confirm that the address is registered, for the same reason    │
// │ `/login` answers identically either way.                                │
// └────────────────────────────────────────────────────────────────────────┘
import type { mail as enMail } from "../en/mail.js";

export const mail = {
  greeting: (displayName: string): string => `Ahoj ${displayName},`, // en: `Hi ${displayName},`
  greetingAnonymous: "Ahoj,", // en: Hi,
  orPaste: "Nebo otevři tuhle adresu v prohlížeči:", // en: Or open this address in your browser:

  loginSubject: "Tvůj přihlašovací odkaz do bandplate", // en: Your sign-in link for bandplate
  // en: `Here is your link to sign in. ${life}`
  loginLead: (life: string): string => `Tady je tvůj odkaz pro přihlášení. ${life}`,
  // en: `It works once and lasts ${n} ${n === 1 ? "minute" : "minutes"}.`
  //
  // 1 minutu · 2–4 minuty · 5+ minut — accusative, which is what the count
  // governs after "platí".
  loginLife: (minutes: number): string =>
    `Funguje jednou a platí ${minutes} ${minutes === 1 ? "minutu" : minutes < 5 ? "minuty" : "minut"}.`,
  loginLifeNoExpiry: "Funguje jednou.", // en: It works once.
  loginButton: "Přihlásit se do bandplate", // en: Sign in to bandplate
  // en: Someone entered this address on the bandplate sign-in page. If that was not you, ignore this — nobody can sign in without the link.
  // "Pokud to nebylo od tebe" rather than "pokud jsi to nebyl ty": the past
  // tense would declare the reader's gender.
  loginFooter:
    "Někdo zadal tuhle adresu na přihlašovací stránce bandplate. Pokud to nebylo od tebe, zprávu ignoruj — bez odkazu se nikdo nepřihlásí.",

  // Present tense — "zve". The past tense Czech would otherwise want
  // ("pozval" / "pozvala") carries the sender's gender, and nothing here
  // knows it.
  inviteSubject: "Máš pozvánku do bandplate", // en: You've been invited to bandplate
  // en: `${name} invited you to bandplate`
  inviteSubjectBy: (name: string): string => `${name} tě zve do bandplate`,
  // en: You've been invited to bandplate, your band's online archive.
  inviteWhat: "Máš pozvánku do bandplate, online archivu tvojí kapely.",
  // en: `${name} invited you to bandplate, your band's online archive.`
  inviteWhatBy: (name: string): string =>
    `${name} tě zve do bandplate, online archivu tvojí kapely.`,
  inviteButton: "Přijmout pozvánku", // en: Accept invite
  // en: If this was a mistake, just ignore this message.
  // "Byl omyl" agrees with "omyl", a masculine noun — not with the reader.
  inviteFooter: "Pokud to byl omyl, zprávu klidně ignoruj.",

  setupSubject: "bandplate je nastavený", // en: bandplate is set up
  // en: Everything works now. Add your bandmates in the bandplate admin and start creating stuff!
  setupWhat: "Vše je nastaveno. Nyní jen přidej své spoluhráče v adminu a můžete začít tvořit!",
  setupButton: "Otevřít bandplate", // en: Open bandplate
  // en: You are getting this because you just set up this bandplate deployment.
  setupFooter:
    "Tahle zpráva přišla proto, že se právě dokončilo nastavení téhle instalace bandplate.",
} satisfies typeof enMail;
