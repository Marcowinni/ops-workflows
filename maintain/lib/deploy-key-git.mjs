// Write path over SSH with the repo's deploy key (ADR 0052 Q53b). Once the
// rulesets are active, only admins and deploy keys may update the default
// branch, so maintenance merges and the auto-rollback push with the key
// instead of writing through the API with GITHUB_TOKEN. Reads stay on the API.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Published host key of github.com (docs.github.com, "GitHub's SSH key
// fingerprints"); pinned instead of trusting whatever answers on first use.
export const GITHUB_HOST_KEY =
  "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

function defaultRun(cmd, args, { cwd, env }) {
  return execFileSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeSecretFile(path, text) {
  writeFileSync(path, text, { mode: 0o600 });
}

/**
 * Local git workspace that pushes with the deploy key. close() deletes the
 * key file and the clone; call it in a finally block.
 */
export function createDeployKeyGit({
  key,
  repo,
  remoteUrl = `git@github.com:${repo}.git`,
  run = defaultRun,
  makeTempDir = () => mkdtempSync(join(tmpdir(), "ops-git-")),
  writeFile = writeSecretFile,
  remove = (path) => rmSync(path, { recursive: true, force: true }),
}) {
  const dir = makeTempDir();
  const keyFile = join(dir, "key");
  const knownHosts = join(dir, "known_hosts");
  const work = join(dir, "repo");
  writeFile(keyFile, key.endsWith("\n") ? key : `${key}\n`);
  writeFile(knownHosts, `${GITHUB_HOST_KEY}\n`);
  const env = {
    GIT_SSH_COMMAND: `ssh -i ${keyFile} -o IdentitiesOnly=yes -o UserKnownHostsFile=${knownHosts} -o StrictHostKeyChecking=yes`,
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: BOT_NAME,
    GIT_AUTHOR_EMAIL: BOT_EMAIL,
    GIT_COMMITTER_NAME: BOT_NAME,
    GIT_COMMITTER_EMAIL: BOT_EMAIL,
  };
  let initialised = false;
  const git = (...args) => run("git", args, { cwd: work, env }).trim();

  function init() {
    if (initialised) return;
    run("git", ["init", "-q", work], { cwd: dir, env });
    git("remote", "add", "origin", remoteUrl);
    initialised = true;
  }

  return {
    /**
     * Real merge commit (not squash): GitHub only closes the PR as merged when
     * its head commit lands on the branch. Pinned to the evaluated head sha.
     */
    async merge(branch, number, sha) {
      init();
      git("fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`, `+refs/pull/${number}/head:refs/ops/pr-${number}`);
      const fetched = git("rev-parse", `refs/ops/pr-${number}`);
      if (fetched !== sha) throw new Error(`PR #${number} hat sich seit der Prüfung bewegt`);
      git("checkout", "-q", "--detach", `origin/${branch}`);
      try {
        git("merge", "--no-ff", "-q", "-m", `Merge pull request #${number} (Wartungslauf)`, sha);
      } catch (e) {
        try {
          git("merge", "--abort");
        } catch {
          // nothing to abort when the merge failed before touching the index
        }
        throw e;
      }
      // No --force: the push is rejected when the branch moved meanwhile.
      git("push", "-q", "origin", `HEAD:refs/heads/${branch}`);
      return { sha: git("rev-parse", "HEAD") };
    },
    /** Same contract as the API: a commit object with this tree and parents, not yet on any branch. */
    async createCommit({ message, tree, parents }) {
      init();
      git("fetch", "-q", "origin", ...parents);
      return git("commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", message);
    },
    /** Fast-forward only: without --force git rejects anything else. */
    async fastForward(branch, sha) {
      git("push", "-q", "origin", `${sha}:refs/heads/${branch}`);
    },
    close() {
      remove(dir);
    },
  };
}

/** API client whose branch writes go through the deploy key; everything else stays on the API. */
export function withDeployKey(gh, keyGit) {
  return {
    ...gh,
    // Only PRs into the default branch: merge-state and the rollback assume it,
    // and a PR into another branch must not carry that branch onto production.
    async merge(number, sha) {
      const [{ branch }, target] = await Promise.all([gh.branchHead(), gh.pullBaseRef(number)]);
      if (target !== branch) throw new Error(`PR #${number} zielt auf ${target}, nicht auf ${branch}`);
      return keyGit.merge(branch, number, sha);
    },
    createCommit: (commit) => keyGit.createCommit(commit),
    fastForward: (branch, sha) => keyGit.fastForward(branch, sha),
  };
}
