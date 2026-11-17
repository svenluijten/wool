import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseYaml } from "../mods/wool/lib/yaml.js";
import {
  ConfigError,
  validateConfig,
  CONFIG_FIELDS,
  SETUP_STEP_FIELDS,
  TAB_FIELDS,
  PANE_FIELDS,
  BACKGROUND_FIELDS,
} from "../mods/wool/lib/schema.js";

const FILE = "/repo/.herdr/wool.yml";

function rejects(fn, value, pattern) {
  assert.throws(() => fn(value, FILE), (e) => {
    assert.ok(e instanceof ConfigError, `expected ConfigError, got ${e}`);
    assert.equal(e.file, FILE);
    assert.match(e.message, pattern);
    return true;
  });
}

const QUIZ = parseYaml(`version: 1

setup:
  - name: Copy .env
    run: cp "$HERDR_MAIN_WORKTREE/.env" .env
  - name: Install PHP dependencies
    run: composer install --no-interaction
  - name: Install JS dependencies
    run: npm ci

tabs: 
  - title: Agent
    panes: 
      - agent: default
  - title: Shell
    panes: 
      - {}
  - title: Server
    panes: 
      - command: composer run dev
        setup: true
`);

const ws = (tabs, extra = {}) => ({ version: 1, tabs, ...extra });
const one = (pane) => ws([{ panes: [pane] }]);
const steps = (list, extra = {}) => ({ version: 1, setup: list, ...extra });

// ---- whole file ----------------------------------------------------------

test("config: the quiz example validates", () => {
  const c = validateConfig(QUIZ, FILE);
  assert.deepEqual(c.steps, [
    { name: "Copy .env", run: 'cp "$HERDR_MAIN_WORKTREE/.env" .env', env: {} },
    { name: "Install PHP dependencies", run: "composer install --no-interaction", env: {} },
    { name: "Install JS dependencies", run: "npm ci", env: {} },
  ]);
  assert.deepEqual(c.tabs.map((t) => t.title), ["Agent", "Shell", "Server"]);
  assert.equal(c.tabs[2].panes[0].command, "composer run dev");
  assert.equal(c.tabs[2].panes[0].setup, true);
});

test("config: setup only has no tabs", () => {
  const c = validateConfig(steps([{ run: "npm ci" }]), FILE);
  assert.equal(c.tabs, null);
  assert.deepEqual(c.background, []);
  assert.equal(c.steps.length, 1);
});

test("config: tabs only has no steps", () => {
  assert.deepEqual(validateConfig(one({}), FILE).steps, []);
});

test("config: rejects a file with neither setup, tabs nor teardown", () => rejects(validateConfig, { version: 1 }, /"setup".*"tabs".*"teardown"/));
test("config: rejects background without tabs", () =>
  rejects(validateConfig, steps([{ run: "x" }], { background: [{ command: "y" }] }), /background.*tabs/));
test("config: rejects the old worktrees block", () =>
  rejects(validateConfig, { version: 1, worktrees: { setup: [] } }, /unknown field "worktrees"/));

// ---- setup -------------------------------------------------------------

test("setup: an empty list is valid", () => {
  assert.deepEqual(validateConfig(steps([]), FILE).steps, []);
});

test("setup: env numbers and booleans become strings", () => {
  const v = validateConfig(steps([{ run: "x", env: { CI: 1, B: true } }]), FILE);
  assert.deepEqual(v.steps[0].env, { CI: "1", B: "true" });
});

test("setup: top-level env applies to steps, under each step's own", () => {
  const v = validateConfig(steps([{ run: "x", env: { A: "step" } }, { run: "y" }], { env: { A: "top", B: "top" } }), FILE);
  assert.deepEqual(v.steps.map((s) => s.env), [{ A: "step", B: "top" }, { A: "top", B: "top" }]);
});

test("setup: rejects a missing version", () => rejects(validateConfig, { setup: [] }, /version/));
test("setup: rejects version 2", () => rejects(validateConfig, { version: 2, setup: [] }, /version.*1/));
test("setup: rejects an empty file", () => rejects(validateConfig, null, /map/));
test("setup: rejects a setup that isn't a list", () => rejects(validateConfig, steps({ run: "x" }), /setup.*list/));
test("setup: rejects a step without run", () => rejects(validateConfig, steps([{ name: "x" }]), /setup\[0\].*"run"/));
test("setup: rejects an empty run", () => rejects(validateConfig, steps([{ run: "" }]), /setup\[0\]\.run/));
test("setup: rejects an unknown step field", () => rejects(validateConfig, steps([{ run: "x", cwd: "y" }]), /unknown field "cwd"/));
test("setup: rejects an unknown top-level field", () => rejects(validateConfig, steps([], { hooks: {} }), /unknown field "hooks"/));
test("setup: rejects a list in env", () => rejects(validateConfig, steps([{ run: "x", env: { A: [1] } }]), /env\.A/));

