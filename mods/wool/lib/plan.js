// Turns a validated workspace into the ordered steps main.js runs as Herdr
// commands. Refs (t<tab>p<pane>, "setup") name panes before they exist;
// main.js maps them to real ids as each one appears.

import { runArgv, waitArgv, bgArgv, headlessRunArgv, withEnv } from "./shell.js";

const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const NO_AGENT = "No installed agent found; the Agent tab is a plain shell.";
const noNamedAgent = (name) => `No installed agent "${name}" found; its pane is a plain shell.`;

// ctx.agentArgv: one argv for every agent pane, or a function of the pane's
// agent name ("default" or a key such as "codex") returning argv or null.
const agentFor = (ctx, name) => (typeof ctx.agentArgv === "function" ? ctx.agentArgv(name) : ctx.agentArgv) ?? null;

// pane.split {argv} runs argv bare and closes the pane when it exits, so a
// split's command is wrapped the way Herdr wraps tab.new's: run it, then the shell.
export function keepShell(argv, shell) {
  const base = shell.split("/").pop();
  if (POSIX_SHELLS.has(base)) return [shell, "-lic", '"$@"; exec "$0" -li', shell, ...argv];
  return ["sh", "-c", '"$@"; exec "$0" -l', shell, ...argv];
}

// Commands started without a terminal get the app's bare PATH. An interactive
// login shell reads the person's rc files, as Herdr's tabs do.
export function inLoginShell(argv, shell) {
  if (!POSIX_SHELLS.has(shell.split("/").pop())) return argv;
  return [shell, "-lic", 'exec "$@"', shell, ...argv];
}

const setupTab = (ctx) => ({ op: "tab", ref: "setup", name: "Setup", argv: runArgv(ctx.binDir, ctx.stateDir, null), task: null });
const setupInBackground = (ctx) => ({ op: "setupInBackground", argv: inLoginShell(headlessRunArgv(ctx.binDir, ctx.stateDir), ctx.shell) });

function paneArgv(pane, hasSetup, ctx) {
  if (pane.kind === "shell") return pane.setup && hasSetup ? runArgv(ctx.binDir, ctx.stateDir, null) : null;
  if (pane.kind === "agent") return agentFor(ctx, pane.agent);
  if (pane.setup && hasSetup) return runArgv(ctx.binDir, ctx.stateDir, pane.command);
  if (pane.waitForSetup && hasSetup) return waitArgv(ctx.binDir, ctx.stateDir, pane.command);
  return ["sh", "-c", pane.command];
}

export function planLayout(ws, hasSetup, ctx) {
  const steps = [];
  const warnings = [];
  const warn = (w) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  let focusRef = null;
  let agentRef = null;
  const headless = ws.setupIn === "background";
  // First, so panes and background commands that wait find its status at once.
  if (hasSetup && headless) steps.push(setupInBackground(ctx));

  ws.tabs.forEach((tab, ti) => {
    tab.panes.forEach((pane, pi) => {
      const ref = `t${ti}p${pi}`;
      const agentArgv = pane.kind === "agent" ? agentFor(ctx, pane.agent) : null;
      if (pane.kind === "agent" && agentArgv === null) warn(pane.agent === "default" ? NO_AGENT : noNamedAgent(pane.agent));
      const env = { ...ws.env, ...pane.env };
      const hasEnv = Object.keys(env).length > 0;
      let argv = paneArgv(pane, hasSetup, ctx);
      const isShell = argv === null;
      if (hasEnv) argv = withEnv(argv ?? [ctx.shell, "-l"], env);
      const agentRuns = agentArgv !== null;

      if (pi === 0) {
        steps.push({ op: "tab", ref, name: tab.title, argv, task: agentRuns ? pane.prompt : null });
      } else {
        if (agentRuns && pane.prompt !== null) {
          warn(`tabs[${ti}].panes[${pi}]: a prompt can only be sent to an agent in a tab's first pane; it was left out.`);
        }
        steps.push({ op: "split", ref, from: `t${ti}p${pi - 1}`, direction: pane.split, argv: argv === null || isShell ? argv : keepShell(argv, ctx.shell) });
      }
      if (pane.focus) focusRef = ref;
      if (pane.kind === "agent" && agentRef === null) agentRef = ref;
    });
  });

  if (hasSetup && !headless && !ws.tabs.some((t) => t.panes.some((p) => p.setup))) steps.push(setupTab(ctx));

  ws.background.forEach((b, n) => {
    const argv = bgArgv(ctx.binDir, ctx.stateDir, n, b.waitForSetup && hasSetup, b.command);
    steps.push({ op: "background", argv: inLoginShell(withEnv(argv, { ...ws.env, ...b.env }), ctx.shell) });
  });

  steps.push({ op: "closeOriginal" });
  steps.push({ op: "focus", ref: focusRef ?? agentRef ?? "t0p0" });
  return { steps, warnings };
}

export function planSetupOnly(hasSetup, ctx, setupIn = "tab") {
  if (!hasSetup) return { steps: [], warnings: [] };
  return { steps: [setupIn === "background" ? setupInBackground(ctx) : setupTab(ctx)], warnings: [] };
}

// knownAgents() is most-picked first: "default" is the first installed one;
// any other name must be an installed entry's key.
export function pickAgent(known, name) {
  const hit = name === "default" ? known.find((a) => a.installed) : known.find((a) => a.key === name && a.installed);
  return hit ? hit.run : null;
}
