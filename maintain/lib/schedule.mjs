// Apply the Business OS schedule (ADR 0044 §4) to the merge plan. The OS
// decides the cadence from the register; the repo only follows:
//   updates "all"      → wave day: patch/minor + security may merge
//   updates "security" → only PRs of the Dependabot group "security"
//   updates "none"     → no package: nothing merges
// Approved PRs (a person clicked) are added afterwards by withApproved().

/** Dependabot names grouped PRs after the group: "bump the security group …". */
export function isSecurityPr(title) {
  return /\bthe security group\b/i.test(title);
}

export function applySchedule(plan, schedule) {
  const updates = schedule?.updates ?? "none";
  if (updates === "all") return { ...plan, held: [] };
  const keep = updates === "security" ? plan.merge.filter((p) => p.security) : [];
  const held = plan.merge.filter((p) => !keep.includes(p));
  return { ...plan, merge: keep, held };
}

/** Sync payload: every PR waiting for a click, except those only GitHub can merge. */
export function pendingFor(plan) {
  return plan.approvals
    .filter((p) => !p.inGitHub)
    .map((p) => ({ number: p.number, title: p.title.slice(0, 200), url: p.url, kind: p.kind, security: Boolean(p.security) }));
}
