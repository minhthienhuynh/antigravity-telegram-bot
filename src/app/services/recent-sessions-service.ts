import os from "node:os";
import { listConversations } from "../../antigravity/session-store.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject, getCurrentSession } from "../stores/settings-store.js";
import { isForegroundBusy } from "./run-control-service.js";

export type RecentStatus = "question" | "permission" | "running" | "idle";
type RecentSessionInfo = {
  id: string;
  directory: string;
  title: string;
  time: { created: number; updated: number };
};
export type RecentSession = { session: RecentSessionInfo; status: RecentStatus };

export async function resolveSessionParentChain(
  sessionId: string,
  directory: string,
  roots: Set<string>,
): Promise<{ root: string; links: Array<{ child: string; parent: string }> } | null> {
  const seen = new Set<string>();
  const links: Array<{ child: string; parent: string }> = [];
  let id = sessionId;
  while (!roots.has(id) && !seen.has(id)) {
    seen.add(id);
    const { data, error } = await opencodeClient.session.get({ sessionID: id, directory });
    if (error || !data?.parentID) return null;
    links.push({ child: id, parent: data.parentID });
    id = data.parentID;
  }
  return roots.has(id) ? { root: id, links } : null;
}

export async function loadRecentSessions(limit: number): Promise<RecentSession[]> {
  // agy keeps every conversation in one global CLI directory and exposes no
  // OpenCode server registry, so /recent lists the same conversations as
  // /sessions (newest first). The current project is a display label; status
  // comes from the bot's own foreground state (no global run/question API).
  const conversations = (await listConversations()).sort(
    (a, b) => b.lastModified.getTime() - a.lastModified.getTime(),
  );
  const attached = getCurrentSession();
  const directory =
    getCurrentProject()?.worktree ?? attached?.directory ?? os.homedir();
  const busy = isForegroundBusy();
  return conversations.slice(0, limit).map((conversation) => ({
    session: {
      id: conversation.id,
      directory,
      title: conversation.title,
      time: {
        created: conversation.lastModified.getTime(),
        updated: conversation.lastModified.getTime(),
      },
    },
    status: attached?.id === conversation.id && busy ? ("running" as const) : ("idle" as const),
  }));
}
