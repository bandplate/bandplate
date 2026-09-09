import { type Db, assetsRepo } from "@bandplate/db";
// Asset slots: what names one, what occupies it, and how a caller gets a
// presigned URL to fill it.
//
// This lives in `core` rather than in the ingest routes because there are now
// TWO front doors that declare assets — the bridge's `/ingest/v1/*` JSON
// contract and the browser's own upload panel — and the rule for "is this the
// same slot, and what happens to the object already in it" must be one
// implementation. `services/members.ts` made the same move for the same
// reason after the API route and the Astro page had drifted apart; the
// comment at the top of that file is the precedent.
//
// What is deliberately NOT here: `syncDeclaredAssets`, which reconciles a
// WHOLE declared manifest against a take and is the shape of the ingest
// contract alone ("re-running must converge"). It stays in the ingest routes
// and is now a loop over `resolveSlotForUpload`. A browser adding one file to
// a take it has already half-filled must not be told that the files it did
// not mention this time should go away.
import type { Storage } from "../ports/index.js";
import { masterStorageKey, peaksStorageKey, stemStorageKey } from "../storage-keys.js";

type AssetKind = assetsRepo.AssetKind;
type AssetTier = assetsRepo.AssetTier;
type AssetFormat = assetsRepo.AssetFormat;

/** Presigned PUT URLs live 1 hour — contract v1 §4 "Expiry". */
export const UPLOAD_URL_TTL_SECONDS = 60 * 60;

/**
 * MIME type for each on-disk asset format — used both for the stored
 * `assets.contentType` column and the `Content-Type` header the presigned PUT
 * URL enforces. The signature covers that header, so this value is not
 * cosmetic: get it wrong and the bucket rejects the upload with a 403 that
 * looks like a signing bug.
 */
export function contentTypeForFormat(format: AssetFormat): string {
  switch (format) {
    case "opus":
      return "audio/ogg";
    case "mp3":
      return "audio/mpeg";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "json":
      return "application/json";
  }
}

/**
 * Converts a lowercase-hex SHA-256 digest (the shape the ingest contract's
 * `sha256` field uses) to standard base64 — the encoding S3's
 * `x-amz-checksum-sha256` header and `AwsClient`'s checksum signing expect
 * (NOT base64url; see `crypto.ts`, which only has a base64url encoder, for
 * token hashing, a different use case).
 *
 * Moved here alongside `buildUploadItems`, its only caller. The browser path
 * never produces a hash — `crypto.subtle.digest` needs the whole file as one
 * ArrayBuffer and there is no incremental SHA-256 in the platform, so a large
 * lossless master would kill the tab — but the bridge does, and the function
 * has to sit wherever the URL builder does.
 */
