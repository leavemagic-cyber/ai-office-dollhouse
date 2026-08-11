import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastJsonLine } from '../resources/js/native-bridge.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function runScript(name, args = [], options = {}) {
  return spawnSync(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(root, 'scripts', name), ...args
  ], { cwd: root, encoding: 'utf8', ...options });
}

test('lastJsonLine ignores harmless leading output', () => {
  assert.deepEqual(lastJsonLine('notice\n{"ok":true}\n'), { ok: true });
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
  assert.equal(stored.includes(rawPrompt), false);
  assert.equal(stored.includes('transcript.jsonl'), false);
  assert.equal(stored.includes('session-secret-id'), false);
  const event = JSON.parse(stored.trim());
  assert.equal(event.eventType, 'agent_spawned');
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
  assert.equal(stored.includes(rawPrompt), false);
  assert.equal(stored.includes('fast-secret-session'), false);
  assert.equal(JSON.parse(stored).eventType, 'turn_started');
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
        if (scenario.payload.error) assert.equal(stored.includes(scenario.payload.error), false, `${runner.name}: ${scenario.name} leaked diagnostic text`);
      }
    }
  }
});

test('integration installer backs up and merges idempotently in an isolated root', { skip: process.platform !== 'win32' }, () => {
  const configRoot = mkdtempSync(join(tmpdir(), 'ai-office-config-'));
  const claudePath = join(configRoot, '.claude', 'settings.json');
  mkdirSync(dirname(claudePath), { recursive: true });
  writeFileSync(claudePath, JSON.stringify({
    permissions: { defaultMode: 'default' },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'existing-safe-hook' }] }] }
  }, null, 2));

  const args = ['-Provider', 'all', '-Action', 'install', '-ConfigRoot', configRoot];
  const first = runScript('install-integrations.ps1', args);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(lastJsonLine(first.stdout).ok, true);
  const second = runScript('install-integrations.ps1', args);
  assert.equal(second.status, 0, second.stderr);

  const claude = JSON.parse(readFileSync(claudePath, 'utf8'));
  const commands = claude.hooks.SessionStart.flatMap((group) => group.hooks.map((hook) => hook.command));
  assert.ok(commands.includes('existing-safe-hook'));
  assert.equal(commands.filter((command) => command.includes('AIOfficeHookRelay.exe')).length, 1);
  assert.equal(existsSync(join(configRoot, '.ai-office-data', 'integration', 'AIOfficeHookRelay.exe')), true);
  assert.ok(readdirSync(dirname(claudePath)).some((name) => name.startsWith('settings.json.bak_ai_office_')));

  const expected = [
    join(configRoot, '.codex', 'hooks.json'),
    join(configRoot, '.gemini', 'settings.json'),
    join(configRoot, '.grok', 'hooks', 'ai-office-dollhouse.json')
  ];
  expected.forEach((path) => assert.equal(existsSync(path), true, path));
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
