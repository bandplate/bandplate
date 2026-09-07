#!/usr/bin/env node
// Dev upload script — Node tooling (not part of the runtime library),
// same category as `migrate.ts`/`seed/run.ts`. Puts REAL, encoded audio
// bytes behind every ready master/stem asset row already in the database
// (typically from `seed/run.ts`), against a real S3-compatible bucket
// (MinIO in local dev). Without this, the seed's asset ROWS exist but the
// objects they point at don't — the audio endpoint would 404/error and
// the player would have nothing to actually play.
//
// Generates real audio via `ffmpeg` (required — refuses to run without
// it, rather than faking content the browser then fails to decode; see
// the task-7 brief's "must be real encoded files"). Each asset gets a
// distinct, deterministic sine tone (frequency derived from the asset id)
// so stems are audibly distinguishable from each other and from the
// master — not because that's musically meaningful, but so "switch to
// Solo: Bass and hear something different" is genuinely verifiable by
// ear, not just by the network tab.
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createS3Storage } from "@bandlib/storage";
import { createClient } from "@libsql/client";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { schema } from "../src/client.js";
import { resolveDatabaseUrl } from "../src/database-url.js";
import * as assetsRepo from "../src/repos/assets.js";
import { assets as assetsTable } from "../src/schema/sqlite/index.js";

const execFileAsync = promisify(execFile);

const DURATION_SECONDS = 20;
const MIN_FREQ_HZ = 220;
const MAX_FREQ_HZ = 880;

interface RequiredS3Env {
  endpoint: string;
  publicEndpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `dev-upload-audio: missing required env var ${name}. This script needs the same S3_* config apps/web uses (see apps/web/.env.example) — point it at your local MinIO, e.g. via deploy/node/compose.yml.`,
    );
  }
  return value;
}

function readS3Env(): RequiredS3Env {
  return {
    endpoint: requireEnv("S3_ENDPOINT"),
    publicEndpoint: requireEnv("S3_PUBLIC_ENDPOINT"),
    bucket: requireEnv("S3_BUCKET"),
    region: requireEnv("S3_REGION"),
    accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
  };
}

function assertFfmpegAvailable(): void {
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (result.status !== 0) {
    throw new Error(
      "dev-upload-audio: ffmpeg is required to generate real encoded audio fixtures, and was " +
        "not found on PATH. Install it (e.g. `brew install ffmpeg` / `apt install ffmpeg`) and " +
        "re-run — this script deliberately does not fall back to fake/silent content, since the " +
        "point is audio the browser can actually decode and play.",
    );
  }
}

/** A stable pseudo-frequency in [MIN_FREQ_HZ, MAX_FREQ_HZ], derived from the asset id (FNV-1a — same technique `seed/run.ts` uses for its duration, for the same "deterministic, not random" reason). */
function toneFrequencyHz(assetId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < assetId.length; i++) {
    hash ^= assetId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const unit = (hash >>> 0) / 0xffffffff;
  return Math.round(MIN_FREQ_HZ + unit * (MAX_FREQ_HZ - MIN_FREQ_HZ));
}

/** ffmpeg's audio codec flags for the formats this app's assets actually use. `wav`/`json` aren't produced by the seed and aren't handled here. */
function encoderArgsFor(format: string): string[] {
  if (format === "mp3") {
    return ["-c:a", "libmp3lame", "-b:a", "128k"];
  }
  if (format === "flac") {
    return ["-c:a", "flac"];
  }
  throw new Error(`dev-upload-audio: no encoder configured for format "${format}"`);
}

async function generateTone(format: string, frequencyHz: number, outPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequencyHz}:duration=${DURATION_SECONDS}`,
    "-ac",
    "2",
    "-ar",
    "44100",
    ...encoderArgsFor(format),
    outPath,
  ]);
}

async function main(): Promise<void> {
  assertFfmpegAvailable();
  const s3Env = readS3Env();

  const dbUrl = resolveDatabaseUrl(process.env, "uploading dev audio fixtures");
  const client = createClient({ url: dbUrl });
  const db = drizzle(client, { schema });

  const storage = createS3Storage({
    endpoint: s3Env.endpoint,
    publicEndpoint: s3Env.publicEndpoint,
    bucket: s3Env.bucket,
    region: s3Env.region,
    accessKeyId: s3Env.accessKeyId,
    secretAccessKey: s3Env.secretAccessKey,
  });

  const rows = await db
    .select()
    .from(assetsTable)
    .where(and(inArray(assetsTable.kind, ["master", "stem"]), eq(assetsTable.status, "ready")));

  if (rows.length === 0) {
    console.log(
      "dev-upload-audio: no ready master/stem asset rows found — run `pnpm --filter @bandlib/db " +
        "run seed` first.",
    );
    client.close();
    return;
  }

  console.log(`Uploading real audio for ${rows.length} asset(s) to ${s3Env.bucket}...`);

  const tmpDir = await mkdtemp(join(tmpdir(), "bandlib-dev-audio-"));
  try {
    let uploaded = 0;
    for (const asset of rows) {
      const frequencyHz = toneFrequencyHz(asset.id);
      const outPath = join(tmpDir, `${asset.id}.${asset.format}`);
      await generateTone(asset.format, frequencyHz, outPath);
      const bytes = await readFile(outPath);

      await storage.put(asset.storageKey, new Uint8Array(bytes), asset.contentType);
      await assetsRepo.updateAudioMeta(db, asset.id, {
        bytes: bytes.byteLength,
        durationMs: DURATION_SECONDS * 1000,
      });

      uploaded += 1;
      console.log(
        `  [${uploaded}/${rows.length}] ${asset.storageKey} (${frequencyHz}Hz tone, ` +
          `${(bytes.byteLength / 1024).toFixed(0)} KiB)`,
      );
    }
    console.log(`Done — ${uploaded} object(s) uploaded to ${s3Env.bucket}.`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
