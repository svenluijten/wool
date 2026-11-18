// A fake Herdr: state lives in globalThis.herdr (set by the test), exec and
// readTextFile are real, run() records commands and adds tabs on tab.new.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const h = () => globalThis.herdr;
export const spaces = () => h().spaces;
export const panes = () => h().panes;
export const terminals = () => h().terminals ?? [];
export const focused = () => h().focused ?? null;
export const machines = () => [{ name: null, layout: "ready" }];
export const knownAgents = async () => [];
export const appHome = () => h().appHome;
export const home = () => "/nonexistent-home";
export function watchFolder() {
  const watch = new Promise(() => {});
  watch.cancelled = false;
  watch.cancel = () => { watch.cancelled = true; };
  h().watches?.push(watch);
  return watch;
}
export const notify = (n) => h().notes.push(n);
export function run(name, args) {
  h().commands.push({ name, args });
  if (name === "tab.new") {
    const id = `tb${h().commands.length}`;
    h().spaces.find((s) => s.id === args.space).tabs.push({ id, name: args.name, panes: 1 });
    h().panes.push({ pane: `p-${id}`, tab: id, terminal: `t-${id}` });
    h().onTab?.(id, args);
  } else if (name === "tab.close") {
    for (const s of h().spaces) s.tabs = s.tabs.filter((t) => t.id !== args.id);
  }
}
export async function exec(command, args = [], options = {}) {
  const r = spawnSync(command, args, { encoding: "utf8", cwd: options.cwd, env: { ...process.env, XDG_CONFIG_HOME: h().xdg } });
  if (r.error) throw r.error;
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}
export async function readTextFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
