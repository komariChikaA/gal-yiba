import { describe, expect, it } from "vitest";
import { formatTime, playlist } from "./playlist.js";

describe("music playlist", () => {
  it("starts with 星めぐりの歌 by Metronome", () => {
    expect(playlist[0]).toMatchObject({
      title: "星めぐりの歌",
      artist: "Metronome",
      file: "/music/hoshi-meguri-no-uta.mp3",
    });
  });
});

describe("formatTime", () => {
  it("formats seconds as m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });

  it("handles invalid input", () => {
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(-3)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});
