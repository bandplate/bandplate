// Asset declaration for the INGEST contract specifically — contract v1
// §3/§4's retry semantics, where a re-posted take declares its whole manifest
// again and re-running must converge.
//
// The per-slot decision (what names a slot, what happens to the object
// already in it, when a hash match means "skip") moved to
// `@bandplate/core`'s `resolveSlotForUpload`, because the browser's upload
// panel needs exactly the same rule. What stays here is the part that is
// genuinely the bridge's: treating the declared list as the WHOLE truth for
// this take. A browser adding one file to a take must not have its other
// files reconciled away, which is why it calls `resolveSlotForUpload` one
// slot at a time instead of this.
import type { DeclaredAsset, Storage } from "@bandplate/core";
import { resolveSlotForUpload } from "@bandplate/core";
import type { Db, assetsRepo } from "@bandplate/db";
import type { AssetInput } from "./schemas.js";

/**
 * Reconciles the take's declared asset list against whatever rows already
 * exist for it (idempotent create-or-reset per slot), returning the full set
 * of asset rows afterward, in the same order as `declared`.
 *
 * Always `replace: true`: contract v1 §3 says a re-declaration IS the new
 * truth, so there is no "are you sure" for a machine that has just re-rendered
 * the file. The browser is the caller that passes `false` and asks a person.
 */
export async function syncDeclaredAssets(
  db: Db,
  storage: Storage,
  now: number,
  takeId: string,
  declared: AssetInput[],
  instrumentBySlug: Map<string, string>,
): Promise<assetsRepo.Asset[]> {
  const results: assetsRepo.Asset[] = [];

  for (const item of declared) {
    const normalized: DeclaredAsset = {
      kind: item.kind,
      instrumentId: item.kind === "stem" ? (instrumentBySlug.get(item.instrument) ?? null) : null,
      instrumentSlug: item.kind === "stem" ? item.instrument : null,
      tier: item.tier,
      format: item.format,
      bytes: item.bytes,
      sha256: item.sha256 ?? null,
      // These three are only present on some arms of the declared union, so
      // they are read defensively rather than destructured.
      durationMs: "durationMs" in item ? (item.durationMs ?? null) : null,
      sampleRate: "sampleRate" in item ? (item.sampleRate ?? null) : null,
      channels: "channels" in item ? (item.channels ?? null) : null,
    };

    const { asset } = await resolveSlotForUpload(db, storage, now, takeId, normalized, {
      replace: true,
    });
    results.push(asset);
  }

  return results;
}
