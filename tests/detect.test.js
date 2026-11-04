import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, utimesSync, existsSync, statSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifySpace, isPlainShellArgv, newSpaces, PENDING_LIMIT_MS, FRESH_MINUTES } from "../mods/wool/lib/detect.js";

const CLAIM = join(dirname(fileURLToPath(import.meta.url)), "..", "mods", "wool", "bin", "wool-claim.sh");

const shellProgram = { key: "shell", name: "zsh", shell: true, agent: false };
const space = (tabs = [{ id: "tb1", panes: 1 }], machine = null) => ({ id: "sp1", machine, tabs });
const pane = (over = {}) => ({ pane: "p1", tab: "tb1", terminal: "t1", status: null, program: shellProgram, ...over });
const term = (argv, address = "t1") => ({ address, argv });
const WRAPPED = ["/bin/zsh", "-lic", '"$@"; exec "$0" -li', "/bin/zsh", "claude", "do the thing"];

test("constants", () => {
  assert.equal(PENDING_LIMIT_MS, 10000);
  assert.equal(FRESH_MINUTES, 3);
});

test("isPlainShellArgv", () => {
  assert.equal(isPlainShellArgv(["/bin/zsh", "-l"]), true);
  assert.equal(isPlainShellArgv(["/bin/bash"]), true);
  assert.equal(isPlainShellArgv(["/opt/homebrew/bin/fish", "-l", "-i"]), true);
  assert.equal(isPlainShellArgv(WRAPPED), false);
  assert.equal(isPlainShellArgv(["sh", "-c", "x"]), false);
  assert.equal(isPlainShellArgv(["/bin/zsh", "-lc"]), false);
  assert.equal(isPlainShellArgv(["/bin/zsh", "script.zsh"]), false);
  assert.equal(isPlainShellArgv([]), false);
  assert.equal(isPlainShellArgv(null), false);
  assert.equal(isPlainShellArgv(undefined), false);
});

test("classifySpace: a plain shell", () => {
  assert.equal(classifySpace(space(), [pane()], [term(["/bin/zsh", "-l"])], 0, 100), "plain-shell");
});

test("classifySpace: an agent launch that still reports as a shell is other", () => {
  assert.equal(classifySpace(space(), [pane()], [term(WRAPPED)], 0, 100), "other");
});

test("classifySpace: terminal not reported yet is pending, then other", () => {
  assert.equal(classifySpace(space(), [pane()], [], 0, 50), "pending");
  assert.equal(classifySpace(space(), [pane()], [term(undefined)], 0, 50), "pending");
  assert.equal(classifySpace(space(), [pane()], [], 0, PENDING_LIMIT_MS + 1000), "other");
});

test("classifySpace: an agent pane is other", () => {
  assert.equal(classifySpace(space(), [pane({ status: "idle" })], [term(["/bin/zsh", "-l"])], 0, 100), "other");
});

test("classifySpace: two tabs is other", () => {
  const s = space([{ id: "tb1", panes: 1 }, { id: "tb2", panes: 1 }]);
  const ps = [pane(), pane({ pane: "p2", tab: "tb2", terminal: "t2" })];
  assert.equal(classifySpace(s, ps, [term(["/bin/zsh", "-l"]), term(["/bin/zsh", "-l"], "t2")], 0, 100), "other");
});

test("classifySpace: a split tab is other", () => {
  const ps = [pane(), pane({ pane: "p2", terminal: "t2" })];
  assert.equal(classifySpace(space([{ id: "tb1", panes: 2 }]), ps, [term(["/bin/zsh", "-l"]), term(["/bin/zsh", "-l"], "t2")], 0, 100), "other");
});

test("classifySpace: a mod pane is other", () => {
  assert.equal(classifySpace(space(), [pane({ terminal: null, mod: "files" })], [], 0, 100), "other");
});

test("classifySpace: no panes yet is pending, then other", () => {
  assert.equal(classifySpace(space(), [], [], 0, 2000), "pending");
  assert.equal(classifySpace(space([]), [], [], 0, 2000), "pending");
  assert.equal(classifySpace(space(), [], [], 0, 11000), "other");
});

test("classifySpace: a remote space", () => {
  assert.equal(classifySpace(space(undefined, "vps"), [pane()], [term(["/bin/zsh", "-l"])], 0, 100), "remote");
});

test("newSpaces ignores known ids", () => {
  const known = new Set(["a", "b"]);
  assert.deepEqual(newSpaces(known, [{ id: "a" }, { id: "c" }, { id: "b" }, { id: "d" }]).map((s) => s.id), ["c", "d"]);
});

// ---- wool-claim.sh -----------------------------------------------------

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
}

function repo(name = "main repo") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wool claim ")));
  const main = join(root, name);
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  return { root, main };
}

