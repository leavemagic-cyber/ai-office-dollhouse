import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const now = Date.now();
const userRoot = process.env.USERPROFILE || process.env.HOME || '';

function clean(value, fallback = '既有工作', maximum = 48) {
  const text = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function safeTitle(title, workspace) {
  const raw = String(title || '');
  if (!raw || /[\r\n]/.test(raw) || raw.length > 76 || raw.startsWith('#')) {
    return clean(workspace, 'Codex 既有工作', 42);
  }
  return clean(raw, clean(workspace, 'Codex 既有工作', 42), 48);
}

async function codexSnapshot() {
  const databasePath = join(userRoot, '.codex', 'state_5.sqlite');
  if (!existsSync(databasePath)) return { available: false, work: [] };
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(databasePath, { readOnly: true });
    const parents = db.prepare(`
      SELECT t.id, t.title, t.cwd, t.updated_at_ms, t.recency_at_ms,
        (SELECT COUNT(*) FROM thread_spawn_edges e
          WHERE e.parent_thread_id = t.id AND e.status = 'open') AS open_children
      FROM threads t
      WHERE t.archived = 0 AND t.agent_nickname IS NULL
        AND t.updated_at_ms >= ?
      ORDER BY t.updated_at_ms DESC
      LIMIT 6
    `).all(now - 36 * 60 * 60_000);
    const children = db.prepare(`
      SELECT c.agent_nickname, c.agent_role, c.updated_at_ms
      FROM thread_spawn_edges e
      JOIN threads c ON c.id = e.child_thread_id
      WHERE e.parent_thread_id = ? AND e.status = 'open'
      ORDER BY c.updated_at_ms DESC
      LIMIT 12
    `);
    const work = parents.map((row) => {
      const workspace = basename(String(row.cwd || '').replaceAll('\\', '/')) || 'Codex 工作';
      const agents = children.all(row.id).map((child) => ({
        label: clean(child.agent_nickname || child.agent_role, 'subagent', 18),
        role: clean(child.agent_role, 'subagent', 18),
        updatedAt: Number(child.updated_at_ms) || 0
      }));
      return {
        id: `codex:${String(row.id).slice(0, 12)}`,
        label: safeTitle(row.title, workspace),
        workspace: clean(workspace, 'Codex 工作', 28),
        updatedAt: Number(row.updated_at_ms) || 0,
        recent: now - Number(row.updated_at_ms || 0) < 5 * 60_000,
        openChildren: Number(row.open_children) || 0,
        agents
      };
    });
    db.close();
    return { available: true, source: 'Codex 本機狀態快照', work };
  } catch (error) {
    return { available: false, source: 'Codex 快照不可用', work: [], error: clean(error.message, 'snapshot error', 80) };
  }
}

function listFiles(root, predicate, depth = 0) {
  if (depth > 4 || !existsSync(root)) return [];
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(path, predicate, depth + 1));
    else if (entry.isFile() && predicate(entry.name)) output.push(path);
  }
  return output;
}

function claudeSnapshot() {
  const root = join(userRoot, '.claude', 'projects');
  if (!existsSync(root)) return { available: false, work: [] };
  try {
    const projects = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const projectPath = join(root, entry.name);
        const metaFiles = listFiles(projectPath, (name) => name.endsWith('.meta.json'))
          .map((path) => ({ path, modified: statSync(path).mtimeMs }))
          .sort((a, b) => b.modified - a.modified);
        const newest = Math.max(statSync(projectPath).mtimeMs, metaFiles[0]?.modified || 0);
        const recentAgents = metaFiles
          .filter((item) => now - item.modified < 24 * 60 * 60_000)
          .slice(0, 12)
          .map((item) => {
            try {
              const meta = JSON.parse(readFileSync(item.path, 'utf8'));
              return { label: clean(meta.agentType, 'subagent', 18), role: clean(meta.agentType, 'subagent', 18), updatedAt: item.modified };
            } catch { return null; }
          })
          .filter(Boolean);
        const tail = entry.name.split('-').filter(Boolean).slice(-5).join('-');
        return {
          id: `claude:${entry.name.slice(-18)}`,
          label: clean(tail, 'Claude 既有專案', 38),
          workspace: 'Claude 專案紀錄',
          updatedAt: newest,
          recent: now - newest < 5 * 60_000,
          openChildren: recentAgents.length,
          agents: recentAgents
        };
      })
      .filter((item) => now - item.updatedAt < 36 * 60 * 60_000)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 4);
    return { available: true, source: 'Claude 本機紀錄快照', work: projects };
  } catch (error) {
    return { available: false, source: 'Claude 快照不可用', work: [], error: clean(error.message, 'snapshot error', 80) };
  }
}

const result = {
  schemaVersion: 1,
  generatedAt: now,
  truth: '快照只證明本機紀錄近期有更新；精確執行狀態以結構化事件為準。',
  providers: {
    codex: await codexSnapshot(),
    claude: claudeSnapshot(),
    gemini: { available: false, source: '尚無安全既有工作索引', work: [] },
    grok: { available: false, source: '尚無安全既有工作索引', work: [] }
  }
};

process.stdout.write(`${JSON.stringify(result)}\n`);
