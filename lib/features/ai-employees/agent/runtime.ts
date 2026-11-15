/**
 * The agent loop of the AI employees (#1188, decision 2026-11-14-training-room-grows-employees):
 * the Messages API with a loop of our own, the model of the AI features (Claude Sonnet 5.5). A
 * function stops at 30 seconds, so a session moves on one call of Claude at a time:
 * advanceSession takes the session's lock, makes one call, carries out the tools Claude asked for
 * and saves it all in one transaction, then lets go of the lock. The caller (the training room)
 * asks for the next step while the session is running.
 *
 * - The conversation is appended to, never rewritten: the assistant's content is kept as it came
 *   (its thinking blocks are only valid in the conversation that made them)
 * - A forced tool call is refused by the model: the report tool is offered with `strict: true`
 *   and asked for in the prompt; an answer without it gets a reminder, at most MAX_REMINDERS times
 * - The stop reason is read before the content: a refusal, a cut-off answer or a full context
 *   ends the session with a short code, never with free text
 * - No fallback to another model on a refusal: it would replay a conversation whose thinking
 *   blocks the other model cannot read. The session ends as `refused`, and the president can
 *   start it again
 */
import type { db as defaultDb } from '@/lib/db/client';
import { aiEmployeeSessions, aiEmployees } from '@/lib/db/schema';
import {
  CLAUDE_MODEL,
  consumeAiCalls,
  createClaudeMessage,
  isMisconfiguredClaudeError,
  reportClaudeFailure,
} from '@/lib/features/ai/service';
import type Anthropic from '@anthropic-ai/sdk';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { AiEmployeeSessionKind, AiEmployeeSessionStatus } from '../types/training';
import { type MemoryNotes, netChanges, runMemoryCommand } from './memory';
import { loadNotes, saveNoteChanges } from './memory-store';
import { reminderMessage, systemPrompt } from './prompts';
import { REPORT_SCHEMAS, REPORT_TOOLS } from './reports';

type Database = typeof defaultDb;

/** Calls of Claude one session may make, counting calls that failed */
export const AGENT_MAX_STEPS = 12;
/** Output tokens one session may use in all (a step may not start past it) */
export const AGENT_MAX_OUTPUT_TOKENS = 40_000;
/** The longest answer of one call: notes are short, and the call must end within its timeout */
export const AGENT_STEP_MAX_TOKENS = 4_000;
/** Writing notes and a report is not hard reasoning; a low effort keeps a call short */
export const AGENT_EFFORT = 'low' as const;
/** How long a step holds its session: longer than a function may run */
export const STEP_LOCK_MS = 40_000;
/** Reminders to hand in the report before the session gives up */
export const MAX_REMINDERS = 2;
/**
 * Longest wait for one call: the function stops at 30 seconds (vercel.json maxDuration), and the
 * lock, the limits and the save take the rest. The same as the other AI calls (client.ts)
 */
export const AGENT_CALL_TIMEOUT_MS = 20_000;

const MEMORY_TOOL: Anthropic.MemoryTool20250818 = { type: 'memory_20250818', name: 'memory' };

/**
 * Whether the AI employees may work as Claude agents (AI_EMPLOYEE_AGENT_ENABLED=true). Off in
 * production until the legal and information systems departments have agreed (#1114)
 */
export function agentEnabled(value = process.env.AI_EMPLOYEE_AGENT_ENABLED): boolean {
  return value === 'true';
}

/** One call of Claude; replaced in the tests */
export type ClaudeCall = (
  params: Anthropic.MessageCreateParamsNonStreaming,
  scope: { operation: 'ai-employee-onboarding' | 'ai-employee-review'; organizationId: string }
) => Promise<Anthropic.Message>;

const defaultCall: ClaudeCall = (params, scope) =>
  createClaudeMessage(params, scope, { timeoutMs: AGENT_CALL_TIMEOUT_MS });

export type StepOutcome =
  /** One step was made and the session runs on: ask for the next */
  | { state: 'running' }
  /** The employee handed in its report: the president answers */
  | { state: 'waiting' }
  | { state: 'failed'; resultCode: string }
  /** Another step holds the session right now */
  | { state: 'busy' }
  /** A passing failure (busy API, timeout): nothing was saved, try again */
  | { state: 'retry' }
  /** The employee is paused: it does not work */
  | { state: 'paused' }
  /** The agents are switched off: nothing is sent to Claude, even for a running session */
  | { state: 'disabled' }
  /** The session is not running (handed in, over) */
  | { state: 'closed'; status: AiEmployeeSessionStatus };

const OPERATION: Readonly<
  Record<AiEmployeeSessionKind, 'ai-employee-onboarding' | 'ai-employee-review'>
