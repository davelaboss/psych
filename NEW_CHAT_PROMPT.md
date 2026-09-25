# Psych Website — New Chat Operating Instructions

This file is the canonical operating instruction set for every new programming chat working on the Psych website.

Repository:
https://github.com/davelaboss/psych

Production:
https://thelabossieres.com

Branch:
main

Local repository:
C:\Users\davel\Documents\GitHub\psych

---

# 1. FIRST ACTIONS — BEFORE CHANGING ANYTHING

Read these files completely:

1. `NEW_CHAT_PROMPT.md`
2. `PROJECT_MASTER.md`

Treat:

- `NEW_CHAT_PROMPT.md` as the operating instructions for the chat.
- `PROJECT_MASTER.md` as the current project coordination record.

The user will provide ONE specific assigned workstream for the chat.

Do not begin implementation until both files have been read and the current project state has been checked.

Do not rely on memory from another ChatGPT conversation when the current repository can establish the actual state.

If you cannot access the current GitHub files, ask the user to provide the latest versions rather than relying on an old copy or remembered context.

---

# 2. ONE CHAT = ONE WORKSTREAM

Work only on the task explicitly assigned to this chat.

Do not begin work on other pending tasks merely because they appear in `PROJECT_MASTER.md`.

Do not redesign unrelated parts of the website.

Do not add speculative improvements or nice-to-have features outside the assigned scope.

Other pending work belongs in separate future chats unless the user explicitly reassigns it.

---

# 3. CHECK FOR COLLISIONS BEFORE EDITING

Before modifying files:

1. Determine the current Git/working-tree state.
2. Confirm whether the working tree is clean.
3. Identify the exact files relevant to the assigned task.
4. Determine whether another chat/workstream may have uncommitted work.

If local Git state cannot be inspected directly, ask the user to run:

`git status`

If the working tree is dirty because another active chat has changes:

STOP.

Do not:

- overwrite the changes;
- restore them;
- reset them;
- stash them;
- delete them;
- commit them;
- pull/rebase over them;

without explicit coordination with the user.

Never assume another chat's uncommitted work is disposable.

---

# 4. CURRENT SOURCE IS TECHNICAL TRUTH

The current committed repository is the technical source of truth for what the website actually contains.

`PROJECT_MASTER.md` is the human-readable project record describing:

- architecture;
- completed work;
- pending work;
- business rules;
- known product facts;
- regression baselines;
- active workstream ownership;
- important historical decisions.

If repository code and `PROJECT_MASTER.md` appear to disagree:

do not silently choose one.

Investigate the discrepancy and tell the user.

---

# 5. DEVELOPMENT RULES

Preserve everything marked completed/verified in `PROJECT_MASTER.md`.

Do not resurrect abandoned runtime patches.

Do not stack competing JavaScript controllers, event-handler systems, or runtime repair layers over working architecture.

Inspect relevant current files before changing them.

Make the smallest coherent change necessary.

Do not casually redesign the data model, commerce flow, catalog architecture, admin architecture, or customer portal.

Netlify Blob admin overrides remain highest priority where the project master specifies that precedence.

Do not guess ambiguous product data.

Do not expose internal/reviewer/TODO material publicly.

---

# 6. DELIVERY AND PRODUCTION-DATA WORKFLOW

The user is not a programmer.

Do not make the user manually splice JavaScript functions, braces, handlers, or large code fragments.

Do not create ZIP bundles.

Do not request API tokens.

Do not request `ADMIN_TOKEN`.

Do not use internal site previews.

When complete file replacement is required, the established working delivery method is a downloadable `.txt` PowerShell installer that writes the required complete replacement file(s).

The PowerShell installer is only a file-delivery mechanism.

It must never become a runtime patch architecture.

For production product-data mutations:

- prefer the established application/admin interfaces;
- use the normal `/admin` workflow whenever it supports the required change;
- do not introduce ad-hoc DevTools Console scripts, one-off browser mutation scripts, or similar production-data shortcuts without explicit owner approval;
- do not bypass the established admin/data workflow merely because a direct endpoint or Blob write is technically possible;
- change only the public fields that actually require correction;
- do not change photos, internal pricing/research, or unrelated fields unless the assigned workstream explicitly requires it.

Optimize for owner time:

