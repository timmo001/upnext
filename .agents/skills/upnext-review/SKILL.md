---
name: upnext-review
description: Review, clean up and test a changeset in upnext, whether a pull request, a branch, recent commits or uncommitted changes. Use when asked to review changes, clean up what goes against the repository's rules, check whether review comments are valid, judge whether tests are needed, or test changes for real against Twitch, YouTube and the Omarchy panel.
license: Apache-2.0
compatibility: Requires mise, Bun and Pitchfork from the upnext repository root, and a configured upnext with Twitch or Google sign-ins for live testing. Pull request steps also need gh.
---

# upnext review

Work through these steps in order, skipping those that don't apply, and report after each one the user asks about. Never merge, comment on, or resolve review threads without the user's say so for that change.

## 1. Find the changeset

The changeset is the scope: review and change only what it introduces or makes worse, and read other code only as context. Work out what it is from the request:

- A pull request or branch: `git fetch origin` and check it out. Find a PR's number with `gh pr list --head <branch>`. The changeset is `git diff origin/main...HEAD`, with commits from `git log origin/main..HEAD`.
- Recent commits: the range the user names, such as `git diff <base>..HEAD`.
- Uncommitted work: `git diff` and `git diff --staged`, plus new files from `git status`.

Once the changed files are known, load every other skill that matches them or the work, and apply it within the changeset. That includes this repository's skills, `upnext-commands`, `upnext-sources`, `upnext-docs` and `upnext-release`, and the shared ones for Effect, TypeScript, testing and writing. This skill sets the review process; the others set the rules for what's being reviewed.

## 2. Check claims

Changes often describe platform or library behaviour in code comments, schemas and docs. Check each claim before trusting it:

- Twitch: the Helix API reference, the authentication guides and the EventSub docs on dev.twitch.tv.
- YouTube and Google: the YouTube Data API reference and quota costs, and Google's OAuth guide for desktop apps.
- Effect: the installed source and `node_modules/effect/ai-docs`, not memory of older Effect versions.

For new schema literals, confirm the full set of values the platform can send, since an unknown value fails the whole decode.

## 3. Clean up against the repository's rules

Fix only what the changeset introduces:

- Tests that don't catch a meaningful failure nothing else covers: schema-decoding checks, tests that repeat another, tests tied to logic the change removes.
- Unused fields, options or exports the change adds, especially in the published packages.
- Hand-written JavaScript where an Effect module does the job (`Array`, `Option`, `String`, `Record`, `HashSet`, `Order`), and Node or Bun calls where an Effect platform service exists.
- Shared schemas in `packages/client`, or upnext config, state or socket knowledge in `packages/twitch` or `packages/youtube`.
- Comments heavier than the surrounding code, writing that doesn't match the repository's voice, and anything that breaks `AGENTS.md`.

Run `mise run check`, `mise run test` and `mise run build`, and `mise run build:packages` when `packages/` changed. Commit one coherent change at a time, and commit or push only when the user asked.

## 4. Validate review comments

Review feedback can come from a pull request, or be pasted by the user. On a pull request, read every source, from people and bots alike: review bodies with `gh api repos/timmo001/upnext/pulls/<n>/reviews`, inline comments with `.../pulls/<n>/comments`, and PR comments with `.../issues/<n>/comments`. Skip deploy and status bots. Some bot bodies hold HTML comments; cut at the first `<!--`.

Don't take any review at face value. For each finding, trace the path in the current code and compare with `main`. Say whether it is valid, why, and the smallest fix. Fix only when asked, then rerun the checks above.

## 5. Judge the tests

For every test the changeset adds or keeps, state the failure it catches and whether anything else covers it. To prove a test catches the bug, run it against `main`'s code in a throwaway worktree:

```bash
dir="$(mktemp -d)/main"
git worktree add "$dir" origin/main
cp <test file> "$dir/<same path>"
ln -s "$PWD/node_modules" "$dir/node_modules"
(cd "$dir" && bun test <test file> -t "<name>")
git worktree remove --force "$dir"
```

## 6. Test for real

Unit tests aren't real testing. Run the changes against the user's accounts without replacing the installed service:

- `mise run serve:daemon` starts a watch-mode daemon on `$XDG_RUNTIME_DIR/upnext/dev.sock`. Check it signed in and checked its sources with `mise run serve:daemon:logs`.
- Point the CLI at it with `UPNEXT_SOCK="$XDG_RUNTIME_DIR/upnext/dev.sock" bun run src/index.ts <command>`.
- For panel changes, ask first, then use `mise run dev:start`. It restarts the Omarchy shell with the development panel in place of the installed one; `mise run dev:stop` puts the installed panel back.

The dev daemon has its own socket but shares everything else with the installed service: `config.yml`, `channels.yml`, the tokens in `state.json` and the synced `library.json`. Both daemons poll, send notifications and auto-open channels. So:

- Prefer reads: `feed --json`, `watch --json` and `recheck` without `--open`.
- Writes change real data and need a reason: `channel add` and `channel remove` edit `channels.yml`, which may be stowed from a dotfiles repository. `queue add` and `watched` change `library.json`, which syncs to other machines, and the YouTube watch-later playlist when one is set. Say what was left behind, and undo it when the user wants.
- Ask before `recheck --open` or anything that opens browser windows, and before `auth`, which replaces the stored sign-in for both daemons.

Stop with `mise run serve:daemon:stop` (or `mise run dev:stop`). If the installed service runs, confirm `systemctl --user is-active upnext` is still `active` and `upnext feed --json` shows its sources as `ok`.

Report what was exercised, the results, and what couldn't be tested live and why.

## 7. Finish

For a pull request, report CI state (`gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup`) and wait. Merge only when the user says so: squash is the only allowed method, with `gh pr merge <n> --squash --delete-branch`.

After a merge, switch to `main`, pull, and delete local branches whose upstream is gone or whose commits are merged. Leave branches checked out in another worktree alone.
