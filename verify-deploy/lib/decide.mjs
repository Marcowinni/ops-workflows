// Judge the check after deploy (ADR 0044) from the job results:
//   green         deploy live, smoke green
//   red           deploy live, smoke red              → roll back
//   deploy_failed host could not build the merge     → roll back (prod still runs the old
//                 version, but the branch must stay deployable)
//   unconfirmed   deploy not confirmed in time, or smoke cancelled → report only
//   untested      deploy live, no smoke configured (job skipped) → proof entry only
// Roll back only when production was green right before the merge: otherwise
// the red result may not come from this run's updates (approved PRs merge
// even when the smoke before was red).

export function decide({ deployResult, smokeResult, preSmokeResult, rollback }) {
  let outcome;
  if (deployResult === "failure") outcome = "deploy_failed";
  else if (deployResult !== "success") outcome = "unconfirmed";
  else if (smokeResult === "success") outcome = "green";
  else if (smokeResult === "failure") outcome = "red";
  else if (smokeResult === "cancelled") outcome = "unconfirmed";
  else outcome = "untested";

  const wanted = outcome === "red" || outcome === "deploy_failed";
  let blocker = null;
  if (wanted && !rollback) blocker = "Rollback abgeschaltet";
  else if (wanted && preSmokeResult !== "success") blocker = "Produktion war vor dem Merge nicht nachweislich grün";
  return { outcome, deployConfirmed: deployResult === "success", rollback: wanted && blocker === null, blocker };
}
