import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFile, loadConfig } from "../mods/wool/lib/config.js";
import { ConfigError } from "../mods/wool/lib/schema.js";

const roots = { main: "/code/app", worktree: "/wt/app/feat" };
const has = (...paths) => {
  const set = new Set(paths);
  return (p) => set.has(p);
};
const reader = (files) => async (p) => (p in files ? files[p] : null);

const CONFIG = "version: 1\nsetup:\n  - run: echo hi\ntabs:\n  - panes:\n      - {}\n";

test("personal yml in main wins over everything", () => {
  const exists = has(
    "/code/app/.herdr/wool.yml", "/wt/app/feat/.herdr/wool.yml",
    "/wt/app/feat/.herdr/wool.yml.dist", "/code/app/.herdr/wool.yml.dist",
  );
  assert.equal(resolveFile(roots, exists), "/code/app/.herdr/wool.yml");
});

test("worktree yml wins over dist files", () => {
  const exists = has("/wt/app/feat/.herdr/wool.yml", "/wt/app/feat/.herdr/wool.yml.dist", "/code/app/.herdr/wool.yml.dist");
  assert.equal(resolveFile(roots, exists), "/wt/app/feat/.herdr/wool.yml");
});

test("worktree dist wins over main dist", () => {
  const exists = has("/wt/app/feat/.herdr/wool.yml.dist", "/code/app/.herdr/wool.yml.dist");
  assert.equal(resolveFile(roots, exists), "/wt/app/feat/.herdr/wool.yml.dist");
});

test("falls back to main dist", () => {
  assert.equal(resolveFile(roots, has("/code/app/.herdr/wool.yml.dist")), "/code/app/.herdr/wool.yml.dist");
});

test("returns null when no file exists", () => {
  assert.equal(resolveFile(roots, has()), null);
});

test("the old worktrees and workspace files are not read", () => {
  assert.equal(resolveFile(roots, has("/code/app/.herdr/worktrees.yml.dist", "/code/app/.herdr/workspace.yml.dist")), null);
});

test("loadConfig loads and validates the file", async () => {
  const c = await loadConfig(roots, reader({ "/code/app/.herdr/wool.yml.dist": CONFIG }));
  assert.equal(c.file, "/code/app/.herdr/wool.yml.dist");
  assert.equal(c.error, null);
  assert.deepEqual(c.value.steps, [{ name: null, run: "echo hi", env: {} }]);
  assert.equal(c.value.tabs[0].panes[0].kind, "shell");
});

test("loadConfig reports a YAML error with file and line", async () => {
  const c = await loadConfig(roots, reader({
    "/code/app/.herdr/wool.yml": "version: 1\ntabs:\n\t- x\n",
    "/code/app/.herdr/wool.yml.dist": CONFIG,
  }));
  assert.ok(c.error instanceof ConfigError);
  assert.equal(c.error.file, "/code/app/.herdr/wool.yml");
  assert.match(c.error.message, /line 3: /);
  assert.equal(c.value, null);
  assert.equal(c.file, "/code/app/.herdr/wool.yml");
});

test("loadConfig reports a schema error with its file", async () => {
  const c = await loadConfig(roots, reader({ "/wt/app/feat/.herdr/wool.yml.dist": "version: 2\nsetup: []\n" }));
  assert.ok(c.error instanceof ConfigError);
  assert.equal(c.error.file, "/wt/app/feat/.herdr/wool.yml.dist");
  assert.match(c.error.message, /version/);
});

test("loadConfig with no file returns null without an error", async () => {
  assert.deepEqual(await loadConfig(roots, reader({})), { file: null, value: null, error: null });
});

test("loadConfig turns a failing read into an error for that file", async () => {
  const c = await loadConfig(roots, async (p) => {
    if (p === "/code/app/.herdr/wool.yml") throw new Error("permission denied");
    return null;
  });
  assert.ok(c.error instanceof ConfigError);
  assert.equal(c.error.file, "/code/app/.herdr/wool.yml");
  assert.match(c.error.message, /permission denied/);
});
