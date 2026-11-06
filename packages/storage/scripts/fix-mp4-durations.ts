// One-off repair of recordings already in the bucket whose MP4 header says
// "duration 0" (MediaRecorder's fragmented MP4, before `mp4-duration.ts` fixed
// it at record time). The same function that fixes a new recording fixes
// these: it rewrites the first 64 KiB, no box changes size, and the rest of
// the object is byte for byte what it was.
//
//   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com S3_BUCKET=bandplate \
//   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
//   node packages/storage/scripts/fix-mp4-durations.ts [--apply] [--backup-dir DIR]
//
// Needs `ffprobe` on PATH: the length written is the one measured from the
// file's own fragments, since this script does not read the database.
//
// DRY RUN BY DEFAULT: it lists what it would change and writes nothing. With
// `--apply` every object is first downloaded to the backup directory (default
// `./mp4-duration-backup`) and the copy is verified against what the bucket
// sent; only then is the object overwritten, and the new header is read back.
// An object whose backup is already there is not downloaded or changed twice.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AwsClient } from "aws4fetch";
import { withMp4Duration } from "../../../apps/web/src/client/mp4-duration.ts";

const HEAD_BYTES = 64 * 1024;

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(2);
  }
  return value;
}

const endpoint = need("S3_ENDPOINT").replace(/\/+$/, "");
const bucket = need("S3_BUCKET");
const client = new AwsClient({
  accessKeyId: need("S3_ACCESS_KEY_ID"),
  secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
  service: "s3",
  region: process.env.S3_REGION ?? "auto",
});
const apply = process.argv.includes("--apply");
const backupFlag = process.argv.indexOf("--backup-dir");
const backupDir =
  (backupFlag >= 0 ? process.argv[backupFlag + 1] : undefined) ?? "./mp4-duration-backup";

const objectUrl = (key: string) =>
  `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

async function listKeys(): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const url = new URL(`${endpoint}/${bucket}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", "takes/");
    if (token) url.searchParams.set("continuation-token", token);
    const res = await client.fetch(url);
    if (!res.ok) throw new Error(`list: HTTP ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1] as string);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1]
      : undefined;
  } while (token);
  return keys.filter((k) => k.endsWith(".m4a"));
}

async function head(key: string): Promise<Uint8Array> {
  const res = await client.fetch(objectUrl(key), {
    headers: { range: `bytes=0-${HEAD_BYTES - 1}` },
  });
  if (!res.ok) throw new Error(`head ${key}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function measuredMs(whole: Uint8Array): number {
  const dir = mkdtempSync(join(tmpdir(), "mp4fix-"));
  try {
    const file = join(dir, "in.m4a");
    writeFileSync(file, whole);
    const out = execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ]);
    return Math.round(Number.parseFloat(out.toString()) * 1000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let changed = 0;
let untouched = 0;
let failed = 0;
for (const key of await listKeys()) {
  try {
    const start = await head(key);
    // Anything but "this header says 0" is left exactly as it is.
    if (withMp4Duration(start, 1000) === start) {
      untouched += 1;
      continue;
    }
    if (!apply) {
      console.log(`would fix  ${key}`);
      changed += 1;
      continue;
    }

    const res = await client.fetch(objectUrl(key));
    if (!res.ok) throw new Error(`get: HTTP ${res.status}`);
    const whole = new Uint8Array(await res.arrayBuffer());
    const expected = Number(res.headers.get("content-length"));
    if (whole.length !== expected) throw new Error(`short read: ${whole.length} of ${expected}`);

    const copy = join(backupDir, key);
    if (!existsSync(copy)) {
      mkdirSync(dirname(copy), { recursive: true });
      writeFileSync(copy, whole);
    }
    const written = new Uint8Array((await import("node:fs")).readFileSync(copy));
    if (written.length !== whole.length || sha(written) !== sha(whole)) {
      throw new Error("backup does not match the download; not touching the object");
    }

    const ms = measuredMs(whole);
    if (!(ms > 0)) throw new Error("ffprobe found no length");
    const fixedHead = withMp4Duration(whole.subarray(0, HEAD_BYTES), ms);
    const fixed = new Uint8Array(whole.length);
    fixed.set(whole);
    fixed.set(fixedHead);

    const put = await client.fetch(objectUrl(key), {
      method: "PUT",
      headers: { "content-type": res.headers.get("content-type") ?? "audio/mp4" },
      body: fixed,
    });
    if (!put.ok) throw new Error(`put: HTTP ${put.status}`);

    const after = await head(key);
    if (withMp4Duration(after, 1000) !== after)
      throw new Error("header still says 0 after the write");
    console.log(`fixed      ${key}  (${(ms / 1000).toFixed(1)} s)`);
    changed += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAILED     ${key}: ${err instanceof Error ? err.message : err}`);
  }
}
console.log(
  `${apply ? "fixed" : "would fix"} ${changed}, already fine ${untouched}, failed ${failed}${apply ? `, backups in ${backupDir}` : ""}`,
);
process.exit(failed > 0 ? 1 : 0);
