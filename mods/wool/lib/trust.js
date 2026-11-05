// Small pure helpers for wool's trust gate. The gate itself (checksum, store,
// gitignore check, the prompt) lives in bin/wool-trust.sh; these read what it prints.

const VERDICTS = new Set(["implicit", "trusted", "declined", "ask"]);

// Reads `wool-trust.sh check`'s one line: "<verdict>\t<sha256>".
export function parseCheck(stdout) {
  const line = String(stdout ?? "").replace(/\r?\n$/, "");
  const [verdict, sha, ...rest] = line.split("\t");
  if (rest.length > 0 || !VERDICTS.has(verdict) || !/^[0-9a-f]{64}$/.test(sha ?? "")) return null;
  return { verdict, sha };
}

const ANSWERS = new Set(["trust", "once", "decline", "none"]);

// Reads <state dir>/trust-answer ("<answer>\t<nonce>") as `wool-trust.sh prompt`
// writes it; null until there is an answer to *this* question (its nonce).
export function readAnswer(text, nonce) {
  const [word, n, ...rest] = String(text ?? "").replace(/\r?\n$/, "").split("\t");
  return ANSWERS.has(word) && n === nonce && rest.length === 0 ? word : null;
}

// The nonce of the question in <state dir>/trust-request, or null.
export function requestNonce(text) {
  const f = String(text ?? "").replace(/\r?\n$/, "").split("\t");
  return f.length === 4 && f[3] !== "" ? f[3] : null;
}

// The tab wool adds to a space to ask about its config.
export function promptTab(binDir, stateDir) {
  return { name: "wool", argv: ["sh", `${binDir}/wool-trust.sh`, "prompt", stateDir] };
}

// The open local space for a worktree folder (wool-trust.sh run), or null.
export function spaceForFolder(spaces, folder) {
  const norm = (p) => String(p ?? "").replace(/(.)\/$/, "$1");
  const want = norm(folder);
  return spaces.find((s) => (s.machine === null || s.machine === undefined) && s.folder && norm(s.folder) === want) ?? null;
}
