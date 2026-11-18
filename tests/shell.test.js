import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { shellQuote, setupScript, teardownScript, teardownArgv, label, runArgv, waitArgv, bgArgv, headlessRunArgv, withEnv } from "../mods/wool/lib/shell.js";
import { branchSlug } from "../mods/wool/lib/names.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "mods", "wool", "bin");
const tmp = (name = "wool test ") => mkdtempSync(join(tmpdir(), name));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function state(steps, worktree = tmp("wt it's $x ")) {
  const dir = tmp("state ");
  const script = setupScript(steps, { HERDR_WORKTREE: worktree, HERDR_MAIN_WORKTREE: "/main dir", HERDR_BRANCH: "feat/it's-$x" });
  writeFileSync(join(dir, "setup.sh"), script);
  return { dir, worktree };
}

function run(argv, opts = {}) {
  return spawnSync(argv[0], argv.slice(1), { encoding: "utf8", ...opts });
}

async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(50);
  }
  return fn();
}

const status = (dir) => (existsSync(join(dir, "status")) ? readFileSync(join(dir, "status"), "utf8").trim() : null);

test("shellQuote round-trips through sh", () => {
  for (const s of ["", "a b", "it's", "$HOME", '"q"', "a\nb", "`x`", "\\n", "'", "''", "~/x *"]) {
    const out = execFileSync("sh", ["-c", "printf %s " + shellQuote(s)], { encoding: "utf8" });
    assert.equal(out, s, `round trip of ${JSON.stringify(s)}`);
  }
});

test("setup script runs steps in order in the worktree with env vars", () => {
  const { dir, worktree } = state([
    { name: "branch", run: 'printf %s "$HERDR_BRANCH" > branch.txt', env: {} },
    { name: null, run: 'pwd -P > pwd.txt; printf %s "$HERDR_MAIN_WORKTREE" > main.txt', env: {} },
    { name: "env", run: 'printf %s "$GREETING" > env.txt; cat branch.txt > order.txt', env: { GREETING: "hi there's $x" } },
  ]);
  const r = run(["sh", join(dir, "setup.sh")]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(worktree, "branch.txt"), "utf8"), "feat/it's-$x");
  assert.equal(readFileSync(join(worktree, "pwd.txt"), "utf8").trim(), execFileSync("sh", ["-c", 'cd "$1" && pwd -P', "sh", worktree], { encoding: "utf8" }).trim());
  assert.equal(readFileSync(join(worktree, "main.txt"), "utf8"), "/main dir");
  assert.equal(readFileSync(join(worktree, "env.txt"), "utf8"), "hi there's $x");
  assert.equal(readFileSync(join(worktree, "order.txt"), "utf8"), "feat/it's-$x");
  assert.match(r.stdout, /==> branch/);
  assert.match(r.stdout, /==> pwd -P > pwd.txt/);
});

test("teardown script runs its steps in the main checkout, with the gone worktree's env", () => {
  const main = tmp("main it's $x ");
  const script = teardownScript(
    [{ name: "where", run: 'pwd -P > where.txt; printf %s "$HERDR_WORKTREE|$HERDR_BRANCH|$DB" > env.txt', env: { DB: "app_x" } }],
    { HERDR_WORKTREE: "/gone/wt", HERDR_MAIN_WORKTREE: main, HERDR_BRANCH: "feat/x" },
  );
  const file = join(tmp(), "teardown.sh");
  writeFileSync(file, script);
  const r = run(["sh", file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(main, "where.txt"), "utf8").trim(), execFileSync("sh", ["-c", 'cd "$1" && pwd -P', "sh", main], { encoding: "utf8" }).trim());
  assert.equal(readFileSync(join(main, "env.txt"), "utf8"), "/gone/wt|feat/x|app_x");
  assert.match(r.stdout, /==> where/);
});

test("a step's env doesn't leak into the next step", () => {
  const { dir, worktree } = state([
    { name: "a", run: "true", env: { ONLY_A: "1" } },
    { name: "b", run: 'printf %s "${ONLY_A:-unset}" > b.txt', env: {} },
  ]);
  assert.equal(run(["sh", join(dir, "setup.sh")]).status, 0);
  assert.equal(readFileSync(join(worktree, "b.txt"), "utf8"), "unset");
});