test("setup: runs in a tab by default", () => {
  assert.equal(validateConfig(steps([]), FILE).setupIn, "tab");
  assert.equal(validateConfig(one({}), FILE).setupIn, "tab");
});

test("setup: can run in the background, with or without tabs", () => {
  assert.equal(validateConfig(steps([{ run: "x" }], { setupIn: "background" }), FILE).setupIn, "background");
  assert.equal(validateConfig(ws([{ panes: [{ command: "x", waitForSetup: true }] }], { setup: [{ run: "y" }], setupIn: "background" }), FILE).setupIn, "background");
});

test("setup: rejects an unknown setupIn", () => rejects(validateConfig, steps([], { setupIn: "pane" }), /setupIn.*tab or background/));
test("setup: rejects setupIn background with a setup pane", () =>
  rejects(validateConfig, ws([{ panes: [{ command: "x", setup: true }] }], { setup: [], setupIn: "background" }),
    /tabs\[0\]\.panes\[0\].*"setup: true" can't be used with "setupIn: background"/));

// ---- teardown ------------------------------------------------------------

test("teardown: steps validate like setup steps, with the top-level env", () => {
  const v = validateConfig(steps([], { env: { A: "top" }, teardown: [{ name: "Drop db", run: "dropdb x", env: { B: "b" } }] }), FILE);
  assert.deepEqual(v.teardown, [{ name: "Drop db", run: "dropdb x", env: { A: "top", B: "b" } }]);
});

test("teardown: missing means none", () => {
  assert.deepEqual(validateConfig(steps([]), FILE).teardown, []);
  assert.deepEqual(validateConfig(one({}), FILE).teardown, []);
});

test("teardown: a file with only teardown is valid", () => {
  const v = validateConfig({ version: 1, teardown: [{ run: "x" }] }, FILE);
  assert.deepEqual(v.steps, []);
  assert.equal(v.tabs, null);
  assert.equal(v.teardown.length, 1);
});

test("teardown: rejects a step without run", () => rejects(validateConfig, steps([], { teardown: [{ name: "x" }] }), /teardown\[0\].*"run"/));
test("teardown: rejects a teardown that isn't a list", () => rejects(validateConfig, steps([], { teardown: { run: "x" } }), /teardown.*list/));
test("teardown: rejects an unknown step field", () =>
  rejects(validateConfig, steps([], { teardown: [{ run: "x", cwd: "y" }] }), /teardown\[0\]: unknown field "cwd"/));

// ---- workspace -----------------------------------------------------------

test("workspace: the quiz example validates", () => {
  const w = validateConfig(QUIZ, FILE);
  assert.equal(w.tabs.length, 3);
  assert.deepEqual(w.env, {});
  assert.deepEqual(w.background, []);
  assert.deepEqual(w.tabs[0], {
    title: "Agent",
    panes: [{
      kind: "agent", command: null, agent: "default", prompt: null, env: {},
      split: null, setup: false, waitForSetup: false, focus: false,
    }],
  });
  assert.equal(w.tabs[1].panes[0].kind, "shell");
  assert.deepEqual(
    { ...w.tabs[2].panes[0] },
    { kind: "command", command: "composer run dev", agent: null, prompt: null, env: {},
      split: null, setup: true, waitForSetup: true, focus: false },
  );
});

test("workspace: split names map to right and down", () => {
  const w = validateConfig(ws([{ panes: [{}, { split: "vertical" }, { split: "horizontal" }, { split: "down" }, { split: "right" }] }]), FILE);
  assert.deepEqual(w.tabs[0].panes.map((p) => p.split), [null, "right", "down", "down", "right"]);
});

test("workspace: a later pane without split splits right", () => {
  const w = validateConfig(ws([{ panes: [{}, {}] }]), FILE);
  assert.equal(w.tabs[0].panes[1].split, "right");
});

test("workspace: env values become strings and layout env is kept", () => {
  const w = validateConfig(ws([{ panes: [{ command: "x", env: { PORT: 3000 } }] }], { env: { APP_ENV: "local" } }), FILE);
  assert.deepEqual(w.env, { APP_ENV: "local" });
  assert.deepEqual(w.tabs[0].panes[0].env, { PORT: "3000" });
});

test("workspace: prompt, focus and background", () => {
  const w = validateConfig(ws([{ panes: [{ agent: "claude", prompt: "hi", focus: true }] }], {
    background: [{ command: "npm run watch", waitForSetup: true, env: { A: "b" } }, { command: "redis-server" }],
  }), FILE);
  const p = w.tabs[0].panes[0];
  assert.equal(p.prompt, "hi");
  assert.equal(p.focus, true);
  assert.deepEqual(w.background, [
    { command: "npm run watch", env: { A: "b" }, waitForSetup: true },
    { command: "redis-server", env: {}, waitForSetup: false },
  ]);
});

test("workspace: rejects command with agent", () =>
  rejects(validateConfig, ws([{ panes: [{}] }, { panes: [{}] }, { panes: [{ command: "x", agent: "default" }] }]),
    /tabs\[2\]\.panes\[0\]: "command" and "agent" can't both be set/));
test("workspace: rejects two setup panes across tabs", () =>
  rejects(validateConfig, ws([{ panes: [{ command: "a", setup: true }] }, { panes: [{ command: "b", setup: true }] }]),
    /tabs\[1\]\.panes\[0\].*setup/));
test("workspace: rejects prompt without agent", () => rejects(validateConfig, one({ prompt: "hi" }), /"prompt" needs "agent"/));
test("workspace: rejects split on a tab's first pane", () => rejects(validateConfig, one({ split: "down" }), /tabs\[0\]\.panes\[0\].*split/));
test("workspace: rejects an unknown split", () => rejects(validateConfig, ws([{ panes: [{}, { split: "left" }] }]), /split/));
test("workspace: rejects no tabs", () => rejects(validateConfig, ws([]), /tabs/));
test("workspace: rejects no panes", () => rejects(validateConfig, ws([{ panes: [] }]), /tabs\[0\]\.panes/));
test("workspace: rejects two focus panes", () =>
  rejects(validateConfig, ws([{ panes: [{ focus: true }] }, { panes: [{ focus: true }] }]), /focus/));
test("workspace: rejects setup on an agent pane", () => rejects(validateConfig, one({ agent: "default", setup: true }), /setup/));
test("workspace: rejects an unknown pane field", () => rejects(validateConfig, one({ cwd: "x" }), /tabs\[0\]\.panes\[0\]: unknown field "cwd"/));
test("workspace: rejects waitForSetup on a shell pane", () => rejects(validateConfig, one({ waitForSetup: true }), /waitForSetup/));
test("workspace: rejects waitForSetup on an agent pane", () => rejects(validateConfig, one({ agent: "default", waitForSetup: true }), /waitForSetup/));
test("workspace: rejects a non-boolean setup", () => rejects(validateConfig, one({ command: "x", setup: "yes" }), /setup.*true or false/));
test("workspace: rejects a pane title", () => rejects(validateConfig, one({ title: "x" }), /tabs\[0\]\.panes\[0\]: unknown field "title"/));
test("workspace: rejects a pane size", () => rejects(validateConfig, ws([{ panes: [{}, { size: 40 }] }]), /tabs\[0\]\.panes\[1\]: unknown field "size"/));
test("workspace: rejects version 2", () => rejects(validateConfig, { version: 2, tabs: [{ panes: [{}] }] }, /version/));
test("workspace: rejects a background entry without command", () =>
  rejects(validateConfig, ws([{ panes: [{}] }], { background: [{ env: {} }] }), /background\[0\].*"command"/));
test("workspace: rejects an unknown top-level field", () =>
  rejects(validateConfig, ws([{ panes: [{}] }], { layouts: [] }), /unknown field "layouts"/));

// ---- JSON schemas ----------------------------------------------------------

test("json schemas list the same fields as the validators", () => {
  const load = (p) => JSON.parse(readFileSync(new URL(`../schema/${p}`, import.meta.url), "utf8"));
  const keys = (o) => Object.keys(o.properties).sort();
  const sorted = (a) => [...a].sort();

  const w = load("wool.schema.json");
  assert.deepEqual(keys(w), sorted(CONFIG_FIELDS));
  assert.deepEqual(keys(w.properties.setup.items), sorted(SETUP_STEP_FIELDS));
  assert.deepEqual(keys(w.properties.teardown.items), sorted(SETUP_STEP_FIELDS));
  assert.deepEqual(keys(w.properties.tabs.items), sorted(TAB_FIELDS));
  assert.deepEqual(keys(w.properties.tabs.items.properties.panes.items), sorted(PANE_FIELDS));
  assert.deepEqual(keys(w.properties.background.items), sorted(BACKGROUND_FIELDS));

  for (const s of [w]) {
    const walk = (o) => {
      if (o && typeof o === "object") {
        if (o.type === "object" && o.properties) assert.equal(o.additionalProperties, false);
        Object.values(o).forEach(walk);
      }
    };
    walk(s);
  }
});
