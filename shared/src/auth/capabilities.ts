import type { Role } from "../schemas/role/role.js";

export const CAPABILITIES = {
  "member:role-change": ["president", "vice_president"],
  "invite:create": ["president", "secretary", "marketing_director"],
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
