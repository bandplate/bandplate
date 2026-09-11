#!/usr/bin/env python3
"""bandplate ingest reference client — contract v1.

A dependency-light Python client for the ingest API described in
docs/ingest-contract-v1.md. It exists for two reasons:

  1. It is executable proof that the server-side implementation actually
     matches the frozen contract, exercised as a real HTTP client rather
     than through the server's own test suite.
  2. It is meant to be read (and forked) by whoever builds the real Reaper
     bridge — it implements exactly the §10 "recommended bridge sequence"
     and nothing else, with every idempotency-relevant decision commented
     at the point it's made.

Standard library only (urllib, json, hashlib, argparse, pathlib) — no
`requests`, no third-party dependency at all, so it stays trivially
readable and installable anywhere Python 3.9+ runs.

--- Folder convention this client expects -----------------------------

    <project_dir>/
      .bandplate-ingest.json      <- sidecar: event + per-take clientRefs
                                    (created on first run; contract v1 §3:
                                    "Generate a UUID on first ingest and
                                    write it to a sidecar file beside the
                                    .rpp" — this file plays that role)
      <take-name>/
        master.<ext>             <- required: the take's mixed-down master
        <instrument-slug>.<ext>  <- optional: one file per captured stem,
                                    named exactly as the bandplate instrument
                                    slug (see GET /ingest/v1/instruments)
        peaks.json               <- optional: the master's waveform,
                                    1000 ints in -128..127
        <instrument-slug>.peaks.json
                                 <- optional: that stem's OWN waveform.
                                    Contract v1 §5: a waveform describes one
                                    source, so each gets its own. Without it
                                    a lane in the mixer draws a plain rail —
                                    which is honest, but it is the picture
                                    someone is reading to find out which stem
                                    is making the noise.

A real Reaper bridge would render these paths directly out of its own
region/track data; this client only needs the finished files, so nothing
here is Reaper-specific.

--- Usage ---------------------------------------------------------------

    python3 bandplate_ingest.py \\
        --base-url http://localhost:27510/api \\
        --token bpk_...  \\
        --project /path/to/session1 \\
        --event-kind rehearsal --venue "Zkušebna Vysočany" \\
        --create-missing-songs

Re-running the exact same command is always safe — see the module's own
idempotency comments below.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SIDECAR_NAME = ".bandplate-ingest.json"

FORMAT_BY_EXT = {
    ".opus": "opus",
    ".mp3": "mp3",
    ".flac": "flac",
    ".wav": "wav",
}
LOSSLESS_FORMATS = {"flac", "wav"}


class IngestError(RuntimeError):
    def __init__(self, status: int, body: dict[str, Any]):
        super().__init__(f"HTTP {status}: {json.dumps(body)}")
        self.status = status
        self.body = body


@dataclass
class Sidecar:
    path: Path
    event_client_ref: str
    take_client_refs: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load_or_create(cls, project_dir: Path) -> "Sidecar":
        path = project_dir / SIDECAR_NAME
        if path.exists():
            data = json.loads(path.read_text())
            return cls(path, data["eventClientRef"], data.get("takes", {}))
        # First ingest of this project: mint the event's clientRef ONCE and
        # persist it before any network call — contract v1 §3's "generate a
        # UUID on first ingest and write it to a sidecar file beside the
        # .rpp". Persisting before the POST (not after) is what makes a
        # crash between "generated" and "used" harmless: on the next run we
        # load the SAME ref from disk rather than minting a second one.
        sidecar = cls(path, event_client_ref=f"event:{uuid.uuid4()}")
        sidecar.save()
        return sidecar

    def save(self) -> None:
        self.path.write_text(
            json.dumps(
                {"eventClientRef": self.event_client_ref, "takes": self.take_client_refs},
                indent=2,
            )
        )

    def take_ref(self, take_name: str) -> str:
        ref = self.take_client_refs.get(take_name)
        if ref is None:
            # Prefer a Reaper region GUID in a real bridge (contract v1
            # §3); this demo client has no region GUID to hand, so it
            # mints and persists its own opaque ref per take-folder name —
            # same requirement either way: generate once, persist before
            # first use, reuse forever.
            ref = f"take:{uuid.uuid4()}"
            self.take_client_refs[take_name] = ref
            self.save()
        return ref


def sha256_file(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size


@dataclass
class DeclaredAsset:
    kind: str
    path: Path | None
    tier: str
    format: str
    bytes: int
    sha256: str | None
    instrument: str | None = None

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.kind, "tier": self.tier, "format": self.format, "bytes": self.bytes}
        if self.sha256:
            out["sha256"] = self.sha256
        if self.instrument:
            out["instrument"] = self.instrument
        return out


def discover_take_assets(take_dir: Path) -> list[DeclaredAsset]:
    assets: list[DeclaredAsset] = []
    for entry in sorted(take_dir.iterdir()):
        if not entry.is_file():
            continue
        stem, ext = entry.stem, entry.suffix.lower()
        # `peaks.json` is the master's; `<slug>.peaks.json` is that stem's own.
        # Matched exactly rather than by a trailing "peaks.json", or a file
        # called `bass_peaks.json` would be filed against the instrument
        # `bass` — a silent misread is worse than not recognising it at all.
        is_peaks = entry.name == "peaks.json" or entry.name.endswith(".peaks.json")
        if is_peaks:
            # The slug is validated against the vocabulary server-side, so a
            # typo is refused rather than attached to the wrong source.
            # `master.peaks.json` is the master's too — the symmetry with
            # `master.<ext>` makes it the name a bridge author will reach for,
            # and `master` is not an instrument slug, so the server would
            # otherwise refuse the whole take over a file name.
            named = entry.name[: -len(".peaks.json")] if entry.name != "peaks.json" else ""
            instrument = None if named in ("", "master") else named
            sha, size = sha256_file(entry)
            assets.append(
                DeclaredAsset(
                    kind="peaks",
                    path=entry,
                    tier="lossy",
                    format="json",
                    bytes=size,
                    sha256=sha,
                    instrument=instrument,
                )
            )
            continue
        fmt = FORMAT_BY_EXT.get(ext)
        if fmt is None:
            continue  # not an asset this client understands — skip silently
        tier = "lossless" if fmt in LOSSLESS_FORMATS else "lossy"
        sha, size = sha256_file(entry)
        if stem == "master":
            assets.append(DeclaredAsset(kind="master", path=entry, tier=tier, format=fmt, bytes=size, sha256=sha))
        else:
            assets.append(
                DeclaredAsset(
                    kind="stem", path=entry, tier=tier, format=fmt, bytes=size, sha256=sha, instrument=stem
                )
            )
    return assets


class Client:
    def __init__(self, base_url: str, token: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as e:
            payload = json.loads(e.read() or b"{}")
            raise IngestError(e.code, payload) from None

    def post_event(self, client_ref: str, kind: str, held_at: str, venue: str | None, notes: str | None) -> dict:
        return self._request(
            "POST",
            "/ingest/v1/events",
            {"clientRef": client_ref, "kind": kind, "heldAt": held_at, "venue": venue, "notes": notes},
        )

    def post_take(self, body: dict[str, Any]) -> dict:
        return self._request("POST", "/ingest/v1/takes", body)

    def get_uploads(self, take_id: str) -> dict:
        return self._request("GET", f"/ingest/v1/takes/{take_id}/uploads")

    def commit(self, take_id: str, publish: bool = True) -> dict:
        return self._request("POST", f"/ingest/v1/takes/{take_id}/commit", {"publish": publish})

    def instruments(self) -> dict:
        return self._request("GET", "/ingest/v1/instruments")


def put_bytes(url: str, headers: dict[str, str], path: Path) -> None:
    data = path.read_bytes()
    req = urllib.request.Request(url, data=data, method="PUT")
    content_type = headers.get("Content-Type") or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    for key, value in headers.items():
        req.add_header(key, value)
    if "Content-Type" not in headers:
        req.add_header("Content-Type", content_type)
    with urllib.request.urlopen(req, timeout=120) as resp:
        if resp.status >= 300:
            raise IngestError(resp.status, {"error": {"code": "upload_failed", "message": "PUT failed"}})


def upload_asset(client: Client, take_id: str, upload: dict[str, Any], asset_by_id: dict[str, DeclaredAsset]) -> str:
    """PUTs one declared asset's bytes to its presigned URL, refreshing the
    URL on a 403 (contract v1 §4 "Expiry": treat this as normal operation,
    not an error path) and returning what happened, for the caller's log.
    """
    asset = asset_by_id[upload["assetId"]]
    assert asset.path is not None
    try:
        put_bytes(upload["url"], upload["headers"], asset.path)
        return "uploaded"
    except urllib.error.HTTPError as e:
        if e.code == 403:
            fresh = client.get_uploads(take_id)
            fresh_upload = next(u for u in fresh["uploads"] if u["assetId"] == upload["assetId"])
            if fresh_upload["status"] == "ready":
                return "already-ready"
            put_bytes(fresh_upload["url"], fresh_upload["headers"], asset.path)
            return "uploaded-after-refresh"
        raise


def ingest_project(
    client: Client,
    project_dir: Path,
    *,
    event_kind: str,
    held_at: str,
    venue: str | None,
    notes: str | None,
    create_missing_songs: bool,
    max_uploads: int | None = None,
    log=print,
) -> dict[str, Any]:
    """Runs the full §10 sequence for one project directory. `max_uploads`
    is a TEST HOOK ONLY (simulates a crash mid-session by refusing to start
    more than N uploads across the whole run) — a real bridge has no such
    parameter; it just dies for real reasons (laptop sleep, network drop)
    and gets re-run.
    """
    sidecar = Sidecar.load_or_create(project_dir)
    event = client.post_event(sidecar.event_client_ref, event_kind, held_at, venue, notes)
    log(f"event: {event}")

    uploads_started = 0
    results: dict[str, Any] = {"eventId": event["eventId"], "takes": []}

    for take_dir in sorted(p for p in project_dir.iterdir() if p.is_dir()):
        take_client_ref = sidecar.take_ref(take_dir.name)
        declared = discover_take_assets(take_dir)
        if not any(a.kind in ("master", "stem") for a in declared):
            log(f"  skipping {take_dir.name}: no master/stem asset found")
            continue

        take_body = {
            "clientRef": take_client_ref,
            "eventClientRef": sidecar.event_client_ref,
            "song": {
                "externalRef": take_client_ref,
                "title": take_dir.name.replace("-", " ").replace("_", " "),
                "createIfMissing": create_missing_songs,
            },
            "recordedAt": held_at,
            "instruments": [a.instrument for a in declared if a.kind == "stem"],
            "assets": [a.to_json() for a in declared],
        }
        take = client.post_take(take_body)
        log(f"  take {take_dir.name}: takeId={take['takeId']} state={take['state']} songMatch={take.get('songMatch')}")

        asset_by_id = {}
        # Pair each declared asset back to its server-assigned assetId by
        # matching (kind, instrument) — the order `uploads` comes back in
        # matches the order assets were declared in the request body.
        for declared_asset, upload in zip(declared, take["uploads"]):
            asset_by_id[upload["assetId"]] = declared_asset

        take_result = {"takeName": take_dir.name, "takeId": take["takeId"], "uploads": []}
        for upload in take["uploads"]:
            if upload["status"] == "ready":
                take_result["uploads"].append({"assetId": upload["assetId"], "outcome": "skipped-already-ready"})
                log(f"    {upload['kind']}: already ready, skipping upload")
                continue

            if max_uploads is not None and uploads_started >= max_uploads:
                log(f"    {upload['kind']}: SIMULATED CRASH before starting this upload")
                take_result["uploads"].append({"assetId": upload["assetId"], "outcome": "not-started (simulated crash)"})
                results["takes"].append(take_result)
                results["crashed"] = True
                return results

            uploads_started += 1
            outcome = upload_asset(client, take["takeId"], upload, asset_by_id)
            take_result["uploads"].append({"assetId": upload["assetId"], "outcome": outcome})
            log(f"    {upload['kind']}: {outcome}")

        commit = client.commit(take["takeId"], publish=True)
        log(f"  commit: state={commit['state']}")
        take_result["state"] = commit["state"]
        results["takes"].append(take_result)

    results["crashed"] = False
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", required=True, help="e.g. http://localhost:4321/api")
    parser.add_argument("--token", required=True, help="bpk_{tokenId}_{secret}")
    parser.add_argument("--project", required=True, type=Path, help="project directory (see module docstring)")
    parser.add_argument("--event-kind", default="rehearsal", choices=["rehearsal", "concert", "session"])
    parser.add_argument("--held-at", default=None, help="ISO-8601 with offset; defaults to now")
    parser.add_argument("--venue", default=None)
    parser.add_argument("--notes", default=None)
    parser.add_argument("--create-missing-songs", action="store_true")
    parser.add_argument(
        "--simulate-crash-after-uploads",
        type=int,
        default=None,
        help="TEST HOOK: stop after starting N uploads, to demonstrate a resumed run",
    )
    args = parser.parse_args()

    held_at = args.held_at
    if held_at is None:
        import datetime

        held_at = datetime.datetime.now().astimezone().isoformat(timespec="seconds")

    client = Client(args.base_url, args.token)
    try:
        result = ingest_project(
            client,
            args.project,
            event_kind=args.event_kind,
            held_at=held_at,
            venue=args.venue,
            notes=args.notes,
            create_missing_songs=args.create_missing_songs,
            max_uploads=args.simulate_crash_after_uploads,
        )
    except IngestError as e:
        print(f"ingest failed: {e}", file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2))
    return 1 if result.get("crashed") else 0


if __name__ == "__main__":
    raise SystemExit(main())