test("setup script stops at the first failing step", () => {
  const { dir, worktree } = state([
    { name: "one", run: "touch one", env: {} },
    { name: "two", run: "exit 3", env: {} },
    { name: "three", run: "touch three", env: {} },
  ]);
  const r = run(["sh", join(dir, "setup.sh")]);
  assert.equal(r.status, 3);
  assert.ok(existsSync(join(worktree, "one")));
  assert.ok(!existsSync(join(worktree, "three")));
  assert.match(r.stdout + r.stderr, /step 'two' failed \(exit 3\)/);
});

test("wool run writes ok and execs the command", () => {
  const { dir, worktree } = state([{ name: "s", run: "true", env: {} }]);
  const r = run(runArgv(BIN, dir, `echo started > ${shellQuote(join(worktree, "cmd.txt"))}; echo ran`));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(status(dir), "ok");
  assert.match(r.stdout, /ran/);
  assert.ok(existsSync(join(worktree, "cmd.txt")));
});

test("wool run without a command writes ok and exits 0", () => {
  const { dir } = state([{ name: "s", run: "true", env: {} }]);
  const r = run(runArgv(BIN, dir, null));
  assert.equal(r.status, 0);
  assert.equal(status(dir), "ok");
});

test("wool run writes failed <label> and does not run the command", () => {
  const { dir, worktree } = state([{ name: "Install deps", run: "echo boom; exit 2", env: {} }]);
  const r = run(runArgv(BIN, dir, `touch ${shellQuote(join(worktree, "cmd.txt"))}`));
  assert.notEqual(r.status, 0);
  assert.equal(status(dir), "failed Install deps");
  assert.ok(!existsSync(join(worktree, "cmd.txt")));
  assert.match(r.stdout, /boom/);
  assert.match(r.stdout + r.stderr, /not starting/);
});

test("headless wool run writes ok and its output to setup.log", () => {
  const { dir } = state([{ name: "s", run: "echo from-step", env: {} }]);
  const r = run(headlessRunArgv(BIN, dir));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, "");
  assert.equal(status(dir), "ok");
  assert.match(readFileSync(join(dir, "setup.log"), "utf8"), /from-step[\s\S]*setup finished/);
});

test("headless wool run writes failed <label>, with the output in setup.log", () => {
  const { dir } = state([{ name: "Install deps", run: "echo boom; exit 2", env: {} }]);
  const r = run(headlessRunArgv(BIN, dir));
  assert.notEqual(r.status, 0);
  assert.equal(status(dir), "failed Install deps");
  assert.match(readFileSync(join(dir, "setup.log"), "utf8"), /boom/);
});

test("headless wool run gives the steps no stdin", () => {
  const { dir } = state([{ name: "read", run: "read x", env: {} }]);
  run(headlessRunArgv(BIN, dir), { input: "typed\n" });
  assert.equal(status(dir), "failed read");
});

test("wool run killed with SIGHUP writes failed interrupted", async () => {
  const { dir } = state([{ name: "slow", run: "sleep 5", env: {} }]);
  const argv = runArgv(BIN, dir, null);
  const child = spawn(argv[0], argv.slice(1), { stdio: "ignore" });
  await waitFor(() => status(dir) === "running");
  await sleep(300);
  const t0 = Date.now();
  child.kill("SIGHUP");
  const s = await waitFor(() => (status(dir) !== "running" ? status(dir) : null), 3000);
  assert.equal(s, "failed interrupted");
  assert.ok(Date.now() - t0 < 2000, "the trap ran without waiting for the step");
});

test("wool wait runs the command after ok", async () => {
  const dir = tmp();
  const out = join(dir, "out.txt");
  const argv = waitArgv(BIN, dir, `echo go > "${out}"`);
  const child = spawn(argv[0], argv.slice(1), { stdio: "pipe" });
  let text = "";
  child.stdout.on("data", (d) => (text += d));
  await sleep(1200);
  assert.ok(!existsSync(out), "didn't start before setup finished");
  writeFileSync(join(dir, "status"), "ok\n");
  const code = await new Promise((r) => child.on("exit", r));
  assert.equal(code, 0);
  assert.equal(readFileSync(out, "utf8").trim(), "go");
  assert.match(text, /waiting for setup/);
});

test("wool wait exits 1 after failed", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "status"), "running\n");
  const out = join(dir, "out.txt");
  const argv = waitArgv(BIN, dir, `touch "${out}"`);
  const child = spawn(argv[0], argv.slice(1), { stdio: "pipe" });
  let text = "";
  child.stdout.on("data", (d) => (text += d));
  await sleep(1500);
  writeFileSync(join(dir, "status"), "failed two\n");
  const code = await new Promise((r) => child.on("exit", r));
  assert.equal(code, 1);
  assert.ok(!existsSync(out));
  assert.match(text, /setup failed, not starting/);
});

