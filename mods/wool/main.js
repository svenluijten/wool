// wool: gets a freshly created git worktree space ready to work in.
//
// Runs as an invisible kept window (mod.json): it draws nothing and watches
// spaces(). When a new space shows up for a linked worktree made in the last
// few minutes, it claims it (bin/wool-claim.sh), runs the repo's setup steps
// in a terminal, and lays out plain-shell spaces, both from .herdr/wool.yml(.dist).
// A config someone else could have written runs only once the person has
// trusted its exact contents (bin/wool-trust.sh, asked in a `wool` tab).
// When a space it set up closes and its worktree folder then disappears, it
// runs the repo's teardown steps in the background (bin/wool-teardown.sh).
// All decisions live in lib/ (tested with node --test); this file is glue.

import { View, div } from "gpui-kit";
import {
  spaces, panes, terminals, focused, machines, run, exec, notify, knownAgents, readTextFile, appHome, home, watchFolder,
} from "herdr";
import { loadConfig } from "./lib/config.js";
import {
  classifySpace, newSpaces, parseClaim, originalIsIdle, closedSpaces, parseRecords, FRESH_MINUTES, PENDING_LIMIT_MS,
} from "./lib/detect.js";
import { setupScript, teardownScript } from "./lib/shell.js";
import { planLayout, planSetupOnly, pickAgent } from "./lib/plan.js";
import { parseCheck, readAnswer, requestNonce, promptTab, spaceForFolder } from "./lib/trust.js";

const STEP_TIMEOUT_MS = 5000;
const STATUS_POLL_MS = 2000;
const BG_POLL_MS = 5000;
const ANSWER_POLL_MS = 500;
const GONE_GRACE_MS = 2000;
const REQUEST_POLL_MS = 5000;
// Herdr's worktree mod closes the space first, then gives `git worktree remove` up to 10 minutes.
const REMOVAL_WAIT_MS = 10 * 60000;
const TEARDOWN_POLL_MS = 2000;
const TEARDOWN_WATCH_MS = 30 * 60000;

const tilde = (p) => (p && p.startsWith(home()) ? "~" + p.slice(home().length) : p);
const base = (p) => String(p).split("/").pop();
const writeFile = (path, text) => exec("sh", ["-c", 'printf %s "$1" > "$2"', "sh", text, path]);

// run() returns nothing, so new tabs and panes are found by polling for them.
async function waitFor(cx, find) {
  for (let waited = 0; waited <= STEP_TIMEOUT_MS; waited += 100) {
    const hit = find();
    if (hit) return hit;
    await cx.sleep(100);
  }
  return null;
}
const tabIdsOf = (spaceId) => new Set((spaces().find((s) => s.id === spaceId)?.tabs ?? []).map((t) => t.id));

const localReady = () => (machines().find((m) => m.name === null)?.layout ?? "ready") !== "loading";

export default class Wool extends View {
  init(_props, _cx) {
    this.known = null; // space ids wool has decided about (seeded on the first ready render)
    this.firstSeen = new Map(); // space id -> ms when first seen, while pending
    this.records = new Map(); // space id -> { record, worktree } for spaces with a teardown
    this.binDir = `${appHome()}/mods/wool/bin`;
    this.asking = new Map(); // worktree -> wool tab's pane, while its prompt is open
  }

  render(cx) {
    try {
      this.scan(cx);
    } catch (e) {
      console.log(`wool: ${e?.stack ?? e}`);
    }
    return div();
  }

  scan(cx) {
    const all = spaces();
    if (this.known === null) {
      // Spaces that exist when wool starts (or reloads) are never handled.
      if (!localReady()) return;
      this.known = new Set(all.map((s) => s.id));
      cx.spawn((cx) => this.watchRequests(cx));
      cx.spawn((cx) => this.sweep(cx, all).catch((e) => console.log(`wool: sweep: ${e?.stack ?? e}`)));
      return;
    }
    for (const id of closedSpaces(this.records, all)) {
      const r = this.records.get(id);
      this.records.delete(id);
      cx.spawn((cx) => this.watchRemoval(cx, r).catch((e) => console.log(`wool: teardown: ${e?.stack ?? e}`)));
    }
    const fresh = newSpaces(this.known, all);
    if (fresh.length === 0) return;
    const now = Date.now();
    const ps = panes();
    const ts = terminals();
    for (const space of fresh) {
      if (!this.firstSeen.has(space.id)) {
        this.firstSeen.set(space.id, now);
        // Re-check once the pending window is over, in case nothing re-renders.
        cx.timer.after(PENDING_LIMIT_MS + 250, (cx) => this.scan(cx));
      }
      const kind = classifySpace(space, ps, ts, this.firstSeen.get(space.id), now);
      if (kind === "pending") continue;
      this.known.add(space.id);
      this.firstSeen.delete(space.id);
      if (kind === "remote") continue;
      const shell = this.shellOf(space, ps, ts);
      cx.spawn(async (cx) => {
        try {
          await this.handle(cx, space, kind, shell);
        } catch (e) {
          notify({ title: "wool: something went wrong", body: String(e?.message ?? e), level: "error" });
        }
      });
    }
  }

