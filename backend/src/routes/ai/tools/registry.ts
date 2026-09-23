import type { AiProposal } from "@ctp/shared";
// `Queryable` is imported, never re-derived — see `routes/events/service.ts`.
import type { Queryable } from "../../events/service.js";
import type { HandleMap } from "../handles.js";
import { PROPOSE_TOOLS } from "./propose.js";
import { READ_TOOLS } from "./read.js";

/**
 * What a tool runs against. `db` and `userId` carry the caller's own
 * permissions — a tool never widens them. `staged` is the proposal a
 * propose-tool writes into; a read tool never touches it.
 */
export interface ToolContext {
  db: Queryable;
  userId: string;
  tier: number;
  handles: HandleMap;
  staged: AiProposal;
}

/**
 * One callable the model may invoke. `minTier` is the UX filter (§4.4):
 * offering a tool the caller's tier cannot use would just draft a proposal
 * that meets a 403 the moment they try to confirm it. The SECURITY boundary
 * is the registry's own contents — `READ_TOOLS`/`PROPOSE_TOOLS` below name
 * every capability the assistant has, full stop.
 */
export interface Tool {
  name: string;
  minTier: number;
  describe: string;
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<unknown>;
}

export { PROPOSE_TOOLS, READ_TOOLS };

const ALL_TOOLS: readonly Tool[] = [...READ_TOOLS, ...PROPOSE_TOOLS];

/** Every tool the caller's tier may use — reads first, so the model reaches for one before proposing. */
export function toolsFor(tier: number): Tool[] {
  return ALL_TOOLS.filter((tool) => tool.minTier <= tier);
}

/**
 * Looks a tool up by name and runs it. Both refusals below are RETURNED to
 * the model as an ordinary tool result, never thrown: a tool the caller may
 * not use, or one that does not exist, is something the assistant should
 * explain in its reply, not a 500 that aborts the turn.
 */
export async function runTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = ALL_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) return { error: "Unknown tool" };
  if (tool.minTier > ctx.tier) return { error: "You do not have permission to do that." };
  return tool.run(ctx, args);
}
