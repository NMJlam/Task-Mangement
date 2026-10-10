import { roleSchema, type Role } from "../schemas/role/role.js";

export const CAPABILITIES = {
  "member:role-change": ["president", "vice_president"],
  "invite:create": ["president", "secretary", "director"],
  "expense:approve": ["president", "treasurer"],
  "budget:manage": ["president", "treasurer"],
  // Tier 2 also contains the VP, treasurer and secretary — cancelling an
  // event releases its allocation (Rule 2), and that call is the president's
  // alone, not "management's". A tier check cannot express "one of tier 2".
  "event:cancel": ["president"],
  // Deleting a custom group removes it for every member. The president may
  // delete any group they are in; every creator may delete their own. Neither
  // power reaches a group the caller is not a member of — that check comes
  // first (`canDeleteGroup`), so these never reveal a private group.
  "group:delete-any": ["president"],
  "group:delete-created": roleSchema.options,
  // Moderation: deleting someone else's message. Every author may delete their
  // own without it. Separate from the group powers on purpose — cleaning up a
  // group is not the same authority as removing what a member said.
  "message:delete-any": ["president"],
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
