import { describe, expect, it } from "vitest";
import { fixMp4Duration, withMp4Duration } from "./mp4-duration.js";

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = parts.flatMap((part) => [...part]);
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  );
  out.set(body, 8);
  return out;
}

function bytes(length: number, fill: (view: DataView) => void): Uint8Array {
  const out = new Uint8Array(length);
  fill(new DataView(out.buffer));
  return out;
}

/** A header body: version 0 is 4+4+4 then timescale+duration, version 1 is 4+8+8 then timescale+duration. */
function movieHeader(version: 0 | 1, timescale: number, duration: number): Uint8Array {
  return version === 0
    ? bytes(100, (v) => {
        v.setUint32(12, timescale);
        v.setUint32(16, duration);
      })
    : bytes(112, (v) => {
        v.setUint8(0, 1);
        v.setUint32(20, timescale);
        v.setBigUint64(24, BigInt(duration));
      });
}

function trackHeader(duration: number): Uint8Array {
  return bytes(84, (v) => v.setUint32(20, duration));
}

function mediaHeader(timescale: number, duration: number): Uint8Array {
  return bytes(24, (v) => {
    v.setUint32(12, timescale);
    v.setUint32(16, duration);
  });
}

function file(version: 0 | 1, durations: { movie: number; track: number; media: number }) {
  return new Uint8Array([
    ...box("ftyp", new Uint8Array([105, 115, 111, 109])),
    ...box(
      "moov",
      box("mvhd", movieHeader(version, 1000, durations.movie)),
      box(
        "trak",
        box("tkhd", trackHeader(durations.track)),
        box("mdia", box("mdhd", mediaHeader(44100, durations.media))),
      ),
    ),
    ...box("moof", new Uint8Array(8)),
  ]);
}

function durationsOf(out: Uint8Array) {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const text = String.fromCharCode(...out.subarray(0, 512));
  const mvhd = text.indexOf("mvhd") + 4;
  const tkhd = text.indexOf("tkhd") + 4;
  const mdhd = text.indexOf("mdhd") + 4;
  return {
    movie:
      view.getUint8(mvhd) === 1 ? Number(view.getBigUint64(mvhd + 24)) : view.getUint32(mvhd + 16),
    track: view.getUint32(tkhd + 20),
    media: view.getUint32(mdhd + 16),
  };
}

describe("withMp4Duration", () => {
  it("writes the length into the movie, track and media headers, in each one's timescale", () => {
    const out = withMp4Duration(file(0, { movie: 0, track: 0, media: 0 }), 2_500);
    expect(durationsOf(out)).toEqual({ movie: 2_500, track: 2_500, media: 110_250 });
  });

  it("handles a version 1 movie header", () => {
    const out = withMp4Duration(file(1, { movie: 0, track: 0, media: 0 }), 4_000);
    expect(durationsOf(out).movie).toBe(4_000);
  });

  it("changes no size, so no offset moves", () => {
    const input = file(0, { movie: 0, track: 0, media: 0 });
    expect(withMp4Duration(input, 2_500).length).toBe(input.length);
  });

  it("leaves a header that already has a length alone", () => {
    const input = file(0, { movie: 900, track: 900, media: 900 });
    expect(withMp4Duration(input, 2_500)).toBe(input);
  });

  it("leaves what is not an MP4, and a length that is not a length, alone", () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(withMp4Duration(junk, 2_500)).toBe(junk);
    const input = file(0, { movie: 0, track: 0, media: 0 });
    expect(withMp4Duration(input, 0)).toBe(input);
    expect(withMp4Duration(input, Number.NaN)).toBe(input);
  });
});

describe("fixMp4Duration", () => {
  it("keeps the type and everything after the header", async () => {
    const input = file(0, { movie: 0, track: 0, media: 0 });
    const tail = new Uint8Array(200_000).fill(7);
    const blob = new Blob([input, tail], { type: "audio/mp4" });
    const fixed = await fixMp4Duration(blob, 2_500);
    const out = new Uint8Array(await fixed.arrayBuffer());
    expect(fixed.type).toBe("audio/mp4");
    expect(out.length).toBe(blob.size);
    expect(durationsOf(out).movie).toBe(2_500);
    expect(out.subarray(input.length).every((b) => b === 7)).toBe(true);
  });
});
