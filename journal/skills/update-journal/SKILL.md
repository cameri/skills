---
name: update-journal
description: Reads Claude Code session activity across every project on this machine, plus the memory system, and writes or closes narrative journal entries in docs/journal/. Use when the user asks to update the journal, write a journal entry, catch the journal up, or close out the current journal.
---

<objective>
Maintains a series of journals at `docs/journal/` in the workspace repo — narrative
entries written from Claude's own perspective (first person for Claude, third person
about the user) about what's been going on. Each journal covers one "cycle" of
activity. Once a journal is closed, it is a permanent record and is never edited
again.
</objective>

<hard_invariant>
A journal file whose frontmatter reads `status: closed` is NEVER opened for writing
again, by any step below, under any circumstance. The only legal write to a
closed-to-be file is the single run that flips it from open to closed — after that,
it is read-only forever.
</hard_invariant>

<journal_format>
Path: `docs/journal/YYYY-MM-DD-<slug>.md`, dated by when that cycle opened (for a
historical-reconstruction run, this is the real date the cycle's content started,
not necessarily today).

Frontmatter:

```yaml
---
status: open        # or: closed
opened: 2026-07-25
closed:              # filled in only when closing
last_synced:          # ISO timestamp of the newest session material incorporated
---
```

Body is dated sections, appended over the cycle's life and never rewritten:

```markdown
## 2026-07-25

Prose entry. Covers what happened since the last update.

## 2026-08-02

Next update's section.
```
</journal_format>

<process>
1. List `docs/journal/*.md` and read each file's frontmatter. At most one should
   have `status: open` — that is the current journal. If none exists, this is the
   first run ever — see <cold_start/> below, then continue from step 3 using the
   digest it produces.

2. If an open journal exists, read its `last_synced` field (this is the `--since`
   value for the extraction script below). If `last_synced` is empty, this journal
   was just opened moments ago in the same run (e.g. right after a close) — treat it
   as having no cutoff for this step, or as a continuation of the digest already in
   hand from that same run.

3. Run the extraction script to get the raw material for this update.

   Resolve the plugin dir from THIS file's own path — never guess a cache path:

   ```bash
   PLUGIN_DIR="$(dirname "$(dirname "$(dirname <path-to-this-SKILL.md>)")")"
   test -f "$PLUGIN_DIR/skills/update-journal/scripts/extract_sessions.py" \
     || { echo "not found at $PLUGIN_DIR - locating:"; find ~/.omp/plugins/cache -name extract_sessions.py 2>/dev/null; }
   ```

   Layout note: omp installs plugins under
   `~/.omp/plugins/cache/marketplaces/<marketplace>/<plugin>/`. There is no
   `~/.omp/plugins/cache/plugins/<marketplace>___<plugin>___<version>/` layout
   (that is Claude Code's cache shape). If the resolved path does not exist,
   locate the script with the `find` above and use that path — a missing script
   is an ERROR to fix, never an empty digest.

   Then run it:

   ```bash
   python3 "$PLUGIN_DIR/skills/update-journal/scripts/extract_sessions.py" \
     --since "<last_synced, if any>"
   ```

   The output ends with a line like
   `--- digest: 42 entries, 8931 chars ---` — read that summary first.

4. If the digest is `0 entries`: there is nothing new. Report that and stop — do not
   touch any file. But 0 entries is only trustworthy if the script actually ran
   (you saw its `--- digest: 0 entries ... ---` line). A script that failed to
   run or wasn't found is NOT an empty digest — fix the path and retry.

5. Decide, as a rough guide (not a strict rule — use judgment): a digest in the
   low tens of thousands of characters is comfortably small enough to read directly
   in full, alongside the open journal's existing content and relevant memory files
   for grounding on who the user is. Your memory index lives at
   `~/.claude/projects/<project-slug>/memory/MEMORY.md`, where `<project-slug>` is
   your current working directory with every `/` replaced by `-` (e.g. `/workspace`
   → `-workspace`) — read that index, then follow any `[[linked-memory]]` references
   in it that seem relevant. A digest that's much larger — most likely on the
   first-ever run's full historical reconstruction, or after a long gap between
   updates — go to step 6 instead.

6. **Large-digest fallback:** split the digest into chunks (by project first; if a
   single project's slice is still large, split further by time window). For each
   chunk, spawn a subagent (general-purpose, read-only — it should not write any
   files) with a prompt along these lines:

   > Here is a slice of raw Claude Code session activity (user/assistant text turns,
   > chronological): <chunk text>. Summarize what happened in a few bullet points —
   > what was worked on, and any notable shifts, decisions, or outcomes. Do not
   > include exact dollar amounts, account/wallet identifiers, or health specifics —
   > describe the kind of thing that happened, not the specifics. Return just the
   > bullets.

   Collect the bullet summaries from all chunks, in chronological order, and use
   those — instead of the raw digest — as the material for the next step.

7. **Judge the cycle boundary(ies).** Working through the material (raw digest from
   step 5, or the ordered chunk summaries from step 6) in chronological order,
   decide whether it continues the currently open journal's arc, or whether enough
   has shifted — a long gap in activity, a resolved thread, a clearly new project
   phase — that this is a new cycle. This is a judgment call each time, the same
   kind of call a person would make looking back at their own week. A single run's
   material can span **more than one** boundary (most likely on a large historical
   reconstruction) — in that case, process it in order, closing and opening as many
   times as the material actually calls for, not just once.

   For each boundary found: write a closing section to the currently-open draft (a
   short retrospective — what this cycle was, in hindsight), set its frontmatter
   `closed: <date>` and `status: closed`, then open the next journal file
   (`opened: <date the next section's material starts>`, `status: open`) and
   continue.

8. **Write.** Before editing any journal file in this step (including the
   close-and-open writes in step 7), re-read its frontmatter one more time and
   confirm it still says `status: open` — this is the one hard invariant in this
   whole process, and re-checking immediately before the edit is cheap insurance
   against acting on a stale read. For material that continues the open journal
   (no boundary crossed): append one `## <date>` section per calendar date
   represented in the material, with prose covering what happened — first person
   for Claude's own observations, third person about the user. Follow the
   redaction stance: describe *what kind* of thing happened (a financial
   reconciliation, a health-related task, a disagreement), never the exact dollar
   amount, account/wallet identifier, or health specifics.

9. Update `last_synced` on whichever journal file ends the run in `status: open` to
   the timestamp of the newest entry incorporated. (There is always exactly one open
   journal at the end of a successful run — closing one always pairs with opening
   the next, because this step only runs when there was new material to seed it.)
</process>

<cold_start>
No journal exists yet (first run ever). Run the extraction script with no `--since`
at all — full history, every project. This will very likely be large enough to need
the large-digest fallback (<process/> step 6). If the reconstructed history clearly
spans multiple distinct cycles, produce multiple closed journals plus one final open
one in this single run, per step 7 — don't force months of unrelated activity into
one file just because it's the first run.
</cold_start>

<success_criteria>
- Every write either appends to the currently-open journal or is the single
  close-and-open transition described above — never a write to a file already
  `status: closed` at the start of the run.
- Entries read as prose from an outside observer (Claude) who was actually paying
  attention, not a bullet-point activity log.
- No exact dollar amounts, account/wallet identifiers, or health specifics appear in
  any entry.
- `last_synced` on the resulting open journal reflects the newest material actually
  incorporated, so the next run's `--since` is correct.
</success_criteria>