const claim = (folder) => {
  const r = spawnSync("sh", [CLAIM, folder], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.replace(/\n$/, "");
};

test("wool-claim: claims a fresh linked worktree once", () => {
  const { root, main } = repo();
  const wt = join(root, "wt b");
  git(main, "worktree", "add", "-q", "-b", "b", wt);
  const gitdir = git(wt, "rev-parse", "--path-format=absolute", "--git-dir");
  assert.equal(claim(wt), `claimed\t${gitdir}\t${main}\tb\t${wt}`);
  assert.ok(statSync(join(gitdir, "wool")).isDirectory());
  assert.equal(claim(wt), "taken");
});

test("wool-claim: a branch with a slash and quotes", () => {
  const { root, main } = repo();
  const wt = join(root, "it's $x");
  git(main, "worktree", "add", "-q", "-b", "feat/it's-x", wt);
  const out = claim(wt).split("\t");
  assert.equal(out[0], "claimed");
  assert.equal(out[3], "feat/it's-x");
});

test("wool-claim: the main checkout is not-linked", () => {
  const { main } = repo();
  assert.equal(claim(main), "not-linked");
  assert.equal(claim(join(main)), "not-linked");
});

test("wool-claim: a plain folder or a missing one is not-linked", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "plain ")));
  assert.equal(claim(dir), "not-linked");
  assert.equal(claim(join(dir, "nope")), "not-linked");
});

test("wool-claim: an old worktree is stale and not claimed", () => {
  const { root, main } = repo();
  const wt = join(root, "old");
  git(main, "worktree", "add", "-q", "-b", "old", wt);
  const gitdir = join(main, ".git", "worktrees", "old");
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(join(gitdir, "commondir"), tenMinutesAgo, tenMinutesAgo);
  assert.equal(claim(wt), "stale");
  assert.ok(!existsSync(join(gitdir, "wool")));
});

test("wool-claim: a subfolder of a worktree claims the worktree", () => {
  const { root, main } = repo();
  const wt = join(root, "sub");
  git(main, "worktree", "add", "-q", "-b", "sub", wt);
  mkdirSync(join(wt, "src"));
  const out = claim(join(wt, "src")).split("\t");
  assert.equal(out[0], "claimed");
  assert.equal(out[4], wt);
});

test("parseClaim reads a claimed line and ignores the rest", async () => {
  const { parseClaim } = await import("../mods/wool/lib/detect.js");
  assert.deepEqual(parseClaim("claimed\t/m/.git/worktrees/b\t/m\tfeat/x\t/wt/b\n"), {
    gitDir: "/m/.git/worktrees/b", stateDir: "/m/.git/worktrees/b/wool", main: "/m", branch: "feat/x", worktree: "/wt/b",
  });
  assert.equal(parseClaim("taken\n"), null);
  assert.equal(parseClaim("stale"), null);
  assert.equal(parseClaim("not-linked"), null);
  assert.equal(parseClaim(""), null);
});

test("originalIsIdle: close the original tab only while its shell runs nothing", async () => {
  const { originalIsIdle } = await import("../mods/wool/lib/detect.js");
  const idle = { argv: ["/bin/zsh", "-l"], foreground: { argv: ["/bin/zsh", "-l"] } };
  assert.equal(originalIsIdle(pane(), idle), true);
  assert.equal(originalIsIdle(pane(), { ...idle, foreground: { argv: ["claude"] } }), false);
  assert.equal(originalIsIdle(pane(), { ...idle, foreground: { argv: ["git", "pull"] } }), false);
  assert.equal(originalIsIdle(pane({ status: "working", program: { key: "claude", shell: false } }), idle), false);
  assert.equal(originalIsIdle(pane({ program: { key: "nvim", shell: false } }), { argv: ["/bin/zsh", "-l"] }), false);
  assert.equal(originalIsIdle(pane(), { argv: ["/bin/zsh", "-l"] }), true);
  assert.equal(originalIsIdle(undefined, idle), false);
  assert.equal(originalIsIdle(pane(), undefined), false);
});

// ---- wool-claim.sh rerun ----------------------------------------------

const rerun = (folder) => {
  const r = spawnSync("sh", [CLAIM, folder, "rerun"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.replace(/\n$/, "");
};

function oldWorktree(name) {
  const { root, main } = repo();
  const wt = join(root, name);
  git(main, "worktree", "add", "-q", "-b", name, wt);
  const gitdir = git(wt, "rev-parse", "--path-format=absolute", "--git-dir");
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(join(gitdir, "commondir"), tenMinutesAgo, tenMinutesAgo);
  return { main, wt, gitdir };
}

test("wool-claim rerun: claims a stale worktree", () => {
  const { main, wt, gitdir } = oldWorktree("stale-one");
  assert.equal(rerun(wt), `claimed\t${gitdir}\t${main}\tstale-one\t${wt}`);
  assert.ok(statSync(join(gitdir, "wool")).isDirectory());
});

test("wool-claim rerun: clears old state and claims again", () => {
  const { wt, gitdir } = oldWorktree("again");
  mkdirSync(join(gitdir, "wool"));
  writeFileSync(join(gitdir, "wool", "status"), "failed x\n");
  writeFileSync(join(gitdir, "wool", "config.yml"), "version: 1\n");
  assert.match(rerun(wt), /^claimed\t/);
  assert.deepEqual(readdirSync(join(gitdir, "wool")), []);
});

test("wool-claim rerun: refuses while setup is running", () => {
  const { wt, gitdir } = oldWorktree("busy");
  mkdirSync(join(gitdir, "wool"));
  writeFileSync(join(gitdir, "wool", "status"), "running\n");
  writeFileSync(join(gitdir, "wool", "config.yml"), "version: 1\n");
  assert.equal(rerun(wt), "running");
  assert.equal(readFileSync(join(gitdir, "wool", "config.yml"), "utf8"), "version: 1\n");
});

test("wool-claim rerun: the main checkout is still not-linked", () => {
  const { main } = repo();
  assert.equal(rerun(main), "not-linked");
});