test("wool wait gives up when no status appears", () => {
  const dir = tmp();
  const r = run(waitArgv(BIN, dir, "echo nope"), { env: { ...process.env, WOOL_WAIT_MISSING_SECS: "1" }, timeout: 8000 });
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout, /^nope$/m);
});

test("wool wait stops waiting when the runner died without writing a result", () => {
  const dir = tmp();
  writeFileSync(join(dir, "status"), "running\n");
  const dead = spawnSync("sh", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(dir, "pid"), dead + "\n");
  const r = run(waitArgv(BIN, dir, "echo nope"), { timeout: 8000 });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /setup failed, not starting/);
});

test("wool bg records exit code and log", () => {
  const dir = tmp();
  const r = run(bgArgv(BIN, dir, 2, false, "echo out; echo err >&2; exit 4"));
  assert.equal(r.status, 0);
  assert.equal(readFileSync(join(dir, "bg-2.exit"), "utf8").trim(), "4");
  assert.match(readFileSync(join(dir, "bg-2.log"), "utf8"), /out[\s\S]*err/);
  assert.match(readFileSync(join(dir, "bg-2.pid"), "utf8"), /^\d+\n$/);
});

test("wool bg --wait skips the command when setup failed", () => {
  const dir = tmp();
  writeFileSync(join(dir, "status"), "failed x\n");
  const out = join(dir, "ran");
  run(bgArgv(BIN, dir, 0, true, `touch "${out}"`), { timeout: 8000 });
  assert.equal(readFileSync(join(dir, "bg-0.exit"), "utf8").trim(), "skipped");
  assert.ok(!existsSync(out));
});

test("wool bg --wait runs after ok", () => {
  const dir = tmp();
  writeFileSync(join(dir, "status"), "ok\n");
  run(bgArgv(BIN, dir, 1, true, "exit 0"), { timeout: 8000 });
  assert.equal(readFileSync(join(dir, "bg-1.exit"), "utf8").trim(), "0");
});

test("argv builders", () => {
  assert.deepEqual(runArgv("/b in", "/s", "npm run dev"), ["sh", "/b in/wool", "run", "/s", "--", "sh", "-c", "npm run dev"]);
  assert.deepEqual(runArgv("/b", "/s", null), ["sh", "/b/wool", "run", "/s"]);
  assert.deepEqual(waitArgv("/b", "/s", "x"), ["sh", "/b/wool", "wait", "/s", "--", "sh", "-c", "x"]);
  assert.deepEqual(bgArgv("/b", "/s", 3, true, "x"), ["sh", "/b/wool", "bg", "/s", "3", "--wait", "--", "sh", "-c", "x"]);
  assert.deepEqual(bgArgv("/b", "/s", 0, false, "x"), ["sh", "/b/wool", "bg", "/s", "0", "--", "sh", "-c", "x"]);
  assert.deepEqual(withEnv(["a"], {}), ["a"]);
  assert.deepEqual(withEnv(["a", "b"], { K: "v w", L: "$x" }), ["env", "K=v w", "L=$x", "a", "b"]);
});

test("withEnv argv sets the variables for the command", () => {
  const r = run(withEnv(["sh", "-c", 'printf %s "$K"'], { K: "it's $x" }));
  assert.equal(r.stdout, "it's $x");
});

// A fake common git dir with one record, as wool writes it at setup.
function record(steps, { worktree = join(tmp(), "gone wt"), name = "feat-x" } = {}) {
  const common = join(tmp("repo it's "), ".git");
  mkdirSync(common);
  writeFileSync(join(common, "HEAD"), "ref: refs/heads/main\n");
  const main = dirname(common);
  const rec = join(common, "wool", name);
  mkdirSync(rec, { recursive: true });
  writeFileSync(join(rec, "worktree"), worktree + "\n");
  writeFileSync(join(rec, "teardown.sh"), teardownScript(steps, { HERDR_WORKTREE: worktree, HERDR_MAIN_WORKTREE: main, HERDR_BRANCH: "feat/x" }));
  return { rec, main, common, worktree };
}
const teardown = (...args) => run(["sh", join(BIN, "wool"), "teardown", ...args]);

test("wool teardown runs teardown once the worktree is gone, then deletes the record", () => {
  const { rec, main, common } = record([{ name: "drop", run: "touch dropped", env: {} }]);
  const r = teardown(rec);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok$/m);
  assert.ok(existsSync(join(main, "dropped")));
  assert.ok(!existsSync(rec));
  assert.ok(!existsSync(join(common, "wool")), "the empty wool folder stays behind");
});

