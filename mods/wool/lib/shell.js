// Builds the setup script and the argv arrays wool hands to Herdr. The long
// work happens in a terminal through bin/*.sh, never in exec (30 s limit).

export function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

const label = (step) => step.name ?? step.run;

export function setupScript(steps, env) {
  return stepsScript(steps, env, "HERDR_WORKTREE");
}

export function teardownScript(steps, env) {
  return stepsScript(steps, env, "HERDR_MAIN_WORKTREE");
}

function stepsScript(steps, env, dirVar) {
  const q = shellQuote;
  const lines = [
    "#!/bin/sh",
    "# Written by wool from the repo's .herdr/wool.yml(.dist). Runs once.",
    "set -u",
    `HERDR_WORKTREE=${q(env.HERDR_WORKTREE)}`,
    `HERDR_MAIN_WORKTREE=${q(env.HERDR_MAIN_WORKTREE)}`,
    `HERDR_BRANCH=${q(env.HERDR_BRANCH)}`,
    "export HERDR_WORKTREE HERDR_MAIN_WORKTREE HERDR_BRANCH",
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

export function runArgv(binDir, stateDir, command) {
  const argv = ["sh", `${binDir}/wool-run.sh`, stateDir];
  return command === null || command === undefined ? argv : [...argv, "--", ...viaSh(command)];
}

// No terminal: output goes to <stateDir>/setup.log and the steps get no stdin.
export function headlessRunArgv(binDir, stateDir) {
  return ["sh", "-c", 'exec sh "$1" "$2" > "$2/setup.log" 2>&1 < /dev/null', "sh", `${binDir}/wool-run.sh`, stateDir];
}

export function waitArgv(binDir, stateDir, command) {
  return ["sh", `${binDir}/wool-wait.sh`, stateDir, "--", ...viaSh(command)];
}

export function bgArgv(binDir, stateDir, n, wait, command) {
  return ["sh", `${binDir}/wool-bg.sh`, stateDir, String(n), ...(wait ? ["--wait"] : []), "--", ...viaSh(command)];
}

export function withEnv(argv, env) {
  const pairs = Object.entries(env ?? {});
  if (pairs.length === 0) return argv;
  return ["env", ...pairs.map(([k, v]) => `${k}=${v}`), ...argv];
}