  shellOf(space, ps, ts) {
    const p = ps.find((x) => x.tab === space.tabs[0]?.id && x.terminal);
    const t = p && ts.find((x) => x.address === p.terminal);
    return Array.isArray(t?.argv) && t.argv[0] ? t.argv[0] : null;
  }

  async handle(cx, space, kind, shellHint) {
    const folder = space.folder || panes().find((p) => p.tab === space.tabs[0]?.id)?.cwd;
    if (!folder) return;
    const claimed = await exec("sh", [`${this.binDir}/wool-claim.sh`, folder, String(FRESH_MINUTES)]);
    if (claimed.code !== 0) {
      notify({ title: "wool: couldn't check the worktree", body: (claimed.stderr || claimed.stdout).trim(), level: "error" });
      return;
    }
    const wt = parseClaim(claimed.stdout);
    if (!wt) return; // not a linked worktree, made a while ago, or already handled
    await this.prepareClaimed(cx, space, kind, shellHint, wt);
  }

  // After a claim (new space or wool-trust.sh run): prepare, and say how to retry.
  async prepareClaimed(cx, space, kind, shellHint, wt) {
    try {
      await this.prepare(cx, space, kind, shellHint, wt);
    } catch (e) {
      // The claim is taken, so nothing will retry by itself: say how.
      notify({
        title: `wool: setting up ${wt.branch || tilde(wt.worktree)} stopped`,
        body: `${e?.message ?? e}\nTo try again: sh "${this.binDir}/wool-trust.sh" run "${wt.worktree}"`,
        level: "error",
      });
    }
  }

  async prepare(cx, space, kind, shellHint, wt) {

    const config = await loadConfig({ main: wt.main, worktree: wt.worktree }, (p) => readTextFile(p));
    if (config.error) {
      // A broken file: no half setup, nothing else for this worktree.
      this.configError(config.error);
      return;
    }
    const cfg = config.value;
    if (cfg === null) return;
    // An empty setup list is nothing to run: no Setup tab, nothing waits.
    const hasSetup = cfg.steps.length > 0;
    const layout = kind === "plain-shell" && cfg.tabs !== null;
    const hasTeardown = cfg.teardown.length > 0 && Boolean(wt.recordDir);
    if (!hasSetup && !layout && !hasTeardown) return;
    if (!(await this.gate(cx, space, kind, wt, config))) return;
    if (hasTeardown) await this.writeRecord(space, wt, cfg.teardown);
    if (!hasSetup && !layout) return;

    if (hasSetup) {
      const script = setupScript(cfg.steps, {
        HERDR_WORKTREE: wt.worktree, HERDR_MAIN_WORKTREE: wt.main, HERDR_BRANCH: wt.branch,
      });
      const w = await writeFile(`${wt.stateDir}/setup.sh`, script);
      if (w.code !== 0) throw new Error(`couldn't write ${wt.stateDir}/setup.sh: ${w.stderr.trim()}`);
    }

    let shell = shellHint;
    if (!shell) {
      const r = await exec("sh", ["-c", 'printf %s "${SHELL:-/bin/sh}"']).catch(() => null);
      shell = r?.stdout.trim() || "/bin/sh";
    }
    const ctx = { binDir: this.binDir, stateDir: wt.stateDir, shell, agentArgv: null };
    if (layout && cfg.tabs.some((t) => t.panes.some((p) => p.kind === "agent"))) {
      // If Herdr can't list agents, agent panes become shells (with a warning).
      const known = await knownAgents().catch(() => []);
      ctx.agentArgv = (name) => pickAgent(known, name);
    }
    const plan = layout ? planLayout(cfg, hasSetup, ctx) : planSetupOnly(hasSetup, ctx, cfg.setupIn);
    if (plan.warnings.length > 0) {
      notify({ title: `wool: ${wt.branch || tilde(wt.worktree)}`, body: plan.warnings.join("\n"), level: "warning" });
    }

    await this.execute(cx, space, wt, plan.steps);
    if (hasSetup) await this.watchSetup(cx, wt, space, cfg.setupIn);
    const bg = plan.steps.filter((s) => s.op === "background").length;
    if (bg > 0) await this.watchBackground(cx, wt, bg);
  }

