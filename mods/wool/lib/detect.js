// Decides what a newly seen space is. Herdr reports a new space's pane before
// its terminal, and a space started with an agent first reports its program as
// a shell, so the terminal's launch argv is what tells a plain shell apart.

export const PENDING_LIMIT_MS = 10000;
export const FRESH_MINUTES = 3;

// Herdr starts a plain shell as e.g. ["/bin/zsh", "-l"]; anything it launches
// with argv runs as [shell, "-lic", '"$@"; exec "$0" -li', shell, ...argv].
export function isPlainShellArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return false;
  return argv.slice(1).every((a) => typeof a === "string" && /^-[A-Za-z]+$/.test(a) && !a.includes("c"));
}

export function classifySpace(space, panes, terminals, firstSeenAt, now) {
  if (space.machine !== null && space.machine !== undefined) return "remote";
  const waiting = now - firstSeenAt < PENDING_LIMIT_MS;
  const pending = () => (waiting ? "pending" : "other");
  if (space.tabs.length === 0) return pending();
  if (space.tabs.length > 1) return "other";
  const tab = space.tabs[0];
  const mine = panes.filter((p) => p.tab === tab.id);
  if (mine.length === 0) return pending();
  if (mine.length > 1 || tab.panes > 1) return "other";
  const p = mine[0];
  if (p.terminal === null || p.terminal === undefined) return "other";
  if (p.status !== null && p.status !== undefined) return "other";
  const t = terminals.find((x) => x.address === p.terminal);
  if (!t || !Array.isArray(t.argv)) return pending();
  return isPlainShellArgv(t.argv) ? "plain-shell" : "other";
}

export function newSpaces(known, spaces) {
  return spaces.filter((s) => !known.has(s.id));
}

// Reads wool-claim.sh's output; null unless this copy of wool claimed it.
// recordDir sits in the common git dir because `git worktree remove` deletes
// the worktree's own git dir, and teardown runs after that.
export function parseClaim(stdout) {
  const line = String(stdout).replace(/\r?\n$/, "");
  const [word, gitDir, main, branch, worktree] = line.split("\t");
  if (word !== "claimed" || !gitDir || !main || !worktree) return null;
  const recordDir = gitDir.replace(/\/worktrees\/([^/]+)$/, "/wool/$1");
  return {
    gitDir, stateDir: `${gitDir}/wool`, recordDir: recordDir === gitDir ? null : recordDir,
    main, branch: branch ?? "", worktree,
  };
}

// Before closing the space's original shell tab: is that shell still idle?
// If the person already started something in it (an agent, git pull), the
// tab stays. `terminal` is its terminals() entry; `foreground` is what runs now.
export function originalIsIdle(pane, terminal) {
  if (!pane || !terminal) return false;
  if (pane.status !== null && pane.status !== undefined) return false;
  if (pane.program && pane.program.shell !== true) return false;
  if (!isPlainShellArgv(terminal.argv)) return false;
  const now = terminal.foreground?.argv;
  if (!now) return true;
  const base = (p) => String(p).split("/").pop().replace(/^-/, "");
  return isPlainShellArgv(now) && base(now[0]) === base(terminal.argv[0]);
}

// Ids in `tracked` (a Map keyed by space id) whose space has closed.
export function closedSpaces(tracked, spaces) {
  const open = new Set(spaces.map((s) => s.id));
  return [...tracked.keys()].filter((id) => !open.has(id));
}

export function parseRecords(stdout) {
  return String(stdout)
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([record, worktree]) => record && worktree)
    .map(([record, worktree]) => ({ record, worktree }));
}
