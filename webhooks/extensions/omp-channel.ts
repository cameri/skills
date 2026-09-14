/**
 * omp (Oh My Pi) wake bridge for the webhooks channel.
 *
 * Claude Code natively converts `notifications/claude/channel` MCP
 * notifications into `<channel source="...">` user turns. omp does not: its
 * MCP manager fans server notifications out to extensions via the
 * `mcp_notification` event and never synthesizes a wake. This extension
 * closes that gap — it re-wraps this plugin's channel notifications in the
 * same marker shape Claude Code uses, so the session's channel rules and
 * prompt-injection guard apply identically in both hosts.
 *
 * The wake is content-bearing (the message text is the prompt) and is sent as
 * a `channel:incoming` custom message with `{triggerTurn: true}` — the shape
 * flock's bridge uses, which omp renders as the inbound-channel card (source,
 * from, timestamp) instead of anonymous user text. `triggerTurn` is what
 * starts the turn: a custom message without it is stored but never wakes an
 * idle session.
 *
 */

/**
 * Namespace import: some omp builds (observed 18.1.14/18.1.17) resolve this
 * module without the named export, which fails the whole extension load and
 * silently breaks wake. The wire value is stable across versions
 * ("channel:incoming" — omp's message customType), so fall back to the
 * literal when the bundled module does not carry the constant.
 */
import * as piPkg from "@oh-my-pi/pi-coding-agent";

const CHANNEL_INCOMING_MESSAGE_TYPE: string =
  ((piPkg as Record<string, unknown>).CHANNEL_INCOMING_MESSAGE_TYPE as string | undefined) ??
  "channel:incoming";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/** MCP server name as declared in this plugin's .mcp.json. */
const SERVER_NAME = "webhooks";
/** Channel source value when the plugin does not declare one in meta. */
const SOURCE_NAME = "webhooks";

interface ChannelParams {
  content?: unknown;
  meta?: Record<string, unknown>;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export default function ompChannelBridge(pi: ExtensionAPI): void {
  pi.on("mcp_notification", (event) => {
    if (event.method !== "notifications/claude/channel") return;
    // Subagent sessions must not wake on channel notifications — the main
    // session owns channel conversations (see sandbox-manager's
    // subagent-hardening extension). omp adds `yield` to every subagent
    // session's tool set (requireYieldTool), so its presence identifies one.
    if (pi.getActiveTools().includes("yield")) return;
    const params = event.params as ChannelParams | undefined;
    if (typeof params?.content !== "string") return;

    const meta = params.meta ?? {};
    const metaSource = typeof meta.source === "string" ? meta.source : undefined;
    // The MCP server can be renamed in a custom .mcp.json; accept the server
    // name or the source this plugin declares in its own meta.
    if (event.server !== SERVER_NAME && metaSource !== SOURCE_NAME) return;

    const attrs = [`source="${escapeAttribute(metaSource ?? SOURCE_NAME)}"`];
    for (const [key, value] of Object.entries(meta)) {
      if (key === "source" || typeof value !== "string") continue;
      attrs.push(`${escapeAttribute(key)}="${escapeAttribute(value)}"`);
    }

    // Break any forged close tag in sender-controlled text so a channel
    // message cannot inject synthetic attributes on the wake.
    const safeContent = params.content.replaceAll("</channel", "<\\/channel");
    const wrapped = `<channel ${attrs.join(" ")}>\n${safeContent}\n</channel>`;
    try {
      pi.sendMessage(
        {
          customType: CHANNEL_INCOMING_MESSAGE_TYPE,
          content: wrapped,
          display: true,
          details: { ...meta, text: params.content },
        },
        { triggerTurn: true },
      );
    } catch (error: unknown) {
      process.stderr.write(
        `omp channel bridge: wake failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  });
}
