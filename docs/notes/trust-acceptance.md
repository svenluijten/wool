# Trust: live acceptance

Herdr app 0.1.13, macOS, 2026-11-04. Repo: quiz
(`~/Code/github.com/svenluijten/quiz`) with its uncommitted Laravel
`.herdr/wool.yml.dist`. The store started out empty.

A first attempt, before Herdr was restarted, didn't render wool at all after
the `mod.open` restart, and the main checkout's wool behaved the same. Once
Herdr was restarted and in front, wool ran normally.

| # | Check | Result |
|---|---|---|
| 1 | New worktree, no entry → only a `wool` tab, nothing runs | pass: the space had its own tab plus `wool`. The prompt showed the repo, the file, checksum `fdfecdbc…` and the whole file. No `setup.sh`; the only process was the prompt. |
| 2 | `t` → layout + setup; `list` shows `trusted` | pass: the prompt tab closed, Agent (claude-code), Shell and Server appeared, and `setup.sh` and `status` were written. `list` showed `trusted fdfecdbc7848 …`. |
| 3 | Next worktree → no prompt | pass: it was laid out directly, with no `trust-answer`. |
| 4 | Edited `.dist` → asks again; `o` runs, store unchanged | pass: new checksum `95fdbb1d…`, and the prompt showed the added comment. After `o`: layout and setup ran; the store still held only the first entry. |
| 5 | `d` → nothing, info notification; next worktree silent | pass: after `d` only the space's own tab was left and there was no `setup.sh`. `list` showed `declined 95fdbb1dc414`. The next worktree got no prompt and no tabs. The toast wasn't checked (not visible from the CLI). |
| 6 | `forget` + `run` → asks again | pass: `Forgot 2 entries for …/quiz.`, then `run` gave a new prompt with a new nonce. |
| 7 | Gitignored personal `wool.yml` → no prompt | pass: quiz's `.gitignore` doesn't ignore it, so this used `.git/info/exclude`. There was no prompt, and the space got just the personal "Mine" tab. |
| 8 | Prompt tab closed → `none` notification with `run` hint | **failed first, fixed**: Herdr sends HUP more than once when it closes a tab. The second HUP cut the exit handler short, so no `trust-answer` was written (main.js still ended the wait through its 2 s vanished-tab fallback). Fixed by ignoring signals once the prompt is exiting (test "prompt: repeated hang-ups still write none"). Re-run: `none\t<nonce>` written, nothing stored, nothing ran. |

Cleanup: the test worktrees and branches (`trust-a`…`trust-f`) and their
spaces were removed. quiz's `.dist` and `.git/info/exclude` were restored and
its personal `wool.yml` removed. `~/.config/wool` was removed (it didn't
exist before). The symlink points back at the main checkout and wool is
running (`herdr-app status` lists it).
