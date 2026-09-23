import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GEMINI_MODEL, aiConfig } from "./ai.js";

const AI_ENV_KEYS = ["AI_ENABLED", "GEMINI_API_KEY", "GEMINI_MODEL", "AI_DAILY_RUN_CAP"] as const;

// aiConfig() reads process.env directly, and vitest runs every file in this
// worker's shared process, so each case gets a clean slate and the ambient
// value (from the repo .env, or the CI/shell environment) is restored after.
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of AI_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of AI_ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("aiConfig", () => {
  describe("enabled (R14 default-OFF gate)", () => {
    it("is false when nothing is set", () => {
      expect(aiConfig().enabled).toBe(false);
    });

    it("is false when AI_ENABLED=1 but GEMINI_API_KEY is absent", () => {
      process.env.AI_ENABLED = "1";
      expect(aiConfig().enabled).toBe(false);
    });

    it("is false when AI_ENABLED=1 but GEMINI_API_KEY is empty", () => {
      process.env.AI_ENABLED = "1";
      process.env.GEMINI_API_KEY = "";
      expect(aiConfig().enabled).toBe(false);
    });

    it("is false when a key is set but AI_ENABLED is unset", () => {
      process.env.GEMINI_API_KEY = "some-key";
      expect(aiConfig().enabled).toBe(false);
    });

    it('is false when a key is set but AI_ENABLED is any value other than "1"', () => {
      process.env.GEMINI_API_KEY = "some-key";
      process.env.AI_ENABLED = "true";
      expect(aiConfig().enabled).toBe(false);
    });

    it("is true only when AI_ENABLED=1 and a non-empty key are both present", () => {
      process.env.AI_ENABLED = "1";
      process.env.GEMINI_API_KEY = "some-key";
      expect(aiConfig().enabled).toBe(true);
    });
  });

  describe("apiKey", () => {
    it("is an empty string when GEMINI_API_KEY is absent", () => {
      expect(aiConfig().apiKey).toBe("");
    });

    it("is the raw env value when GEMINI_API_KEY is set", () => {
      process.env.GEMINI_API_KEY = "some-key";
      expect(aiConfig().apiKey).toBe("some-key");
    });
  });

  describe("model", () => {
    it("falls back to DEFAULT_GEMINI_MODEL when GEMINI_MODEL is unset", () => {
      expect(aiConfig().model).toBe(DEFAULT_GEMINI_MODEL);
    });

    it("returns the env value when GEMINI_MODEL is set", () => {
      process.env.GEMINI_MODEL = "gemini-3.0-pro";
      expect(aiConfig().model).toBe("gemini-3.0-pro");
    });
  });

  describe("dailyRunCap", () => {
    it("defaults to 50 when AI_DAILY_RUN_CAP is unset", () => {
      expect(aiConfig().dailyRunCap).toBe(50);
    });

    it("returns the parsed env value when AI_DAILY_RUN_CAP is a valid number", () => {
      process.env.AI_DAILY_RUN_CAP = "10";
      expect(aiConfig().dailyRunCap).toBe(10);
    });
  });
});
