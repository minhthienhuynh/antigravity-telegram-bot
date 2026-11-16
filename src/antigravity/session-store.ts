import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";

/**
 * Antigravity conversation store.
 *
 * Conversations live as one sqlite DB per conversation under
 * `~/.gemini/antigravity-cli/conversations/<conversation-uuid>.db`.
 *
 * Verification notes (sep-2026, real .db files):
 * - `gen_metadata` in the per-conversation .db is a protobuf blob with NO title;
 *   `steps.step_payload` is protobuf too, so the planned gen_metadata JSON title
 *   parse and the steps-based message preview proved FRAGILE (could not be
 *   validated against real data).
 * - The CLI maintains a central summary DB at
 *   `~/.gemini/antigravity-cli/conversation_summaries.db` with per-conversation
 *   `title` and `preview` (first user input) columns. That is the only reliable
 *   on-disk title source, so we use it.
 *
 * Every DB is opened with better-sqlite3 in readonly mode. We never write.
 */

export interface AntigravityConversation {
  id: string;
  title: string;
  preview: string;
  lastModified: Date;
  /** Absolute filesystem paths of the workspaces agy recorded for this conversation. */
  workspaces: string[];
  /** Non-null for subagent/child conversations spawned by a parent turn. */
  parentConversationId: string | null;
}

function conversationsDir(): string {
  return path.join(os.homedir(), ".gemini", "antigravity-cli", "conversations");
}

interface ConversationMetadataRow {
  conversation_id: string;
  title: string | null;
  preview: string | null;
  workspace_uris: string | null;
  parent_conversation_id: string | null;
}

export interface ConversationWorkspaceInfo {
  workspaces: string[];
  parentConversationId: string | null;
}

interface ConversationMetadata {
  title: string;
  preview: string;
  workspaces: string[];
  parentConversationId: string | null;
}

// TODO(v2): gen_metadata in the per-conversation .db is a protobuf blob without a
// human title in real DBs (checked 2026-09 against live conversations). If agy
// starts writing one, prefer it over the central summary DB — verify first.

function conversationTitleFallback(conversationId: string): string {
  return `Conversation ${conversationId.slice(0, 8)}`;
}

function deriveConversationTitle(
  title: string | null | undefined,
  preview: string | null | undefined,
  conversationId: string,
): string {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  const trimmedPreview = preview?.trim();
  if (trimmedPreview) {
    // Truncate long first prompts into a readable title.
    return trimmedPreview.length > 60 ? `${trimmedPreview.slice(0, 57)}...` : trimmedPreview;
  }

  return conversationTitleFallback(conversationId);
}

export function listConversationFiles(): { id: string; mtimeMs: number }[] {
  const dir = conversationsDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    logger.warn("[SessionStore] Cannot read conversations directory:", error);
    return [];
  }

  const files: { id: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".db")) {
      continue;
    }
    try {
      const filePath = path.join(dir, entry.name);
      if (!fs.statSync(filePath).isFile()) {
        continue;
      }
      const id = entry.name.slice(0, -".db".length);
      files.push({ id, mtimeMs: fs.statSync(filePath).mtimeMs });
    } catch {
      // Skip files that vanish or cannot stat mid-scan.
    }
  }

  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function loadConversationMetadataIndex(): Map<string, ConversationMetadata> {
  const index = new Map<string, ConversationMetadata>();
  const summaryDbPath = path.join(
    os.homedir(),
    ".gemini",
    "antigravity-cli",
    "conversation_summaries.db",
  );

  try {
    if (!fs.existsSync(summaryDbPath)) {
      return index;
    }
    const db = new Database(summaryDbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare(
          "SELECT conversation_id, title, preview, workspace_uris, parent_conversation_id FROM conversation_summaries",
        )
        .all() as ConversationMetadataRow[];

      for (const row of rows) {
        if (!row || typeof row.conversation_id !== "string") {
          continue;
        }
        const preview = row.preview?.trim() ?? "";
        index.set(row.conversation_id, {
          title: deriveConversationTitle(row.title, row.preview, row.conversation_id),
          preview,
          workspaces: parseWorkspaceUris(row.workspace_uris),
          parentConversationId:
            typeof row.parent_conversation_id === "string" && row.parent_conversation_id.length > 0
              ? row.parent_conversation_id
              : null,
        });
      }
    } finally {
      db.close();
    }
  } catch (error) {
    logger.warn("[SessionStore] Cannot read conversation summaries DB:", error);
  }

  return index;
}

/**
 * Parse agy's `workspace_uris` JSON column (e.g. `["file:///home/ubuntu/projects"]`)
 * into absolute filesystem paths.
 *
 * Non-file URI schemes (e.g. `ssh://`, `vscode-remote://`), relative paths, and
 * malformed entries are discarded so they cannot falsely match local directories.
 */
export function parseWorkspaceUris(urisJson: string | null): string[] {
  if (!urisJson) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(urisJson);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string" || entry.length === 0) {
        continue;
      }
      if (entry.startsWith("file://")) {
        try {
          const resolvedPath = fileURLToPath(entry);
          if (path.isAbsolute(resolvedPath) || path.win32.isAbsolute(resolvedPath)) {
            out.push(resolvedPath);
          }
        } catch {
          // Discard unparseable file:// URLs.
        }
      } else if (path.isAbsolute(entry) || path.win32.isAbsolute(entry)) {
        out.push(entry);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * List real conversations, newest first.
 */
export async function listConversations(limit?: number | null): Promise<AntigravityConversation[]> {
  const result = buildConversationList();
  if (typeof limit === "number") {
    return result.slice(0, limit);
  }

  return result;
}

function buildConversationList(): AntigravityConversation[] {
  const metadataIndex = loadConversationMetadataIndex();
  return listConversationFiles().map((file) => {
    const lastModified = new Date(file.mtimeMs);
    const meta = metadataIndex.get(file.id);
    return {
      id: file.id,
      title: meta?.title ?? conversationTitleFallback(file.id),
      preview: meta?.preview ?? "",
      lastModified,
      workspaces: meta?.workspaces ?? [],
      parentConversationId: meta?.parentConversationId ?? null,
    };
  });
}

/**
 * Build a preview: title + last-modified date + last messages labelled "You"/"Agent".
 *
 * The per-conversation .db steps table stores protobuf payloads, not JSON — the
 * You/Agent message content could not be reliably extracted from real DBs, so v1
 * shows only the reliable metadata (title/date) as a resumable notice.
 */
export function formatConversationPreview(conversation: AntigravityConversation): string {
  const date = new Date(conversation.lastModified).toLocaleString();
  const lines = [`📂 ${conversation.title}`, `🕒 ${date}`];

  if (conversation.preview) {
    lines.push("");
    lines.push(`You ${conversation.preview}`);
    lines.push("... resumable existing conversation");
  } else {
    lines.push("resumable existing conversation");
  }

  return lines.join("\n");
}

/**
 * Get a single conversation, null if it does not exist on disk.
 */
export function getConversation(id: string): AntigravityConversation | null {
  return buildConversationList().find((conversation) => conversation.id === id) ?? null;
}

export function conversationExists(id: string): boolean {
  return fs.existsSync(path.join(conversationsDir(), `${id}.db`));
}

/**
 * Real conversation title from the agy summaries DB (falls back to the
 * short-id label).
 */
export function getConversationTitle(conversationId: string): string {
  const meta = loadConversationMetadataIndex().get(conversationId);
  return meta?.title ?? conversationTitleFallback(conversationId);
}