  // Written now because the worktree's files (and its .herdr/wool.yml.dist)
  // are gone by the time teardown runs.
  async writeRecord(space, wt, steps) {
    const script = teardownScript(steps, {
      HERDR_WORKTREE: wt.worktree, HERDR_MAIN_WORKTREE: wt.main, HERDR_BRANCH: wt.branch,
    });
    const w = await exec("sh", [
      "-c",
      'mkdir -p "$1" && rm -f "$1/status" "$1/teardown.log" && printf %s "$2" > "$1/teardown.sh" && printf "%s\\n" "$3" > "$1/worktree"',
      "sh", wt.recordDir, script, wt.worktree,
    ]);
    if (w.code !== 0) {
      notify({ title: "wool: teardown won't run", body: `Couldn't write ${tilde(wt.recordDir)}: ${w.stderr.trim()}`, level: "error" });
      return;
    }
    this.records.set(space.id, { record: wt.recordDir, worktree: wt.worktree });
  }

  // On start: tear down records whose worktree went while wool wasn't
  // watching, and watch the open spaces that still have one.
  async sweep(cx, all) {
    const local = all.filter((s) => (s.machine === null || s.machine === undefined) && s.folder);
    const seen = new Set();
    for (const space of local) {
      const r = await exec("sh", [`${this.binDir}/wool-records.sh`, space.folder]);
      for (const rec of parseRecords(r.stdout)) {
        const open = local.find((s) => s.folder === rec.worktree);
        if (open && spaces().some((s) => s.id === open.id)) this.records.set(open.id, rec);
        if (seen.has(rec.record)) continue;
        seen.add(rec.record);
        if ((await this.checkRecord(rec)) === "gone") await this.runTeardown(cx, rec);
      }
    }
  }

  async checkRecord(rec) {
    const r = await exec("sh", [`${this.binDir}/wool-teardown.sh`, "--check", rec.record]);
    return r.code === 0 ? r.stdout.trim().split("\n").pop() : "error";
  }

  // A closed space is only a removed worktree if its folder then disappears.
  async watchRemoval(cx, rec) {
    for (let waited = 0; waited <= REMOVAL_WAIT_MS; waited += TEARDOWN_POLL_MS) {
      const state = await this.checkRecord(rec);
      if (state === "gone") return this.runTeardown(cx, rec);
      if (state !== "alive") return;
      await cx.sleep(TEARDOWN_POLL_MS);
    }
  }

  // Runs in the background (exec has a 30 s limit); the record folder
  // disappearing means it succeeded.
  async runTeardown(cx, rec) {
    const name = rec.record.split("/").pop();
    const r = await exec("sh", ["-c", 'nohup sh "$1" "$2" >/dev/null 2>&1 &', "sh", `${this.binDir}/wool-teardown.sh`, rec.record]);
    if (r.code !== 0) {
      notify({ title: `wool: teardown of ${name} didn't start`, body: r.stderr.trim(), level: "error" });
      return;
    }
    for (let waited = 0; waited <= TEARDOWN_WATCH_MS; waited += TEARDOWN_POLL_MS) {
      await cx.sleep(TEARDOWN_POLL_MS);
      if ((await readTextFile(`${rec.record}/worktree`)) === null) {
        notify({ title: `wool: tore down ${name}`, level: "success" });
        return;
      }
      const status = ((await readTextFile(`${rec.record}/status`)) ?? "").split("\n")[0].trim();
      if (status.startsWith("failed")) {
        notify({
          title: `wool: teardown of ${name} failed`,
          body: `Step '${status.replace(/^failed\s*/, "")}' failed. Log: ${tilde(`${rec.record}/teardown.log`)}\nTo run it again: sh "${this.binDir}/wool-teardown.sh" "${rec.record}"`,
          level: "error",
        });
        return;
      }
    }
  }

