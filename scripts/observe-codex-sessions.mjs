import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  closeSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

// This observer is deliberately a read-only fallback for Codex Desktop sessions.
// It never executes a Codex hook and never reads a session file from its start after
// its first bounded tail. Only structural event metadata is copied into the office
// inbox; prompts, messages, tool inputs, and outputs never leave the source JSONL.
const MAX_CANDIDATES = 24;
const MAX_STATE_FILES = 64;
const MAX_READ_BYTES = 192 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
const RECENT_FILE_MS = 15 * 60_000;
const STATE_SCHEMA_VERSION = 2;

const now = Date.now();
const userRoot = process.env.USERPROFILE || process.env.HOME || '';
const sessionRoot = process.env.CODEX_SESSION_ROOT || join(userRoot, '.codex', 'sessions');
const dataDirectory = process.env.AI_OFFICE_DATA_DIR
  || join(process.env.LOCALAPPDATA || userRoot, 'AIOfficeDollhouse');
const statePath = process.env.AI_OFFICE_OBSERVER_STATE_PATH
  || join(dataDirectory, 'codex-session-observer.json');

function hash(value, length = 32) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function readState() {
  try {
    const value = JSON.parse(readFileSync(statePath, 'utf8'));
    if (value?.schemaVersion !== STATE_SCHEMA_VERSION || typeof value?.files !== 'object' || !value.files) {
      return { schemaVersion: STATE_SCHEMA_VERSION, files: {} };
    }
    // State is deliberately keyed by the same opaque session hash that reaches the
    // inbox. A v1 state file used source paths as keys; treating it as a fresh,
    // bounded tail is safer than carrying raw session IDs forward.
    const files = {};
    for (const [key, entry] of Object.entries(value.files)) {
      if (!/^[a-f0-9]{24}$/.test(key)
        || !Number.isSafeInteger(Number(entry?.offset))
        || Number(entry.offset) < 0) continue;
      // Keep the observer cursor state deliberately small and opaque. In particular,
      // do not carry arbitrary fields forward from a malformed or older state file.
      files[key] = {
        offset: Number(entry.offset),
        seenAt: Number.isFinite(Number(entry?.seenAt)) ? Number(entry.seenAt) : 0,
        modifiedAt: Number.isFinite(Number(entry?.modifiedAt)) ? Number(entry.modifiedAt) : 0,
        pendingOwnerInput: Boolean(entry?.pendingOwnerInput)
      };
    }
    return { schemaVersion: STATE_SCHEMA_VERSION, files };
  } catch {
    return { schemaVersion: STATE_SCHEMA_VERSION, files: {} };
  }
}

function writeState(state) {
  const newest = Object.entries(state.files)
    .sort(([, left], [, right]) => Number(right?.seenAt || 0) - Number(left?.seenAt || 0))
    .slice(0, MAX_STATE_FILES);
  mkdirSync(dataDirectory, { recursive: true });
  const temporary = `${statePath}.tmp`;
  writeFileSync(temporary, JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, files: Object.fromEntries(newest) }), 'utf8');
  try { renameSync(temporary, statePath); } catch { writeFileSync(statePath, JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, files: Object.fromEntries(newest) }), 'utf8'); }
}

function dateFolders() {
  const output = new Set();
  for (const delta of [0, -1]) {
    const date = new Date(now + delta * 24 * 60 * 60_000);
    output.add(join(
      sessionRoot,
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ));
  }
  return [...output];
}

function candidates() {
  const output = [];
  for (const folder of dateFolders()) {
    if (!existsSync(folder)) continue;
    let entries = [];
    try { entries = readdirSync(folder, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !/^rollout-.*\.jsonl$/i.test(entry.name)) continue;
      const path = join(folder, entry.name);
      try {
        const stats = statSync(path);
        if (stats.size <= 0 || now - stats.mtimeMs > RECENT_FILE_MS) continue;
        output.push({ path, size: stats.size, modifiedAt: stats.mtimeMs });
      } catch { /* the active writer may rotate a file between listing and stat */ }
    }
  }
  return output.sort((left, right) => right.modifiedAt - left.modifiedAt).slice(0, MAX_CANDIDATES);
}

