// Asset declaration + upload-URL issuance — contract v1 §3/§4's retry
// semantics: re-posting a take returns the existing row with freshly
// signed URLs, and per declared asset, a matching `sha256`+`bytes` against
// an already-`ready` row skips it (no `url`), while a mismatch resets the
// slot to `pending` and reissues a URL against the SAME storage key (an
// overwrite, never an orphan).
import { masterStorageKey, peaksStorageKey, stemStorageKey } from "@bandlib/core";
import type { Storage } from "@bandlib/core";
import { type Db, assetsRepo } from "@bandlib/db";
import type { AssetInput } from "./schemas.js";
import { UPLOAD_URL_TTL_SECONDS, contentTypeForFormat, hexSha256ToBase64 } from "./support.js";

export interface UploadItemPending {
  assetId: string;
  kind: assetsRepo.AssetKind;
  instrument: string | null;
  tier: assetsRepo.AssetTier;
  storageKey: string;
  status: "pending";
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface UploadItemReady {
  assetId: string;
  kind: assetsRepo.AssetKind;
  instrument: string | null;
  status: "ready";
}

export type UploadItem = UploadItemPending | UploadItemReady;

function slotStorageKey(
  takeId: string,
  kind: assetsRepo.AssetKind,
  instrumentSlug: string | null,
  tier: assetsRepo.AssetTier,
  format: assetsRepo.AssetFormat,
): string {
  if (kind === "peaks") {
    return peaksStorageKey(takeId);
  }
  if (kind === "stem") {
    // biome-ignore lint/style/noNonNullAssertion: caller only reaches here for kind === "stem", which always carries an instrument slug
    return stemStorageKey(takeId, instrumentSlug!, tier, format);
  }
  return masterStorageKey(takeId, tier, format);
}

/**
 * Reconciles the take's declared asset list against whatever rows already
 * exist for it (idempotent create-or-reset per slot), returning the full
 * set of asset rows afterward, in the same order as `declared`.
 */
export async function syncDeclaredAssets(
  db: Db,
  now: number,
  takeId: string,
  declared: AssetInput[],
  instrumentBySlug: Map<string, string>,
): Promise<assetsRepo.Asset[]> {
  const results: assetsRepo.Asset[] = [];

  for (const item of declared) {
    const instrumentId =
      item.kind === "stem" ? (instrumentBySlug.get(item.instrument) ?? null) : null;
    const instrumentSlug = item.kind === "stem" ? item.instrument : null;
    const storageKey = slotStorageKey(takeId, item.kind, instrumentSlug, item.tier, item.format);
    const contentType = contentTypeForFormat(item.format);

    const existing = await assetsRepo.getBySlot(
      db,
      takeId,
      item.kind,
      instrumentId,
      item.tier,
      item.format,
    );

    if (!existing) {
      const [created] = await assetsRepo.createMany(db, [
        {
          takeId,
          kind: item.kind,
          instrumentId,
          tier: item.tier,
          format: item.format,
          storageKey,
          contentType,
          bytes: item.bytes,
          sha256: item.sha256 ?? null,
          durationMs: "durationMs" in item ? (item.durationMs ?? null) : null,
          sampleRate: "sampleRate" in item ? (item.sampleRate ?? null) : null,
          channels: "channels" in item ? (item.channels ?? null) : null,
          status: "pending",
          createdAt: now,
        },
      ]);
      // biome-ignore lint/style/noNonNullAssertion: createMany([one input]) always returns exactly one row
      results.push(created!);
      continue;
    }

    const hashMatches =
      existing.status === "ready" &&
      existing.bytes === item.bytes &&
      (item.sha256 === undefined || item.sha256 === null || existing.sha256 === item.sha256);

    if (hashMatches) {
      results.push(existing);
      continue;
    }

    await assetsRepo.resetForReupload(db, existing.id, {
      bytes: item.bytes,
      sha256: item.sha256 ?? null,
      contentType,
      durationMs: "durationMs" in item ? (item.durationMs ?? null) : null,
      sampleRate: "sampleRate" in item ? (item.sampleRate ?? null) : null,
      channels: "channels" in item ? (item.channels ?? null) : null,
    });
    results.push({
      ...existing,
      status: "pending",
      bytes: item.bytes,
      sha256: item.sha256 ?? null,
      contentType,
      readyAt: null,
    });
  }

  return results;
}

/** Builds the `uploads` response array — fresh presigned URLs for pending assets, bare status for ready ones. */
export async function buildUploadItems(
  storage: Storage,
  now: number,
  assets: assetsRepo.Asset[],
  instrumentIdToSlug: Map<string, string>,
): Promise<UploadItem[]> {
  const items: UploadItem[] = [];
  for (const asset of assets) {
    const instrument = asset.instrumentId
      ? (instrumentIdToSlug.get(asset.instrumentId) ?? null)
      : null;

    if (asset.status === "ready") {
      items.push({ assetId: asset.id, kind: asset.kind, instrument, status: "ready" });
      continue;
    }

    const headers: Record<string, string> = { "Content-Type": asset.contentType };
    let checksumSha256: string | undefined;
    if (asset.sha256) {
      checksumSha256 = hexSha256ToBase64(asset.sha256);
      headers["x-amz-checksum-sha256"] = checksumSha256;
    }

    const url = await storage.signedUploadUrl(asset.storageKey, {
      contentType: asset.contentType,
      contentLength: asset.bytes,
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      checksumSha256,
    });

    items.push({
      assetId: asset.id,
      kind: asset.kind,
      instrument,
      tier: asset.tier,
      storageKey: asset.storageKey,
      status: "pending",
      method: "PUT",
      url,
      headers,
      expiresAt: new Date(now + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    });
  }
  return items;
}
