---
name: bot-api-reference
description: Reference for Telegram's Bot API surface (updates/webhooks, messages/entities, groups/privacy mode, files/media, inline keyboards/callback queries). Use before modifying server.ts to add or change Telegram behavior, or when you need exact field names, parameter tables, or size limits instead of re-fetching core.telegram.org/bots/api from scratch.
user-invocable: true
allowed-tools:
  - Read
---

<objective>
A curated, offline reference to the Telegram Bot API surface `telegram-ng`'s
`server.ts` builds on (grammy/Bot API). Built so extending `server.ts` doesn't
require re-fetching and re-reading the full upstream spec
(https://core.telegram.org/bots/api) each time. All content is sourced from a
live fetch of that page (plus https://core.telegram.org/bots/features for
privacy mode) on 2026-08-18, Bot API version 10.2. Each reference file links
back to the exact upstream anchor for anything not covered here — the upstream
docs are the source of truth if these files and a future API version disagree.

Arguments passed: `$ARGUMENTS`
</objective>

<quick_start>
Read the one file relevant to the task — don't read all six unless the task
genuinely spans them.

- Adding/changing what updates the bot receives, polling vs. webhook setup →
  `references/updates-and-polling.md`.
- Sending or formatting outgoing text — including Bot API 10.1+ Rich Messages →
  `references/rich-messages.md` (grammar) and `references/messages-and-entities.md`
  (methods); parsing `@mentions`/links/commands out of incoming text, editing or
  deleting a sent message → `references/messages-and-entities.md`.
- Anything about group behavior: what the bot can see by default, moderation
  actions, admin rights, invite links, join requests →
  `references/groups-and-privacy.md`.
- Sending or receiving photos/audio/video/documents/voice notes, or hitting a
  file size limit → `references/files-and-media.md`.
- Building a button UI, handling taps, or debugging a stuck "loading"
  spinner on a button → `references/inline-keyboards-and-callbacks.md`.
</quick_start>

<reference_guides>
| File | Covers |
| --- | --- |
| `references/updates-and-polling.md` | `Update` object, `getUpdates`, `setWebhook`/`deleteWebhook`/`getWebhookInfo`, `allowed_updates`, long polling vs webhooks, local Bot API server |
| `references/messages-and-entities.md` | `Message` object, `MessageEntity` (types, UTF-16 offsets, `mention` vs `text_mention`), parse modes (Markdown/MarkdownV2/HTML), `sendMessage`/edit/delete methods |
| `references/groups-and-privacy.md` | Privacy mode behavior, chat types, `ChatMember` status model, `ChatPermissions`/`ChatAdministratorRights`, ban/restrict/promote/invite-link/join-request methods |
| `references/files-and-media.md` | `file_id`/`file_unique_id`/`file_path`, the three ways to send a file, per-method size limits, media type objects (`Photo`/`Video`/`Audio`/`Document`/`Voice`/etc.), `getFile` |
| `references/inline-keyboards-and-callbacks.md` | `InlineKeyboardMarkup`/`InlineKeyboardButton`, `callback_data` (1-64 bytes), `CallbackQuery`, `answerCallbackQuery`, `editMessageReplyMarkup` |
| `references/rich-messages.md` | Rich Messages (Bot API 10.1+, fetched live 2026-09-09): `sendRichMessage`/`InputRichMessage`, the Rich Markdown grammar (GFM-style), limits, practical reply-formatting rules |
</reference_guides>

<context>
- These are reference files, not runnable code — there's nothing to execute
  here, just facts to look up before writing or reviewing a change to
  `server.ts`.
- The Bot API moves fast (this snapshot is 10.2, July 2026). If a task needs
  something that looks newer than these files describe, or a file's content
  looks stale, re-fetch https://core.telegram.org/bots/api directly rather
  than guessing from memory — don't silently patch these files from
  training-data recall.
- Rich Messages **are** covered — added 2026-09-09 as
  `references/rich-messages.md`, sourced from a live fetch of the 10.3 API page
  and /bots/features. Gifts, Stories, Business accounts, Suggested Posts, Telegram
  Passport, Games, Payments remain intentionally **not** covered here — if a future
  task needs one of those, fetch the upstream doc directly rather than expecting
  it in these files.
</context>

<success_criteria>
- The correct reference file(s) were read for the task at hand, without
  reading all five unnecessarily
- Any fact used that looks newer than the 10.2/2026-08-18 snapshot, or that
  looks stale, was verified against the live upstream doc rather than
  guessed from training-data recall
- Out-of-scope 10.x features are not answered from these files — they're
  redirected to a live upstream fetch
</success_criteria>
