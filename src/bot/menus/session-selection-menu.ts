import { InlineKeyboard } from "grammy";
import {
  listConversations,
  type AntigravityConversation,
} from "../../antigravity/session-store.js";
import { getDateLocale, t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import path from "node:path";

export const SESSION_CALLBACK_PREFIX = "session:";
const SESSION_PAGE_CALLBACK_PREFIX = "session:page:";
const BACKGROUND_SESSION_CALLBACK_PREFIX = "background-session:";

export type SessionListItem = {
  id: string;
  title: string;
  directory: string;
  time: {
    created: number;
  };
};

export type SessionPage = {
  sessions: SessionListItem[];
  hasNext: boolean;
  page: number;
};

export type BackgroundSessionOpenKind = "assistant_response" | "question_asked" | "permission_asked";

export interface BackgroundSessionCallbackPayload {
  sessionId: string;
  kind: BackgroundSessionOpenKind | null;
}

const BACKGROUND_SESSION_KIND_CALLBACK_MARKERS: Record<BackgroundSessionOpenKind, string> = {
  assistant_response: "a",
  question_asked: "q",
  permission_asked: "p",
};

const BACKGROUND_SESSION_KIND_BY_CALLBACK_MARKER: Record<string, BackgroundSessionOpenKind> = {
  a: "assistant_response",
  q: "question_asked",
  p: "permission_asked",
};

function buildSessionPageCallback(page: number): string {
  return `${SESSION_PAGE_CALLBACK_PREFIX}${page}`;
}

export function parseSessionPageCallback(data: string): number | null {
  if (!data.startsWith(SESSION_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(SESSION_PAGE_CALLBACK_PREFIX.length);
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return page;
}

export function parseSessionIdCallback(data: string): string | null {
  if (!data.startsWith(SESSION_CALLBACK_PREFIX)) {
    return null;
  }

  if (data.startsWith(SESSION_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const sessionId = data.slice(SESSION_CALLBACK_PREFIX.length);
  return sessionId.length > 0 ? sessionId : null;
}

export function parseBackgroundSessionCallback(
  data: string,
): BackgroundSessionCallbackPayload | null {
  if (!data.startsWith(BACKGROUND_SESSION_CALLBACK_PREFIX)) {
    return null;
  }

  const payload = data.slice(BACKGROUND_SESSION_CALLBACK_PREFIX.length);
  const markerSeparatorIndex = payload.indexOf(":");
  if (markerSeparatorIndex < 0) {
    return payload.length > 0 ? { sessionId: payload, kind: null } : null;
  }

  const marker = payload.slice(0, markerSeparatorIndex);
  const rawSessionId = payload.slice(markerSeparatorIndex + 1);
  // Buttons store the bare agy uuid (see toCallbackSessionId); rebuild the
  // prefixed id only when the payload is a plain uuid stripped by the button.
  const looksLikeBareUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSessionId);
  const sessionId = looksLikeBareUuid ? `agy-session-${rawSessionId}` : rawSessionId;
  const kind = BACKGROUND_SESSION_KIND_BY_CALLBACK_MARKER[marker];
  if (!kind || sessionId.length === 0) {
    return null;
  }

  return { sessionId, kind };
}

const AGY_SESSION_ID_PREFIX = "agy-session-";

/**
 * Telegram callback_data is limited to 64 bytes; `agy-session-<uuid>` is 48
 * chars, so prefix + marker + id overflows. Store the bare uuid on the button
 * and rebuild the full id when the callback is parsed.
 */
function toCallbackSessionId(sessionId: string): string {
  return sessionId.startsWith(AGY_SESSION_ID_PREFIX)
    ? sessionId.slice(AGY_SESSION_ID_PREFIX.length)
    : sessionId;
}

export function buildBackgroundSessionOpenKeyboard(
  sessionId: string,
  kind: BackgroundSessionOpenKind,
): InlineKeyboard {
  const marker = BACKGROUND_SESSION_KIND_CALLBACK_MARKERS[kind];
  return new InlineKeyboard().text(
    t("background.open_session_button"),
    `${BACKGROUND_SESSION_CALLBACK_PREFIX}${marker}:${toCallbackSessionId(sessionId)}`,
  );
}

function formatSessionsSelectText(page: number): string {
  if (page === 0) {
    return t("sessions.select");
  }

  return t("sessions.select_page", { page: page + 1 });
}

/**
 * True when the conversation was run inside `directory` (the workspace is the
 * directory itself or a descendant of it).
 */
export function workspaceBelongsToDirectory(workspace: string, directory: string): boolean {
  const normalizedWorkspace = path.resolve(workspace);
  const normalizedDirectory = path.resolve(directory);
  return (
    normalizedWorkspace === normalizedDirectory ||
    normalizedWorkspace.startsWith(`${normalizedDirectory}${path.sep}`)
  );
}

/**
 * Filter conversations for the `/sessions` list of a project:
 * - subagent/child conversations (parent_conversation_id set) are dropped;
 * - conversations whose recorded workspace belongs to the directory come first;
 * - conversations with no workspace info yet (fresh, first turn pending) are
 *   kept at the end so a brand-new conversation never disappears from the list.
 * Order stays newest-first within each group.
 */
export function filterConversationsForDirectory(
  conversations: AntigravityConversation[],
  directory: string,
): AntigravityConversation[] {
  const topLevel = conversations.filter((conversation) => !conversation.parentConversationId);
  const owned: AntigravityConversation[] = [];
  const unknown: AntigravityConversation[] = [];
  for (const conversation of topLevel) {
    const workspaces = conversation.workspaces ?? [];
    if (workspaces.some((workspace) => workspaceBelongsToDirectory(workspace, directory))) {
      owned.push(conversation);
    } else if (workspaces.length === 0) {
      unknown.push(conversation);
    }
  }
  return [...owned, ...unknown];
}

/**
 * Page through real agy conversations (newest first), filtered for the
 * project `directory`: workspace-matched conversations first, conversations
 * without workspace info yet appended at the end.
 */
export async function loadSessionPage(
  directory: string,
  page: number,
  pageSize: number,
): Promise<SessionPage> {
  const conversations = await listConversations();
  const filtered = filterConversationsForDirectory(conversations, directory);
  const sessions: SessionListItem[] = filtered.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    directory,
    time: {
      created: conversation.lastModified.getTime(),
    },
  }));

  const startIndex = page * pageSize;
  const endExclusive = startIndex + pageSize;
  const hasNext = sessions.length > endExclusive;
  const pagedSessions = sessions.slice(startIndex, endExclusive);

  logger.debug(
    `[Sessions] Loaded page=${page + 1}, startIndex=${startIndex}, endExclusive=${endExclusive}, pageSize=${pageSize}, items=${pagedSessions.length}, hasNext=${hasNext}`,
  );

  return {
    sessions: pagedSessions,
    hasNext,
    page,
  };
}

function buildSessionsKeyboard(pageData: SessionPage, pageSize: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const localeForDate = getDateLocale();
  const pageStartIndex = pageData.page * pageSize;

  pageData.sessions.forEach((session, index) => {
    const date = new Date(session.time.created).toLocaleDateString(localeForDate);
    const label = `${pageStartIndex + index + 1}. ${session.title} (${date})`;
    keyboard.text(label, `${SESSION_CALLBACK_PREFIX}${session.id}`).row();
  });

  if (pageData.page > 0) {
    keyboard.text(t("sessions.button.prev_page"), buildSessionPageCallback(pageData.page - 1));
  }

  if (pageData.hasNext) {
    keyboard.text(t("sessions.button.next_page"), buildSessionPageCallback(pageData.page + 1));
  }

  if (pageData.page > 0 || pageData.hasNext) {
    keyboard.row();
  }

  return keyboard;
}

export function buildSessionSelectionMenuView(
  pageData: SessionPage,
  pageSize: number,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text: formatSessionsSelectText(pageData.page),
    keyboard: buildSessionsKeyboard(pageData, pageSize),
  };
}
