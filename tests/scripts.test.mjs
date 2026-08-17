import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  appendFileSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastJsonLine } from '../resources/js/native-bridge.js';
import { applyOfficeEvent, createInitialState } from '../resources/js/domain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function runScript(name, args = [], options = {}) {
  return spawnSync(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(root, 'scripts', name), ...args
  ], { cwd: root, encoding: 'utf8', ...options });
}

function runCodexSessionObserver(options = {}) {
  return spawnSync(process.execPath, [join(root, 'scripts', 'observe-codex-sessions.mjs')], {
    cwd: root,
    encoding: 'utf8',
    ...options
  });
}

test('lastJsonLine ignores harmless leading output', () => {
  assert.deepEqual(lastJsonLine('notice\n{"ok":true}\n'), { ok: true });
});

test('release bundle keeps only the approved no-person scene plates', () => {
  const config = JSON.parse(readFileSync(join(root, 'neutralino.config.json'), 'utf8'));
  const excluded = new RegExp(config.cli.resourcesExclude);
  assert.equal(excluded.test('resources/scenes/first-floor-transparent.png'), true,
    'temporary scene studies with static people must never enter the native bundle');
  assert.equal(excluded.test('resources/scenes/first-floor-static.png'), false,
    'the approved no-person scene plate must remain in the native bundle');
  assert.equal(existsSync(join(root, 'resources', 'scenes', 'first-floor-static.png')), true);
  assert.equal(existsSync(join(root, 'resources', 'scenes', 'execution-floor-static.png')), true);
});

test('Codex session observer is private, incremental, and does not replay an existing transcript', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ai-office-codex-session-observer-'));
  const sessionRoot = join(temporaryRoot, 'sessions');
  const dataDirectory = join(temporaryRoot, 'data');
  const today = new Date();
  const folder = join(sessionRoot, String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0'));
  const rawSessionId = '019ff9cc-9f67-7610-a107-604fcef9bbbd';
  const sessionPath = join(folder, `rollout-2026-08-17T00-00-00-${rawSessionId}.jsonl`);
  const rawPrompt = 'OBSERVER_PROMPT_MUST_NOT_LEAK';
  const rawOutput = 'OBSERVER_TOOL_OUTPUT_MUST_NOT_LEAK';
  mkdirSync(folder, { recursive: true });
  writeFileSync(sessionPath, [
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'session_meta', payload: { session_id: 'never-store-this-id', cwd: 'C:\\Private\\Workspace', prompt: rawPrompt } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'turn_context', payload: { prompt: rawPrompt } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'agent_reasoning', text: rawPrompt } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.exec', input: rawPrompt } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call_output', output: rawOutput } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'agent_message', message: rawOutput } })
  ].join('\n') + '\n', 'utf8');

  const environment = { ...process.env, CODEX_SESSION_ROOT: sessionRoot, AI_OFFICE_DATA_DIR: dataDirectory };
  const first = runCodexSessionObserver({ env: environment });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(lastJsonLine(first.stdout).ok, true);
  const events = readFileSync(join(dataDirectory, 'live-events.ndjson'), 'utf8');
  assert.equal(events.includes(rawPrompt), false);
  assert.equal(events.includes(rawOutput), false);
  assert.equal(events.includes('never-store-this-id'), false);
  assert.equal(events.includes(rawSessionId), false);
  const parsed = events.trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(parsed.some((event) => event.eventType === 'session_observed'));
  assert.equal(parsed.filter((event) => event.eventType === 'session_observed').length, 1);
  assert.equal(parsed.filter((event) => event.eventType === 'turn_completed').length, 1,
    'an existing transcript seeds only its latest state instead of replaying old work');
  assert.ok(parsed.some((event) => event.eventType === 'turn_completed'));
  assert.ok(parsed.every((event) => event.observationTier === 'B'));
  assert.ok(parsed.every((event) => event.sourceConfidence === 'local_session_record'));
  assert.ok(parsed.every((event) => /^[a-f0-9]{24}$/.test(event.sessionId)));
  const relayCompatibleId = createHash('sha256').update(`codex:${rawSessionId}`).digest('hex').slice(0, 24);
  assert.ok(parsed.every((event) => event.sessionId === relayCompatibleId),
    'the read-only observer must use the same opaque key as a real Codex hook');
  assert.equal(existsSync(join(dataDirectory, 'events.ndjson')), false,
    'Tier-B local observation must not write into the structured hook ledger');
  const observerState = readFileSync(join(dataDirectory, 'codex-session-observer.json'), 'utf8');
  assert.equal(observerState.includes(rawPrompt), false);
  assert.equal(observerState.includes(rawOutput), false);
  assert.equal(observerState.includes(rawSessionId), false);
  const state = JSON.parse(observerState);
  assert.equal(state.schemaVersion, 2);
  assert.ok(Object.keys(state.files).every((key) => /^[a-f0-9]{24}$/.test(key)));

  const second = runCodexSessionObserver({ env: environment });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(lastJsonLine(second.stdout).emitted, 0, 'unchanged session bytes are never replayed');

  const turnContext = JSON.stringify({ timestamp: new Date().toISOString(), type: 'turn_context', payload: { prompt: rawPrompt } });
  const splitAt = Math.floor(turnContext.length / 2);
  appendFileSync(sessionPath, turnContext.slice(0, splitAt), 'utf8');
  const partial = runCodexSessionObserver({ env: environment });
  assert.equal(partial.status, 0, partial.stderr);
  assert.equal(lastJsonLine(partial.stdout).emitted, 0, 'a partial NDJSON row must remain pending');

  appendFileSync(sessionPath, `${turnContext.slice(splitAt)}\n`, 'utf8');
  const completedRow = runCodexSessionObserver({ env: environment });
  assert.equal(completedRow.status, 0, completedRow.stderr);
  assert.equal(lastJsonLine(completedRow.stdout).emitted, 1,
    'the completed turn_context must be read from its first byte, not discarded');
  const afterTurnStart = readFileSync(join(dataDirectory, 'live-events.ndjson'), 'utf8')
    .trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(afterTurnStart.at(-1).eventType, 'turn_started');

  appendFileSync(sessionPath, [
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'agent_reasoning', text: rawPrompt } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.exec', input: rawPrompt } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call_output', output: rawOutput } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'agent_message', message: rawOutput } })
  ].join('\n') + '\n', 'utf8');
  const third = runCodexSessionObserver({ env: environment });
  assert.equal(third.status, 0, third.stderr);
  assert.equal(lastJsonLine(third.stdout).emitted, 3,
    'agent_reasoning is not a new turn; only the actual structural rows are observed');
  const afterAppend = readFileSync(join(dataDirectory, 'live-events.ndjson'), 'utf8');
  assert.equal(afterAppend.includes(rawPrompt), false);
  const appended = afterAppend.trim().split(/\r?\n/).map(JSON.parse).slice(-3);
  assert.deepEqual(appended.map((event) => event.eventType), ['tool_started', 'tool_finished', 'turn_completed']);
  assert.equal(appended[0].toolName, 'functions.exec');
});