> = {
  onboarding: 'ai-employee-onboarding',
  review: 'ai-employee-review',
};

/** The request of one step: fixed parts first, so the prompt cache keeps them */
export function stepRequest(
  kind: AiEmployeeSessionKind,
  messages: Anthropic.MessageParam[]
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: CLAUDE_MODEL,
    max_tokens: AGENT_STEP_MAX_TOKENS,
    system: [{ type: 'text', text: systemPrompt(kind), cache_control: { type: 'ephemeral' } }],
    tools: [MEMORY_TOOL, REPORT_TOOLS[kind]],
    messages,
    output_config: { effort: AGENT_EFFORT },
  };
}

/** What the tools Claude asked for do to the notes, and what Claude reads back */
export function runTools(
  kind: AiEmployeeSessionKind,
  content: readonly Anthropic.ContentBlock[],
  notes: MemoryNotes
): {
  results: Anthropic.ToolResultBlockParam[];
  notes: MemoryNotes;
  report: Record<string, unknown> | null;
} {
  const results: Anthropic.ToolResultBlockParam[] = [];
  let current = notes;
  let report: Record<string, unknown> | null = null;
  for (const block of content) {
    if (block.type !== 'tool_use') continue;
    if (block.name === MEMORY_TOOL.name) {
      const outcome = runMemoryCommand(current, block.input);
      current = outcome.notes;
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: outcome.result,
        ...(outcome.isError ? { is_error: true } : {}),
      });
    } else if (block.name === REPORT_TOOLS[kind].name) {
      const parsed = REPORT_SCHEMAS[kind].safeParse(block.input);
      if (parsed.success) {
        report = parsed.data;
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'Handed in. The president will read it and answer.',
        });
      } else {
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          is_error: true,
          content: `Error: the report was not accepted: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
            .join('; ')}`,
        });
      }
    } else {
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        is_error: true,
        content: `Error: there is no tool named ${block.name}.`,
      });
    }
  }
  return { results, notes: current, report };
}

/** How many reminders the conversation already holds */
function remindersSent(kind: AiEmployeeSessionKind, messages: Anthropic.MessageParam[]): number {
  const text = reminderMessage(kind);
  return messages.filter((message) => message.role === 'user' && message.content === text).length;
}

const STOPPED: Partial<Record<Anthropic.StopReason, string>> = {
  refusal: 'refused',
  max_tokens: 'max_tokens',
  model_context_window_exceeded: 'context_full',
};

/**
 * Moves a running session one step. Null when the organization has no such session. Throws
 * TOO_MANY_REQUESTS when the AI limits are used up (nothing is saved, the lock is let go).
 */
