import { beforeEach, describe, expect, it } from "vitest";
import {
  featureCodeToPlayerId,
  loadFeatureCode,
  loadPlayerId,
  normalizeFeatureCode,
  resolvePlayerId,
  saveFeatureCode,
} from "./identity";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

beforeEach(() => {
  globalThis.localStorage = makeStorage();
});

describe("normalizeFeatureCode", () => {
  it("trims, uppercases, and strips non-alphanumerics", () => {
    expect(normalizeFeatureCode("  abc-123 ")).toBe("ABC123");
    expect(normalizeFeatureCode("qwe中文")).toBe("QWE");
  });
});
describe("featureCodeToPlayerId", () => {
  it("is deterministic and produces a valid uuid v4 shape", () => {
    const first = featureCodeToPlayerId("GALYIBA");
    const second = featureCodeToPlayerId("GALYIBA");
    expect(first).toBe(second);
    expect(first).toMatch(UUID_V4);
  });

  it("normalizes case before deriving (via resolvePlayerId)", () => {
    expect(resolvePlayerId("galyiba")).toBe(resolvePlayerId("GALYIBA"));
  });

  it("differs across distinct codes", () => {
    expect(featureCodeToPlayerId("CODE123")).not.toBe(
      featureCodeToPlayerId("CODE124"),
    );
  });
});

describe("resolvePlayerId", () => {
  it("uses the code-derived identity for codes of 4+ characters", () => {
    const derived = resolvePlayerId("MYCODE");
    expect(derived).toBe(featureCodeToPlayerId("MYCODE"));
    expect(derived).toMatch(UUID_V4);
  });

  it("falls back to an anonymous persisted identity for short or empty codes", () => {
    const short = resolvePlayerId("AB");
    expect(short).toMatch(UUID_V4);
    expect(short).not.toBe(featureCodeToPlayerId("AB"));
    expect(loadPlayerId()).toBe(short);
  });
});

describe("saveFeatureCode", () => {
  it("stores the normalized code and clears on empty input", () => {
    saveFeatureCode("  aB3-xy ");
    expect(loadFeatureCode()).toBe("AB3XY");
    saveFeatureCode("");
    expect(loadFeatureCode()).toBe("");
  });
});