test("wool teardown keeps the wool folder while other records are in it", () => {
  const { rec, common } = record([]);
  mkdirSync(join(common, "wool", "other"));
  assert.equal(teardown(rec).status, 0);
  assert.ok(!existsSync(rec));
  assert.ok(existsSync(join(common, "wool", "other")));
});

test("wool teardown does nothing while the worktree still exists", () => {
  const { rec, main } = record([{ name: "drop", run: "touch dropped", env: {} }], { worktree: tmp() });
  const r = teardown(rec);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^alive$/m);
  assert.ok(!existsSync(join(main, "dropped")));
  assert.ok(existsSync(rec));
});

test("wool teardown keeps the record, its log and the failed step when a step fails", () => {
  const { rec, main } = record([
    { name: "one", run: "echo hello from one", env: {} },
    { name: "two", run: "exit 3", env: {} },
    { name: "three", run: "touch three", env: {} },
  ]);
  const r = teardown(rec);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /^failed two$/m);
  assert.equal(readFileSync(join(rec, "status"), "utf8").trim(), "failed two");
  assert.match(readFileSync(join(rec, "teardown.log"), "utf8"), /hello from one/);
  assert.ok(!existsSync(join(main, "three")));
  assert.ok(!existsSync(join(rec, "running")), "a failed run must not block a retry");
});

test("wool teardown --check reports gone, alive, failed and busy without running anything", () => {
  const { rec, main } = record([{ name: "drop", run: "touch dropped", env: {} }]);
  assert.match(teardown("--check", rec).stdout, /^gone$/m);
  writeFileSync(join(rec, "status"), "failed drop\n");
  assert.match(teardown("--check", rec).stdout, /^failed$/m);
  mkdirSync(join(rec, "running"));
  assert.match(teardown("--check", rec).stdout, /^busy$/m);
  assert.match(teardown(rec).stdout, /^busy$/m);
  assert.ok(!existsSync(join(main, "dropped")));
  const alive = record([], { worktree: tmp() });
  assert.match(teardown("--check", alive.rec).stdout, /^alive$/m);
});

test("wool teardown refuses a folder that isn't a record in a git dir", () => {
  const { rec } = record([]);
  const notWool = join(tmp(), "x");
  mkdirSync(notWool);
  writeFileSync(join(notWool, "worktree"), "/gone\n");
  writeFileSync(join(notWool, "teardown.sh"), "exit 0\n");
  for (const bad of [notWool, dirname(rec), join(rec, "..", "..", "wool", "missing")]) {
    const r = teardown(bad);
    assert.equal(r.status, 2, `${bad}: ${r.stdout}`);
    assert.ok(existsSync(bad) || bad.endsWith("missing"));
  }
  assert.ok(existsSync(notWool));
});

