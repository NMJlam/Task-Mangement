// Enforces Conventional Commits on the commit message via the .husky/commit-msg
// hook. Allowed types are the config-conventional defaults (feat, fix, docs,
// chore, refactor, test, build, ci, perf, style, revert). See docs/contributing.md.
export default {
  extends: ["@commitlint/config-conventional"],
};
