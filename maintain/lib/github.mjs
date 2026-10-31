// Minimal GitHub REST client (fetch, no dependencies) scoped to one repo.

export function createGitHub({ token, repo, apiUrl = "https://api.github.com" }) {
  async function request(method, path, body) {
    const res = await fetch(`${apiUrl}/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body && { "content-type": "application/json" }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(`${method} ${path || "/"} → ${res.status}: ${data?.message ?? text}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function gitCommit(sha) {
    const c = await request("GET", `/git/commits/${sha}`);
    return { tree: c.tree.sha, parents: c.parents.map((p) => p.sha), message: c.message };
  }

  return {
    async dependabotPulls() {
      const pulls = await request("GET", "/pulls?state=open&per_page=100");
      return pulls.filter((p) => p.user?.login === "dependabot[bot]");
    },
    async pullFiles(number) {
      const files = await request("GET", `/pulls/${number}/files?per_page=100`);
      return files.map((f) => f.filename);
    },
    async commitMessage(sha) {
      return (await request("GET", `/commits/${sha}`)).commit.message;
    },
    async checkRuns(sha) {
      return (await request("GET", `/commits/${sha}/check-runs?per_page=100`)).check_runs;
    },
    async statuses(sha) {
      return (await request("GET", `/commits/${sha}/status`)).statuses;
    },
    /** GitHub computes mergeability lazily: null on first read, so ask twice. */
    async mergeable(number) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const pr = await request("GET", `/pulls/${number}`);
        if (pr.mergeable !== null) return pr.mergeable;
        await sleep(2000);
      }
      return null;
    },
    /** sha pins the merge to the commit whose checks were evaluated. */
    async merge(number, sha, method) {
      return request("PUT", `/pulls/${number}/merge`, { sha, merge_method: method });
    },
    /** Default branch (main or master) and its head commit. */
    async branchHead() {
      const { default_branch: branch } = await request("GET", "");
      const head = await request("GET", `/branches/${branch}`);
      return { branch, sha: head.commit.sha };
    },
    gitCommit,
    async createCommit({ message, tree, parents }) {
      return (await request("POST", "/git/commits", { message, tree, parents })).sha;
    },
    /** force:false = fast-forward only; GitHub answers 422 when the branch moved meanwhile. */
    async fastForward(branch, sha) {
      return request("PATCH", `/git/refs/heads/${branch}`, { sha, force: false });
    },
    async createTag(name, sha) {
      return request("POST", "/git/refs", { ref: `refs/tags/${name}`, sha });
    },
    /** Messages of the rollback commits tagged ops-regression/* (regression.mjs). */
    async regressionMessages() {
      const refs = await request("GET", "/git/matching-refs/tags/ops-regression/");
      const commits = refs.filter((r) => r.object?.type === "commit");
      return Promise.all(commits.map(async (r) => (await gitCommit(r.object.sha)).message));
    },
    /** Entries of a directory on the default branch; [] if it does not exist. */
    async listDir(path) {
      try {
        return (await request("GET", `/contents/${path}`)).map((e) => e.name);
      } catch (e) {
        if (e.status === 404) return [];
        throw e;
      }
    },
    /** Text of a file on the default branch; null if it does not exist. */
    async fileText(path) {
      try {
        const file = await request("GET", `/contents/${path}`);
        return Buffer.from(file.content, "base64").toString("utf8");
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    async deployments(sha) {
      return request("GET", `/deployments?sha=${sha}&per_page=100`);
    },
    /** Statuses come newest first; a deployment without one is still pending. */
    async deploymentState(id) {
      const [latest] = await request("GET", `/deployments/${id}/statuses?per_page=1`);
      return latest?.state ?? "pending";
    },
  };
}
