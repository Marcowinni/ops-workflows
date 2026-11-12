// Repository ruleset of ADR 0052 Q53b/Q48e. Shape verified against the GitHub API.
// Binds everyone with write access equally (Marco, Till, agents): PR plus green
// checks; only the deploy key may push (maintenance merge, auto-rollback).
const TARGET = { target: "branch", enforcement: "active", conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } } };
const DEPLOY_KEY_BYPASS = { actor_type: "DeployKey", bypass_mode: "always" };
const REQUIRED_CHECKS = ["ci / checks", "ci / secret-scan", "ci / standard"];

export function mainProtectionRuleset() {
  return {
    name: "main-schutz",
    ...TARGET,
    bypass_actors: [DEPLOY_KEY_BYPASS],
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: REQUIRED_CHECKS.map((context) => ({ context })),
        },
      },
    ],
  };
}
