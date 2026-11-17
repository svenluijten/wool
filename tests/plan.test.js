import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planLayout, planSetupOnly, keepShell } from "../mods/wool/lib/plan.js";
import { validateConfig } from "../mods/wool/lib/schema.js";
import { parseYaml } from "../mods/wool/lib/yaml.js";
import { runArgv, waitArgv, bgArgv } from "../mods/wool/lib/shell.js";

const ctx = { binDir: "/mods/wool/bin", stateDir: "/repo/.git/worktrees/x/wool", agentArgv: ["claude"], shell: "/bin/zsh" };
const W = (yaml) => validateConfig(parseYaml(yaml), "/f");
const ops = (steps) => steps.map((s) => s.op);

const QUIZ = W(`version: 1
tabs:
  - title: Agent
    panes:
      - agent: default
  - title: Shell
    panes:
      - {}
  - title: Dev
    panes:
      - command: composer run dev
        setup: true
`);

test("keepShell uses Herdr's wrapper for POSIX shells", () => {
  assert.deepEqual(keepShell(["sh", "-c", "x"], "/bin/zsh"), ["/bin/zsh", "-lic", '"$@"; exec "$0" -li', "/bin/zsh", "sh", "-c", "x"]);
  assert.deepEqual(keepShell(["a"], "/usr/local/bin/bash"), ["/usr/local/bin/bash", "-lic", '"$@"; exec "$0" -li', "/usr/local/bin/bash", "a"]);
});

test("keepShell falls back to sh for other shells", () => {
  assert.deepEqual(keepShell(["a", "b c"], "/opt/homebrew/bin/fish"), ["sh", "-c", '"$@"; exec "$0" -l', "/opt/homebrew/bin/fish", "a", "b c"]);
});

test("keepShell runs the command, then the shell", () => {
  // A fake non-POSIX "shell" that reports how it was started proves the
  // fallback wrapper execs it after the command, as a login shell.
  const dir = mkdtempSync(join(tmpdir(), "wool shell "));
  const fake = join(dir, "fish");
  writeFileSync(fake, '#!/bin/sh\necho "shell:$*"\n');
  chmodSync(fake, 0o755);
  const argv = keepShell(["sh", "-c", "echo 'it''s one'"], fake);
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8" });
  assert.equal(r.stdout, "its one\nshell:-l\n");
});

test("quiz example", () => {
  const { steps, warnings } = planLayout(QUIZ, true, ctx);
  assert.deepEqual(warnings, []);
  assert.deepEqual(steps, [
    { op: "tab", ref: "t0p0", name: "Agent", argv: ["claude"], task: null },
    { op: "tab", ref: "t1p0", name: "Shell", argv: null, task: null },
    { op: "tab", ref: "t2p0", name: "Dev", argv: runArgv(ctx.binDir, ctx.stateDir, "composer run dev"), task: null },
    { op: "closeOriginal" },
    { op: "focus", ref: "t0p0" },
  ]);
});

test("split panes produce split steps from the previous pane", () => {
  const ws = W(`version: 1
tabs:
  - title: Work
    panes:
      - {}
      - command: npm run watch
        split: horizontal
      - split: vertical
`);
  const { steps } = planLayout(ws, false, ctx);
  assert.deepEqual(steps.slice(0, 3), [
    { op: "tab", ref: "t0p0", name: "Work", argv: null, task: null },
    { op: "split", ref: "t0p1", from: "t0p0", direction: "down", argv: keepShell(["sh", "-c", "npm run watch"], "/bin/zsh") },
    { op: "split", ref: "t0p2", from: "t0p1", direction: "right", argv: null },
  ]);
});

test("a setup pane in a split keeps its shell", () => {
  const ws = W(`version: 1
tabs:
  - panes:
      - agent: default
      - command: npm run dev
        setup: true
        split: down
`);
  const { steps } = planLayout(ws, true, ctx);
  assert.deepEqual(steps[1].argv, keepShell(runArgv(ctx.binDir, ctx.stateDir, "npm run dev"), "/bin/zsh"));
});

test("prompt becomes the tab's task", () => {
  const ws = W("version: 1\ntabs:\n  - panes:\n      - agent: default\n        prompt: Read the README\n");
  assert.deepEqual(planLayout(ws, false, ctx).steps[0], { op: "tab", ref: "t0p0", name: null, argv: ["claude"], task: "Read the README" });
});

test("a prompt on a split agent pane can't be sent and warns", () => {
  const ws = W("version: 1\ntabs:\n  - panes:\n      - {}\n      - agent: default\n        prompt: hi\n");
  const { steps, warnings } = planLayout(ws, false, ctx);
  assert.deepEqual(steps[1].argv, keepShell(["claude"], "/bin/zsh"));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /prompt/);
});

test("env merges layout env under pane env", () => {
  const ws = W(`version: 1
env:
  APP_ENV: local
  PORT: 1
tabs:
  - panes:
      - command: serve
        env:
          PORT: 8000
`);
  assert.deepEqual(planLayout(ws, false, ctx).steps[0].argv, ["env", "APP_ENV=local", "PORT=8000", "sh", "-c", "serve"]);
});

test("a shell pane with env starts the shell with that env", () => {
  const ws = W("version: 1\ntabs:\n  - panes:\n      - env:\n          A: b\n");
  assert.deepEqual(planLayout(ws, false, ctx).steps[0].argv, ["env", "A=b", "/bin/zsh", "-l"]);
});

test("adds a Setup tab when setup exists but no pane is marked setup", () => {
  const ws = W("version: 1\ntabs:\n  - title: Agent\n    panes:\n      - agent: default\n");
  const { steps } = planLayout(ws, true, ctx);
  assert.deepEqual(ops(steps), ["tab", "tab", "closeOriginal", "focus"]);
  assert.deepEqual(steps[1], { op: "tab", ref: "setup", name: "Setup", argv: runArgv(ctx.binDir, ctx.stateDir, null), task: null });
  assert.deepEqual(steps[3], { op: "focus", ref: "t0p0" });
});

