import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCheck } from "../mods/wool/lib/trust.js";

const WOOL = join(dirname(fileURLToPath(import.meta.url)), "..", "mods", "wool", "bin", "wool.sh");
const tmp = (name = "wool trust ") => realpathSync(mkdtempSync(join(tmpdir(), name)));
const CONFIG = "version: 1\nsetup:\n  - run: echo hi\n";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
}

// A repo with a linked worktree, its own XDG_CONFIG_HOME, and a state dir
// holding the config text wool read.
function fixture({ text = CONFIG, file = "wool.yml.dist", ignore = false } = {}) {
  const root = tmp();
  const main = join(root, "main repo");
  mkdirSync(join(main, ".herdr"), { recursive: true });
  git(main, "init", "-q", "-b", "main");
  if (ignore) writeFileSync(join(main, ".gitignore"), ".herdr/*.yml\n");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  const wt = join(root, "wt b");
  git(main, "worktree", "add", "-q", "-b", "b", wt);
  const path = join(main, ".herdr", file);
  writeFileSync(path, text);
  const state = join(root, "state");
  mkdirSync(state);
  writeFileSync(join(state, "config.yml"), text);
  const xdg = join(root, "xdg");
  return { root, main, wt, path, state, xdg, store: join(xdg, "wool", "trust.tsv") };
}

function wool(fx, args, opts = {}) {
  return spawnSync("sh", [WOOL, ...args], { encoding: "utf8", env: { ...process.env, XDG_CONFIG_HOME: fx.xdg }, ...opts });
}

const sha = (s) => execFileSync("shasum", ["-a", "256"], { input: s, encoding: "utf8" }).split(" ")[0];