export function hexSha256ToBase64(hex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(`hexSha256ToBase64: not a 64-char hex string: ${hex}`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/**
 * Where one slot's object lives, composed from the three key builders in
 * `storage-keys.ts`.
 *
 * It sits here rather than in `storage-keys.ts` on purpose: that module is
 * deliberately dependency-free (it is imported by the db package's own seed
 * script), and this needs the asset enums from `@bandplate/db`. Putting it
 * there would close a module-level import cycle between the two packages.
 */
export function assetStorageKey(
  takeId: string,
  kind: AssetKind,
  instrumentSlug: string | null,
  tier: AssetTier,
  format: AssetFormat,
): string {
  if (kind === "peaks") {
    return peaksStorageKey(takeId);
  }
  if (kind === "stem") {
    if (!instrumentSlug) {
      throw new Error("assetStorageKey: a stem needs an instrument slug");
    }
    return stemStorageKey(takeId, instrumentSlug, tier, format);
  }
  return masterStorageKey(takeId, tier, format);
}

/**
 * One asset a caller wants to put on a take, normalized across both front
 * doors.
 *
 * It carries BOTH the instrument's id and its slug because the two callers
 * arrive holding different halves: the bridge speaks slugs (its Reaper track
 * mapping is slug-keyed), the browser speaks ids (its checkbox group renders
 * from the instruments table). The id is what the row stores; the slug is
 * what the storage key needs. Each caller fills in the other from the
 * instrument vocabulary it already loaded, rather than this module doing a
 * lookup neither caller needs twice.
 */
export interface DeclaredAsset {
  kind: AssetKind;
  /** The row's `instrument_id`. NULL for a master; required for a stem. */
  instrumentId: string | null;
  /** Used only to build the storage key. NULL for a master. */
  instrumentSlug: string | null;
  tier: AssetTier;
  format: AssetFormat;
  bytes: number;
  sha256?: string | null;
  durationMs?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
}

export type SlotOutcome =
  /** Nothing was in the slot; a `pending` row now is. */
  | "created"
  /** The slot held a `ready` row matching this declaration. Untouched. */
  | "unchanged"
  /** The slot's row was reset to `pending` for a fresh upload. */
  | "reset"
  /** Something is already here and the caller did not ask to replace it. */
  | "occupied";

export interface ResolveSlotResult {
  outcome: SlotOutcome;
  asset: assetsRepo.Asset;
}

export interface ResolveSlotOptions {
  /**
   * Whether the caller has authority to overwrite whatever is in the slot.
   *
   * The bridge always passes `true`: contract v1 §3 says re-running must
   * converge, so a re-declaration is by definition the new truth. The browser
   * passes `false` first and gets `occupied` back, which the UI turns into
   * "this take already has a lossy master (opus, 4.2 MB) — replace it?", then
   * retries with `true` once a person has said so. Uploading a file is not a
   * retry, and silently destroying the object already there is not something
   * to do on someone's behalf.
   */
  replace: boolean;
}

/**
 * Decide what happens to one asset slot, and leave the DB reflecting it.
 *
 * Slot identity is `(takeId, kind, instrumentId, tier)` for a master or stem
 * and `(takeId, kind)` alone for peaks — `format` is NOT part of it. See
 * `assetsRepo.getBySlot`'s own comment, which is the authority on why: the
 * format is a property of whatever currently occupies the slot, not part of
 * what names it, so re-rendering a lossy master as mp3 instead of opus lands
 * in the same slot and overwrites rather than orphaning.
 */
export async function resolveSlotForUpload(
  db: Db,
  storage: Storage,
  now: number,
  takeId: string,
  declared: DeclaredAsset,
  options: ResolveSlotOptions,
): Promise<ResolveSlotResult> {
  const storageKey = assetStorageKey(
    takeId,
    declared.kind,
    declared.instrumentSlug,
    declared.tier,
    declared.format,
  );
  const contentType = contentTypeForFormat(declared.format);

  const existing = await assetsRepo.getBySlot(
    db,
    takeId,
    declared.kind,
    declared.instrumentId,
    declared.tier,
  );

  if (!existing) {
    const [created] = await assetsRepo.createMany(db, [
      {
        takeId,
        kind: declared.kind,
        instrumentId: declared.instrumentId,
        tier: declared.tier,
        format: declared.format,
        storageKey,
        contentType,
        bytes: declared.bytes,
        sha256: declared.sha256 ?? null,
        durationMs: declared.durationMs ?? null,
        sampleRate: declared.sampleRate ?? null,
        channels: declared.channels ?? null,
        status: "pending",
        createdAt: now,
      },
    ]);
    // biome-ignore lint/style/noNonNullAssertion: createMany([one input]) always returns exactly one row
    return { outcome: "created", asset: created! };
  }

  if (!options.replace) {
    return { outcome: "occupied", asset: existing };
  }

  // A format change (master/stem) or a re-declared tier (peaks) changes what
  // the slot's row records even when bytes/hash happen to coincide, so either
  // always forces a reset — never treated as a hash match. `keyChanged`
  // (format differs) means the OBJECT KEY itself moves and the old object
  // needs cleanup; a peaks tier change updates the row's `tier` metadata
  // without the key moving (`peaksStorageKey` ignores tier), so nothing needs
  // deleting for that case.
  const keyChanged = existing.storageKey !== storageKey;
  const slotMetaChanged = keyChanged || existing.tier !== declared.tier;
  const hashMatches =
    !slotMetaChanged &&
    existing.status === "ready" &&
    existing.bytes === declared.bytes &&
    (declared.sha256 === undefined ||
      declared.sha256 === null ||
      existing.sha256 === declared.sha256);

  if (hashMatches) {
    return { outcome: "unchanged", asset: existing };
  }

  if (keyChanged) {
    // The slot's key changed shape (a format change on a master/stem
    // re-declaration) — the old object, if any, would otherwise be orphaned
    // in the bucket forever (contract v1 §3). Best-effort delete: the DB row
    // (source of truth) is updated regardless, so a failed bucket delete
    // leaves a harmless stray object rather than a dangling DB reference.
    try {
      await storage.delete([existing.storageKey]);
    } catch (err) {
      console.error("failed to delete superseded storage object", existing.storageKey, err);
    }
  }

  await assetsRepo.resetForReupload(db, existing.id, {
    bytes: declared.bytes,
    sha256: declared.sha256 ?? null,
    contentType,
    durationMs: declared.durationMs ?? null,
    sampleRate: declared.sampleRate ?? null,
    channels: declared.channels ?? null,
    ...(slotMetaChanged ? { storageKey, tier: declared.tier, format: declared.format } : {}),
  });

  return {
    outcome: "reset",
    asset: {
      ...existing,
      status: "pending",
      bytes: declared.bytes,
      sha256: declared.sha256 ?? null,
      contentType,
      readyAt: null,
      ...(slotMetaChanged ? { storageKey, tier: declared.tier, format: declared.format } : {}),
    },
  };
}

export interface UploadItemPending {
  assetId: string;
  kind: AssetKind;
  instrument: string | null;
  tier: AssetTier;
  storageKey: string;
  status: "pending";
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface UploadItemReady {
  assetId: string;
  kind: AssetKind;
  instrument: string | null;
  status: "ready";
}

export type UploadItem = UploadItemPending | UploadItemReady;

/** Fresh presigned URLs for pending assets, bare status for ready ones. */
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

/**
 * Whether a take has anything that can actually be listened to.
 *
 * This is the publish gate for both front doors, so it lives in one place and
 * they agree on the word. A peaks-only take can never publish: peaks describe
 * a waveform, they are not a recording. Ingest additionally requires that
 * EVERY declared asset be ready, because it declared a whole manifest up
 * front and can tell when it is complete; the browser has no manifest, so
 * "one playable file exists" is the strongest true statement available.
 */
export function canPublish(assets: assetsRepo.Asset[]): boolean {
  return assets.some((a) => (a.kind === "master" || a.kind === "stem") && a.status === "ready");
}
