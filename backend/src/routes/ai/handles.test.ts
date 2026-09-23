import { describe, expect, it } from "vitest";
import { HandleMap } from "./handles.js";
import { AiOutputError } from "./service.js";

const uuid = (n: number) => `0192f1a0-0000-7000-8000-00000000000${n}`;

describe("HandleMap", () => {
  it("issues sequential handles per kind", () => {
    const map = new HandleMap();
    expect(map.issue("T", uuid(1))).toBe("T1");
    expect(map.issue("T", uuid(2))).toBe("T2");
    expect(map.issue("E", uuid(3))).toBe("E1");
  });

  it("reuses the handle already issued for a row", () => {
    const map = new HandleMap();
    expect(map.issue("T", uuid(1))).toBe("T1");
    expect(map.issue("T", uuid(1))).toBe("T1");
  });

  it("resolves an issued handle back to its id", () => {
    const map = new HandleMap();
    const handle = map.issue("E", uuid(4));
    expect(map.resolve(handle)).toBe(uuid(4));
  });

  it("rejects a handle this run never issued", () => {
    expect(() => new HandleMap().resolve("T9")).toThrow(AiOutputError);
  });

  it("round-trips through JSON so it can live in ai_run.steps", () => {
    const map = new HandleMap();
    const handle = map.issue("M", uuid(5));
    expect(HandleMap.from(map.toJSON()).resolve(handle)).toBe(uuid(5));
  });
});