function readSegment(path, start, end) {
  const count = Math.max(0, end - start);
  if (!count) return Buffer.alloc(0);
  const buffer = Buffer.alloc(count);
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    const read = readSync(descriptor, buffer, 0, count, start);
    return buffer.subarray(0, read);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function startsPartialLine(path, start) {
  if (start <= 0) return false;
  try { return readSegment(path, start - 1, start).toString('utf8') !== '\n'; } catch { return true; }
}

function sessionIdFor(path) {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(path);
  // Match the hook relay's opaque key when both observation paths see the same
  // Desktop session. Tier-B local evidence can then supplement, never duplicate,
  // a Tier-A hook record.
  return hash(`codex:${match?.[1] || path}`, 24);
}

function parsedRows(buffer, discardPartialFirst) {
  const lastNewline = buffer.lastIndexOf(0x0a);
  if (lastNewline < 0) return { rows: [], consumedBytes: 0 };
  const rows = [];
  let lineStart = 0;
  let discard = discardPartialFirst;
  while (lineStart <= lastNewline) {
    const newline = buffer.indexOf(0x0a, lineStart);
    if (newline < 0 || newline > lastNewline) break;
    const lineEnd = newline > lineStart && buffer[newline - 1] === 0x0d ? newline - 1 : newline;
    const line = buffer.subarray(lineStart, lineEnd);
    if (!discard && line.length && line.length <= MAX_LINE_BYTES) {
      try { rows.push({ row: JSON.parse(line.toString('utf8')), relativeOffset: lineStart }); } catch { /* malformed source rows are ignored */ }
    }
    discard = false;
    lineStart = newline + 1;
  }
  // Do not move the cursor past a trailing partial row. The next bounded read
  // starts at that row's first byte, so no real turn_context can be lost.
  return { rows, consumedBytes: lastNewline + 1 };
}

function timestampFor(row) {
  const parsed = Date.parse(String(row?.timestamp || ''));
  return Number.isFinite(parsed) ? parsed : now;
}

function toolName(value) {
  const compact = String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 30);
  return compact || '';
}

// These names are direct structural facts: the observer never reads a tool's input
// or output to decide what work it represents.  A command that explicitly names its
// action may animate that action, but a generic command is never upgraded into a
// result that it did not name.
const DIRECT_TOOL_EVENTS = new Map([
  ['collaboration.spawn_agent', 'delegation_requested'],
  ['collaboration.followup_task', 'delegation_requested'],
  ['collaboration.send_message', 'coordination_message'],
  ['spawn_agent', 'delegation_requested'],
  ['followup_task', 'delegation_requested'],
  ['send_message', 'coordination_message'],
  ['acting_lead_handoff', 'acting_lead_handoff'],
  ['lead_handoff', 'acting_lead_handoff'],
  ['discussion_started', 'discussion_started'],
  ['start_discussion', 'discussion_started'],
  ['meeting_started', 'meeting_started'],
  ['start_meeting', 'meeting_started'],
  ['revision_requested', 'revision_requested'],
  ['request_revision', 'revision_requested'],
  ['review_passed', 'review_passed'],
  ['review_approved', 'review_passed'],
  ['approve_review', 'review_passed'],
  ['delegated_decision_granted', 'delegated_decision_granted'],
  ['delegated_authority_granted', 'delegated_decision_granted'],
  ['authority_granted', 'delegated_decision_granted'],
  ['decision_recorded', 'decision_recorded']
]);

function directToolEvent(name) {
  const normalized = toolName(name).toLowerCase();
  const aliases = [normalized];
  for (const prefix of ['functions.', 'collaboration.']) {
    if (normalized.startsWith(prefix)) aliases.push(normalized.slice(prefix.length));
  }
  if (aliases.includes('request_user_input')) {
    return 'owner_input_required';
  }
  return aliases.map((alias) => DIRECT_TOOL_EVENTS.get(alias)).find(Boolean) || '';
}

