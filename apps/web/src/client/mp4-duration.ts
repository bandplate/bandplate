// MediaRecorder's MP4 is fragmented and written as it goes, so the header
// (`moov`) is out before anyone knows how long the recording is: the movie,
// track and media headers all say duration 0, and there is no `mehd` or
// `sidx` to say it instead. A browser then reads the length off what it has
// played so far, so the clock ends at the playhead and the seek bar has
// nowhere to go. The recorder measured the length, so it is written into the
// three headers here, the way `fix-webm-duration` does for WebM.
//
// Only the header is rewritten, in place: no box changes size, so no offset
// moves, and the fragments after it are not read at all.

const MOVIE_TIMESCALE_MS = 1000;

interface Header {
  /** Offset of the duration field. */
  at: number;
  /** 8 bytes for a version 1 header, 4 for version 0. */
  wide: boolean;
  timescale: number;
}

function u32(view: DataView, at: number): number {
  return view.getUint32(at);
}

function boxType(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at + 4),
    view.getUint8(at + 5),
    view.getUint8(at + 6),
    view.getUint8(at + 7),
  );
}

/** The boxes between `start` and `end`, as [type, offset of the box, end of the box]. */
function boxes(view: DataView, start: number, end: number): [string, number, number][] {
  const found: [string, number, number][] = [];
  let at = start;
  while (at + 8 <= end) {
    const size = u32(view, at);
    // 0 (to the end) and 1 (64-bit size) are not in a header MediaRecorder writes.
    if (size < 8 || at + size > end) {
      break;
    }
    found.push([boxType(view, at), at, at + size]);
    at += size;
  }
  return found;
}

/** A `mvhd`, `tkhd` or `mdhd`: where its duration is and what timescale it counts in. */
function headerAt(view: DataView, box: number, kind: "mvhd" | "tkhd" | "mdhd"): Header | null {
  const body = box + 8;
  const wide = view.getUint8(body) === 1;
  // version+flags, creation, modification, then: mvhd/mdhd timescale+duration,
  // tkhd track id + reserved + duration (in the movie's timescale).
  const times = wide ? 16 : 8;
  if (kind === "tkhd") {
    const at = body + 4 + times + 4 + 4;
    return { at, wide, timescale: MOVIE_TIMESCALE_MS };
  }
  const timescale = u32(view, body + 4 + times);
  return { at: body + 4 + times + 4, wide, timescale };
}

function write(view: DataView, header: Header, ms: number): void {
  const ticks = Math.round((ms / 1000) * header.timescale);
  if (header.wide) {
    view.setBigUint64(header.at, BigInt(ticks));
  } else {
    view.setUint32(header.at, Math.min(ticks, 0xffffffff));
  }
}

function isZero(view: DataView, header: Header): boolean {
  return header.wide ? view.getBigUint64(header.at) === 0n : view.getUint32(header.at) === 0;
}

/**
 * The bytes with the duration written into the headers that say 0, or the
 * same bytes when there is nothing to fix: not an MP4, a header that already
 * has a length, or one this does not understand.
 */
export function withMp4Duration(bytes: Uint8Array, durationMs: number): Uint8Array {
  if (!(durationMs > 0)) {
    return bytes;
  }
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const moov = boxes(view, 0, bytes.byteLength).find(([type]) => type === "moov");
    if (!moov) {
      return bytes;
    }
    const headers: Header[] = [];
    let movieHeader: Header | null = null;
    for (const [type, at, end] of boxes(view, moov[1] + 8, moov[2])) {
      if (type === "mvhd") {
        movieHeader = headerAt(view, at, "mvhd");
      } else if (type === "trak") {
        for (const [inner, innerAt, innerEnd] of boxes(view, at + 8, end)) {
          if (inner === "tkhd") {
            headers.push(headerAt(view, innerAt, "tkhd") as Header);
          } else if (inner === "mdia") {
            for (const [deep, deepAt] of boxes(view, innerAt + 8, innerEnd)) {
              if (deep === "mdhd") {
                headers.push(headerAt(view, deepAt, "mdhd") as Header);
              }
            }
          }
        }
      }
    }
    if (!movieHeader || !isZero(view, movieHeader)) {
      return bytes;
    }
    const out = bytes.slice();
    const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
    for (const header of [movieHeader, ...headers]) {
      write(outView, header, durationMs);
    }
    return out;
  } catch {
    return bytes;
  }
}

/** Enough to hold `ftyp` and `moov`, which MediaRecorder writes first and which are a few hundred bytes. */
const HEAD_BYTES = 64 * 1024;

/** `withMp4Duration` for a Blob: only the head is read, and the rest of the file is passed through untouched. */
export async function fixMp4Duration(blob: Blob, durationMs: number): Promise<Blob> {
  const head = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  const fixed = withMp4Duration(head, durationMs);
  if (fixed === head) {
    return blob;
  }
  return new Blob([fixed as Uint8Array<ArrayBuffer>, blob.slice(head.byteLength)], {
    type: blob.type,
  });
}