test("wool records lists a repo's records from any of its checkouts", () => {
  const { rec, main, worktree } = record([]);
  const empty = join(dirname(rec), "no-worktree-file");
  mkdirSync(empty);
  execFileSync("git", ["init", "-q", main]);
  const r = run(["sh", join(BIN, "wool"), "records", main]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${realpathSync(rec)}\t${worktree}\n`);
  assert.equal(run(["sh", join(BIN, "wool"), "records", tmp()]).stdout, "");
});

test("scripts are valid POSIX sh", () => {
  for (const f of ["bin/wool", ...["run", "wait", "bg", "claim", "trust", "teardown", "records", "port"].map((n) => `libexec/${n}.sh`)]) {
    const r = run(["sh", "-n", join(BIN, "..", f)]);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test("wool run interrupted with Ctrl-C stops the running step too", async () => {
  // A step whose sh ignores INT (as a background job's children do) must still
  // stop: `wool run` signals the whole tree, not just setup.sh.
  const { dir, worktree } = state([{ name: "slow", run: "trap '' INT; sleep 2; touch marker", env: {} }]);
  const argv = runArgv(BIN, dir, null);
  const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"], detached: true });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  await waitFor(() => status(dir) === "running");
  await sleep(400);
  process.kill(-child.pid, "SIGINT");
  await new Promise((r) => child.on("exit", r));
  assert.equal(status(dir), "failed interrupted");
  await sleep(2500);
  assert.ok(!existsSync(join(worktree, "marker")), "the step kept running after Ctrl-C");
  assert.match(out, /setup interrupted/);
});

test("setup and teardown scripts export the branch slug", () => {
  const worktree = tmp("wt ");
  const dir = tmp("state ");
  writeFileSync(join(dir, "setup.sh"), setupScript(
    [{ name: "slug", run: 'printf %s "$HERDR_BRANCH_SLUG" > slug.txt', env: {} }],
    { HERDR_WORKTREE: worktree, HERDR_MAIN_WORKTREE: "/main", HERDR_BRANCH: "feat/x" },
  ));
  const r = run(["sh", join(dir, "setup.sh")]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(worktree, "slug.txt"), "utf8"), branchSlug("feat/x"));
  const env = { HERDR_WORKTREE: "/w", HERDR_MAIN_WORKTREE: "/m", HERDR_BRANCH: "feat/x" };
  assert.match(teardownScript([], env), new RegExp(`^HERDR_BRANCH_SLUG='${branchSlug("feat/x")}'$`, "m"));
});

test("a multi-line run runs every line; its label is the first line", () => {
  const { dir, worktree } = state([{ name: null, run: "\n  echo one > one.txt\necho two > two.txt\n", env: {} }]);
  const r = run(["sh", join(dir, "setup.sh")]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(worktree, "one.txt")) && existsSync(join(worktree, "two.txt")));
  assert.match(r.stdout, /==> echo one > one.txt …\n/);
});

test("label", () => {
  assert.equal(label({ name: "Install", run: "x" }), "Install");
  assert.equal(label({ name: null, run: "npm ci" }), "npm ci");
  assert.equal(label({ name: null, run: "a\nb\n" }), "a …");
  assert.equal(label({ name: "Ports\n", run: "a\nb" }), "Ports");
});

test("teardownArgv", () => {
  assert.deepEqual(teardownArgv("/bin dir", "/rec"), ["sh", "/bin dir/wool", "teardown", "/rec"]);
});

// ---- bin/wool --------------------------------------------------------------

const WOOL = join(BIN, "wool");
const wool = (args, opts = {}) => run(["sh", WOOL, ...args], opts);

test("wool help lists the commands people run", () => {
  const r = wool(["help"]);
  assert.equal(r.status, 0);
  for (const c of ["port [name]", "rerun <worktree>", "teardown <record>", "trust list", "trust forget <folder>"]) {
    assert.ok(r.stdout.includes(c), c);
  }
});

test("wool with no command, or an unknown one, prints usage and exits 2", () => {
  for (const args of [[], ["nope"], ["trust"], ["trust", "nope"]]) {
    const r = wool(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /usage: wool <command>/);
  }
  assert.match(wool(["trust", "nope"]).stderr, /unknown command: trust nope/);
});

test("wool runs through a relative symlink on PATH", () => {
  const dir = tmp("path ");
  symlinkSync(relative(dir, WOOL), join(dir, "wool"));
  const r = run(["sh", "-c", "wool port vite"], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, HERDR_BRANCH: "feat/x" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^1\d{4}\n$/);
});

const port = (branch, ...args) => wool(["port", ...args], { env: { ...process.env, HERDR_BRANCH: branch } });

test("wool port gives a stable port from 10000 to 19999 per branch and name", () => {
  const seen = new Set();
  for (const b of ["main", "feat/x", "feat/y", "it's $x"]) {
    for (const name of [[], ["vite"], ["pgsql"]]) {
      const a = port(b, ...name);
      assert.equal(a.status, 0, a.stderr);
      const n = Number(a.stdout.trim());
      assert.ok(n >= 10000 && n <= 19999, a.stdout);
      assert.equal(port(b, ...name).stdout, a.stdout);
      seen.add(n);
    }
  }
  assert.ok(seen.size > 6, "ports spread out");
});

test("wool port fails without a branch, or with more than one name", () => {
  const r = port("");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /detached/);
  assert.equal(port("main", "a", "b").status, 2);
});

test("setup steps get wool on PATH", () => {
  const worktree = tmp("wt ");
  const dir = tmp("state ");
  writeFileSync(join(dir, "setup.sh"), setupScript(
    [{ name: "port", run: "wool port vite > port.txt", env: {} }],
    { HERDR_WORKTREE: worktree, HERDR_MAIN_WORKTREE: "/main", HERDR_BRANCH: "feat/x" },
    BIN,
  ));
  const r = run(["sh", join(dir, "setup.sh")]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(worktree, "port.txt"), "utf8"), port("feat/x", "vite").stdout);
});

test("without a bin folder, the scripts leave PATH alone", () => {
  assert.doesNotMatch(setupScript([], { HERDR_WORKTREE: "/w", HERDR_MAIN_WORKTREE: "/m", HERDR_BRANCH: "b" }), /PATH=/);
});
