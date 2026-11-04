import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { shellQuote, setupScript, runArgv, waitArgv, bgArgv, withEnv } from "../mods/wool/lib/shell.js";

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

test("wool-run writes ok and execs the command", () => {
  const { dir, worktree } = state([{ name: "s", run: "true", env: {} }]);
  const r = run(runArgv(BIN, dir, `echo started > ${shellQuote(join(worktree, "cmd.txt"))}; echo ran`));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(status(dir), "ok");
  assert.match(r.stdout, /ran/);
  assert.ok(existsSync(join(worktree, "cmd.txt")));
});

test("wool-run without a command writes ok and exits 0", () => {
  const { dir } = state([{ name: "s", run: "true", env: {} }]);
  const r = run(runArgv(BIN, dir, null));
  assert.equal(r.status, 0);
  assert.equal(status(dir), "ok");
});

test("wool-run writes failed <label> and does not run the command", () => {
  const { dir, worktree } = state([{ name: "Install deps", run: "echo boom; exit 2", env: {} }]);
  const r = run(runArgv(BIN, dir, `touch ${shellQuote(join(worktree, "cmd.txt"))}`));
  assert.notEqual(r.status, 0);
  assert.equal(status(dir), "failed Install deps");
  assert.ok(!existsSync(join(worktree, "cmd.txt")));
  assert.match(r.stdout, /boom/);
  assert.match(r.stdout + r.stderr, /not starting/);
});

test("wool-run killed with SIGHUP writes failed interrupted", async () => {
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

test("wool-wait runs the command after ok", async () => {
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

test("wool-wait exits 1 after failed", async () => {
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

test("wool-wait gives up when no status appears", () => {
  const dir = tmp();
  const r = run(waitArgv(BIN, dir, "echo nope"), { env: { ...process.env, WOOL_WAIT_MISSING_SECS: "1" }, timeout: 8000 });
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout, /^nope$/m);
});

test("wool-wait stops waiting when the runner died without writing a result", () => {
  const dir = tmp();
  writeFileSync(join(dir, "status"), "running\n");
  const dead = spawnSync("sh", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(dir, "pid"), dead + "\n");
  const r = run(waitArgv(BIN, dir, "echo nope"), { timeout: 8000 });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /setup failed, not starting/);
});

test("wool-bg records exit code and log", () => {
  const dir = tmp();
  const r = run(bgArgv(BIN, dir, 2, false, "echo out; echo err >&2; exit 4"));
  assert.equal(r.status, 0);
  assert.equal(readFileSync(join(dir, "bg-2.exit"), "utf8").trim(), "4");
  assert.match(readFileSync(join(dir, "bg-2.log"), "utf8"), /out[\s\S]*err/);
  assert.match(readFileSync(join(dir, "bg-2.pid"), "utf8"), /^\d+\n$/);
});

test("wool-bg --wait skips the command when setup failed", () => {
  const dir = tmp();
  writeFileSync(join(dir, "status"), "failed x\n");
  const out = join(dir, "ran");
  run(bgArgv(BIN, dir, 0, true, `touch "${out}"`), { timeout: 8000 });
  assert.equal(readFileSync(join(dir, "bg-0.exit"), "utf8").trim(), "skipped");
  assert.ok(!existsSync(out));
});

test("wool-bg --wait runs after ok", () => {
  const dir = tmp();
  writeFileSync(join(dir, "status"), "ok\n");
  run(bgArgv(BIN, dir, 1, true, "exit 0"), { timeout: 8000 });
  assert.equal(readFileSync(join(dir, "bg-1.exit"), "utf8").trim(), "0");
});

test("argv builders", () => {
  assert.deepEqual(runArgv("/b in", "/s", "npm run dev"), ["sh", "/b in/wool-run.sh", "/s", "--", "sh", "-c", "npm run dev"]);
  assert.deepEqual(runArgv("/b", "/s", null), ["sh", "/b/wool-run.sh", "/s"]);
  assert.deepEqual(waitArgv("/b", "/s", "x"), ["sh", "/b/wool-wait.sh", "/s", "--", "sh", "-c", "x"]);
  assert.deepEqual(bgArgv("/b", "/s", 3, true, "x"), ["sh", "/b/wool-bg.sh", "/s", "3", "--wait", "--", "sh", "-c", "x"]);
  assert.deepEqual(bgArgv("/b", "/s", 0, false, "x"), ["sh", "/b/wool-bg.sh", "/s", "0", "--", "sh", "-c", "x"]);
  assert.deepEqual(withEnv(["a"], {}), ["a"]);
  assert.deepEqual(withEnv(["a", "b"], { K: "v w", L: "$x" }), ["env", "K=v w", "L=$x", "a", "b"]);
});

test("withEnv argv sets the variables for the command", () => {
  const r = run(withEnv(["sh", "-c", 'printf %s "$K"'], { K: "it's $x" }));
  assert.equal(r.stdout, "it's $x");
});

test("scripts are valid POSIX sh", () => {
  for (const f of ["wool-run.sh", "wool-wait.sh", "wool-bg.sh", "wool-claim.sh", "wool.sh"]) {
    const r = run(["sh", "-n", join(BIN, f)]);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test("wool-run interrupted with Ctrl-C stops the running step too", async () => {
  // A step whose sh ignores INT (as a background job's children do) must still
  // stop: wool-run signals the whole tree, not just setup.sh.
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
