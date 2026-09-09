Source: https://core.telegram.org/bots/api (Bot API 10.3, fetched 2026-09-09) and
https://core.telegram.org/bots/features#rich-messages. Live-fetched to close the gap
the 10.2 snapshot deliberately left. Upstream is the source of truth if things drift.

# Rich Messages (Bot API 10.1+)

Rich messages are for highly structured content: reports, tables, docs snippets,
streamed AI answers. Sent via `sendRichMessage` with an `InputRichMessage`
(`{markdown: string}` or `{html: string}` or `{blocks: [...]}`); edited via
`editMessageText` with `rich_message`. Character cap ~32768 (vs 4096 for regular).
telegram-ng's `reply`/`edit_message` `format:'rich'` maps to `{markdown: text}`.

## Rich Markdown style (GFM-based, no escaping needed)

Inline:

```
**bold text**        __bold text__
*italic text*        _italic text_
~~strikethrough~~    `inline fixed-width code`     ==marked text==     ||spoiler||
[inline URL](https://t.me/)   [e-mail](mailto:)   [phone](tel:)   [user](tg://user?id=123)
![](tg://emoji?id=...)         ![22:45 tomorrow](tg://time?unix=...&format=wDT)
$x^2 + y^2$  (inline LaTeX)
#hashtag $USD +12345678901 card: 4242 4242 4242 4242 https://t.me a@t.me /command @username
```

Blocks:

```
# H1 … ###### H6
Paragraph text
---
- / * unordered items      1. 2. ordered items      - [ ] / - [x] task items
> Block quotations (continued with > lines)
```lang fenced code blocks```
$$E = mc^2$$   or   ```math E = mc^2 ```
| GFM tables | with | alignment `:---`, `:--:`, `---:` |
Text with a reference[^id1]  …  [^id1]: Footnote definition.
![](https://…/photo.jpg "caption")  — media blocks: jpg/mp4/mp3/ogg/gif/zip
<details open><summary>…</summary> … </details>   (collapsible)
<tg-collage> / <tg-slideshow> wrapping media blocks
<u>underline</u>, <sup>/<sub>, <tg-spoiler>, <ins> work inline; markdown nests inside HTML tags
```

Limits: ≤50 media attachments, ≤20 table columns.

## Practical rules for this bot's replies

- `**bold**`, headings, GFM tables, fences, and footnotes all render — tables and
  headings are safe to use, unlike regular Markdown messages.
- Inline `` `code` `` IS part of the upstream Rich Markdown grammar (see grammar
  excerpt above). If a client/grammy build ever strips it again, fall back to fenced
  blocks or plain text — but treat upstream as authoritative first.
- Keep whole-table rows on one line; don't mix `- ` bullets inside table cells.
- For long reports prefer headings + tables + `<details>`; don't dump raw JSON.
