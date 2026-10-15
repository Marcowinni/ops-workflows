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
      const err = new Error(`${method} ${path} → ${res.status}: ${data?.message ?? text}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  };
}