function directMessageEvent(row, payloadType, ownerInputPending) {
  if (row?.type !== 'event_msg') return '';
  if (payloadType === 'task_started') return 'task_started';
  if (payloadType === 'task_complete') return 'task_completed';
  if (['task_failed', 'task_aborted', 'turn_aborted'].includes(payloadType)) return 'task_interrupted';
  if (payloadType === 'patch_apply_end') return 'patch_apply_ended';
  // A user_message proves an Owner response only after the same opaque session
  // directly requested it. A normal user prompt must remain an ordinary turn.
  if (payloadType === 'user_message' && ownerInputPending) return 'owner_input_received';
  if (payloadType === 'agent_message') return 'turn_completed';
  return '';
}

function sourceEvidenceFor(eventType) {
  const direct = {
    task_started: 'session:task_started',
    task_completed: 'session:task_completed',
    task_interrupted: 'session:task_interrupted',
    owner_input_required: 'session:owner_input_required',
    owner_input_received: 'session:owner_input_received',
    delegation_requested: 'session:delegation_requested',
    coordination_message: 'session:coordination_message',
    patch_apply_ended: 'session:patch_apply_ended',
    acting_lead_handoff: 'session:acting_lead_handoff',
    discussion_started: 'session:discussion_started',
    discussion_ended: 'session:discussion_ended',
    meeting_started: 'session:meeting_started',
    meeting_completed: 'session:meeting_completed',
    revision_requested: 'session:revision_requested',
    review_passed: 'session:review_passed',
    delegated_decision_granted: 'session:delegated_decision_granted',
    decision_recorded: 'session:decision_recorded'
  };
  return direct[eventType] || 'session:lifecycle';
}

function eventForRow(row, context) {
  const payload = row?.payload || {};
  const payloadType = String(payload.type || '').toLowerCase();
  const eventBase = {
    schemaVersion: 1,
    timestamp: timestampFor(row),
    provider: 'codex',
    surfaceId: 'codex:local-session',
    surfaceKind: 'local-session',
    sessionId: context.sessionId,
    agentId: null,
    parentAgentId: null,
    taskLabel: 'Codex 工作',
    role: 'main-app',
    observationTier: 'B',
    sourceConfidence: 'local_session_record',
    animationEligible: context.animationEligible !== false,
    important: false
  };
  let eventType = '';
  let observedTool = '';
  if (row?.type === 'turn_context') eventType = 'turn_started';
  else if (payloadType === 'custom_tool_call' || payloadType === 'function_call') {
    observedTool = toolName(payload.name);
    eventType = directToolEvent(observedTool) || 'tool_started';
  } else if (payloadType === 'custom_tool_call_output' || payloadType === 'function_call_output') {
    eventType = 'tool_finished';
  } else eventType = directMessageEvent(row, payloadType, Boolean(context.ownerInputPending));
  if (!eventType) return null;
  return {
    ...eventBase,
    eventId: hash(`codex-session-observer|${context.path}|${context.offset}|${eventType}`),
    eventType,
    sourceEvidence: sourceEvidenceFor(eventType),
    toolName: observedTool
  };
}

function updateFileContext(context, event) {
  if (!event) return;
  if (event.eventType === 'owner_input_required') context.ownerInputPending = true;
  if (['owner_input_received', 'task_completed', 'task_interrupted', 'session_stopped'].includes(event.eventType)) {
    context.ownerInputPending = false;
  }
}

