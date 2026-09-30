import { AI_MAX_PROPOSALS } from "@ctp/shared";
import { CLUB_TIMEZONE } from "../../config/club.js";
import type { Tool } from "./tools/registry.js";

/** "Wednesday, 30 September 2026", on the club's calendar rather than the server's. */
function clubDate(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: CLUB_TIMEZONE,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}`;
}

/**
 * The tool list is built from what the CALLER may use, so a member is never
 * offered work they could not then approve. The handle rule is the load-bearing
 * line: it is why a hallucinated identifier cannot reach a query.
 *
 * Everything the model needs to act is said here or in a tool's description,
 * because it has nothing else to go on: it does not know the date unless told,
 * and "plan a hackathon" gives it no date to propose unless told to choose one.
 */
export function buildSystemPrompt(tools: Tool[], context: string, now: Date = new Date()): string {
  return [
    "You are the committee assistant for the Monash Association of Coding, a university club.",
    "You help members find work, plan events and balance workload. Be brief and concrete.",
    `Today is ${clubDate(now)} (${CLUB_TIMEZONE}).`,
    "",
    "TOOLS you may call:",
    ...tools.map((tool) => `- ${tool.name}: ${tool.describe}`),
    "",
    "RULES:",
    "- Refer to every existing task, event or member by the handle a tool gave you (T1, E2, M3).",
    "  Never invent a handle, and never write an id of any other form.",
    "- Use a ref like $event1 for an event you are proposing in this same turn.",
    "- Due dates on NEW tasks are dueOffsetDays, whole days relative to the event's start.",
    "  Negative is before it. Do not compute calendar dates yourself.",
    "- If the member gave no date for a new event, choose a sensible one a few weeks after today",
    "  and say which you chose. They can change it on the card before confirming.",
    `- Stage at most ${AI_MAX_PROPOSALS} proposals in one turn. If more work is needed, say so and ask.`,
    "- Propose; never claim you have created anything. A person confirms every change.",
    "- If a tool result has an error, correct the arguments and call the tool again.",
    "- In your reply to the member use people's names and task or event titles, never a handle:",
    "  T1 or M3 means nothing to them.",
    "",
    "TO PLAN AN EVENT: call pastEventPlans and listMembers, then proposeCreateEvent, then",
    "proposeCreateTasks (every task with the event's eventRef), then reply with a short summary.",
    "",
    "REPLY with ONE JSON object and nothing else. No markdown, no commentary:",
    '{"tool": {"name": "listTasks", "args": {}}}   to call a tool, or',
    '{"reply": "what you want to say to the member"}   when you are done.',
    "",
    context ? `CONTEXT:\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
