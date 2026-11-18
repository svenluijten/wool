// Builds the setup script and the argv arrays wool hands to Herdr. The long
// work happens in a terminal through bin/wool, never in exec (30 s limit).

import { branchSlug } from "./names.js";

export function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// One line per step on screen and in failed-step: a multi-line command shows
// its first line.
export function label(step) {
  const lines = String(step.name ?? step.run).split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 ? `${lines[0]} …` : (lines[0] ?? "");
}

// env: HERDR_WORKTREE, HERDR_MAIN_WORKTREE, HERDR_BRANCH. binDir: the folder
// with bin/wool, put first on PATH so steps can run `wool port`; or null.
export function setupScript(steps, env, binDir = null) {
  return stepsScript(steps, env, binDir, "HERDR_WORKTREE");
}

export function teardownScript(steps, env, binDir = null) {
  return stepsScript(steps, env, binDir, "HERDR_MAIN_WORKTREE");
}

// Everything is written as values, not worked out when the script runs, so a
// teardown sees exactly what its setup saw.
function stepsScript(steps, env, binDir, dirVar) {
  const q = shellQuote;
  const lines = [
    "#!/bin/sh",
    "# Written by wool from the repo's .herdr/wool.yml(.dist). Runs once.",
    "set -u",
    `HERDR_WORKTREE=${q(env.HERDR_WORKTREE)}`,
    `HERDR_MAIN_WORKTREE=${q(env.HERDR_MAIN_WORKTREE)}`,
    `HERDR_BRANCH=${q(env.HERDR_BRANCH)}`,
    `HERDR_BRANCH_SLUG=${q(branchSlug(env.HERDR_BRANCH))}`,
    "export HERDR_WORKTREE HERDR_MAIN_WORKTREE HERDR_BRANCH HERDR_BRANCH_SLUG",
    ...(binDir ? [`PATH=${q(binDir)}:$PATH`, "export PATH"] : []),
    `cd "$${dirVar}" || { echo "wool: can't enter $${dirVar}"; exit 1; }`,
    "wool_step() {",
    "  wool_label=$1; shift",
    "  printf '\\n==> %s\\n' \"$wool_label\"",
    '  "$@"',
    "  wool_code=$?",
    '  if [ "$wool_code" -ne 0 ]; then',
    "    printf \"\\nwool: step '%s' failed (exit %d)\\n\" \"$wool_label\" \"$wool_code\"",
    '    if [ -n "${WOOL_STATE_DIR:-}" ]; then printf \'%s\\n\' "$wool_label" > "$WOOL_STATE_DIR/failed-step"; fi',
    '    exit "$wool_code"',
    "  fi",
    "}",
  ];
  for (const step of steps) {
    const envArgs = Object.entries(step.env ?? {}).map(([k, v]) => q(`${k}=${v}`));
    const cmd = [...(envArgs.length ? ["env", ...envArgs] : []), "/bin/sh", "-c", q(step.run)];
    lines.push(`wool_step ${q(label(step))} ${cmd.join(" ")}`);
  }
  lines.push("exit 0", "");
  return lines.join("\n");
}

const viaSh = (command) => ["sh", "-c", command];

// bin/wool <command> [args], through sh so it needn't be executable.
export function woolArgv(binDir, ...args) {
  return ["sh", `${binDir}/wool`, ...args];
}

export function runArgv(binDir, stateDir, command) {
  const argv = woolArgv(binDir, "run", stateDir);
  return command === null || command === undefined ? argv : [...argv, "--", ...viaSh(command)];
}

export function teardownArgv(binDir, record) {
  return woolArgv(binDir, "teardown", record);
}

// No terminal: output goes to <stateDir>/setup.log and the steps get no stdin.
export function headlessRunArgv(binDir, stateDir) {
  return ["sh", "-c", 'exec sh "$1" run "$2" > "$2/setup.log" 2>&1 < /dev/null', "sh", `${binDir}/wool`, stateDir];
}

export function waitArgv(binDir, stateDir, command) {
  return woolArgv(binDir, "wait", stateDir, "--", ...viaSh(command));
}

export function bgArgv(binDir, stateDir, n, wait, command) {
  return woolArgv(binDir, "bg", stateDir, String(n), ...(wait ? ["--wait"] : []), "--", ...viaSh(command));
}

export function withEnv(argv, env) {
  const pairs = Object.entries(env ?? {});
  if (pairs.length === 0) return argv;
  return ["env", ...pairs.map(([k, v]) => `${k}=${v}`), ...argv];
}