  // `wool-trust.sh run <folder>` drops a request file; this takes them as they come
  // (and those left while wool wasn't running, at start).
  async watchRequests(cx) {
    try {
      const r = await exec("sh", ["-c", 'd="${XDG_CONFIG_HOME:-$HOME/.config}/wool/requests"; mkdir -p "$d" && printf %s "$d"']);
      if (r.code !== 0) throw new Error(r.stderr.trim());
      const dir = r.stdout;
      for (;;) {
        const t = await exec("sh", [`${this.binDir}/wool-trust.sh`, "_take"]);
        for (const top of t.stdout.split("\n").filter(Boolean)) {
          cx.spawn(async (cx) => {
            try {
              await this.rerun(cx, top);
            } catch (e) {
              notify({ title: "wool: something went wrong", body: String(e?.message ?? e), level: "error" });
            }
          });
        }
        // The timer covers a watch that never fires (or was rejected).
        const watch = watchFolder(dir);
        await Promise.race([watch.catch(() => cx.sleep(REQUEST_POLL_MS)), cx.sleep(REQUEST_POLL_MS)]);
        // A watch that lost the race stays pending and counts toward the host task limit.
        watch.cancel();
      }
    } catch (e) {
      notify({ title: "wool: wool-trust.sh run won't work", body: String(e?.message ?? e), level: "error" });
    }
  }

  // Handles a worktree's space again, as if it were new: any age, old state
  // cleared, and through the trust gate (run never trusts anything).
  async rerun(cx, top) {
    const space = spaceForFolder(spaces(), top);
    if (!space) {
      notify({ title: `wool: no open space for ${tilde(top)}`, body: "Open the worktree in Herdr, then run wool-trust.sh run again.", level: "warning" });
      return;
    }
    const pending = this.asking.get(top);
    if (pending) {
      notify({ title: "wool: already asking", body: `Answer in the wool tab of ${tilde(top)}.`, level: "info", action: { name: "pane.focus", args: { pane: pending } } });
      return;
    }
    const claimed = await exec("sh", [`${this.binDir}/wool-claim.sh`, top, "rerun"]);
    if (claimed.code !== 0) {
      notify({ title: "wool: couldn't check the worktree", body: (claimed.stderr || claimed.stdout).trim(), level: "error" });
      return;
    }
    if (claimed.stdout.trim() === "running") {
      notify({ title: `wool: setup is already running in ${tilde(top)}`, level: "info" });
      return;
    }
    const wt = parseClaim(claimed.stdout);
    if (!wt) return;
    // Classified now, as it is (never pending): one plain shell is laid out.
    const now = Date.now();
    const kind = classifySpace(space, panes(), terminals(), now - PENDING_LIMIT_MS, now);
    this.known.add(space.id);
    this.firstSeen.delete(space.id);
    await this.prepareClaimed(cx, space, kind, this.shellOf(space, panes(), terminals()), wt);
  }

  // True when what this worktree's config says may run. The text wool parsed
  // is written to the state dir and checksummed there, so what's asked about
  // is exactly what runs, whatever happens to the file meanwhile.
  async gate(cx, space, kind, wt, config) {
    if (config.text.includes("\0")) throw new Error(`${tilde(config.file)} contains a NUL byte`);
    const w = await writeFile(`${wt.stateDir}/config.yml`, config.text);
    if (w.code !== 0) throw new Error(`couldn't write ${wt.stateDir}/config.yml: ${w.stderr.trim()}`);
    // Ties the prompt's answer to this question, not an older or newer one
    // (wool-trust.sh run, or a second copy of wool, asking about the same worktree).
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const r = await exec("sh", [`${this.binDir}/wool-trust.sh`, "check", wt.stateDir, wt.main, config.file, nonce]);
    const c = r.code === 0 ? parseCheck(r.stdout) : null;
    if (!c) throw new Error(`couldn't check whether ${tilde(config.file)} is trusted: ${(r.stderr || r.stdout).trim()}`);
    if (c.verdict === "implicit" || c.verdict === "trusted") return true;
    if (c.verdict === "declined") return false; // asked before: silently nothing
    return this.askTrust(cx, space, kind, wt, config.file, nonce);
  }

  // Adds the `wool` tab running `wool-trust.sh prompt` and waits for its answer.
  async askTrust(cx, space, kind, wt, file, nonce) {
    const name = wt.branch || tilde(wt.worktree);
    const before = focused();
    const old = tabIdsOf(space.id);
    const t = promptTab(this.binDir, wt.stateDir);
    run("tab.new", { space: space.id, name: t.name, folder: wt.worktree, argv: t.argv });
    const tab = await waitFor(cx, () => [...tabIdsOf(space.id)].find((id) => !old.has(id)));
    const pane = tab && (await waitFor(cx, () => panes().find((p) => p.tab === tab)?.pane));
    if (!tab || !pane) throw new Error(`Herdr didn't create the wool tab within ${STEP_TIMEOUT_MS / 1000} s`);
    this.asking.set(wt.worktree, pane);
    try {
      return await this.awaitAnswer(cx, space, kind, wt, file, nonce, before, tab, pane);
    } finally {
      this.asking.delete(wt.worktree);
    }
  }