function check(fx) {
  const r = wool(fx, ["check", fx.state, fx.main, fx.path]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function put(fx, s, decision, repo = fx.main, file = fx.path) {
  const r = wool(fx, ["_put", s, decision, repo, file]);
  assert.equal(r.status, 0, r.stderr);
}

const storeLines = (fx) => (existsSync(fx.store) ? readFileSync(fx.store, "utf8").split("\n").filter((l) => l !== "") : []);

test("check: a dist with no entry asks", () => {
  const fx = fixture();
  assert.equal(check(fx), `ask\t${sha(CONFIG)}\n`);
  assert.equal(readFileSync(join(fx.state, "trust-request"), "utf8"), `${fx.main}\t${fx.path}\t${sha(CONFIG)}\n`);
});

test("check: a gitignored wool.yml is implicit", () => {
  const fx = fixture({ file: "wool.yml", ignore: true });
  assert.equal(check(fx), `implicit\t${sha(CONFIG)}\n`);
});

test("check: a wool.yml that isn't ignored asks", () => {
  const fx = fixture({ file: "wool.yml" });
  assert.equal(check(fx), `ask\t${sha(CONFIG)}\n`);
});

test("check: an ignored dist is still gated", () => {
  const fx = fixture({ file: "wool.yml.dist", ignore: true });
  writeFileSync(join(fx.main, ".gitignore"), ".herdr/\n");
  assert.equal(check(fx), `ask\t${sha(CONFIG)}\n`);
});

test("check: a trusted entry for this repo and sha is trusted", () => {
  const fx = fixture();
  put(fx, sha(CONFIG), "trusted");
  assert.equal(check(fx), `trusted\t${sha(CONFIG)}\n`);
});

test("check: same sha, other repo asks", () => {
  const fx = fixture();
  put(fx, sha(CONFIG), "trusted", "/some/other repo");
  assert.equal(check(fx), `ask\t${sha(CONFIG)}\n`);
});

test("check: a declined entry is declined", () => {
  const fx = fixture();
  put(fx, sha(CONFIG), "declined");
  assert.equal(check(fx), `declined\t${sha(CONFIG)}\n`);
});

test("check: a changed file (new sha) asks again", () => {
  const fx = fixture();
  put(fx, sha(CONFIG), "trusted");
  writeFileSync(join(fx.state, "config.yml"), CONFIG + "# changed\n");
  assert.equal(check(fx), `ask\t${sha(CONFIG + "# changed\n")}\n`);
});

test("store: two concurrent puts both land", async () => {
  const fx = fixture();
  const env = { ...process.env, XDG_CONFIG_HOME: fx.xdg };
  const runs = Array.from({ length: 10 }, (_, i) => new Promise((resolve) => {
    const c = spawn("sh", [WOOL, "_put", sha(String(i)), "trusted", fx.main, fx.path], { env, stdio: "ignore" });
    c.on("exit", resolve);
  }));
  const codes = await Promise.all(runs);
  assert.deepEqual(codes, Array(10).fill(0));
  assert.equal(storeLines(fx).length, 10);
  assert.ok(!existsSync(join(fx.xdg, "wool", "trust.lock")), "the lock was left behind");
});

test("store: a new decision replaces the old line for the same repo and sha", () => {
  const fx = fixture();
  put(fx, sha(CONFIG), "declined");
  put(fx, sha("other"), "trusted");
  put(fx, sha(CONFIG), "trusted");
  const lines = storeLines(fx);
  assert.equal(lines.length, 2);
  assert.equal(lines.filter((l) => l.startsWith(sha(CONFIG))).length, 1);
  assert.match(lines.find((l) => l.startsWith(sha(CONFIG))), /\ttrusted\t/);
  assert.equal(check(fx), `trusted\t${sha(CONFIG)}\n`);
});

test("store: a line is sha, decision, repo, file and an ISO date", () => {
  const fx = fixture();
  put(fx, sha(CONFIG), "trusted");
  const f = storeLines(fx)[0].split("\t");
  assert.deepEqual(f.slice(0, 4), [sha(CONFIG), "trusted", fx.main, fx.path]);
  assert.match(f[4], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});

test("store: junk lines are kept and ignored", () => {
  const fx = fixture();
  mkdirSync(dirname(fx.store), { recursive: true });
  const junk = `\ngarbage\n${sha(CONFIG)}\ttrusted\t${fx.main}\n${sha(CONFIG)}\tmaybe\t${fx.main}\t${fx.path}\t2026-01-01T00:00:00Z\n`;
  writeFileSync(fx.store, junk);
  assert.equal(check(fx), `ask\t${sha(CONFIG)}\n`);
  const l = wool(fx, ["list"]);
  assert.equal(l.status, 0, l.stderr);
  assert.equal(l.stdout, "No trusted or declined files.\n");
  put(fx, sha(CONFIG), "declined");
  const text = readFileSync(fx.store, "utf8");
  assert.ok(text.includes("garbage\n"));
  assert.ok(text.includes(`${sha(CONFIG)}\ttrusted\t${fx.main}\n`));
  assert.ok(text.includes(`\tmaybe\t`));
  assert.equal(check(fx), `declined\t${sha(CONFIG)}\n`);
});

test("list: empty store says so", () => {
  const fx = fixture();
  const r = wool(fx, ["list"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "No trusted or declined files.\n");
});

test("list: shows decision, short sha, repo, file", () => {
  const fx = fixture();
  put(fx, sha(CONFIG), "trusted");
  put(fx, sha("x"), "declined");
  const out = wool(fx, ["list"]).stdout.split("\n").filter(Boolean);
  assert.equal(out.length, 2);
  assert.match(out[0], new RegExp(`^trusted  ${sha(CONFIG).slice(0, 12)}  ${fx.main}  ${fx.path}  \\d{4}-`));
  assert.match(out[1], new RegExp(`^declined  ${sha("x").slice(0, 12)}  `));
});

test("forget: removes every entry for the repo, from a worktree path too", () => {
  const fx = fixture();
  put(fx, sha(CONFIG), "trusted");
  put(fx, sha("x"), "declined");
  put(fx, sha(CONFIG), "trusted", "/other/repo");
  const r = wool(fx, ["forget", fx.wt]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `Forgot 2 entries for ${fx.main}.\n`);
  const lines = storeLines(fx);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\t\/other\/repo\t/);
});

test("forget: one entry, from the main checkout", () => {
  const fx = fixture();
  put(fx, sha(CONFIG), "trusted");
  assert.equal(wool(fx, ["forget", fx.main]).stdout, `Forgot 1 entry for ${fx.main}.\n`);
  assert.equal(wool(fx, ["forget", fx.main]).stdout, `Forgot 0 entries for ${fx.main}.\n`);
});

test("forget: a folder that isn't a repo is an error", () => {
  const fx = fixture();
  const r = wool(fx, ["forget", tmp("plain ")]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /git/);
});

test("wool.sh: no trust subcommand", () => {
  const fx = fixture();
  for (const args of [["trust", fx.wt], [], ["nope"]]) {
    const r = wool(fx, args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /usage/i);
    assert.doesNotMatch(r.stderr, /\btrust </);
  }
  assert.ok(!existsSync(fx.store));
});

test("parseCheck", () => {
  assert.deepEqual(parseCheck(`ask\t${sha(CONFIG)}`), { verdict: "ask", sha: sha(CONFIG) });
  assert.deepEqual(parseCheck(`trusted\t${sha(CONFIG)}\n`), { verdict: "trusted", sha: sha(CONFIG) });
  assert.deepEqual(parseCheck(`implicit\t${sha(CONFIG)}\n`), { verdict: "implicit", sha: sha(CONFIG) });
  assert.deepEqual(parseCheck(`declined\t${sha(CONFIG)}\n`), { verdict: "declined", sha: sha(CONFIG) });
  assert.equal(parseCheck(`maybe\t${sha(CONFIG)}\n`), null);
  assert.equal(parseCheck("ask\tnotasha\n"), null);
  assert.equal(parseCheck(""), null);
  assert.equal(parseCheck(null), null);
});
