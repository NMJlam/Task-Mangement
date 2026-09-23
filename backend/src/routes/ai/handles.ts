import { AiOutputError } from "./service.js";

export type HandleKind = "T" | "E" | "M";

/**
 * The rule that makes a hallucinated identifier impossible: the model never
 * sees a UUID. Read tools hand it `T1`, `E2`, `M3`, and only a handle this run
 * actually issued resolves back to a row. Persisted into `ai_run.steps`, so a
 * later apply in the same run can still resolve what the model was shown.
 */
export class HandleMap {
  readonly #byHandle = new Map<string, string>();
  readonly #byId = new Map<string, string>();
  readonly #counts: Record<HandleKind, number> = { T: 0, E: 0, M: 0 };

  issue(kind: HandleKind, id: string): string {
    const existing = this.#byId.get(id);
    if (existing) return existing;
    this.#counts[kind] += 1;
    const handle = `${kind}${this.#counts[kind]}`;
    this.#byHandle.set(handle, id);
    this.#byId.set(id, handle);
    return handle;
  }

  resolve(handle: string): string {
    const id = this.#byHandle.get(handle);
    if (!id) throw new AiOutputError(`The assistant referred to ${handle}, which does not exist.`);
    return id;
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.#byHandle);
  }

  static from(map: Record<string, string>): HandleMap {
    const restored = new HandleMap();
    for (const [handle, id] of Object.entries(map)) {
      const kind = handle[0] as HandleKind;
      restored.#byHandle.set(handle, id);
      restored.#byId.set(id, handle);
      restored.#counts[kind] = Math.max(restored.#counts[kind], Number(handle.slice(1)) || 0);
    }
    return restored;
  }
}