- batch known safe corrections whenever practical;
- batch verification steps whenever practical;
- if files are needed, request all relevant files together whenever possible instead of interrogating them through many terminal commands;
- batch safe read-only diagnostics when doing so reduces unnecessary owner interaction.

Production deploys may be used when they materially save time.

Optimize for completion speed rather than minimizing deploy count, while staying within the current Netlify monthly credit budget.

---

# 7. GIT RULES

Use exact files.

Never use:

`git add .`

Never commit:

- `.bak` files;
- temporary installers;
- abandoned runtime patch files;
- generated debugging debris;
- secrets.

For routine, known-safe Git workflows, give the user the FULL command sequence at once and briefly state what should be expected after each command.

The user will stop and report back if the actual result materially differs.

Use one-command-at-a-time mode only when:

- the next command depends on the exact previous output;
- merge/rebase conflicts are possible;
- the working tree is unexpectedly dirty;
- local and remote history have diverged;
- restore/reset/stash operations are involved;
- another chat may have uncommitted work;
- a command could overwrite, discard, or complicate existing work.

Safe read-only diagnostics may be batched.

Do not run `git pull`, reset, rebase, restore, or stash blindly when the working tree is dirty.

---

# 8. SECURITY

The repository is public.

Never place the following in committed files or project documentation:

- `ADMIN_TOKEN`;
- passwords;
- private API keys;
- bank credentials;
- customer personal data;
- private order-access tokens;
- secrets of any kind.

Do not ask the user to reveal production secrets.

---

# 9. BEFORE IMPLEMENTATION

After reading the master files and checking project state, briefly tell the user:

- what files/data sources are relevant;
- what you intend to inspect;
- what you expect to modify;
- what existing behavior must be preserved.

Do not produce a large redesign proposal when the assigned task is narrow.

---

# 10. TESTING

Test the assigned work against the relevant regression baseline in `PROJECT_MASTER.md`.

Do not mark a task complete merely because code was written.

Distinguish between:

- capability implemented;
- data corrected;
- feature tested;
- owner-confirmed successful behavior.

When the user says the result is NOMINAL, proceed to checkpointing.

---

# 11. END-OF-WORKSTREAM PROCEDURE

After the task is successfully implemented and the user confirms it is NOMINAL:

1. Update `PROJECT_MASTER.md` with the completed factual status, regression performed, files/data changed, and remaining follow-up.
2. Update `NEW_CHAT_PROMPT.md` only if the workstream established a permanent workflow rule.
3. Verify the working tree and intended diff.
4. Stage only the exact intended files.
5. Commit the successful work.
6. Push it.
7. Verify that local `main` is synchronized with `origin/main` and the working tree is clean.

For a routine, known-safe checkpoint, provide the full Git command sequence together and briefly state the expected result after each command.

Switch to one-command-at-a-time mode only when one of the Git-risk conditions in Section 7 applies.

Do not mark failed or untested work as completed.

---

# 12. WHEN TO UPDATE THIS FILE

`NEW_CHAT_PROMPT.md` should change only when a permanent rule about how future programming chats should operate changes.

Examples:

- a new Git safety rule;
- a new required startup procedure;
- a permanent change to file-delivery workflow;
- a new cross-chat coordination rule.

Ordinary product facts, completed tasks, pending features, and business requirements belong in `PROJECT_MASTER.md`, not here.

If a chat establishes a permanent workflow rule that future chats must follow:

1. update `NEW_CHAT_PROMPT.md`;
2. update `PROJECT_MASTER.md` if the change also affects project coordination;
3. commit both with the relevant work.

GitHub is the canonical copy.

Do not maintain a second authoritative copy in ChatGPT Library, Notes, or another chat.

---

# 13. NEW CHAT BOOTSTRAP

The user can start a new programming chat with:

"Go to the public GitHub repository https://github.com/davelaboss/psych.

Read `NEW_CHAT_PROMPT.md` and `PROJECT_MASTER.md` completely before doing anything else.

Treat `NEW_CHAT_PROMPT.md` as the operating instructions for this chat and `PROJECT_MASTER.md` as the current project coordination record.

My assigned task is:

[ONE SPECIFIC TASK]

Do not change code until you have read both files and checked the current repository state."

That short bootstrap is sufficient when the repository is accessible.

No giant cross-chat handoff should normally be necessary.
