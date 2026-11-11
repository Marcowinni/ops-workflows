// PR data from the local checkout (no token, no REST). Needs fetch-depth: 0
// so the base sha is present. execFileSync with an argv array, never a shell.
import { execFileSync } from "node:child_process";

const STATUS = { A: "added", D: "removed" };

export function createGitClient({ cwd = process.cwd() } = {}) {
  const git = (args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

  return {
    /** Files changed between base and HEAD: [{ filename, status }]. */
    async pullFiles(_number, baseSha) {
      const out = git(["diff", "--name-status", "--no-renames", "-z", `${baseSha}...HEAD`]);
      const parts = out.split("\0").filter(Boolean);
      const files = [];
      for (let i = 0; i + 1 < parts.length; i += 2) {
        files.push({ filename: parts[i + 1], status: STATUS[parts[i][0]] ?? "modified" });
      }
      return files;
    },
    /** Does the path exist in the tree of ref? */
    async dirExists(dir, ref) {
      try {
        git(["cat-file", "-e", `${ref}:${dir}`]);
        return true;
      } catch {
        return false;
      }
    },
  };
}
