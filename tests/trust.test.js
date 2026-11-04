import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCheck, readAnswer, promptTab, spaceForFolder } from "../mods/wool/lib/trust.js";

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
  // The state dir sits in the worktree's git dir, as wool-claim.sh makes it.
  const state = join(git(wt, "rev-parse", "--path-format=absolute", "--git-dir"), "wool");
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

// ---- wool.sh prompt ----------------------------------------------------

const QUESTION = "[d]ecline  trust [o]nce  [t]rust project";
const BSD_SCRIPT = process.platform === "darwin" || process.platform === "freebsd";
const ptyTest = (name, fn) => test(name, { skip: !BSD_SCRIPT && "needs BSD script(1) for a pseudo-terminal" }, fn);
const count = (s, sub) => s.split(sub).length - 1;

async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return fn();
}

// Runs the prompt in a pseudo-terminal. Each answer is typed only once the
// question is showing (the terminal drops input typed before it's read).
// `then` replaces the last answer: "hup" closes the terminal, "int" types Ctrl-C.
async function prompt(fx, answers, then = null) {
  writeFileSync(join(fx.state, "trust-request"), `${fx.main}\t${fx.path}\t${sha(readFileSync(join(fx.state, "config.yml"), "utf8"))}\n`);
  // script(1) can't take a socket as stdin (what Node's pipes are): cat bridges.
  const c = spawn("sh", ["-c", 'cat | script -q /dev/null sh "$0" prompt "$1"', WOOL, fx.state], {
    env: { ...process.env, XDG_CONFIG_HOME: fx.xdg }, stdio: ["pipe", "pipe", "pipe"], detached: true,
  });
  let out = "";
  c.stdout.on("data", (d) => (out += d));
  c.stderr.on("data", (d) => (out += d));
  const exited = new Promise((r) => c.on("exit", (code, signal) => r(code ?? signal)));
  let i = 0;
  for (const a of answers) {
    assert.ok(await until(() => count(out, QUESTION) > i), `question ${i + 1} never showed:\n${out}`);
    await new Promise((r) => setTimeout(r, 50));
    c.stdin.write(a + "\n");
    i++;
  }
  if (then) {
    assert.ok(await until(() => count(out, QUESTION) > i), `question never showed:\n${out}`);
    await new Promise((r) => setTimeout(r, 50));
    if (then === "hup") process.kill(-c.pid, "SIGHUP"); // the terminal goes away
    if (then === "int") c.stdin.write("\x03");
  }
  // Let cat (and so script) finish once the prompt has its answer.
  await until(() => answer(fx) !== null, 3000);
  c.stdin.end();
  const timer = setTimeout(() => { try { process.kill(-c.pid, "SIGKILL"); } catch {} }, 5000);
  const code = await exited;
  clearTimeout(timer);
  return { code, out };
}

const answer = (fx) => (existsSync(join(fx.state, "trust-answer")) ? readFileSync(join(fx.state, "trust-answer"), "utf8") : null);

ptyTest("prompt: shows repo, file, sha and contents", async () => {
  const fx = fixture({ text: "version: 1\nsetup:\n  - run: make it so\n" });
  const { out } = await prompt(fx, ["o"]);
  assert.ok(out.includes(fx.main), out);
  assert.ok(out.includes(fx.path), out);
  assert.ok(out.includes(sha("version: 1\nsetup:\n  - run: make it so\n")), out);
  assert.ok(out.includes("  - run: make it so"), out);
});

ptyTest("prompt: t trusts the project", async () => {
  const fx = fixture();
  const { code, out } = await prompt(fx, ["t"]);
  assert.equal(code, 0, out);
  assert.equal(answer(fx), "trust\n");
  const lines = storeLines(fx);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].split("\t").slice(0, 4), [sha(CONFIG), "trusted", fx.main, fx.path]);
  assert.match(out, /wool\.sh" run/);
  assert.ok(out.includes(fx.wt), out);
});

