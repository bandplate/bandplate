// Tři obrazovky, na které se člověk dostane bez přihlášení.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání), matching the English — this is the  │
// │ first thing anyone reads, so it sets the tone for the whole app.        │
// │                                                                        │
// │ ONE THING TO CHECK CAREFULLY: `sentLede`. The English is vague ON       │
// │ PURPOSE — saying "we sent it" would confirm the address exists and turn │
// │ the member list into an enumeration oracle. The Czech has to stay just  │
// │ as non-committal. Do not "improve" it into "Odeslali jsme ti odkaz".    │
// │                                                                        │
// │ GLOSSARY: keeper → držák · sign-in link → přihlašovací odkaz            │
// └────────────────────────────────────────────────────────────────────────┘
import type { auth as enAuth } from "../en/auth.js";

export const auth = {
  signInTitle: "Přihlášení", // en: Sign in
  setupTitle: "Nastavení bandplate", // en: Set up bandplate

  heading: "Přihlášení", // en: Sign in
  lede: "Zadej e-mail. Pošleme ti odkaz.", // en: Enter your email. We'll send you a link.
  // en: We'll send your sign-in link to the address your invite went to.
  invitedLede: "Přihlašovací odkaz pošleme na adresu, kam ti přišla pozvánka.",
  emailLabel: "E-mailová adresa", // en: Email address
  emailRequired: "Zadej svou e-mailovou adresu.", // en: Enter your email address.
  submit: "Poslat odkaz", // en: Send me a link

  sentTitle: "Mrkni do e-mailu", // en: Check your email
  // en: If that address is registered, a link is on its way.
  // Stays deliberately non-committal — see the note at the top of this file.
  sentLede: "Pokud je ta adresa zaregistrovaná, odkaz je na cestě.",
  sentUseAnother: "Použít jinou adresu", // en: Use a different address

  slowTitle: "Dej tomu chvilku", // en: Give it a minute
  // en: `Too many sign-in requests from here. Try again in about ${seconds} seconds.`
  //
  // "sekund" is the genitive plural, which is what Czech takes after any
  // number this counter realistically shows (5 and up). The English "about"
  // becomes "asi za", which reads as an estimate rather than a deadline.
  slowLede: (seconds: string): string =>
    `Moc pokusů o přihlášení odsud. Zkus to znovu asi za ${seconds} sekund.`,
  slowNote: "odkaz, který už ti přišel, pořád platí", // en: any link already sent still works

  signingInAs: "Přihlašuješ se jako", // en: Signing in as
  yourself: "sebe", // en: yourself
  tokenSubmit: "Přihlásit se do bandplate", // en: Sign in to bandplate
  notYou: "Nejsi to ty?", // en: Not you?
  notYouLink: "Vyžádej si vlastní odkaz", // en: Ask for your own link

  spentTitle: "Odkaz je vyčerpaný", // en: That link is spent
  // en: Sign-in links work once and last 15 minutes. This one has expired or has already been used.
  spentLede:
    "Přihlašovací odkazy fungují jednou a platí 15 minut. Tenhle už vypršel nebo byl použitý.",
  spentAction: "Poslat nový odkaz", // en: Send me a new link

  setupHeading: "Nastavení archivu", // en: Set up the archive
  // en: Create the first admin. You'll need the bootstrap token from your server's environment.
  setupLede: "Vytvoř prvního správce. Budeš potřebovat bootstrap token z prostředí serveru.",
  setupTokenLabel: "Bootstrap token", // en: Bootstrap token
  setupNameLabel: "Tvoje jméno", // en: Your name
  setupEmailLabel: "Tvoje e-mailová adresa", // en: Your email address
  setupSubmit: "Vytvořit prvního správce", // en: Create the first admin
  // en: That bootstrap token isn't right. Check your server configuration.
  setupBadToken: "Ten bootstrap token nesedí. Zkontroluj konfiguraci serveru.",
  // en: bandplate is already set up. Sign in instead.
  setupAlreadyDone: "bandplate už je nastavený. Přihlas se.",

  setupOkHeading: "Jsi uvnitř", // en: You're in
  // en: You're signed in as the first admin, and bandplate is ready to use.
  setupOkLede: "Jsi přihlášený jako první správce a bandplate je připravený.",
  setupGoToAdmin: "Přejít do správy", // en: Go to admin

  setupMailOkTitle: "Testovací e-mail odeslán", // en: Test email sent
  // en: The mailer works — a confirmation email went out to your address.
  setupMailOkBody: "Odesílání funguje. Potvrzovací e-mail šel na tvoji adresu.",

  setupMailFailTitle: "Testovací e-mail se nepodařilo odeslat", // en: Test email failed to send
  // en: Members won't be able to sign in by email until this is fixed. You're still signed in, so you can fix it and carry on.
  setupMailFailLede:
    "Dokud to nespravíš, členové se nepřihlásí e-mailem. Ty přihlášený zůstáváš, takže to můžeš spravit a pokračovat.",
  // en: The provider's own error explains why, and it's only in the server log:
  setupMailFailWhere: "Chybu hlásí poskytovatel a je jen v logu serveru:",
  setupMailFailWorkers: "Na Workers:", // en: On Workers:
  // en: On a container: read the app's stdout.
  setupMailFailContainer: "V kontejneru: přečti stdout aplikace.",
  // en: Most often it's the wrong API key, or a From address the provider hasn't verified yet.
  setupMailFailCommon:
    "Většinou je to špatný API klíč nebo adresa odesílatele, kterou poskytovatel ještě neověřil.",
} satisfies typeof enAuth;