test('Codex session observer seeds one last tool state without a synthetic historical turn', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ai-office-codex-initial-state-'));
  const sessionRoot = join(temporaryRoot, 'sessions');
  const dataDirectory = join(temporaryRoot, 'data');
  const today = new Date();
  const folder = join(sessionRoot, String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0'));
  const sessionPath = join(folder, 'rollout-2026-08-17T00-00-00-119ff9cc-9f67-7610-a107-604fcef9bbbd.jsonl');
  mkdirSync(folder, { recursive: true });
  writeFileSync(sessionPath, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: { type: 'custom_tool_call', name: 'functions.exec', input: 'MUST_NOT_LEAK' }
  })}\n`, 'utf8');

  const result = runCodexSessionObserver({
    env: { ...process.env, CODEX_SESSION_ROOT: sessionRoot, AI_OFFICE_DATA_DIR: dataDirectory }
  });
  assert.equal(result.status, 0, result.stderr);
  const events = readFileSync(join(dataDirectory, 'live-events.ndjson'), 'utf8')
    .trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(events.map((event) => event.eventType), ['session_observed', 'tool_started']);
  assert.equal(events.some((event) => event.eventType === 'turn_started'), false,
    'the observer must never fabricate a prior turn merely to animate an old tool row');
});

test('Codex session observer maps only direct metadata to special Tier-B cues and silences initial history', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ai-office-codex-direct-cues-'));
  const sessionRoot = join(temporaryRoot, 'sessions');
  const dataDirectory = join(temporaryRoot, 'data');
  const today = new Date();
  const folder = join(sessionRoot, String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0'));
  const sessionPath = join(folder, 'rollout-2026-08-17T00-00-00-229ff9cc-9f67-7610-a107-604fcef9bbbd.jsonl');
  const privateText = 'SPECIAL_CUE_CONTENT_MUST_NOT_LEAK';
  mkdirSync(folder, { recursive: true });
  writeFileSync(sessionPath, `${JSON.stringify({
    timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_complete', text: privateText }
  })}\n`, 'utf8');

  const environment = { ...process.env, CODEX_SESSION_ROOT: sessionRoot, AI_OFFICE_DATA_DIR: dataDirectory };
  const seeded = runCodexSessionObserver({ env: environment });
  assert.equal(seeded.status, 0, seeded.stderr);
  const seedEvents = readFileSync(join(dataDirectory, 'live-events.ndjson'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(seedEvents.map((event) => event.eventType), ['session_observed', 'task_completed']);
  assert.equal(seedEvents.at(-1).animationEligible, false,
    'a pre-existing task completion may seed delivered state but must not replay J');
  assert.equal(seedEvents.at(-1).sourceEvidence, 'session:task_completed');

  appendFileSync(sessionPath, [
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_started', text: privateText } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'patch_apply_end', text: privateText } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.request_user_input', input: privateText } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'user_message', text: privateText } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'collaboration.followup_task', input: privateText } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'collaboration.send_message', input: privateText } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.lead_handoff', input: privateText } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.start_discussion', input: privateText } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.request_revision', input: privateText } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.review_approved', input: privateText } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.authority_granted', input: privateText } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_failed', text: privateText } })
  ].join('\n') + '\n', 'utf8');

  const observed = runCodexSessionObserver({ env: environment });
  assert.equal(observed.status, 0, observed.stderr);
  const events = readFileSync(join(dataDirectory, 'live-events.ndjson'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const appended = events.slice(seedEvents.length);
  assert.deepEqual(appended.map((event) => event.eventType), [
    'task_started', 'patch_apply_ended', 'owner_input_required', 'owner_input_received',
    'delegation_requested', 'coordination_message', 'acting_lead_handoff', 'discussion_started',
    'revision_requested', 'review_passed', 'delegated_decision_granted', 'task_interrupted'
  ]);
  assert.ok(appended.every((event) => event.observationTier === 'B'
    && event.sourceConfidence === 'local_session_record'
    && event.animationEligible === true));
  assert.deepEqual(appended.map((event) => event.sourceEvidence), [
    'session:task_started', 'session:patch_apply_ended', 'session:owner_input_required',
    'session:owner_input_received', 'session:delegation_requested',
    'session:coordination_message', 'session:acting_lead_handoff', 'session:discussion_started',
    'session:revision_requested', 'session:review_passed', 'session:delegated_decision_granted',
    'session:task_interrupted'
  ]);
  assert.equal(events.some((event) => event.eventType === 'agent_spawned'), false,
    'a collaboration request is never misreported as a successful new agent');
  const stored = readFileSync(join(dataDirectory, 'live-events.ndjson'), 'utf8');
  assert.equal(stored.includes(privateText), false);
  const observerState = readFileSync(join(dataDirectory, 'codex-session-observer.json'), 'utf8');
  assert.equal(observerState.includes(privateText), false);
  assert.equal(Object.values(JSON.parse(observerState).files).some((entry) => entry.pendingOwnerInput), false,
    'a direct same-session user message clears the pending Owner request without retaining its text');
});

test('Codex installs its official hook configuration and keeps the read-only observer as fallback', () => {
  const appInstaller = readFileSync(join(root, 'scripts', 'install-app.ps1'), 'utf8');
  const appMain = readFileSync(join(root, 'resources', 'js', 'main.js'), 'utf8');
  const integrationScript = readFileSync(join(root, 'scripts', 'install-integrations.ps1'), 'utf8');
  assert.match(appInstaller, /@\('codex', 'claude', 'gemini', 'grok'\)/);
  assert.doesNotMatch(appInstaller, /-Provider all -Action install/);
  assert.match(appInstaller, /automaticHookInstallSkipped = \$true/);
  assert.match(appInstaller, /fallbackWhenHookUntrusted = \$true/);
  assert.match(appInstaller, /\[switch\]\$SkipIntegrations/);
  assert.match(appInstaller, /if \(\$SkipIntegrations\)/);
  assert.doesNotMatch(appMain, /item\.provider !== 'codex'/);
  assert.match(appMain, /Codex performs its own normal \/hooks review/);
  assert.match(integrationScript, /Review and trust this hook once in Codex \/hooks\./);
  assert.doesNotMatch(appInstaller, /dangerously-bypass-hook-trust/);
  assert.doesNotMatch(integrationScript, /dangerously-bypass-hook-trust/);
});

test('local packaging preserves earlier release artifacts and visual-test material', () => {
  const packageScript = readFileSync(join(root, 'scripts', 'package-release.ps1'), 'utf8');
  assert.match(packageScript, /\$allowed = @\('\.tmp', 'bin', 'dist'\)/);
  assert.match(packageScript, /foreach \(\$generatedDirectory in @\('\.tmp', 'bin', 'dist'\)\)/);
  assert.doesNotMatch(packageScript, /Remove-ProjectGeneratedDirectory 'release'/);
  assert.doesNotMatch(packageScript, /Remove-ProjectGeneratedDirectory '\.visual-test'/);
});

test('the wordless overlay never exposes verification state as a visible tooltip', () => {
  const appMain = readFileSync(join(root, 'resources', 'js', 'main.js'), 'utf8');
  const appMarkup = readFileSync(join(root, 'resources', 'index.html'), 'utf8');
  assert.match(appMain, /tower\.removeAttribute\('title'\)/);
  assert.doesNotMatch(appMain, /tower\.title\s*=/);
  assert.match(appMarkup, /id="tower-truth" class="sr-only"/);
});

test('discovery returns bounded presence data without task content', { skip: process.platform !== 'win32' }, () => {
  const result = runScript('discover.ps1');
  assert.equal(result.status, 0, result.stderr);
  const payload = lastJsonLine(result.stdout);
  assert.equal(payload.schemaVersion, 1);
  assert.ok(Array.isArray(payload.surfaces));
  assert.ok(payload.surfaces.some((surface) => surface.provider === 'codex'));
  for (const surface of payload.surfaces) {
    assert.equal('processCount' in surface, false);
    assert.equal('commandLine' in surface, false);
  }
});

test('hook relay stores only allowlisted metadata and never raw prompt', { skip: process.platform !== 'win32' }, () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'ai-office-relay-'));
  const rawPrompt = 'TOP_SECRET_PROMPT_MUST_NOT_BE_STORED';
  const input = JSON.stringify({
    session_id: 'session-secret-id',
    hook_event_name: 'SubagentStart',
    cwd: 'C:\\Work\\Safe Project',
    agent_id: 'agent-secret-id',
    agent_type: 'researcher',
    timestamp: '2026-08-09T07:30:00Z',
    prompt: rawPrompt,
    transcript_path: 'C:\\Sensitive\\transcript.jsonl'
  });
  const result = runScript('hook-relay.ps1', ['-Provider', 'codex', '-SurfaceKind', 'auto'], {
    input,
    env: { ...process.env, AI_OFFICE_DATA_DIR: dataDirectory }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '{}');
  const stored = readFileSync(join(dataDirectory, 'events.ndjson'), 'utf8');
  assert.equal(readFileSync(join(dataDirectory, 'live-events.ndjson'), 'utf8'), stored);
  assert.equal(stored.includes(rawPrompt), false);
  assert.equal(stored.includes('transcript.jsonl'), false);
  assert.equal(stored.includes('session-secret-id'), false);
  const event = JSON.parse(stored.trim());
  assert.equal(event.eventType, 'agent_spawned');
  assert.equal(event.sourceEvidence, 'hook:subagent_started');
  assert.equal(event.taskLabel, 'Safe Project');
  assert.match(event.sessionId, /^[a-f0-9]{24}$/);
});

test('compiled hook relay is private, fail-open, and provider-aware', { skip: process.platform !== 'win32' }, () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'ai-office-fast-relay-'));
  const rawPrompt = 'FAST_RELAY_SECRET_MUST_NOT_BE_STORED';
  const relay = join(root, 'scripts', 'relay', 'AIOfficeHookRelay.exe');
  assert.equal(existsSync(relay), true, 'run scripts/build-relay.ps1 first');
  const input = JSON.stringify({
    session_id: 'fast-secret-session',
    hook_event_name: 'UserPromptSubmit',
    cwd: 'C:\\Work\\Office Animation',
    prompt: rawPrompt,
    timestamp: '2026-08-09T07:31:00Z'
  });
  const result = spawnSync(relay, ['codex', 'auto'], {
    cwd: root,
    encoding: 'utf8',
    input,
    env: { ...process.env, AI_OFFICE_DATA_DIR: dataDirectory }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '{}');
  const stored = readFileSync(join(dataDirectory, 'events.ndjson'), 'utf8');
  assert.equal(readFileSync(join(dataDirectory, 'live-events.ndjson'), 'utf8'), stored);
  assert.equal(stored.includes(rawPrompt), false);
  assert.equal(stored.includes('fast-secret-session'), false);
  const event = JSON.parse(stored);
  assert.equal(event.eventType, 'turn_started');
  assert.equal(event.sourceEvidence, 'hook:lifecycle');
});

test('compiled hook relay exits after one JSON line even when stdin stays open', { skip: process.platform !== 'win32' }, async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'ai-office-open-stdin-'));
  const relay = join(root, 'scripts', 'relay', 'AIOfficeHookRelay.exe');
  const child = spawn(relay, ['grok', 'auto'], {
    cwd: root,
    env: { ...process.env, AI_OFFICE_DATA_DIR: dataDirectory },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write(`${JSON.stringify({
    session_id: 'grok-open-pipe',
    hook_event_name: 'SessionStart',
    cwd: 'C:\\Work\\Office Animation'
  })}\n`);
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('relay waited for EOF instead of exiting after one JSON line'));
    }, 1_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(status, 0, stderr);
  assert.equal(stdout, '{}');
  assert.equal(JSON.parse(readFileSync(join(dataDirectory, 'events.ndjson'), 'utf8')).eventType, 'session_started');
});

test('only an explicit completion signal produces task_completed', { skip: process.platform !== 'win32' }, () => {
  const relay = join(root, 'scripts', 'relay', 'AIOfficeHookRelay.exe');
  for (const runner of [
    (input, dataDirectory) => runScript('hook-relay.ps1', ['-Provider', 'codex', '-SurfaceKind', 'auto'], { input, env: { ...process.env, AI_OFFICE_DATA_DIR: dataDirectory } }),
    (input, dataDirectory) => spawnSync(relay, ['codex', 'auto'], { cwd: root, encoding: 'utf8', input, env: { ...process.env, AI_OFFICE_DATA_DIR: dataDirectory } })
  ]) {
    const ordinaryRoot = mkdtempSync(join(tmpdir(), 'ai-office-turn-finish-'));
    const explicitRoot = mkdtempSync(join(tmpdir(), 'ai-office-task-finish-'));
    const ordinary = runner(JSON.stringify({ session_id: 'ordinary', hook_event_name: 'Stop' }), ordinaryRoot);
    const explicit = runner(JSON.stringify({ session_id: 'explicit', hook_event_name: 'Stop', task_completed: true }), explicitRoot);
    assert.equal(ordinary.status, 0, ordinary.stderr);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(JSON.parse(readFileSync(join(ordinaryRoot, 'events.ndjson'), 'utf8')).eventType, 'turn_completed');
    const explicitEvent = JSON.parse(readFileSync(join(explicitRoot, 'events.ndjson'), 'utf8'));
    assert.equal(explicitEvent.eventType, 'task_completed');
    assert.equal(explicitEvent.sourceEvidence, 'hook:task_completed');
  }
});

test('Grok session-end Stop is ignored instead of duplicating turn completion', { skip: process.platform !== 'win32' }, () => {
  const relay = join(root, 'scripts', 'relay', 'AIOfficeHookRelay.exe');
  for (const runner of [
    (input, dataDirectory) => runScript('hook-relay.ps1', ['-Provider', 'grok', '-SurfaceKind', 'auto'], { input, env: { ...process.env, AI_OFFICE_DATA_DIR: dataDirectory } }),
    (input, dataDirectory) => spawnSync(relay, ['grok', 'auto'], { cwd: root, encoding: 'utf8', input, env: { ...process.env, AI_OFFICE_DATA_DIR: dataDirectory } })
  ]) {
    const rootPath = mkdtempSync(join(tmpdir(), 'ai-office-grok-stop-'));
    const ordinary = runner(JSON.stringify({ session_id: 's', hook_event_name: 'Stop', reason: 'end_turn' }), rootPath);
    const ended = runner(JSON.stringify({ session_id: 's', hook_event_name: 'Stop', reason: 'channel_closed' }), rootPath);
    assert.equal(ordinary.status, 0, ordinary.stderr);
    assert.equal(ended.status, 0, ended.stderr);
    const events = readFileSync(join(rootPath, 'events.ndjson'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.deepEqual(events.map((event) => event.eventType), ['turn_completed']);
  }
});

test('hook relays only present subagent stop as terminal when the payload proves an outcome', { skip: process.platform !== 'win32' }, () => {
  const relay = join(root, 'scripts', 'relay', 'AIOfficeHookRelay.exe');
  assert.equal(existsSync(relay), true, 'run scripts/build-relay.ps1 first');
  const cases = [
    { name: 'no outcome', payload: {}, expected: null },
    { name: 'explicit completion', payload: { status: 'completed' }, expected: 'agent_finished' },
    { name: 'explicit success flag', payload: { success: true }, expected: 'agent_finished' },
    { name: 'nonzero exit code', payload: { exit_code: 1 }, expected: 'agent_failed' },
    { name: 'explicit stop', payload: { status: 'stopped' }, expected: 'agent_cancelled' },
    { name: 'explicit cancellation', payload: { status: 'cancelled' }, expected: 'agent_cancelled' },
    { name: 'explicit cancellation with diagnostic', payload: { status: 'cancelled', error: 'cancelled by the Owner' }, expected: 'agent_cancelled' },
    { name: 'explicit error', payload: { error: 'child process ended unexpectedly' }, expected: 'agent_failed' }
  ];
  const runners = [
    {
      name: 'PowerShell fallback',
      run(input, dataDirectory) {
        return runScript('hook-relay.ps1', ['-Provider', 'codex', '-SurfaceKind', 'auto'], {
          input,
          env: { ...process.env, AI_OFFICE_DATA_DIR: dataDirectory }
        });
      }
    },
    {
      name: 'compiled relay',
      run(input, dataDirectory) {
        return spawnSync(relay, ['codex', 'auto'], {
          cwd: root,
          encoding: 'utf8',
          input,
          env: { ...process.env, AI_OFFICE_DATA_DIR: dataDirectory }
        });
      }
    }
  ];

  for (const runner of runners) {
    for (const scenario of cases) {
      const dataDirectory = mkdtempSync(join(tmpdir(), 'ai-office-subagent-stop-'));
      const input = JSON.stringify({
        session_id: `subagent-${scenario.name}`,
        agent_id: 'child-1',
        hook_event_name: 'SubagentStop',
        cwd: 'C:\\Work\\Office Animation',
        ...scenario.payload
      });
      const result = runner.run(input, dataDirectory);
      assert.equal(result.status, 0, `${runner.name}: ${result.stderr}`);
      assert.equal(result.stdout, '{}', runner.name);
      const eventPath = join(dataDirectory, 'events.ndjson');
      if (scenario.expected === null) {
        assert.equal(existsSync(eventPath), false, `${runner.name}: ${scenario.name}`);
      } else {
        const stored = readFileSync(eventPath, 'utf8');
        const event = JSON.parse(stored);
        assert.equal(event.eventType, scenario.expected, `${runner.name}: ${scenario.name}`);
        assert.equal(event.sourceEvidence, {
          agent_finished: 'hook:subagent_finished',
          agent_failed: 'hook:subagent_failed',
          agent_cancelled: 'hook:subagent_cancelled'
        }[scenario.expected], `${runner.name}: ${scenario.name} evidence`);
        if (scenario.payload.error) assert.equal(stored.includes(scenario.payload.error), false, `${runner.name}: ${scenario.name} leaked diagnostic text`);
      }
    }
  }
});

test('a Codex hook-shaped payload survives relay -> domain and becomes a live pod, never a snapshot phantom', { skip: process.platform !== 'win32' }, () => {
  const relay = join(root, 'scripts', 'relay', 'AIOfficeHookRelay.exe');
  assert.equal(existsSync(relay), true, 'run scripts/build-relay.ps1 first');
  const dataDirectory = mkdtempSync(join(tmpdir(), 'ai-office-codex-chain-'));
  const sessionId = 'codex-chain-session';
  const runRelay = (hookEventName, extra = {}) => spawnSync(relay, ['codex', 'auto'], {
    cwd: root,
    encoding: 'utf8',
    input: JSON.stringify({
      session_id: sessionId,
      hook_event_name: hookEventName,
      cwd: 'C:\\Work\\Office Animation',
      timestamp: '2026-08-17T00:00:00Z',
      ...extra
    }),
    env: { ...process.env, AI_OFFICE_DATA_DIR: dataDirectory }
  });

  const started = runRelay('SessionStart');
  assert.equal(started.status, 0, started.stderr);
  const prompted = runRelay('UserPromptSubmit');
  assert.equal(prompted.status, 0, prompted.stderr);

  // This exercises the documented Codex lifecycle payload shape through the
  // compiled relay; nothing here is a synthetic livePod or hand-built domain object.
  const rawEvents = readFileSync(join(dataDirectory, 'live-events.ndjson'), 'utf8')
    .trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(rawEvents.length, 2, 'one relay-emitted event per hook invocation');
  assert.ok(rawEvents.every((relayEvent) => relayEvent.provider === 'codex'));
  assert.ok(rawEvents.every((relayEvent) => relayEvent.observationTier === 'A'),
    'a hook payload must be Tier-A structured evidence, not a process/snapshot guess');

  // The relay never stores the raw session id (see the sibling privacy test above);
  // it emits a one-way hash instead, and that hash is what domain state keys pods by.
  assert.match(rawEvents[0].sessionId, /^[a-f0-9]{24}$/);
  assert.ok(rawEvents.every((relayEvent) => relayEvent.sessionId === rawEvents[0].sessionId),
    'the same real session must hash to the same pod key across both hook calls');

  const state = createInitialState(Date.now());
  for (const relayEvent of rawEvents) applyOfficeEvent(state, relayEvent, relayEvent.timestamp);

  const pod = state.teams.codex.pods[rawEvents[0].sessionId];
  assert.ok(pod, 'the relay -> domain chain must create a live pod keyed by the relay-emitted session id');
  assert.equal(pod.lifecycle, 'active');

  // A snapshot-only entry (Codex's own local chat-history mtime scan, e.g. the
  // "解決拍照煩惱" thread label) never goes through applyOfficeEvent at all, so it
  // can only ever surface as snapshotWork in the UI layer -- it must not be able
  // to appear in state.teams.codex.pods, which is reserved for observed events.
  assert.equal('snapshot-only-phantom' in state.teams.codex.pods, false);
});

test('integration installer backs up and merges idempotently in an isolated root', { skip: process.platform !== 'win32' }, () => {
  const configRoot = mkdtempSync(join(tmpdir(), 'ai-office-config-'));
  // Codex loads user hooks from ~/.codex/hooks.json. Seed it with an unrelated
  // hook to prove the installer merges rather than clobbers.
  const codexPath = join(configRoot, '.codex', 'hooks.json');
  // A prior build incorrectly wrote this app's group beneath the plugin-style
  // nested path. The installer must clean only that app-owned entry from it.
  const legacyCodexPath = join(configRoot, '.codex', 'hooks', 'hooks.json');
  const claudePath = join(configRoot, '.claude', 'settings.json');
  mkdirSync(dirname(codexPath), { recursive: true });
  mkdirSync(dirname(legacyCodexPath), { recursive: true });
  mkdirSync(dirname(claudePath), { recursive: true });
  writeFileSync(codexPath, JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'existing-codex-hook' }] }] }
  }, null, 2));
  writeFileSync(legacyCodexPath, JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'C:\\stale\\AIOfficeHookRelay.exe codex auto' }] }] }
  }, null, 2));
  writeFileSync(claudePath, JSON.stringify({
    permissions: { defaultMode: 'default' },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'existing-safe-hook' }] }] }
  }, null, 2));

  const args = ['-Provider', 'all', '-Action', 'install', '-ConfigRoot', configRoot];
  const first = runScript('install-integrations.ps1', args);
  assert.equal(first.status, 0, first.stderr);
  const firstResult = lastJsonLine(first.stdout);
  assert.equal(firstResult.ok, true);
  const codexResult = firstResult.results.find((item) => item.provider === 'codex');
  assert.match(codexResult.path, /[\\/]\.codex[\\/]hooks\.json$/i);
  assert.equal(codexResult.legacyMigrated, true, 'installer must report that it cleaned the misplaced nested hook file');
  const second = runScript('install-integrations.ps1', args);
  assert.equal(second.status, 0, `${second.stderr}\n${second.stdout}`);

  const claude = JSON.parse(readFileSync(claudePath, 'utf8'));
  const codex = JSON.parse(readFileSync(codexPath, 'utf8'));
  const codexCommands = codex.hooks.SessionStart.flatMap((group) => group.hooks.map((hook) => hook.command));
  assert.ok(codexCommands.includes('existing-codex-hook'));
  assert.equal(codexCommands.filter((command) => command.includes('AIOfficeHookRelay.exe')).length, 1);
  const legacyCodex = JSON.parse(readFileSync(legacyCodexPath, 'utf8'));
  const legacyGroups = legacyCodex.hooks.SessionStart || [];
  const legacyCommands = legacyGroups.flatMap((group) => group.hooks.map((hook) => hook.command));
  assert.equal(legacyCommands.some((command) => command.includes('AIOfficeHookRelay.exe')), false,
    'the misplaced nested hook file must not still claim the integration is installed there');
  const commands = claude.hooks.SessionStart.flatMap((group) => group.hooks.map((hook) => hook.command));
  assert.ok(commands.includes('existing-safe-hook'));
  assert.equal(commands.filter((command) => command.includes('AIOfficeHookRelay.exe')).length, 1);
  const claudeRelayCommand = commands.find((command) => command.includes('AIOfficeHookRelay.exe'));
  assert.match(claudeRelayCommand, /^'\/[a-z]\//, 'Claude Windows hooks need a Git Bash path');
  assert.equal(claudeRelayCommand.includes('\\'), false, 'Bash command must not contain Windows separators');
  assert.equal(existsSync(join(configRoot, '.ai-office-data', 'integration', 'AIOfficeHookRelay.exe')), true);
  const gitBash = join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
  if (existsSync(gitBash)) {
    const eventRoot = join(configRoot, 'bash-event-output');
    const hook = spawnSync(gitBash, ['-lc', claudeRelayCommand], {
      cwd: root,
      encoding: 'utf8',
      input: JSON.stringify({
        session_id: 'claude-bash-path-probe',
        hook_event_name: 'SessionEnd',
        cwd: 'C:\\Work\\Office Animation',
        timestamp: '2026-08-12T00:00:00Z'
      }),
      env: { ...process.env, AI_OFFICE_DATA_DIR: eventRoot }
    });
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(JSON.parse(readFileSync(join(eventRoot, 'events.ndjson'), 'utf8')).eventType, 'session_stopped');
  }
  assert.ok(readdirSync(dirname(claudePath)).some((name) => name.startsWith('settings.json.bak_ai_office_')));

  const expected = [
    join(configRoot, '.codex', 'hooks.json'),
    join(configRoot, '.gemini', 'settings.json'),
    join(configRoot, '.grok', 'hooks', 'ai-office-dollhouse.json')
  ];
  expected.forEach((path) => assert.equal(existsSync(path), true, path));
});

test('status reports codex as installed only via the supported root hooks path, never the nested plugin path alone', { skip: process.platform !== 'win32' }, () => {
  const configRoot = mkdtempSync(join(tmpdir(), 'ai-office-status-'));
  const legacyCodexPath = join(configRoot, '.codex', 'hooks', 'hooks.json');
  mkdirSync(dirname(legacyCodexPath), { recursive: true });
  // A nested plugin-style file that merely looks installed must not be reported
  // as installed: the CLI reads the root user source.
  writeFileSync(legacyCodexPath, JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'C:\\stale\\AIOfficeHookRelay.exe codex auto' }] }] }
  }, null, 2));
  const staleStatus = lastJsonLine(runScript('install-integrations.ps1', ['-Provider', 'codex', '-Action', 'status', '-ConfigRoot', configRoot]).stdout);
  const staleResult = staleStatus.results[0];
  assert.equal(staleResult.installed, false, 'a marker only in the nested plugin path must not read as installed');
  assert.equal(staleResult.legacyDetected, true);

  runScript('install-integrations.ps1', ['-Provider', 'codex', '-Action', 'install', '-ConfigRoot', configRoot]);
  const freshStatus = lastJsonLine(runScript('install-integrations.ps1', ['-Provider', 'codex', '-Action', 'status', '-ConfigRoot', configRoot]).stdout);
  const freshResult = freshStatus.results[0];
  assert.equal(freshResult.installed, true);
  assert.match(freshResult.path, /[\\/]\.codex[\\/]hooks\.json$/i);
});

test('integration installer serializes newly created hook groups as arrays', { skip: process.platform !== 'win32' }, () => {
  const configRoot = mkdtempSync(join(tmpdir(), 'ai-office-empty-config-'));
  const result = runScript('install-integrations.ps1', ['-Provider', 'all', '-Action', 'install', '-ConfigRoot', configRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(lastJsonLine(result.stdout).ok, true);

  const settings = [
    join(configRoot, '.codex', 'hooks.json'),
    join(configRoot, '.claude', 'settings.json'),
    join(configRoot, '.gemini', 'settings.json'),
    join(configRoot, '.grok', 'hooks', 'ai-office-dollhouse.json')
  ];
  for (const path of settings) {
    const config = JSON.parse(readFileSync(path, 'utf8'));
    for (const groups of Object.values(config.hooks)) {
      assert.equal(Array.isArray(groups), true, path);
      assert.equal(groups.length, 1, path);
      assert.equal(Array.isArray(groups[0].hooks), true, path);
      assert.equal(groups[0].hooks.length, 1, path);
    }
    if (path.endsWith(join('.gemini', 'settings.json'))) {
      for (const groups of Object.values(config.hooks)) {
        assert.equal(groups[0].hooks[0].timeout, 5000, 'Gemini hook timeout must remain milliseconds');
      }
    }
    if (path.endsWith(join('.grok', 'hooks', 'ai-office-dollhouse.json'))) {
      for (const groups of Object.values(config.hooks)) {
        assert.equal(groups[0].hooks[0].timeout, 5, 'Grok uses its documented five-second timeout');
      }
    }
  }
});

test('integration uninstaller removes only AI Office hooks and its isolated relay', { skip: process.platform !== 'win32' }, () => {
  const configRoot = mkdtempSync(join(tmpdir(), 'ai-office-uninstall-'));
  const claudePath = join(configRoot, '.claude', 'settings.json');
  mkdirSync(dirname(claudePath), { recursive: true });
  writeFileSync(claudePath, JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'existing-safe-hook' }] }] }
  }));
  const install = runScript('install-integrations.ps1', ['-Provider', 'all', '-Action', 'install', '-ConfigRoot', configRoot]);
  assert.equal(install.status, 0, install.stderr);
  const uninstall = runScript('install-integrations.ps1', ['-Provider', 'all', '-Action', 'uninstall', '-ConfigRoot', configRoot]);
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.equal(lastJsonLine(uninstall.stdout).ok, true);
  const claude = JSON.parse(readFileSync(claudePath, 'utf8'));
  const commands = claude.hooks.SessionStart.flatMap((group) => group.hooks.map((hook) => hook.command));
  assert.deepEqual(commands, ['existing-safe-hook']);
  assert.equal(existsSync(join(configRoot, '.ai-office-data', 'integration', 'AIOfficeHookRelay.exe')), false);
});

test('application installer and uninstaller reject arbitrary roots before touching them', { skip: process.platform !== 'win32' }, () => {
  const unexpectedRoot = mkdtempSync(join(tmpdir(), 'ai-office-unexpected-root-'));
  const install = runScript('install-app.ps1', ['-InstallRoot', unexpectedRoot]);
  assert.notEqual(install.status, 0);
  assert.match(`${install.stdout}\n${install.stderr}`, /installs only to/i);
  assert.deepEqual(readdirSync(unexpectedRoot), []);

  const uninstall = runScript('uninstall-app.ps1', ['-InstallRoot', unexpectedRoot]);
  assert.notEqual(uninstall.status, 0);
  assert.match(`${uninstall.stdout}\n${uninstall.stderr}`, /unexpected directory/i);
  assert.deepEqual(readdirSync(unexpectedRoot), []);
});