  async awaitAnswer(cx, space, kind, wt, file, nonce, before, tab, pane) {
    const name = wt.branch || tilde(wt.worktree);

    if (kind !== "plain-shell") {
      // As with the Setup tab: don't take focus from what the person is doing.
      if (before?.pane) run("pane.focus", { pane: before.pane });
      notify({
        title: `wool: trust needed for ${base(wt.main)}`,
        body: `Answer in the wool tab of ${name}.`,
        level: "warning",
        action: { name: "pane.focus", args: { pane } },
      });
    }

    let answer = null;
    let goneSince = null;
    for (;;) {
      answer = readAnswer(await readTextFile(`${wt.stateDir}/trust-answer`), nonce);
      if (answer) break;
      // Asked again since (wool-trust.sh run): that question's flow takes over.
      if (requestNonce(await readTextFile(`${wt.stateDir}/trust-request`)) !== nonce) {
        if (tabIdsOf(space.id).has(tab)) run("tab.close", { id: tab, confirmed: true });
        return false;
      }
      // The tab went away without writing an answer (killed): no answer.
      if (!tabIdsOf(space.id).has(tab)) {
        goneSince ??= Date.now();
        if (Date.now() - goneSince > GONE_GRACE_MS) {
          answer = "none";
          break;
        }
      }
      await cx.sleep(ANSWER_POLL_MS);
    }
    if (tabIdsOf(space.id).has(tab)) run("tab.close", { id: tab, confirmed: true });

    if (answer === "trust" || answer === "once") return true;
    notify({
      title: `wool: skipped ${name}`,
      body: answer === "decline"
        ? `You declined .herdr/${base(file)} for ${tilde(wt.main)}.`
        : `No answer. To ask again: sh "${this.binDir}/wool-trust.sh" run "${wt.worktree}"`,
      level: "info",
    });
    return false;
  }

  configError(error) {
    // Toast titles are short: lead with .herdr/<file>, the full path goes in the body.
    const short = error.file.split("/").slice(-2).join("/");
    notify({ title: `wool: ${short} is invalid`, body: `${error.message}\n${tilde(error.file)}`, level: "error" });
  }

  // Runs the planned steps as Herdr commands. run() returns nothing, so each
  // new tab or pane is found by diffing spaces()/panes() afterwards.
  async execute(cx, space, wt, steps) {
    const refs = new Map(); // ref -> { tab, pane }
    const before = focused();
    const personElsewhere = !before || before.space !== space.id;
    const originalTab = space.tabs[0]?.id ?? null;
    let focusedAtEnd = false;

    const tabIds = () => tabIdsOf(space.id);
    const paneIds = (tab) => new Set(panes().filter((p) => p.tab === tab).map((p) => p.pane));

    for (const step of steps) {
      if (step.op === "tab") {
        const old = tabIds();
        run("tab.new", { space: space.id, name: step.name, folder: wt.worktree, argv: step.argv, task: step.task });
        const tab = await waitFor(cx, () => [...tabIds()].find((id) => !old.has(id)));
        const pane = tab && (await waitFor(cx, () => panes().find((p) => p.tab === tab)?.pane));
        if (!tab || !pane) return this.stepFailed(step, refs);
        refs.set(step.ref, { tab, pane });
      } else if (step.op === "split") {
        const from = refs.get(step.from);
        if (!from) return this.stepFailed(step, refs);
        const old = paneIds(from.tab);
        run("pane.split", { pane: from.pane, direction: step.direction, argv: step.argv });
        const pane = await waitFor(cx, () => [...paneIds(from.tab)].find((id) => !old.has(id)));
        if (!pane) return this.stepFailed(step, refs);
        refs.set(step.ref, { tab: from.tab, pane });
      } else if (step.op === "setupInBackground") {
        const r = await exec("sh", ["-c", 'nohup "$@" >/dev/null 2>&1 </dev/null &', "sh", ...step.argv], { cwd: wt.worktree });
        if (r.code !== 0) notify({ title: "wool: setup didn't start", body: r.stderr.trim(), level: "error" });
      } else if (step.op === "background") {
        const r = await exec("sh", ["-c", 'nohup "$@" >/dev/null 2>&1 &', "sh", ...step.argv], { cwd: wt.worktree });
        if (r.code !== 0) notify({ title: "wool: a background command didn't start", body: step.argv.join(" "), level: "error" });
      } else if (step.op === "closeOriginal") {
        // Only while its shell is still idle: the person may have started
        // something in it while wool was getting ready.
        const p = panes().find((x) => x.tab === originalTab);
        const t = p && terminals().find((x) => x.address === p.terminal);
        if (originalTab && originalIsIdle(p, t)) run("tab.close", { id: originalTab, confirmed: true });
        else if (originalTab) notify({ title: "wool: kept your first tab", body: "Something is running in it, so wool left it open.", level: "info" });
      } else if (step.op === "focus") {
        const target = refs.get(step.ref);
        if (!personElsewhere && target) {
          run("pane.focus", { pane: target.pane });
          focusedAtEnd = true;
        }
      }
    }
    // tab.new takes focus and shows its space; give it back unless the plan
    // chose where focus goes and the person is still in this space.
    if (!focusedAtEnd && before?.pane) run("pane.focus", { pane: before.pane });
    return refs;
  }

