import { describe, expect, it } from "vitest";
import { apiUrl, publicAsset } from "./config";

describe("public asset helpers", () => {
  it("prefixes API paths with the optional remote origin", () => {
    expect(apiUrl("/api/health")).toMatch(/\/api\/health$/);
  });

  it("keeps a leading-slash public file under the Vite base", () => {
    expect(publicAsset("/music/hoshi-meguri-no-uta.mp3")).toContain(
      "music/hoshi-meguri-no-uta.mp3",
    );
  });
});