test("no Setup tab when there's no setup", () => {
  const ws = W("version: 1\ntabs:\n  - panes:\n      - agent: default\n");
  assert.deepEqual(ops(planLayout(ws, false, ctx).steps), ["tab", "closeOriginal", "focus"]);
});

test("waitForSetup waits only when there is setup", () => {
  const ws = W("version: 1\ntabs:\n  - panes:\n      - command: php artisan queue:work\n        waitForSetup: true\n");
  assert.deepEqual(planLayout(ws, true, ctx).steps[0].argv, waitArgv(ctx.binDir, ctx.stateDir, "php artisan queue:work"));
  assert.deepEqual(planLayout(ws, false, ctx).steps[0].argv, ["sh", "-c", "php artisan queue:work"]);
});

test("a setup pane without setup runs its command directly", () => {
  assert.deepEqual(planLayout(QUIZ, false, ctx).steps[2].argv, ["sh", "-c", "composer run dev"]);
});

test("a setup shell pane shows setup, then stays a shell", () => {
  const ws = W("version: 1\ntabs:\n  - panes:\n      - setup: true\n");
  assert.deepEqual(planLayout(ws, true, ctx).steps[0].argv, runArgv(ctx.binDir, ctx.stateDir, null));
  assert.equal(planLayout(ws, false, ctx).steps[0].argv, null);
});

test("no installed agent: agent pane becomes a shell and warns", () => {
  const { steps, warnings } = planLayout(QUIZ, true, { ...ctx, agentArgv: null });
  assert.equal(steps[0].argv, null);
  assert.equal(steps[0].task, null);
  assert.deepEqual(warnings, ["No installed agent found; the Agent tab is a plain shell."]);
});

test("agentArgv can be a function of the pane's agent name", () => {
  const ws = W("version: 1\ntabs:\n  - panes:\n      - agent: default\n  - panes:\n      - agent: codex\n  - panes:\n      - agent: nope\n");
  const argvs = { default: ["claude"], codex: ["codex", "--yolo"] };
  const { steps, warnings } = planLayout(ws, false, { ...ctx, agentArgv: (name) => argvs[name] ?? null });
  assert.deepEqual(steps.slice(0, 3).map((s) => s.argv), [["claude"], ["codex", "--yolo"], null]);
  assert.deepEqual(warnings, ['No installed agent "nope" found; its pane is a plain shell.']);
});

test("focus: an explicit focus pane wins", () => {
  const ws = W("version: 1\ntabs:\n  - panes:\n      - agent: default\n  - panes:\n      - {}\n      - command: x\n        focus: true\n");
  assert.deepEqual(planLayout(ws, false, ctx).steps.at(-1), { op: "focus", ref: "t1p1" });
});

test("focus: the first pane when there is no agent", () => {
  const ws = W("version: 1\ntabs:\n  - panes:\n      - {}\n  - panes:\n      - command: x\n");
  assert.deepEqual(planLayout(ws, false, ctx).steps.at(-1), { op: "focus", ref: "t0p0" });
});

test("focus: the first agent pane", () => {
  const ws = W("version: 1\ntabs:\n  - panes:\n      - {}\n  - panes:\n      - command: x\n      - agent: codex\n");
  assert.deepEqual(planLayout(ws, false, ctx).steps.at(-1), { op: "focus", ref: "t1p1" });
});

test("background commands become background steps with bgArgv", () => {
  const ws = W(`version: 1
env:
  A: "1"
tabs:
  - panes:
      - {}
background:
  - command: npm run watch
    waitForSetup: true
  - command: redis-server
    env:
      B: "2"
`);
  const { steps } = planLayout(ws, true, ctx);
  assert.deepEqual(steps.filter((s) => s.op === "background"), [
    { op: "background", argv: ["env", "A=1", ...bgArgv(ctx.binDir, ctx.stateDir, 0, true, "npm run watch")] },
    { op: "background", argv: ["env", "A=1", "B=2", ...bgArgv(ctx.binDir, ctx.stateDir, 1, false, "redis-server")] },
  ]);
  assert.deepEqual(ops(steps), ["tab", "tab", "background", "background", "closeOriginal", "focus"]);
  assert.deepEqual(planLayout(ws, false, ctx).steps.find((s) => s.op === "background").argv,
    ["env", "A=1", ...bgArgv(ctx.binDir, ctx.stateDir, 0, false, "npm run watch")]);
});

test("planSetupOnly with and without setup", () => {
  assert.deepEqual(planSetupOnly(true, ctx), {
    steps: [{ op: "tab", ref: "setup", name: "Setup", argv: runArgv(ctx.binDir, ctx.stateDir, null), task: null }],
    warnings: [],
  });
  assert.deepEqual(planSetupOnly(false, ctx), { steps: [], warnings: [] });
});

test("pickAgent: default is the first installed, a name must match an installed key", async () => {
  const { pickAgent } = await import("../mods/wool/lib/plan.js");
  const known = [
    { key: "codex", run: ["codex"], installed: false },
    { key: "claude", run: ["claude"], installed: true },
    { key: "pi", run: ["pi", "--x"], installed: true },
  ];
  assert.deepEqual(pickAgent(known, "default"), ["claude"]);
  assert.deepEqual(pickAgent(known, "pi"), ["pi", "--x"]);
  assert.equal(pickAgent(known, "codex"), null);
  assert.equal(pickAgent(known, "nope"), null);
  assert.equal(pickAgent([], "default"), null);
});
