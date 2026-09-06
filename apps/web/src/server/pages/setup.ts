// `/setup` page logic — bootstraps the first admin. The page itself 404s
// once any member exists (checked by the page directly via `membersRepo`,
// same as the API's `GET /setup`); this module only handles the POST.
import type { AuthDeps } from "@bandlib/core";
import { bootstrapAdmin } from "@bandlib/core";
import type { Db } from "@bandlib/db";
import { membersRepo } from "@bandlib/db";
import { z } from "zod";

export async function isBootstrapAvailable(db: Db): Promise<boolean> {
  const count = await membersRepo.count(db);
  return count === 0;
}

const bootstrapSchema = z.object({
  bootstrapToken: z.string().min(1, "Enter the bootstrap token."),
  displayName: z.string().trim().min(1, "Enter a display name.").max(200),
  email: z.string().trim().min(1, "Enter an email address.").max(320),
});

export type BootstrapFieldErrors = Partial<
  Record<"bootstrapToken" | "displayName" | "email", string>
>;

export type BootstrapPostResult =
  | { kind: "ok"; sessionToken: string; testEmailSent: boolean }
  | { kind: "invalid"; errors: BootstrapFieldErrors }
  | { kind: "bad_token" }
  | { kind: "already_bootstrapped" };

export async function handleSetupPost(
  auth: AuthDeps,
  formData: FormData,
): Promise<BootstrapPostResult> {
  const raw = {
    bootstrapToken: formData.get("bootstrapToken"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
  };
  const parsed = bootstrapSchema.safeParse({
    bootstrapToken: typeof raw.bootstrapToken === "string" ? raw.bootstrapToken : "",
    displayName: typeof raw.displayName === "string" ? raw.displayName : "",
    email: typeof raw.email === "string" ? raw.email : "",
  });
  if (!parsed.success) {
    const errors: BootstrapFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "bootstrapToken" || key === "displayName" || key === "email") {
        errors[key] = issue.message;
      }
    }
    return { kind: "invalid", errors };
  }

  const result = await bootstrapAdmin(auth, parsed.data);
  if (!result.ok || !result.sessionToken) {
    if (result.reason === "already-bootstrapped") {
      return { kind: "already_bootstrapped" };
    }
    return { kind: "bad_token" };
  }

  return {
    kind: "ok",
    sessionToken: result.sessionToken,
    testEmailSent: result.testEmailSent === true,
  };
}
