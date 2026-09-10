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
// │ `loginFooter` must stay as non-committal as the English: it deliberately│
// │ does NOT confirm that the address is registered, for the same reason    │
// │ `/login` answers identically either way.                                │
// └────────────────────────────────────────────────────────────────────────┘
import type { mail as enMail } from "../en/mail.js";

export const mail = {
  greeting: (displayName: string): string => `Ahoj ${displayName},`, // en: `Hi ${displayName},`
  greetingAnonymous: "Ahoj,", // en: Hi,
  signOff: "— bandplate", // en: — bandplate
  orPaste: "Nebo si tohle vlož do prohlížeče:", // en: Or paste this into your browser:

  loginSubject: "Tvůj přihlašovací odkaz do bandplate", // en: Your sign-in link for bandplate
  loginLead: (life: string): string => `Tady je odkaz pro přihlášení. ${life}`, // en: `Here is your link to sign in. ${life}`
  // en: `It works once, and only for the next ${n} ${n === 1 ? "minute" : "minutes"}.`
  //
  // 1 minutu · 2–4 minuty · 5+ minut — accusative after "na", which is what
  // the count governs here.
  loginLife: (minutes: number): string =>
    `Funguje jednou a jen následujících ${minutes} ${minutes === 1 ? "minutu" : minutes < 5 ? "minuty" : "minut"}.`,
  loginLifeNoExpiry: "Funguje jednou.", // en: It works once.
  loginButton: "Přihlásit se do bandplate", // en: Sign in to bandplate
  // en: You are getting this because someone entered this address on the bandplate sign-in page. If that was not you, ignore it — nobody can sign in without the link.
  loginFooter:
    "Tenhle e-mail ti přišel, protože někdo zadal tuhle adresu na přihlašovací stránce bandplate. Pokud jsi to nebyl ty, nevšímej si ho — bez odkazu se nikdo nepřihlásí.",

  inviteSubject: "Byl jsi přidán do bandplate", // en: You've been added to bandplate
  // en: You've been added to bandplate — your band's rehearsal and recording archive.
  inviteWhat: "Byl jsi přidán do bandplate — archivu zkoušek a nahrávek tvojí kapely.",
  // en: There's no password to set up. Go to the sign-in page, enter this address (${address}), and we'll email you a link that signs you in.
  inviteHow: (address: string): string =>
    `Žádné heslo se nenastavuje. Běž na přihlašovací stránku, zadej tuhle adresu (${address}) a pošleme ti e-mailem odkaz, kterým se přihlásíš.`,
  inviteButton: "Na přihlašovací stránku", // en: Go to the sign-in page
  // en: An admin of your band added this address. If you were not expecting it, you can ignore this message.
  inviteFooter:
    "Tuhle adresu přidal správce tvojí kapely. Jestli jsi to nečekal, můžeš zprávu ignorovat.",

  setupSubject: "bandplate je nastavený", // en: bandplate is set up
  // en: Mail is working. That was the last thing standing between your band and their archive — everyone signs in by a link sent to this address, so nothing else works without it.
  setupWhat:
    "Odesílání e-mailů funguje. To bylo poslední, co stálo mezi kapelou a jejím archivem — všichni se přihlašují odkazem poslaným na tuhle adresu, takže bez toho nic nefunguje.",
  // en: Add your bandmates from the admin area, and they'll each get an invite like this one.
  setupNext: "Přidej spoluhráče ve správě a každému přijde pozvánka jako tahle.",
  setupButton: "Otevřít bandplate", // en: Open bandplate
  // en: You are getting this because you just set up this bandplate deployment.
  setupFooter: "Tenhle e-mail ti přišel, protože jsi právě nastavil tuhle instalaci bandplate.",
} satisfies typeof enMail;
