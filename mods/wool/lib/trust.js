// Small pure helpers for wool's trust gate. The gate itself (checksum, store,
// gitignore check, the prompt) lives in bin/wool.sh; these read what it prints.

const VERDICTS = new Set(["implicit", "trusted", "declined", "ask"]);

// Reads `wool.sh check`'s one line: "<verdict>\t<sha256>".
export function parseCheck(stdout) {
  const line = String(stdout ?? "").replace(/\r?\n$/, "");
  const [verdict, sha, ...rest] = line.split("\t");
  if (rest.length > 0 || !VERDICTS.has(verdict) || !/^[0-9a-f]{64}$/.test(sha ?? "")) return null;
  return { verdict, sha };
}

const ANSWERS = new Set(["trust", "once", "decline", "none"]);

// Reads <state dir>/trust-answer as `wool.sh prompt` writes it; null until
// there is a known answer.
export function readAnswer(text) {
  const word = String(text ?? "").replace(/\r?\n$/, "");
  return ANSWERS.has(word) ? word : null;
}

// The tab wool adds to a space to ask about its config.
export function promptTab(binDir, stateDir) {
  return { name: "wool", argv: ["sh", `${binDir}/wool.sh`, "prompt", stateDir] };
}
