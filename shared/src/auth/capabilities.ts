import type { Role } from "../schemas/role/role.js";

export const CAPABILITIES = {
  "member:role-change": ["president", "vice_president"],
  "invite:create": ["president", "secretary", "director"],
  "expense:approve": ["president", "treasurer"],
  "budget:manage": ["president", "treasurer"],
  // Tier 2 also contains the VP, treasurer and secretary — cancelling an
  // event releases its allocation (Rule 2), and that call is the president's
  // alone, not "management's". A tier check cannot express "one of tier 2".
  "event:cancel": ["president"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly Role[]).includes(role);
}

export function roleDiff(from: Role, to: Role): { gains: Capability[]; removed: Capability[] } {
  const capabilities = Object.keys(CAPABILITIES) as Capability[];
  return {
    gains: capabilities.filter((capability) => !can(from, capability) && can(to, capability)),
    removed: capabilities.filter((capability) => can(from, capability) && !can(to, capability)),
  };
}