function observedEvent(candidate) {
  return {
    schemaVersion: 1,
    eventId: hash(`codex-session-observer|${candidate.path}|observed|${candidate.size}`),
    timestamp: candidate.modifiedAt,
    provider: 'codex',
    surfaceId: 'codex:local-session',
    surfaceKind: 'local-session',
    sessionId: sessionIdFor(candidate.path),
    agentId: null,
    parentAgentId: null,
    eventType: 'session_observed',
    taskLabel: 'Codex 工作',
    role: 'main-app',
    toolName: '',
    observationTier: 'B',
    sourceConfidence: 'local_session_record',
    sourceEvidence: 'session:observed',
    important: false
  };
}

function initialTailEvents(candidate, rows, start, context) {
  const observation = observedEvent(candidate);
  const latest = [...rows].reverse().map(({ row, relativeOffset }) => eventForRow(row, {
    path: candidate.path,
    offset: start + relativeOffset,
    sessionId: sessionIdFor(candidate.path),
    ownerInputPending: context.ownerInputPending,
    // A pre-existing transcript is a state seed. Even a true historical completion
    // must not replay a big delivery animation when the overlay first sees it.
    animationEligible: false
  })).find(Boolean);
  if (!latest) return [observation];
  // First contact is a state seed only. Never manufacture a preceding turn for
  // an old tool row: that would replay an animation the observer did not see.
  return [observation, latest];
}

function rotateIfNeeded(path, maximumBytes) {
  try {
    if (!existsSync(path) || statSync(path).size <= maximumBytes) return;
    const archive = path.replace(/\.ndjson$/i, '.1.ndjson');
    try { if (existsSync(archive)) writeFileSync(archive, '', 'utf8'); } catch { /* normal append remains available */ }
    try { renameSync(path, archive); } catch { /* do not disrupt a concurrent hook writer */ }
  } catch { /* observation is fail-open */ }
}

function appendEvents(events) {
  if (!events.length) return;
  mkdirSync(dataDirectory, { recursive: true });
  const serialized = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
  // Tier-B local observations are for the bounded live inbox, not the durable
  // hook ledger. This keeps them visibly separate from structured hook evidence.
  const target = join(dataDirectory, 'live-events.ndjson');
  rotateIfNeeded(target, 512 * 1024);
  appendFileSync(target, serialized, 'utf8');
}

const state = readState();
const emitted = [];
let observedSessions = 0;

for (const candidate of candidates()) {
  const sessionId = sessionIdFor(candidate.path);
  const previous = state.files[sessionId];
  const firstSeen = !previous;
  const previousOffset = Math.max(0, Number(previous?.offset || 0));
  const reset = previousOffset > candidate.size;
  const start = firstSeen || reset
    ? Math.max(0, candidate.size - MAX_READ_BYTES)
    : Math.min(previousOffset, candidate.size);
  const readEnd = Math.min(candidate.size, start + MAX_READ_BYTES);
  let bytes;
  try { bytes = readSegment(candidate.path, start, readEnd); } catch { continue; }
  const parsed = parsedRows(bytes, startsPartialLine(candidate.path, start));
  const end = start + parsed.consumedBytes;
  const context = {
    path: candidate.path,
    sessionId,
    ownerInputPending: Boolean(previous?.pendingOwnerInput),
    animationEligible: !(firstSeen || reset)
  };
  if (firstSeen || reset) {
    // A pre-existing transcript is evidence of its current last state, not a
    // permission to replay its historical work as a fresh animation sequence.
    const initial = initialTailEvents(candidate, parsed.rows, start, context);
    emitted.push(...initial);
    for (const event of initial) updateFileContext(context, event);
  } else {
    for (const { row, relativeOffset } of parsed.rows) {
      const event = eventForRow(row, { ...context, offset: start + relativeOffset });
      if (event) {
        emitted.push(event);
        updateFileContext(context, event);
      }
    }
  }
  state.files[sessionId] = {
    offset: end,
    seenAt: now,
    modifiedAt: candidate.modifiedAt,
    pendingOwnerInput: context.ownerInputPending
  };
  observedSessions += 1;
}

appendEvents(emitted);
writeState(state);
process.stdout.write(`${JSON.stringify({ ok: true, emitted: emitted.length, observedSessions })}\n`);
