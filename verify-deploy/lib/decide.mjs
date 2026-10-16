// Judge the check after deploy (ADR 0044) from the job results:
//   green         deploy live, smoke ran and passed
//   red           deploy live, smoke ran and failed            → roll back + regression lock
//   deploy_failed host could not build the merge                → roll back without lock
//   unconfirmed   deploy not confirmed in time, or the smoke job broke before
//                 its test ran (setup, install, download) or was cancelled → report only
//   untested      deploy live, no smoke configured (job skipped) → proof entry only
//
// smokeResult is the step output pass | fail that a test step sets only after
// the test actually ran; smokeJob is the job result. A failed job without
// "fail" is a broken setup, never a reason to roll back an innocent update.
//
// Rollback guards: red only when production was green right before the merge
// (approved PRs merge even when the smoke before was red). deploy_failed
// only when the commit before the merge deployed green — otherwise the build
// was broken before. Production still runs the old version after a failed
// deploy; the rollback keeps the branch deployable. No lock then: a build
// error can be transient, the next wave may try the update again.

export function decide({ deployResult, smokeJob, smokeResult, preSmokeResult, rollback, baseDeployGreen = null }) {
  let outcome;
  if (deployResult === "failure") outcome = "deploy_failed";
  else if (deployResult !== "success") outcome = "unconfirmed";
  else if (smokeResult === "fail") outcome = "red";
  else if (smokeResult === "pass" && smokeJob === "success") outcome = "green";
  else if (smokeJob === "skipped") outcome = "untested";
  else outcome = "unconfirmed";

  const wanted = outcome === "red" || outcome === "deploy_failed";
  let blocker = null;
  if (wanted && !rollback) blocker = "Rollback abgeschaltet";
  else if (outcome === "red" && preSmokeResult !== "success") blocker = "Produktion war vor dem Merge nicht nachweislich grün";
  else if (outcome === "deploy_failed" && baseDeployGreen !== true) {
    blocker = baseDeployGreen === false ? "Deploy vor dem Merge war schon nicht grün" : "Deploy vor dem Merge unbekannt";
  }
  return {
    outcome,
    deployConfirmed: deployResult === "success",
    rollback: wanted && blocker === null,
    lock: outcome === "red",
    blocker,
  };
}
