import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GITHUB_HOST_KEY, createDeployKeyGit, withDeployKey } from "../maintain/lib/deploy-key-git.mjs";
import { rollBack } from "../verify-deploy/lib/rollback.mjs";

const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----";
const BOT = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...BOT } }).trim();

/** Bare "GitHub" repo with main and a PR head under refs/pull/7/head, plus a helper clone. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ops-key-test-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "init", "-q", "-b", "main", seed);
  writeFileSync(join(seed, "a.txt"), "base\n");
  git(seed, "add", "."), git(seed, "commit", "-q", "-m", "base");
  const base = git(seed, "rev-parse", "HEAD");
  git(seed, "checkout", "-q", "-b", "dep");
  writeFileSync(join(seed, "b.txt"), "dep\n");
  git(seed, "add", "."), git(seed, "commit", "-q", "-m", "bump dep");
  const prHead = git(seed, "rev-parse", "HEAD");
  git(seed, "push", "-q", remote, "main", "dep:refs/pull/7/head");
  return { root, remote, seed, base, prHead };
}

function keyGit(remote, root) {
  const dir = mkdtempSync(join(root, "work-"));
  return { dir, git: createDeployKeyGit({ key: KEY, repo: "o/r", remoteUrl: remote, makeTempDir: () => dir }) };
}

test("deploy-key git: key file 0600, pinned github.com host key, ssh uses only them; close deletes all", () => {
  const calls = [];
  const dir = mkdtempSync(join(tmpdir(), "ops-key-unit-"));
  const kg = createDeployKeyGit({ key: KEY, repo: "o/r", makeTempDir: () => dir, run: (cmd, args, opts) => (calls.push({ args, env: opts.env }), "") });
  assert.equal(statSync(join(dir, "key")).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(dir, "key"), "utf8"), `${KEY}\n`);
  assert.equal(readFileSync(join(dir, "known_hosts"), "utf8").trim(), GITHUB_HOST_KEY);
  kg.createCommit({ message: "m", tree: "t", parents: ["p"] });
  const ssh = calls[0].env.GIT_SSH_COMMAND;
  assert.match(ssh, /-o IdentitiesOnly=yes/);
  assert.match(ssh, /-o StrictHostKeyChecking=yes/);
  assert.ok(calls.some((c) => c.args.join(" ") === "remote add origin git@github.com:o/r.git"));
  kg.close();
  assert.equal(existsSync(dir), false);
});

test("deploy-key git: merge is a real merge commit on main, pinned to the PR head, PR head reachable", async () => {
  const f = fixture();
  try {
    const { git: kg } = keyGit(f.remote, f.root);
    const { sha } = await kg.merge("main", 7, f.prHead);
    kg.close();
    assert.equal(git(f.remote, "rev-parse", "main"), sha);
    assert.equal(git(f.remote, "rev-list", "--parents", "-n", "1", sha), `${sha} ${f.base} ${f.prHead}`);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("deploy-key git: refuses a PR head that moved since the check", async () => {
  const f = fixture();
  try {
    const { git: kg } = keyGit(f.remote, f.root);
    await assert.rejects(kg.merge("main", 7, f.base), /bewegt/);
    kg.close();
    assert.equal(git(f.remote, "rev-parse", "main"), f.base);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("deploy-key git: rollBack restores the base tree by fast-forward; a moved branch is not overwritten", async () => {
  const f = fixture();
  try {
    const { git: kg } = keyGit(f.remote, f.root);
    const { sha: merged } = await kg.merge("main", 7, f.prHead);
    const api = {
      branchHead: async () => ({ branch: "main", sha: git(f.remote, "rev-parse", "main") }),
      gitCommit: async (s) => ({ tree: git(f.remote, "rev-parse", `${s}^{tree}`), parents: git(f.remote, "rev-list", "--parents", "-n", "1", s).split(" ").slice(1), message: "" }),
      createTag: async () => {},
    };
    const gh = withDeployKey(api, kg);
    const state = { branch: "main", base: f.base, head: merged, merges: [{ number: 7, title: "bump dep", sha: merged, updates: [] }] };
    const r = await rollBack(gh, state, { reason: "Funktionstest nach Deploy rot", runUrl: "https://x", tag: null });
    assert.equal(r.done, true);
    assert.equal(git(f.remote, "rev-parse", "main"), r.sha);
    assert.equal(git(f.remote, "rev-parse", "main^{tree}"), git(f.remote, "rev-parse", `${f.base}^{tree}`));

    const stale = await kg.createCommit({ message: "late", tree: git(f.remote, "rev-parse", `${f.base}^{tree}`), parents: [merged] });
    await assert.rejects(kg.fastForward("main", stale));
    assert.equal(git(f.remote, "rev-parse", "main"), r.sha);
    kg.close();
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
