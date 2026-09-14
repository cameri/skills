/**
 * Reusable omp (Oh My Pi) channel bridge.
 *
 * Claude Code natively converts `notifications/claude/channel` MCP
 * notifications into `<channel source="...">` user turns. omp does not: its
 * MCP manager fans server notifications out to extensions through the
 * `mcp_notification` event and never synthesizes a wake. This module closes
 * that gap by re-wrapping the plugin's channel notifications in the same
 * marker shape Claude Code uses, so the session's channel rules and
 * prompt-injection guard apply identically in both hosts.
 *
 * Drop this file at `extensions/omp-channel.ts` in the plugin that owns the
 * MCP channel server, set the two values in `CONFIG` below, declare the file
 * under `omp.extensions` in the plugin's `package.json`, and restart the
 * session. The factory is also exported so a test can build a bridge for a
 * synthetic server name.
 *
 * The wake is content-bearing (the message text is the prompt), matching the
 * Claude path, and is sent as a `customType: "channel:incoming"` message with
 * `{ triggerTurn: true }` — the shape omp renders as the inbound-channel card
 * (source, from, timestamp) instead of anonymous user text. A bare
 * `pi.sendUserMessage(wrapped)` still wakes the session, but the message then
 * arrives as ordinary user text with no card. `triggerTurn` is what starts the
 * turn: a custom message without it is stored but never wakes an idle session,
 * and `deliverAs: "followUp"` merely queues. See `delivery-and-wake.md`.
 *
 * The flip side: under a stock omp build the `channel:incoming` message is
 * still delivered and still renders (as a generic custom message), so the wake
 * does not depend on the card renderer being present.
 */

/**
 * Namespace import with a literal fallback: some omp builds (observed
 * 18.1.14/18.1.17) resolve this module without the named export, and a failed
 * extension load silently breaks the wake for that channel. The wire value is
 * stable across versions, so fall back to it when the module lacks the
 * constant.
 */
import * as piPkg from "@oh-my-pi/pi-coding-agent";

const CHANNEL_INCOMING_MESSAGE_TYPE: string =
  ((piPkg as Record<string, unknown>).CHANNEL_INCOMING_MESSAGE_TYPE as string | undefined) ??
  "channel:incoming";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export interface ChannelBridgeConfig {
  /** MCP server name as declared in the plugin's `.mcp.json`. */
  serverName: string;
  /** Channel source value used when the plugin does not declare one in `meta`. */
  sourceName: string;
}

/** Edit these two to match the plugin that owns the MCP channel server. */
const CONFIG: ChannelBridgeConfig = {
  serverName: "my-plugin",
  sourceName: "my-plugin",
};

interface ChannelParams {
  content?: unknown;
  meta?: Record<string, unknown>;
}

/**
 * Escape a value that will be interpolated into an attribute position.
 * Meta keys and values are sender- or server-controlled; without this a
 * crafted value could close the attribute and inject a second one.
 */
function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function createChannelBridge(config: ChannelBridgeConfig): (pi: ExtensionAPI) => void {
  const { serverName, sourceName } = config;

  return function ompChannelBridge(pi: ExtensionAPI): void {
    pi.on("mcp_notification", (event) => {
      // Only channel notifications are part of this contract; every other
      // method on the same server (and every other server) is left alone.
      if (event.method !== "notifications/claude/channel") return;

      // Subagent sessions must not wake on channel notifications — the main
      // session owns channel conversations, and a wake here would spawn a
      // turn inside a subagent that cannot answer the channel. omp adds
      // `yield` to every subagent session's tool set (requireYieldTool) and
      // never to a main session, so its presence identifies a subagent.
      if (pi.getActiveTools().includes("yield")) return;

      const params = event.params as ChannelParams | undefined;
      // A wake is content-bearing: no content means no prompt to run.
      if (typeof params?.content !== "string") return;

      const meta = params.meta ?? {};
      const metaSource = typeof meta.source === "string" ? meta.source : undefined;
      // The MCP server can be renamed in a custom `.mcp.json`, and a plugin
      // may emit a source name that differs from its server name; accept
      // either so a renamed install still bridges.
      if (event.server !== serverName && metaSource !== sourceName) return;

      // `source` is written first and never duplicated from meta; every other
      // string-valued meta entry becomes an attribute on the channel marker.
      const attrs = [`source="${escapeAttribute(metaSource ?? sourceName)}"`];
      for (const [key, value] of Object.entries(meta)) {
        if (key === "source" || typeof value !== "string") continue;
        attrs.push(`${escapeAttribute(key)}="${escapeAttribute(value)}"`);
      }

      // Break any forged close tag in sender-controlled text so a channel
      // message cannot inject synthetic attributes or a fake marker on the
      // wake (same defence the Claude Code path relies on).
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
        // Losing one wake must not take down the notification dispatch path
        // for the other extensions subscribed to this event.
        process.stderr.write(
          `omp channel bridge: wake failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    });
  };
}

export default createChannelBridge(CONFIG);
