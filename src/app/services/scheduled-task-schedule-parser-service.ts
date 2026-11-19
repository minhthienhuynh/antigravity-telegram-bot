import { execFile } from "node:child_process";
import { logger } from "../../utils/logger.js";
<<<<<<< HEAD
import { config } from "../../config.js";
import type { ParsedTaskSchedule } from "../types/scheduled-task.js";
=======
import {
  cleanupScheduledTaskSessionIgnores,
  registerScheduledTaskSessionIgnore,
} from "./scheduled-task-session-ignore-service.js";
import type { ParsedTaskSchedule, ScheduledTaskModel } from "../types/scheduled-task.js";
>>>>>>> bef86bb

/**
 * Schedule parser (agy version).
 *
 * Uses a one-shot agy print run with a JSON schema to turn natural-language
 * schedule text into a structured ParsedTaskSchedule (once or cron).
 */

function agyPrint(prompt: string, directory: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      config.antigravity.bin,
      ["--print", prompt, "--output-format", "json"],
      { cwd: directory, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function parseTaskSchedule(
  scheduleText: string,
  directory: string,
  model?: ScheduledTaskModel,
): Promise<ParsedTaskSchedule> {
  logger.info(`[ScheduledTaskScheduleParser] Parsing schedule via agy one-shot: ${scheduleText}`);

  const prompt =
    `You are a schedule parser. Convert the user's schedule request into JSON with ` +
    `these fields: kind ("once"|"cron"). For "once": runAt (ISO 8601), timezone (IANA, default UTC), ` +
    `summary (human readable), nextRunAt (ISO 8601). For "cron": cron.expression, cron.summary, ` +
    `cron.nextRunAt. Use the current time for relative calculations. Schedule request: "${scheduleText}"`;

  const stdout = await agyPrint(prompt, directory);

  const cleaned = stdout.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  let parsed: Record<string, unknown>;
  try {
<<<<<<< HEAD
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error("Schedule parsing returned invalid JSON from Antigravity");
=======
    logger.debug(
      `[ScheduledTaskScheduleParser] Parsing schedule: directory=${trimmedDirectory}, textLength=${trimmedScheduleText.length}`,
    );
    await cleanupScheduledTaskSessionIgnores();

    const { data: session, error: createError } = await opencodeClient.session.create({
      directory: trimmedDirectory,
      title: SCHEDULE_PARSE_SESSION_TITLE,
    });

    if (createError || !session) {
      throw createError || new Error("Failed to create temporary schedule parser session");
    }

    sessionId = session.id;
    await registerScheduledTaskSessionIgnore(session.id);
    logger.debug(`[ScheduledTaskScheduleParser] Created temporary session: sessionId=${session.id}`);

    const promptOptions: {
      sessionID: string;
      directory: string;
      system: string;
      parts: Array<{ type: "text"; text: string }>;
      model?: { providerID: string; modelID: string };
      variant?: string;
    } = {
      sessionID: session.id,
      directory: session.directory,
      system:
        "You are a schedule parser. Your only job is to convert user schedule text into strict JSON output.",
      parts: [{ type: "text", text: buildSchedulePrompt(trimmedScheduleText, timezone) }],
    };

    if (model?.providerID && model.modelID) {
      promptOptions.model = {
        providerID: model.providerID,
        modelID: model.modelID,
      };
    }

    if (model?.variant) {
      promptOptions.variant = model.variant;
    }

    const { data: response, error: promptError } = await opencodeClient.session.prompt(
      promptOptions,
    );

    if (promptError || !response) {
      throw promptError || new Error("Failed to parse schedule");
    }

    const responseText = collectResponseText(response.parts);
    logger.debug(
      `[ScheduledTaskScheduleParser] Received parser response: sessionId=${session.id}, textLength=${responseText.length}`,
    );
    if (!responseText) {
      throw new Error("Schedule parser returned an empty response");
    }

    return parseSchedulePayload(responseText);
  } finally {
    if (sessionId) {
      try {
        await opencodeClient.session.delete({ sessionID: sessionId });
      } catch (error) {
        logger.warn(
          `[ScheduledTaskScheduleParser] Failed to delete temporary session: sessionId=${sessionId}`,
          error,
        );
      }
    }
>>>>>>> bef86bb
  }

  const kind = parsed.kind;
  if (kind === "once") {
    const runAt = String(parsed.runAt ?? "");
    if (!runAt) {
      throw new Error("Schedule parsing did not include runAt for a one-time schedule");
    }
    const timezone = String(parsed.timezone ?? "UTC");
    const summary = String(parsed.summary ?? scheduleText);
    const nextRunAt = String(parsed.nextRunAt ?? runAt);
    return { kind: "once", runAt, timezone, summary, nextRunAt };
  }

  if (kind === "cron") {
    const cronField = parsecExpressionField(parsed.cron);
    const expression = String(cronField ?? "");
    if (!expression) {
      throw new Error("Schedule parsing did not include a cron expression");
    }
    const summary = String(parsed.summary ?? scheduleText);
    const nextRunAt = String(parsed.nextRunAt ?? "");
    if (!nextRunAt) {
      throw new Error("Schedule parsing did not include the next cron occurrence");
    }
    const timezone = String(parsed.timezone ?? "UTC");
    return { kind: "cron", cron: expression, timezone, summary, nextRunAt };
  }

  throw new Error("Schedule parsing returned an unknown schedule kind");
}

function parsecExpressionField(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return String(obj.expression ?? "");
  }
  return "";
}