ptyTest("prompt: o trusts once", async () => {
  const fx = fixture();
  const { code, out } = await prompt(fx, ["O"]);
  assert.equal(code, 0, out);
  assert.equal(answer(fx), "once\n");
  assert.deepEqual(storeLines(fx), []);
  assert.match(out, /wool\.sh" run/);
});

ptyTest("prompt: d declines", async () => {
  const fx = fixture();
  const { code, out } = await prompt(fx, ["d"]);
  assert.equal(code, 0, out);
  assert.equal(answer(fx), "decline\n");
  assert.deepEqual(storeLines(fx)[0].split("\t").slice(0, 2), [sha(CONFIG), "declined"]);
  assert.match(out, /wool\.sh" forget/);
  assert.match(out, /wool\.sh" run/);
});

ptyTest("prompt: anything else asks again", async () => {
  const fx = fixture();
  const { out } = await prompt(fx, ["x", "", "tx", "t"]);
  assert.equal(answer(fx), "trust\n");
  assert.equal(count(out, QUESTION), 4);
});

ptyTest("prompt: control characters in the file are stripped", async () => {
  const fx = fixture({ text: "version: 1\n# \x1b]0;evil\x07 hi\r\n# \x1b[2Jcleared\tok \u009b31m\n" });
  const { out } = await prompt(fx, ["o"]);
  const shown = out.slice(out.indexOf("version: 1"), out.indexOf(QUESTION));
  assert.ok(!shown.includes("\x1b"), JSON.stringify(shown));
  assert.ok(!shown.includes("\x07"), JSON.stringify(shown));
  assert.ok(!shown.includes("\u009b"), JSON.stringify(shown));
  assert.ok(shown.includes("cleared\tok"), JSON.stringify(shown));
  // The terminal turns each \n into \r\n; a \r from the file would add one more.
  assert.ok(!shown.includes("hi\r\r"), JSON.stringify(shown));
});

ptyTest("prompt: hang-up writes none", async () => {
  const fx = fixture();
  await prompt(fx, [], "hup");
  assert.ok(await until(() => answer(fx) !== null), "no trust-answer");
  assert.equal(answer(fx), "none\n");
  assert.deepEqual(storeLines(fx), []);
});

ptyTest("prompt: Ctrl-C writes none", async () => {
  const fx = fixture();
  const { code } = await prompt(fx, [], "int");
  assert.equal(code, 130);
  assert.equal(answer(fx), "none\n");
  assert.deepEqual(storeLines(fx), []);
});

ptyTest("prompt: a config.yml that no longer matches the checked sha is refused", async () => {
  const fx = fixture();
  writeFileSync(join(fx.state, "trust-request"), `${fx.main}\t${fx.path}\t${sha(CONFIG)}\n`);
  writeFileSync(join(fx.state, "config.yml"), CONFIG + "# edited after the check\n");
  const c = spawnSync("sh", ["-c", 'cat | script -q /dev/null sh "$0" prompt "$1"', WOOL, fx.state], {
    encoding: "utf8", env: { ...process.env, XDG_CONFIG_HOME: fx.xdg }, input: "",
  });
  assert.notEqual(c.status, 0);
  assert.match(c.stdout, /changed since/);
  assert.equal(answer(fx), "none\n");
  assert.deepEqual(storeLines(fx), []);
});

test("prompt: refuses without a terminal", () => {
  const fx = fixture();
  writeFileSync(join(fx.state, "trust-request"), `${fx.main}\t${fx.path}\t${sha(CONFIG)}\n`);
  const r = wool(fx, ["prompt", fx.state], { input: "t\n" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs a terminal/);
  assert.equal(answer(fx), null);
  assert.deepEqual(storeLines(fx), []);
});

// ---- main.js helpers ---------------------------------------------------

test("readAnswer", () => {
  for (const w of ["trust", "once", "decline", "none"]) {
    assert.equal(readAnswer(w), w);
    assert.equal(readAnswer(w + "\n"), w);
  }
  assert.equal(readAnswer(null), null);
  assert.equal(readAnswer(""), null);
  assert.equal(readAnswer("maybe\n"), null);
  assert.equal(readAnswer("tru"), null);
});

test("promptTab", () => {
  assert.deepEqual(promptTab("/m/bin", "/r/.git/worktrees/b/wool"), {
    name: "wool", argv: ["sh", "/m/bin/wool.sh", "prompt", "/r/.git/worktrees/b/wool"],
  });
});

// ---- wool.sh run -------------------------------------------------------

const requestsOf = (fx) => join(fx.xdg, "wool", "requests");
const requestFiles = (fx) => (existsSync(requestsOf(fx)) ? readdirSync(requestsOf(fx)) : []);

test("run: writes a request with the worktree top", () => {
  const fx = fixture();
  mkdirSync(join(fx.wt, "src"));
  const r = wool(fx, ["run", join(fx.wt, "src")]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `Asked wool to set up ${fx.wt}.\n`);
  const files = requestFiles(fx);
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d+-\d+$/);
  assert.equal(readFileSync(join(requestsOf(fx), files[0]), "utf8"), `${fx.wt}\n`);
});

test("run: refuses the main checkout", () => {
  const fx = fixture();
  const r = wool(fx, ["run", fx.main]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /isn't a linked git worktree/);
  assert.deepEqual(requestFiles(fx), []);
});

test("run: refuses a non-repo folder", () => {
  const fx = fixture();
  const r = wool(fx, ["run", tmp("plain ")]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /isn't a linked git worktree/);
  assert.deepEqual(requestFiles(fx), []);
});

test("_take: prints each request once and removes it", () => {
  const fx = fixture();
  assert.equal(wool(fx, ["_take"]).stdout, "");
  wool(fx, ["run", fx.wt]);
  wool(fx, ["run", fx.wt]);
  const r = wool(fx, ["_take"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${fx.wt}\n${fx.wt}\n`);
  assert.deepEqual(requestFiles(fx), []);
  assert.equal(wool(fx, ["_take"]).stdout, "");
});

ptyTest("prompt: an answer to an out-of-date question is not used", async () => {
  // wool asked again (wool.sh run) while this old prompt stayed open.
  const fx = fixture();
  writeFileSync(join(fx.state, "trust-request"), `${fx.main}\t${fx.path}\t${sha(CONFIG)}\n`);
  const c = spawn("sh", ["-c", 'cat | script -q /dev/null sh "$0" prompt "$1"', WOOL, fx.state], {
    env: { ...process.env, XDG_CONFIG_HOME: fx.xdg }, stdio: ["pipe", "pipe", "pipe"], detached: true,
  });
  let out = "";
  c.stdout.on("data", (d) => (out += d));
  const exited = new Promise((r) => c.on("exit", r));
  assert.ok(await until(() => out.includes(QUESTION)), out);
  writeFileSync(join(fx.state, "trust-request"), `${fx.main}\t${fx.path}\t${sha("newer")}\n`);
  c.stdin.write("t\n");
  await until(() => out.includes("out of date"), 3000);
  c.stdin.end();
  await exited;
  assert.match(out, /out of date/);
  assert.equal(answer(fx), null);
  assert.deepEqual(storeLines(fx), []);
});

test("spaceForFolder", () => {
  const sp = (id, folder, machine = null) => ({ id, folder, machine, tabs: [] });
  const all = [sp("a", "/x/one"), sp("r", "/x/two", "vps"), sp("b", "/x/two/"), sp("c", "/x/three")];
  assert.equal(spaceForFolder(all, "/x/one").id, "a");
  assert.equal(spaceForFolder(all, "/x/one/").id, "a");
  assert.equal(spaceForFolder(all, "/x/two").id, "b");
  assert.equal(spaceForFolder([sp("r", "/x/two", "vps")], "/x/two"), null);
  assert.equal(spaceForFolder([{ id: "u", folder: "/x/u", tabs: [] }], "/x/u").id, "u");
  assert.equal(spaceForFolder(all, "/x/none"), null);
  assert.equal(spaceForFolder(all, "/x"), null);
});
