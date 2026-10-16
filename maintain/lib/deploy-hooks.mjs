// Deploy hooks after a commit by GITHUB_TOKEN: such a push starts no
// workflows, and Vercel does not deploy commits by bots. Returns the failed
// hooks as HTTP status or error text (never the URL — it is a secret).

export function parseHooks(value) {
  return value.split(/\s+/).filter(Boolean);
}

export async function triggerDeployHooks(hooks, fetchFn = fetch) {
  const errors = [];
  for (const hook of hooks) {
    const res = await fetchFn(hook, { method: "POST" }).catch((e) => ({ ok: false, status: e.message }));
    if (!res.ok) errors.push(res.status);
  }
  return errors;
}
