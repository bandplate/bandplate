// Is the Cloudflare build's cron actually wired to something? Run from
// `astro.config.mjs`'s `bandplate-cron-wiring` build hook against the
// generated `dist/server/wrangler.json` and the built `dist/server/entry.mjs`.
//
// Why this exists: since `@astrojs/cloudflare` 13 the Worker's entry is
// `wrangler.toml`'s `main`, and when `main` is missing the adapter quietly
// uses its stock entry, which exports `fetch` and nothing else. The build
// passes, the deploy passes, the site works, and `[triggers] crons` fires
// into a Worker with no `scheduled` handler, so notifications stop with no
// error anywhere. The check below turns that into a failed build.
//
// It inspects the BUILT entry rather than the `main` string, because the
// entry is what Cloudflare runs: a `main` that points somewhere unexpected
// but still exports `scheduled` is fine, and a correct-looking `main` whose
// file lost its `scheduled` export is not.

export type CronWiring = { ok: true } | { ok: false; reason: string };

/** `triggers.crons` from the generated wrangler.json, tolerating its absence. */
export function cronsOf(wranglerJson: unknown): string[] {
  if (typeof wranglerJson !== "object" || wranglerJson === null) {
    return [];
  }
  const triggers = (wranglerJson as { triggers?: unknown }).triggers;
  if (typeof triggers !== "object" || triggers === null) {
    return [];
  }
  const crons = (triggers as { crons?: unknown }).crons;
  return Array.isArray(crons) ? crons.filter((c): c is string => typeof c === "string") : [];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The source of the object literal the bundle exports as `default`, or
 * `undefined` when the shape is not the one Rolldown emits
 * (`var X = { ... };` plus `export { X as default };`).
 */
export function defaultExportObject(entrySource: string): string | undefined {
  const exportMatch = /export\s*\{[^}]*?\b([A-Za-z_$][\w$]*)\s+as\s+default\b[^}]*\}/.exec(
    entrySource,
  );
  if (!exportMatch?.[1]) {
    return undefined;
  }
  const name = escapeRegExp(exportMatch[1]);
  const declMatch = new RegExp(`(?:var|let|const)\\s+${name}\\s*=\\s*\\{`).exec(entrySource);
  if (!declMatch) {
    return undefined;
  }
  // Walk to the matching brace. Braces inside strings or comments in this
  // literal would throw the count off; the entry's default export is a
  // handful of handler properties, so that is not a shape it takes.
  const start = declMatch.index + declMatch[0].length - 1;
  let depth = 0;
  for (let i = start; i < entrySource.length; i++) {
    const ch = entrySource[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return entrySource.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

/** A top-level `scheduled` property: `scheduled: ...`, `scheduled(`, `async scheduled(`. */
function hasScheduledProperty(objectSource: string): boolean {
  return /(^|[{,\n])\s*(async\s+)?scheduled\s*[:(]/.test(objectSource);
}

/**
 * Is Workers Logs actually on in the generated wrangler.json? A production
 * `wrangler.toml` missing `[observability]` (or with `enabled` anything but
 * `true`) builds and deploys cleanly, and every structured
 * `console.error(JSON.stringify({...}))` this app emits (see
 * `packages/core/src/log-error.ts`) goes nowhere — Cloudflare's dashboard
 * Logs tab stays empty with no error at deploy or runtime. The build hook
 * that calls this treats that as a failed build, not a silent gap.
 */
export function checkObservability(wranglerJson: unknown): CronWiring {
  const fix =
    "Add `[observability]` with `enabled = true` to wrangler.toml (see wrangler.toml.example).";
  if (typeof wranglerJson !== "object" || wranglerJson === null) {
    return {
      ok: false,
      reason: `wrangler.toml has no readable \`[observability]\` section. ${fix}`,
    };
  }
  const observability = (wranglerJson as { observability?: unknown }).observability;
  if (typeof observability !== "object" || observability === null) {
    return {
      ok: false,
      reason: `wrangler.toml has no \`[observability]\` section, so Workers Logs stays off silently. ${fix}`,
    };
  }
  const enabled = (observability as { enabled?: unknown }).enabled;
  if (enabled !== true) {
    return {
      ok: false,
      reason:
        `wrangler.toml's \`[observability]\` section does not set \`enabled = true\` ` +
        `(got ${JSON.stringify(enabled)}), so Workers Logs stays off silently. ${fix}`,
    };
  }
  return { ok: true };
}

export function checkCronWiring(input: {
  crons: readonly string[];
  entrySource: string;
}): CronWiring {
  if (input.crons.length === 0) {
    return { ok: true };
  }
  const fix =
    'Set `main = "./src/worker.ts"` in apps/web/wrangler.toml (see wrangler.toml.example), then build again.';
  const crons = input.crons.join(", ");
  const exported = defaultExportObject(input.entrySource);
  if (exported === undefined) {
    return {
      ok: false,
      reason:
        `wrangler.toml declares cron trigger(s) ${crons}, but the built Worker entry's default export ` +
        `could not be found, so there is no way to tell whether it handles them. ${fix}`,
    };
  }
  if (!hasScheduledProperty(exported)) {
    return {
      ok: false,
      reason:
        `wrangler.toml declares cron trigger(s) ${crons}, but the built Worker exports no \`scheduled\` ` +
        "handler, so every cron run would do nothing. This is what the adapter's stock entry looks like: " +
        `\`main\` is missing or points elsewhere. ${fix}`,
    };
  }
  return { ok: true };
}
