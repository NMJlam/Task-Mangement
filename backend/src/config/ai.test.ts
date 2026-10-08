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

/** Sets exactly these variables for one read; the hooks above restore the rest. */
function withEnv(env: Partial<Record<(typeof AI_ENV_KEYS)[number], string>>) {
  for (const key of AI_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  return aiConfig();
}

describe("aiConfig", () => {
  it("is enabled only with AI_ENABLED=1 and a non-empty key (R14 default-OFF gate)", () => {
    expect(withEnv({}).enabled).toBe(false);
    expect(withEnv({ AI_ENABLED: "1" }).enabled).toBe(false);
    expect(withEnv({ AI_ENABLED: "1", GEMINI_API_KEY: "" }).enabled).toBe(false);
    expect(withEnv({ GEMINI_API_KEY: "some-key" }).enabled).toBe(false);
    expect(withEnv({ AI_ENABLED: "true", GEMINI_API_KEY: "some-key" }).enabled).toBe(false);
    expect(withEnv({ AI_ENABLED: "1", GEMINI_API_KEY: "some-key" }).enabled).toBe(true);
  });

  it("defaults the key, model and daily cap, and takes each from the environment", () => {
    expect(withEnv({})).toMatchObject({ apiKey: "", model: DEFAULT_GEMINI_MODEL, dailyRunCap: 50 });
    expect(
      withEnv({
        GEMINI_API_KEY: "some-key",
        GEMINI_MODEL: "gemini-3.0-pro",
        AI_DAILY_RUN_CAP: "10",
      }),
    ).toMatchObject({ apiKey: "some-key", model: "gemini-3.0-pro", dailyRunCap: 10 });
  });
});