  stepFailed(step, refs) {
    const what = step.op === "tab" ? `the tab "${step.name ?? step.ref}"` : `the pane ${step.ref}`;
    notify({ title: "wool: layout stopped", body: `Herdr didn't create ${what} within ${STEP_TIMEOUT_MS / 1000} s.`, level: "error" });
    return refs;
  }

  async watchSetup(cx, wt, space, setupIn) {
    const name = wt.branch || tilde(wt.worktree);
    let missing = 0;
    for (;;) {
      await cx.sleep(STATUS_POLL_MS);
      const text = await readTextFile(`${wt.stateDir}/status`);
      const status = (text ?? "").split("\n")[0].trim();
      if (status === "" || status === "running") {
        if (status === "" && ++missing * STATUS_POLL_MS > 60000) return; // the runner never started
        continue;
      }
      if (status === "ok") {
        notify({ title: `wool: ${name} is ready`, level: "success" });
      } else {
        const step = status.replace(/^failed\s*/, "");
        const pane = setupIn === "background" ? await this.openSetupLog(cx, space, wt) : this.setupPaneOf(wt);
        notify({
          title: "wool: setup failed",
          body: step === "interrupted" ? `Setup in ${name} was interrupted.` : `Step '${step}' failed in ${name}.`,
          level: "error",
          ...(pane ? { action: { name: "pane.focus", args: { pane } } } : {}),
        });
      }
      return;
    }
  }

  // Setup ran without a terminal: show its output in a tab, without taking focus.
  async openSetupLog(cx, space, wt) {
    const before = focused();
    const old = tabIdsOf(space.id);
    run("tab.new", { space: space.id, name: "Setup", folder: wt.worktree, argv: ["sh", "-c", 'cat "$1"', "sh", `${wt.stateDir}/setup.log`] });
    const tab = await waitFor(cx, () => [...tabIdsOf(space.id)].find((id) => !old.has(id)));
    const pane = tab ? await waitFor(cx, () => panes().find((p) => p.tab === tab)?.pane) : null;
    if (before?.pane) run("pane.focus", { pane: before.pane });
    return pane;
  }

  // The pane running wool-run.sh for this worktree, found through its terminal.
  setupPaneOf(wt) {
    const t = terminals().find((x) => Array.isArray(x.argv) && x.argv.includes(`${this.binDir}/wool-run.sh`) && x.argv.includes(wt.stateDir));
    return t ? panes().find((p) => p.terminal === t.address)?.pane ?? null : null;
  }

  async watchBackground(cx, wt, count) {
    const done = new Set();
    const name = wt.branch || tilde(wt.worktree);
    // Watched until each command exits (a reload or restart stops watching;
    // bg-<n>.exit and bg-<n>.log stay in the state folder).
    while (done.size < count) {
      await cx.sleep(BG_POLL_MS);
      for (let n = 0; n < count; n++) {
        if (done.has(n)) continue;
        const text = await readTextFile(`${wt.stateDir}/bg-${n}.exit`);
        if (text === null) continue;
        done.add(n);
        const code = text.trim();
        if (code !== "0" && code !== "skipped") {
          notify({
            title: `wool: a background command failed in ${name}`,
            body: `Exit ${code}. Its output is in ${tilde(`${wt.stateDir}/bg-${n}.log`)}.`,
            level: "error",
          });
        }
      }
    }
  }
}
