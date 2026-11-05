// main.js's trust gate, run in Node against a fake Herdr (tests/stubs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

register("./stubs/loader.mjs", import.meta.url);
const { default: Wool } = await import("../mods/wool/main.js");

const MOD = join(dirname(fileURLToPath(import.meta.url)), "..", "mods", "wool");
const CONFIG = "version: 1\nsetup:\n  - run: echo hi\n";
const sha = (s) => execFileSync("shasum", ["-a", "256"], { input: s, encoding: "utf8" }).split(" ")[0];

function setup({ onTab } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wool main ")));
  const appHome = join(root, "app");
  mkdirSync(join(appHome, "mods"), { recursive: true });
  symlinkSync(MOD, join(appHome, "mods", "wool"));
  const state = join(root, "state");
  mkdirSync(state);
  const space = { id: "sp1", folder: join(root, "wt"), machine: null, tabs: [{ id: "tb0", panes: 1 }] };
  globalThis.herdr = {
    appHome, xdg: join(root, "xdg"), spaces: [space], panes: [{ pane: "p0", tab: "tb0", terminal: "t0" }],
    focused: { space: "sp1", pane: "p0" }, commands: [], notes: [], onTab,
  };
  const wool = new Wool();
  wool.init({}, {});
  const cx = { sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))), spawn: () => {}, timer: { after: () => {} } };
  const wt = { gitDir: root, stateDir: state, main: join(root, "main"), branch: "b", worktree: space.folder };
  const config = { file: join(root, "main", ".herdr", "wool.yml.dist"), text: CONFIG, value: null, error: null };
  return { wool, cx, space, wt, config, state, root };
}

// Answers the prompt the way wool-trust.sh prompt would, once wool's tab exists.
const answering = (word) => (id, args) => {
  assert.deepEqual(args.argv.slice(1), [`${globalThis.herdr.appHome}/mods/wool/bin/wool-trust.sh`, "prompt", args.argv[3]]);
  const state = args.argv[3];
  const nonce = readFileSync(join(state, "trust-request"), "utf8").trim().split("\t")[3];
  setTimeout(() => writeFileSync(join(state, "trust-answer"), `${word}\t${nonce}\n`), 30);
};

test("gate: trust runs, after the wool tab asked and closed", async () => {
  const t = setup({ onTab: answering("trust") });
  assert.equal(await t.wool.gate(t.cx, t.space, "plain-shell", t.wt, t.config), true);
  assert.equal(readFileSync(join(t.state, "config.yml"), "utf8"), CONFIG);
  const names = globalThis.herdr.commands.map((c) => c.name);
  assert.deepEqual(names, ["tab.new", "tab.close"]);
  assert.equal(globalThis.herdr.commands[0].args.name, "wool");
  assert.deepEqual(globalThis.herdr.notes, []);
});

test("gate: once runs", async () => {
  const t = setup({ onTab: answering("once") });
  assert.equal(await t.wool.gate(t.cx, t.space, "plain-shell", t.wt, t.config), true);
});

test("gate: decline runs nothing and says so", async () => {
  const t = setup({ onTab: answering("decline") });
  assert.equal(await t.wool.gate(t.cx, t.space, "plain-shell", t.wt, t.config), false);
  assert.equal(globalThis.herdr.notes.length, 1);
  assert.match(globalThis.herdr.notes[0].body, /You declined \.herdr\/wool\.yml\.dist/);
});

test("gate: no answer runs nothing and gives the run command", async () => {
  const t = setup({ onTab: answering("none") });
  assert.equal(await t.wool.gate(t.cx, t.space, "plain-shell", t.wt, t.config), false);
  assert.match(globalThis.herdr.notes[0].body, /wool-trust\.sh" run/);
});

test("gate: an answer to another question is ignored; a newer question takes over", async () => {
  const t = setup({
    onTab: (id, args) => {
      const state = args.argv[3];
      writeFileSync(join(state, "trust-answer"), "trust\tsomeone-else\n");
      setTimeout(() => writeFileSync(join(state, "trust-request"), readFileSync(join(state, "trust-request"), "utf8").replace(/\t[^\t]*\n$/, "\tnewer\n")), 60);
    },
  });
  assert.equal(await t.wool.gate(t.cx, t.space, "plain-shell", t.wt, t.config), false);
  assert.deepEqual(globalThis.herdr.notes, []);
  assert.ok(globalThis.herdr.commands.some((c) => c.name === "tab.close"));
});

test("gate: in a space wool doesn't lay out, focus goes back and a warning points at the prompt", async () => {
  const t = setup({ onTab: answering("once") });
  assert.equal(await t.wool.gate(t.cx, t.space, "other", t.wt, t.config), true);
  const focus = globalThis.herdr.commands.find((c) => c.name === "pane.focus");
  assert.deepEqual(focus.args, { pane: "p0" });
  const warn = globalThis.herdr.notes.find((n) => n.level === "warning");
  assert.match(warn.title, /trust needed/);
  assert.equal(warn.action.name, "pane.focus");
  assert.match(warn.action.args.pane, /^p-tb/);
});

test("gate: a trusted file runs without asking", async () => {
  const t = setup();
  mkdirSync(join(globalThis.herdr.xdg, "wool"), { recursive: true });
  writeFileSync(join(globalThis.herdr.xdg, "wool", "trust.tsv"), `${sha(CONFIG)}\ttrusted\t${t.wt.main}\t${t.config.file}\t2026-11-04T00:00:00Z\n`);
  assert.equal(await t.wool.gate(t.cx, t.space, "plain-shell", t.wt, t.config), true);
  assert.deepEqual(globalThis.herdr.commands, []);
});

test("gate: a declined file runs nothing, silently", async () => {
  const t = setup();
  mkdirSync(join(globalThis.herdr.xdg, "wool"), { recursive: true });
  writeFileSync(join(globalThis.herdr.xdg, "wool", "trust.tsv"), `${sha(CONFIG)}\tdeclined\t${t.wt.main}\t${t.config.file}\t2026-11-04T00:00:00Z\n`);
  assert.equal(await t.wool.gate(t.cx, t.space, "plain-shell", t.wt, t.config), false);
  assert.deepEqual(globalThis.herdr.commands, []);
  assert.deepEqual(globalThis.herdr.notes, []);
});
