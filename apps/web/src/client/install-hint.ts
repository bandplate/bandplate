// Which install affordance `/me` shows, if any.
//
// Pure, because the rule is the whole feature and the DOM half is two
// property reads. Three answers:
//   prompt     the browser handed us `beforeinstallprompt` (Chrome, Android);
//              a real button that opens the browser's own dialog.
//   ios-steps  iOS, where no prompt API exists. Words, not a button: there is
//              nothing a button could do.
//   none       already installed, or a browser that will not install this.
//              No affordance that cannot work.
//
// `ios-steps` also needs `iosSignInWorks`, currently always false: the
// installed iOS app gets its own cookie jar, separate from Safari's, and the
// emailed sign-in link opens in Safari. Until sign-in by code exists,
// telling an iPhone member to install leads to an app they cannot sign into.

export type InstallHint = "none" | "prompt" | "ios-steps";

export interface InstallEnvironment {
  standalone: boolean;
  promptAvailable: boolean;
  userAgent: string;
  maxTouchPoints: number;
  iosSignInWorks: boolean;
}

export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    return true;
  }
  // iPadOS 13+ requests the desktop site and reports as a Mac.
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export function decideInstallHint(env: InstallEnvironment): InstallHint {
  if (env.standalone) {
    return "none";
  }
  if (env.promptAvailable) {
    return "prompt";
  }
  return isIos(env.userAgent, env.maxTouchPoints) && env.iosSignInWorks ? "ios-steps" : "none";
}