export async function advanceSession(
  db: Database,
  input: {
    organizationId: string;
    sessionId: string;
    userId: string;
    now?: Date;
    call?: ClaudeCall;
  }
): Promise<StepOutcome | null> {
  const now = input.now ?? new Date();
  const call = input.call ?? defaultCall;
  // The switch stops what is running too: once it is off, no step calls Claude
  if (!agentEnabled()) return { state: 'disabled' };

  const [found] = await db
    .select({ status: aiEmployeeSessions.status, employeeStatus: aiEmployees.status })
    .from(aiEmployeeSessions)
    .innerJoin(aiEmployees, eq(aiEmployees.id, aiEmployeeSessions.employeeId))
    .where(
      and(
        eq(aiEmployeeSessions.id, input.sessionId),
        eq(aiEmployeeSessions.organizationId, input.organizationId),
        eq(aiEmployees.organizationId, input.organizationId)
      )
    );
  if (!found) return null;
  if (found.status !== 'running') {
    return { state: 'closed', status: found.status as AiEmployeeSessionStatus };
  }
  if (found.employeeStatus === 'paused') return { state: 'paused' };

  // The lock, and the step counted, in one statement: two tabs never make the same step
  const lockUntil = new Date(now.getTime() + STEP_LOCK_MS);
  const [session] = await db
    .update(aiEmployeeSessions)
    .set({ lockedUntil: lockUntil, steps: sql`${aiEmployeeSessions.steps} + 1`, updatedAt: now })
    .where(
      and(
        eq(aiEmployeeSessions.id, input.sessionId),
        eq(aiEmployeeSessions.organizationId, input.organizationId),
        eq(aiEmployeeSessions.status, 'running'),
        or(isNull(aiEmployeeSessions.lockedUntil), lt(aiEmployeeSessions.lockedUntil, now))
      )
    )
    .returning();
  if (!session) return { state: 'busy' };

  const kind = session.kind as AiEmployeeSessionKind;
  const scope = { organizationId: input.organizationId, employeeId: session.employeeId };
  const held = and(
    eq(aiEmployeeSessions.id, session.id),
    eq(aiEmployeeSessions.organizationId, input.organizationId),
    eq(aiEmployeeSessions.lockedUntil, lockUntil)
  );
  const finish = async (resultCode: string): Promise<StepOutcome> => {
    await db
      .update(aiEmployeeSessions)
      .set({ status: 'failed', resultCode, lockedUntil: null, finishedAt: now, updatedAt: now })
      .where(held);
    return { state: 'failed', resultCode };
  };
  const letGo = async (uncount: boolean) => {
    await db
      .update(aiEmployeeSessions)
      .set({
        lockedUntil: null,
        ...(uncount ? { steps: sql`${aiEmployeeSessions.steps} - 1` } : {}),
      })
      .where(held);
  };

  if (session.steps > AGENT_MAX_STEPS) return finish('step_limit');
  if (session.outputTokens >= AGENT_MAX_OUTPUT_TOKENS) return finish('token_limit');

  try {
    await consumeAiCalls(db, {
      userId: input.userId,
      organizationId: input.organizationId,
      calls: 1,
    });
  } catch (error) {
    await letGo(true);
    throw error;
  }

  const messages = session.messages as Anthropic.MessageParam[];
  let message: Anthropic.Message;
  try {
    message = await call(stepRequest(kind, messages), {
      operation: OPERATION[kind],
      organizationId: input.organizationId,
    });
  } catch (error) {
    console.error('AI employee agent step failed', {
      sessionId: session.id,
      kind,
      status: (error as { status?: unknown } | null)?.status ?? null,
    });
    if (isMisconfiguredClaudeError(error)) {
      await reportClaudeFailure(OPERATION[kind], error);
      return finish('claude_error');
    }
    await letGo(false);
    return { state: 'retry' };
  }

  const usage = {
    inputTokens: sql`${aiEmployeeSessions.inputTokens} + ${message.usage.input_tokens}`,
    outputTokens: sql`${aiEmployeeSessions.outputTokens} + ${message.usage.output_tokens}`,
    cacheReadTokens: sql`${aiEmployeeSessions.cacheReadTokens} + ${message.usage.cache_read_input_tokens ?? 0}`,
    cacheWriteTokens: sql`${aiEmployeeSessions.cacheWriteTokens} + ${message.usage.cache_creation_input_tokens ?? 0}`,
    model: message.model || CLAUDE_MODEL,
  };

  const stopped = message.stop_reason ? STOPPED[message.stop_reason] : undefined;
  if (stopped) {
    await db
      .update(aiEmployeeSessions)
      .set({
        ...usage,
        status: 'failed',
        resultCode: stopped,
        lockedUntil: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(held);
    return { state: 'failed', resultCode: stopped };
  }

  const assistant: Anthropic.MessageParam = { role: 'assistant', content: message.content };
  const notes = await loadNotes(db, scope);
  let appended: Anthropic.MessageParam[];
  let status: AiEmployeeSessionStatus = 'running';
  let resultCode: string | null = null;
  let report: Record<string, unknown> | null = null;
  let after: MemoryNotes = notes;

  if (message.stop_reason === 'tool_use') {
    const ran = runTools(kind, message.content, notes);
    after = ran.notes;
    appended = [assistant, { role: 'user', content: ran.results }];
    if (ran.report) {
      report = ran.report;
      status = 'waiting';
    }
  } else if (message.stop_reason === 'pause_turn') {
    appended = [assistant];
  } else if (remindersSent(kind, messages) >= MAX_REMINDERS) {
    appended = [assistant];
    status = 'failed';
    resultCode = 'no_report';
  } else {
    appended = [assistant, { role: 'user', content: reminderMessage(kind) }];
  }

  const changes = netChanges(notes, after);
  const saved = await db.transaction(async (tx) => {
    // The step must still hold the session (not cancelled meanwhile): else nothing is kept
    const [kept] = await tx
      .update(aiEmployeeSessions)
      .set({
        ...usage,
        messages: [...messages, ...appended],
        status,
        resultCode,
        ...(report ? { report } : {}),
        lockedUntil: null,
        updatedAt: now,
        ...(status === 'failed' ? { finishedAt: now } : {}),
      })
      .where(and(held, eq(aiEmployeeSessions.status, 'running')))
      .returning({ id: aiEmployeeSessions.id });
    if (!kept) return false;
    await saveNoteChanges(tx, scope, changes, { kind: 'agent', sessionId: session.id }, now);
    return true;
  });
  if (!saved) return { state: 'closed', status: 'cancelled' };

  if (status === 'failed') return { state: 'failed', resultCode: resultCode ?? 'failed' };
  return status === 'waiting' ? { state: 'waiting' } : { state: 'running' };
}
