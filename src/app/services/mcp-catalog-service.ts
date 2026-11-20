import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";

/**
 * MCP catalog for agy.
 *
 * agy exposes no live MCP status API in v1, so the catalog lists the servers
 * configured in the CLI config file with a static "configured" status (no live
 * connection claim, no toggle). Parsing helpers are kept because the catalog
 * callback handler unit-tests them.
 */

export interface McpCatalogServerItem {
  name: string;
  status: { status: string; error?: string | undefined };
  transport?: "stdio" | "http" | undefined;
  endpoint?: string | undefined;
}

const MCP_STATUS_NAMES = [
  "connected",
  "disabled",
  "failed",
  "needs_auth",
  "needs_client_registration",
  "configured",
] as const;

function isMcpStatusName(value: unknown): value is (typeof MCP_STATUS_NAMES)[number] {
  return typeof value === "string" && MCP_STATUS_NAMES.some((name) => name === value);
}

function buildMcpStatus(statusValue: (typeof MCP_STATUS_NAMES)[number], errorValue: unknown): McpCatalogServerItem["status"] {
  if (statusValue === "failed" || statusValue === "needs_client_registration") {
    return { status: statusValue, error: typeof errorValue === "string" ? errorValue : "" };
  }

  return { status: statusValue };
}

type ParsedMcpServerStatus =
  | { kind: "ok"; status: McpCatalogServerItem["status"] }
  | { kind: "skip" }
  | { kind: "invalid" };

function parseMcpServerStatus(status: unknown): ParsedMcpServerStatus {
  if (!isRecord(status)) {
    return { kind: "invalid" };
  }

  if (!isMcpStatusName(status.status)) {
    if (typeof status.status === "string") {
      logger.debug(`[McpCatalog] Unknown MCP status "${status.status}", skipping server`);
      return { kind: "skip" };
    }

    return { kind: "invalid" };
  }

  return { kind: "ok", status: buildMcpStatus(status.status, status.error) };
}

export function parseMcpCatalogServers(value: unknown): McpCatalogServerItem[] | null {
  if (!isRecord(value)) {
    return null;
  }

  if (Array.isArray(value)) {
    const servers: McpCatalogServerItem[] = [];
    for (const item of value) {
      if (!isRecord(item)) {
        return null;
      }

      const name = item.name;
      if (typeof name !== "string") {
        return null;
      }

      const parsed = parseMcpServerStatus(item.status);
      if (parsed.kind === "invalid") {
        return null;
      }
      if (parsed.kind === "skip") {
        continue;
      }

      servers.push({ name, status: parsed.status });
    }

    return servers;
  }

  const servers: McpCatalogServerItem[] = [];

  for (const [name, statusValue] of Object.entries(value)) {
    const parsed = parseMcpServerStatus(statusValue);
    if (parsed.kind === "invalid") {
      return null;
    }
    if (parsed.kind === "skip") {
      continue;
    }

    servers.push({ name, status: parsed.status });
  }

  return servers;
}

export async function loadMcpCatalog(_projectDirectory: string): Promise<McpCatalogServerItem[]> {
  // agy has no live MCP status API: list the servers configured in the CLI
  // config file. Only names/transport/endpoint are read — env and header values
  // (tokens) never enter the catalog.
  const configPath = path.join(os.homedir(), ".gemini", "config", "mcp_config.json");
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.warn("[McpCatalog] Cannot parse mcp_config.json:", error);
    return [];
  }

  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    return [];
  }

  const servers: McpCatalogServerItem[] = [];
  for (const [name, cfg] of Object.entries(parsed.mcpServers)) {
    if (!isRecord(cfg)) {
      continue;
    }
    const item: McpCatalogServerItem = { name, status: { status: "configured" } };
    if (typeof cfg.command === "string") {
      item.transport = "stdio";
      item.endpoint = cfg.command;
    } else if (typeof cfg.url === "string") {
      item.transport = "http";
      // Strip any query string so a token embedded in the URL is not shown.
      item.endpoint = cfg.url.split("?")[0];
    }
    servers.push(item);
  }
  return servers;
}

export async function toggleMcpCatalogServer(
  _projectDirectory: string,
  _serverName: string,
  _enable: boolean,
): Promise<void> {
  throw new Error("MCP server toggling is not available with the Antigravity backend");
}
