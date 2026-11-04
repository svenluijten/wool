// Finds and loads a worktree's .herdr/wool.yml(.dist). A personal `.yml`
// (main checkout first, then the worktree) replaces the committed `.yml.dist`
// (the worktree's own first, then the main checkout's). Nothing is merged.

import { parseYaml, YamlError } from "./yaml.js";
import { ConfigError, validateConfig } from "./schema.js";

export function candidates(roots) {
  return [
    `${roots.main}/.herdr/wool.yml`,
    `${roots.worktree}/.herdr/wool.yml`,
    `${roots.worktree}/.herdr/wool.yml.dist`,
    `${roots.main}/.herdr/wool.yml.dist`,
  ];
}

export function resolveFile(roots, exists) {
  return candidates(roots).find((p) => exists(p)) ?? null;
}

export async function loadConfig(roots, read) {
  for (const file of candidates(roots)) {
    let text;
    try {
      text = await read(file);
    } catch (e) {
      return { file, text: null, value: null, error: new ConfigError(file, `couldn't read the file: ${e?.message ?? e}`) };
    }
    if (text === null || text === undefined) continue;
    try {
      return { file, text, value: validateConfig(parseYaml(text), file), error: null };
    } catch (e) {
      if (e instanceof ConfigError) return { file, text, value: null, error: e };
      if (e instanceof YamlError) return { file, text, value: null, error: new ConfigError(file, e.message) };
      throw e;
    }
  }
  return { file: null, text: null, value: null, error: null };
}
