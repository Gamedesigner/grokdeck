import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {VERIFIED_VERSION,compatibilityWarning} from './compatibility.mjs';
const MAX_BLOB = 24 * 1024 * 1024;
export const SUPPORTED_VERSION = VERIFIED_VERSION;
export function defaultSource(
  platform = process.platform,
  home = os.homedir(),
  appData = process.env.APPDATA,
) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (platform === "win32")
    return paths.join(
      appData || paths.join(home, "AppData", "Roaming"),
      "Grok Bot",
    );
  if (platform === "darwin")
    return paths.join(home, "Library", "Application Support", "Grok Bot");
  return paths.join(home, ".config", "Grok Bot");
}
export function decodeKey(name) {
  if (!/^[a-z2-7]+\.blob$/i.test(name)) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of name.slice(0, -5).toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}
export function encodeKey(key) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of Buffer.from(key)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return `${out}.blob`;
}
const text = (v, fallback = "") => (typeof v === "string" ? v : fallback);
const timestamp = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
export function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries
    .filter((e) => e && typeof e === "object")
    .map((e, i) => {
      const kind = text(e.kind);
      let role = "system",
        content = "",
        type = kind;
      const author =
        e.fromAgent && typeof e.fromAgent === "object"
          ? text(e.fromAgent.name, "Another agent")
          : null;
      if (kind === "message") {
        role = author
          ? "agent"
          : e.role === "user"
            ? "user"
            : e.role === "assistant"
              ? "assistant"
              : "system";
        content = text(e.content);
      } else if (kind === "send-message") {
        role = "assistant";
        type = text(e.message?.type, kind);
        content =
          type === "text"
            ? text(e.message?.content)
            : `[${type.replaceAll("-", " ")} — open in Grok Bot to view or respond]`;
      } else if (kind === "user-attachment") {
        role = "user";
        content = "[Attachment — open in Grok Bot to view]";
      } else if (kind === "notice") {
        content = text(e.text) || text(e.content) || "[Conversation notice]";
      } else if (kind === "voice-call") {
        content = "[Voice call — open in Grok Bot for details]";
      } else if (kind === "event") {
        content = `[${text(e.event?.type, "Activity").replaceAll("-", " ")}]`;
      } else {
        content = `[${kind || "Unsupported entry"} — open in Grok Bot for details]`;
      }
      return {
        id: text(e.id, `entry-${i}`),
        role,
        author,
        content,
        timestamp: timestamp(e.timestampMs),
        type,
        sequence: timestamp(e.seq),
        streaming: e.isStreaming === true || e.streaming === true,
      };
    })
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
}
async function readJSON(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BLOB)
    throw new Error("Unsupported cache file");
  return {
    data: JSON.parse(await fs.readFile(file, "utf8")),
    mtime: stat.mtimeMs,
  };
}
export async function readCache(root = defaultSource()) {
  const folder =
    path.basename(root) === "sand-client-persistence"
      ? root
      : path.join(root, "sand-client-persistence");
  const parent = path.dirname(folder);
  const warnings = [];
  let names;
  try {
    names = await fs.readdir(folder);
  } catch (e) {
    return {
      agents: [],
      sections: [],
      source: {
        kind: "local-cache",
        path: parent,
        available: false,
        checkedAt: Date.now(),
        version: null,
        cacheUpdatedAt: 0,
        warning:
          e.code === "ENOENT"
            ? "Grok Bot cache not found. Open Grok Bot and sign in, or choose its data folder."
            : "Grok Bot cache could not be read. Check folder permissions.",
      },
      warnings: [],
    };
  }
  const inventory = names
    .map((name) => ({ name, key: decodeKey(name) }))
    .filter((x) => x.key);
  const meta = inventory.find(
    (x) => x.key === "sand.client.slice.client-meta.account-slot",
  );
  let slot;
  if (meta) {
    try {
      slot = (await readJSON(path.join(folder, meta.name))).data.value;
    } catch {
      warnings.push("Could not read the active account selection.");
    }
  }
  // Select the active account only. Never blend histories from different accounts.
  const prefix =
    typeof slot === "string" && slot
      ? `sand.client.slice.account.${encodeURIComponent(slot)}.`
      : null;
  if (!prefix)
    return {
      agents: [],
      sections: [],
      source: {
        kind: "local-cache",
        path: parent,
        available: true,
        checkedAt: Date.now(),
        version: null,
        cacheUpdatedAt: 0,
        warning: "No active Grok Bot account cache. Open Grok Bot and sign in.",
      },
      warnings,
    };
  const scoped = inventory.filter((x) => x.key.startsWith(prefix));
  const slices = new Map();
  const replicas = new Map();
  let latest = 0;
  for (const entry of scoped) {
    const suffix = entry.key.slice(prefix.length);
    if (
      ![
        "roster.last-roster",
        "sidebar.last-sections",
        "ui-agent-refs",
      ].includes(suffix) &&
      !suffix.startsWith("transcript.replicas.")
    )
      continue;
    try {
      const { data, mtime } = await readJSON(path.join(folder, entry.name));
      const schemas = suffix === "roster.last-roster" ? [1, 4] : [1];
      if (
        !schemas.includes(data.schemaVersion) ||
        !data.value ||
        typeof data.value !== "object"
      ) {
        warnings.push(`Unsupported schema for ${suffix.split(".")[0]}.`);
        continue;
      }
      if (suffix === "roster.last-roster") latest = mtime;
      if (suffix.startsWith("transcript.replicas."))
        replicas.set(suffix.slice("transcript.replicas.".length), {
          messages: normalizeEntries(data.value.entries),
          cachedAt: timestamp(data.value.persistedAt) || mtime,
        });
      else slices.set(suffix, data.value);
    } catch {
      warnings.push(
        `Could not read a ${suffix.split(".")[0]} cache file. Refresh to retry.`,
      );
    }
  }
  const sectionRows = slices.get("sidebar.last-sections")?.sections;
  const sections = Array.isArray(sectionRows)
    ? sectionRows
        .filter((x) => x && typeof x.id === "string")
        .map((s) => ({
          id: s.id,
          name: text(s.name, "Untitled"),
          agentIds: Array.isArray(s.agentIds)
            ? s.agentIds.filter((x) => typeof x === "string")
            : [],
        }))
    : [];
  const pins = slices.get("ui-agent-refs")?.pinnedAgentIds;
  const rows = slices.get("roster.last-roster")?.rows;
  if (!Array.isArray(rows))
    warnings.push(
      "No supported agent roster found. This Grok Bot version may need an adapter update.",
    );
  const agents = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.id === "string" && !r.isRemovedFromSidebar)
    .map((r) => {
      const replica = replicas.get(r.id);
      const messages = replica?.messages || [];
      return {
        id: r.id,
        name: text(r.name, "Unnamed agent"),
        description: text(r.title) || text(r.description),
        color: /^#[0-9a-f]{3,8}$/i.test(r.avatarColor)
          ? r.avatarColor
          : "#8a9bff",
        section:
          sections.find((s) => s.agentIds.includes(r.id))?.name || "Unassigned",
        sectionId:
          sections.find((s) => s.agentIds.includes(r.id))?.id ||
          "__unassigned__",
        pinned: Array.isArray(pins) && pins.includes(r.id),
        hasUnread: r.hasUnread === true,
        unreadCount: Number.isSafeInteger(r.unreadCount)
          ? Math.max(0, r.unreadCount)
          : 0,
        awaitingResponse:
          r.awaitingUserResponse != null && r.awaitingUserResponse !== false,
        lastActivityAt:
          timestamp(r.lastActivityAt) ||
          timestamp(r.localActivityAt) ||
          timestamp(r.updatedAt),
        preview:
          text(r.lastEntry?.text) ||
          messages.at(-1)?.content ||
          "No cached messages yet",
        messages,
        cachedAt: replica?.cachedAt || 0,
      };
    });
  let version = null;
  try {
    version =
      text(
        (await readJSON(path.join(parent, "desktop-status.json"))).data
          .appVersion,
      ) || null;
  } catch {
    /* Optional desktop status; never read credentials. */
  }
  return {
    agents,
    sections,
    source: {
      kind: "local-cache",
      path: parent,
      available: true,
      checkedAt: Date.now(),
      version,
      cacheUpdatedAt: latest,
      warning:
        version ? compatibilityWarning(version) : null,
    },
    warnings,
  };
}
export function conversationURL(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    throw new Error("Invalid agent ID");
  return `grokbot://app/v1/agent?id=${encodeURIComponent(id)}`;
}
