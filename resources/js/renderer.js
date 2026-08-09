import { DISPLAY_MODES, PROVIDERS } from './domain.js';

const FLOOR = Object.freeze({ owner: 150, decision: 118, team: 190, public: 112, lobby: 118 });
const PROVIDER_ORDER = ['codex', 'claude', 'gemini', 'grok', 'other'];

function hashNumber(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function roundedRect(ctx, x, y, width, height, radius = 8) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function text(ctx, value, x, y, options = {}) {
  ctx.save();
  ctx.fillStyle = options.color || '#eaf1f8';
  ctx.font = `${options.weight || 500} ${options.size || 12}px "Segoe UI", "Microsoft JhengHei UI", sans-serif`;
  ctx.textAlign = options.align || 'left';
  ctx.textBaseline = options.baseline || 'alphabetic';
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.fillText(String(value), x, y, options.maxWidth);
  ctx.restore();
}

function splitTeam(team) {
  const fragments = [];
  for (const pod of Object.values(team.pods).sort((a, b) => a.createdAt - b.createdAt)) {
    const agents = Object.values(pod.agents).sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.createdAt - b.createdAt);
    const main = agents.find((agent) => agent.isMain);
    const children = agents.filter((agent) => !agent.isMain);
    const first = [main, ...children.slice(0, 4)].filter(Boolean);
    fragments.push({ pod, agents: first, continuation: 0 });
    for (let index = 4, part = 1; index < children.length; index += 5, part += 1) {
      fragments.push({ pod, agents: children.slice(index, index + 5), continuation: part });
    }
  }
  const unassigned = Object.values(team.unassigned);
  if (unassigned.length) {
    for (let index = 0; index < unassigned.length; index += 5) {
      fragments.push({ pod: null, agents: unassigned.slice(index, index + 5), continuation: Math.floor(index / 5), unassigned: true });
    }
  }
  if (!fragments.length) fragments.push({ pod: null, agents: [], empty: true });

  const floors = [];
  for (const fragment of fragments) {
    let floor = floors.at(-1);
    const floorAgents = floor?.fragments.reduce((sum, item) => sum + item.agents.length, 0) || 0;
    if (!floor || floor.fragments.length >= 2 || floorAgents + fragment.agents.length > 10) {
      floor = { team, fragments: [] };
      floors.push(floor);
    }
    floor.fragments.push(fragment);
  }
  return floors.map((floor, index) => ({ ...floor, annexIndex: index, annexTotal: floors.length }));
}

function buildFloors(state) {
  const floors = [
    { id: 'owner', kind: 'owner', height: FLOOR.owner },
    { id: 'decision', kind: 'decision', height: FLOOR.decision }
  ];
  const teams = Object.values(state.teams).sort((a, b) => PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider));
  for (const team of teams) {
    for (const floor of splitTeam(team)) floors.push({ id: `team:${team.provider}:${floor.annexIndex}`, kind: 'team', height: FLOOR.team, ...floor });
  }
  floors.push({ id: 'public', kind: 'public', height: FLOOR.public });
  floors.push({ id: 'lobby', kind: 'lobby', height: FLOOR.lobby });
  let y = 18;
  for (const floor of floors) {
    floor.expandedHeight = floor.height;
    floor.collapsed = Boolean(state.settings.collapsedFloors?.[floor.id]);
    if (floor.collapsed) floor.height = 34;
    floor.y = y;
    y += floor.height + 8;
  }
  return { floors, height: y + 18 };
}

function activityColor(activity) {
  return ({
    working: '#7fd3c6', running: '#7fd3c6', idle: '#9ba8b6', delivered: '#b7db83',
    waiting_owner: '#efc16f', attention: '#efc16f', failed: '#df7777', unknown: '#8a9099',
    completed: '#91b781'
  })[activity] || '#aeb8c4';
}

export class OfficeRenderer {
  constructor({ canvas, scrollContainer, state, resourceManager, onSettingsChanged }) {
    this.canvas = canvas;
    this.scrollContainer = scrollContainer;
    this.state = state;
    this.resourceManager = resourceManager;
    this.onSettingsChanged = onSettingsChanged;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 1.25);
    this.lastFrameAt = 0;
    this.lastRenderedAt = 0;
    this.raf = null;
    this.running = false;
    this.invalidated = true;
    this.layout = buildFloors(state);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(scrollContainer);
    this.scrollHandler = () => this.invalidate();
    this.pointerHandler = (event) => this.toggleFloorAt(event);
    scrollContainer.addEventListener('scroll', this.scrollHandler, { passive: true });
    canvas.addEventListener('click', this.pointerHandler);
    canvas.title = '點一下樓層標題可收合或展開';
    this.resize();
  }

  resize() {
    const width = Math.max(660, this.scrollContainer.clientWidth);
    this.layout = buildFloors(this.state);
    const height = Math.max(this.scrollContainer.clientHeight, this.layout.height);
    const nextWidth = Math.round(width * this.dpr);
    const nextHeight = Math.round(height * this.dpr);
    if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
      this.canvas.width = nextWidth;
      this.canvas.height = nextHeight;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    this.invalidate();
  }

  invalidate() {
    this.invalidated = true;
    const next = buildFloors(this.state);
    if (next.height !== this.layout.height || next.floors.length !== this.layout.floors.length) this.resize();
  }

  toggleFloorAt(event) {
    const bounds = this.canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const floor = this.layout.floors.find((item) => y >= item.y && y <= item.y + 30);
    if (!floor || x < 18 || x > bounds.width - 18) return;
    const collapsed = this.state.settings.collapsedFloors || (this.state.settings.collapsedFloors = {});
    collapsed[floor.id] = !floor.collapsed;
    this.resize();
    this.onSettingsChanged?.();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (timestamp) => {
      if (!this.running) return;
      const fps = this.resourceManager.fps(this.state.settings.mode);
      const interval = fps ? 1000 / fps : Infinity;
      if (fps && (this.invalidated || timestamp - this.lastRenderedAt >= interval)) {
        const start = performance.now();
        this.render(timestamp);
        this.resourceManager.recordFrame(performance.now() - start);
        this.lastRenderedAt = timestamp;
        this.invalidated = false;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    this.scrollContainer.removeEventListener('scroll', this.scrollHandler);
    this.canvas.removeEventListener('click', this.pointerHandler);
  }

  label(value, fallback) {
    return this.state.settings.privacyMask ? fallback : value;
  }

  render(timestamp) {
    const ctx = this.ctx;
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#111b26');
    gradient.addColorStop(1, '#0b1017');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const viewportTop = this.scrollContainer.scrollTop - 40;
    const viewportBottom = viewportTop + this.scrollContainer.clientHeight + 80;
    const budget = this.resourceManager.animationBudget(this.state.settings.mode);
    let movingIndex = 0;
    for (const floor of this.layout.floors) {
      if (floor.y + floor.height < viewportTop || floor.y > viewportBottom) continue;
      if (floor.kind === 'owner') this.drawOwner(ctx, floor, width, timestamp, budget);
      else if (floor.kind === 'decision') this.drawDecision(ctx, floor, width, timestamp);
      else if (floor.kind === 'team') movingIndex = this.drawTeam(ctx, floor, width, timestamp, budget, movingIndex);
      else if (floor.kind === 'public') this.drawPublic(ctx, floor, width, timestamp);
      else if (floor.kind === 'lobby') this.drawLobby(ctx, floor, width, timestamp);
    }
  }

  floorShell(ctx, floor, width, fill, title, subtitle = '') {
    const x = 18;
    const w = width - 36;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.38)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;
    roundedRect(ctx, x, floor.y, w, floor.height, 12);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(181,205,224,.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.23)';
    ctx.fillRect(x + 1, floor.y + floor.height - 15, w - 2, 14);
    text(ctx, title, x + 14, floor.y + 21, { size: 12, weight: 650, color: '#f0f5fa' });
    if (subtitle) text(ctx, subtitle, x + w - 34, floor.y + 21, { size: 9, align: 'right', color: '#a7b5c2' });
    text(ctx, floor.collapsed ? '▸' : '▾', x + w - 15, floor.y + 21, { size: 11, align: 'center', color: '#b7c6d1' });
    ctx.restore();
    return { x, y: floor.y, w, h: floor.height };
  }

  drawOwner(ctx, floor, width, timestamp, budget) {
    const shell = this.floorShell(ctx, floor, width, '#293a43', 'Owner 辦公室', '永久保留 · 最終主導權');
    if (floor.collapsed) return;
    const deskX = shell.x + shell.w * .5;
    const baseY = shell.y + shell.h - 24;
    ctx.fillStyle = '#8a674d';
    roundedRect(ctx, deskX - 70, baseY - 45, 140, 34, 5); ctx.fill();
    ctx.fillStyle = '#d7c39d'; ctx.fillRect(deskX - 12, baseY - 59, 24, 17);
    const motion = budget.movingDolls ? Math.sin(timestamp / 650) * 1.5 : 0;
    this.drawDoll(ctx, 'owner', deskX - 95, baseY - 54 + motion, 'idle', '#e4b86b', true, timestamp, true);

    const inbox = this.state.owner.inboxCount;
    ctx.fillStyle = inbox ? '#7a5330' : '#3b4c55';
    roundedRect(ctx, shell.x + shell.w - 112, shell.y + 46, 82, 58, 7); ctx.fill();
    text(ctx, '請示收件匣', shell.x + shell.w - 71, shell.y + 65, { size: 9, align: 'center', color: '#dce5eb' });
    text(ctx, inbox, shell.x + shell.w - 71, shell.y + 92, { size: 22, weight: 700, align: 'center', color: inbox ? '#ffd58a' : '#91a0ad' });
    ctx.strokeStyle = '#63808d';
    ctx.beginPath(); ctx.moveTo(shell.x + 35, shell.y + 44); ctx.lineTo(shell.x + 35, baseY - 8); ctx.stroke();
    text(ctx, '指定討論、主持、審查與授權', shell.x + 52, shell.y + 55, { size: 9, color: '#b9c6cf', maxWidth: 205 });
    text(ctx, '重要決定送回 Owner 收件匣', shell.x + 52, shell.y + 72, { size: 8, color: '#91a4b1', maxWidth: 205 });
  }

  drawDecision(ctx, floor, width) {
    const shell = this.floorShell(ctx, floor, width, '#202d3a', '公共決策層', '只有明確事件才集合');
    if (floor.collapsed) return;
    const roomW = (shell.w - 48) / 2;
    for (let index = 0; index < 2; index += 1) {
      const x = shell.x + 16 + index * (roomW + 16);
      ctx.fillStyle = index ? '#293142' : '#263744';
      roundedRect(ctx, x, shell.y + 33, roomW, shell.h - 52, 7); ctx.fill();
      text(ctx, index ? '審查室' : '跨團隊會議室', x + 10, shell.y + 51, { size: 10, color: '#d6e0e8' });
      ctx.fillStyle = '#6f5846';
      roundedRect(ctx, x + roomW * .23, shell.y + 72, roomW * .54, 18, 7); ctx.fill();
      ctx.fillStyle = '#73808a';
      for (let seat = 0; seat < 4; seat += 1) ctx.fillRect(x + roomW * .2 + seat * roomW * .19, shell.y + 64 + (seat % 2) * 28, 8, 8);
    }
  }

  drawTeam(ctx, floor, width, timestamp, budget, movingIndex) {
    const team = floor.team;
    const providerStyle = PROVIDERS[team.provider] || PROVIDERS.other;
    const teamName = this.label(team.label, `團隊 ${PROVIDER_ORDER.indexOf(team.provider) + 1}`);
    const annex = floor.annexTotal > 1 ? ` ${floor.annexIndex + 1}/${floor.annexTotal}` : '';
    const subtitle = `${Object.keys(team.pods).length} 專案桌 · ${team.lifecycle === 'active' ? '運作中' : '休眠'}`;
    const shell = this.floorShell(ctx, floor, width, team.floorColor || providerStyle.floor, `${teamName}${annex}`, subtitle);
    if (floor.collapsed) return movingIndex;
    const fragments = floor.fragments;
    const gap = 12;
    const podW = (shell.w - 28 - gap * Math.max(0, fragments.length - 1)) / Math.max(1, fragments.length);
    fragments.forEach((fragment, index) => {
      const x = shell.x + 14 + index * (podW + gap);
      movingIndex = this.drawPod(ctx, fragment, x, shell.y + 32, podW, shell.h - 50, timestamp, budget, movingIndex, team);
    });
    const expansionAge = timestamp - team.expansionAt;
    if (expansionAge >= 0 && expansionAge < 3200) this.drawExpansion(ctx, shell, expansionAge, budget, providerStyle.accent);
    return movingIndex;
  }

  drawPod(ctx, fragment, x, y, width, height, timestamp, budget, movingIndex, team) {
    ctx.fillStyle = 'rgba(9,14,19,.34)';
    roundedRect(ctx, x, y, width, height, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(210,225,237,.12)'; ctx.stroke();
    const rawLabel = fragment.unassigned
      ? '未歸屬（等待可靠 parent）'
      : fragment.empty
        ? '待命座位'
        : `${fragment.pod.label}${fragment.continuation ? ` · 附屬 ${fragment.continuation}` : ''}`;
    const safe = this.state.settings.privacyMask ? (fragment.unassigned ? '未歸屬' : '工作桌') : rawLabel;
    text(ctx, safe, x + 9, y + 17, { size: 10, weight: 600, color: fragment.unassigned ? '#d6bd84' : '#dbe6ee', maxWidth: width - 85 });
    if (fragment.pod) {
      const source = this.state.settings.privacyMask ? '來源遮罩' : `${team.label} · ${fragment.pod.surfaceKind || 'unknown'}`;
      text(ctx, source, x + width - 9, y + 17, { size: 8, align: 'right', color: '#92a6b6', maxWidth: 80 });
    }

    const deskY = y + height - 30;
    ctx.fillStyle = '#775d48';
    roundedRect(ctx, x + 13, deskY - 22, width - 26, 22, 4); ctx.fill();
    ctx.fillStyle = '#24313b';
    for (let desk = 0; desk < Math.min(2, Math.max(1, fragment.agents.length)); desk += 1) {
      const dx = x + width * (.33 + desk * .34);
      roundedRect(ctx, dx - 12, deskY - 37, 24, 15, 2); ctx.fill();
      ctx.fillStyle = '#75aab2'; ctx.fillRect(dx - 8, deskY - 34, 16, 8); ctx.fillStyle = '#24313b';
    }

    const positions = [
      [.16, .56], [.36, .54], [.56, .58], [.75, .53], [.88, .60]
    ];
    fragment.agents.forEach((agent, index) => {
      const [px, py] = positions[index] || [.2 + index * .14, .58];
      const animate = movingIndex < budget.movingDolls;
      const bob = animate && ['working', 'running'].includes(agent.activity) ? Math.sin(timestamp / 180 + movingIndex) * 1.5 : 0;
      this.drawDoll(ctx, agent.id, x + width * px, y + height * py + bob, agent.activity, team.accent, agent.isMain, timestamp, animate);
      movingIndex += 1;
    });

    if (fragment.pod?.activity === 'waiting_owner') {
      ctx.fillStyle = '#f0c16d'; roundedRect(ctx, x + width - 32, y + 27, 19, 17, 7); ctx.fill();
      text(ctx, '?', x + width - 22, y + 39, { size: 12, weight: 700, align: 'center', color: '#3d3020' });
    } else if (fragment.pod?.activity === 'unknown') {
      text(ctx, '狀態未確認', x + width - 10, y + 39, { size: 8, align: 'right', color: '#a8adb5' });
    }
    const delegationCount = Object.values(team.delegations).filter((item) => item.sessionId === fragment.pod?.sessionId).length;
    if (delegationCount) {
      text(ctx, `委派區間 ×${delegationCount}`, x + 9, y + height - 7, { size: 8, color: '#c0aef1' });
    }
    return movingIndex;
  }

  drawDoll(ctx, id, x, y, activity, accent, isMain, timestamp, animate) {
    const kind = hashNumber(id) % 4;
    const scale = isMain ? 1.1 : .92;
    const status = activityColor(activity);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = activity === 'completed' ? .55 : 1;
    ctx.fillStyle = 'rgba(0,0,0,.24)';
    ctx.beginPath(); ctx.ellipse(0, 25, 15, 4, 0, 0, Math.PI * 2); ctx.fill();
    const hand = animate && activity === 'working' ? Math.sin(timestamp / 120 + hashNumber(id)) * 3 : 0;

    if (kind === 0) {
      ctx.fillStyle = accent; roundedRect(ctx, -12, -1, 24, 23, 4); ctx.fill();
      ctx.fillStyle = '#d9e1e5'; roundedRect(ctx, -10, -20, 20, 19, 4); ctx.fill();
      ctx.fillStyle = '#33444c'; ctx.fillRect(-5, -13, 3, 3); ctx.fillRect(3, -13, 3, 3);
    } else if (kind === 1) {
      ctx.fillStyle = accent; roundedRect(ctx, -11, 0, 22, 22, 5); ctx.fill();
      ctx.fillStyle = '#9aa9b3'; roundedRect(ctx, -12, -19, 24, 19, 5); ctx.fill();
      ctx.strokeStyle = '#9aa9b3'; ctx.beginPath(); ctx.moveTo(0, -19); ctx.lineTo(0, -25); ctx.stroke();
      ctx.fillStyle = status; ctx.beginPath(); ctx.arc(0, -27, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#26343c'; ctx.fillRect(-7, -12, 4, 3); ctx.fillRect(3, -12, 4, 3);
    } else if (kind === 2) {
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.moveTo(-10, -16); ctx.lineTo(-6, -25); ctx.lineTo(-1, -17); ctx.lineTo(4, -25); ctx.lineTo(10, -15); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -10, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0dfc3'; roundedRect(ctx, -10, 1, 20, 21, 6); ctx.fill();
      ctx.fillStyle = '#28333a'; ctx.fillRect(-5, -12, 3, 3); ctx.fillRect(3, -12, 3, 3);
    } else {
      ctx.fillStyle = '#d7b18e'; ctx.beginPath(); ctx.arc(0, -11, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = accent; roundedRect(ctx, -11, 0, 22, 22, 3); ctx.fill();
      ctx.fillStyle = '#ead7ad'; ctx.beginPath(); ctx.moveTo(-3, 1); ctx.lineTo(3, 1); ctx.lineTo(1, 13); ctx.lineTo(-1, 13); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2b3035'; ctx.fillRect(-10, -19, 20, 5);
    }
    ctx.strokeStyle = status; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-10, 5); ctx.lineTo(-16, 13 + hand); ctx.moveTo(10, 5); ctx.lineTo(16, 13 - hand); ctx.stroke();
    ctx.strokeStyle = '#66737d'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, 21); ctx.lineTo(-7, 27); ctx.moveTo(6, 21); ctx.lineTo(7, 27); ctx.stroke();
    if (activity === 'failed' || activity === 'unknown') {
      text(ctx, activity === 'failed' ? '!' : '?', 13, -22, { size: 12, weight: 700, align: 'center', color: status });
    }
    ctx.restore();
  }

  drawExpansion(ctx, shell, age, budget, accent) {
    const progress = Math.min(1, age / 2100);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - age / 3200) * .8;
    ctx.strokeStyle = accent;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(shell.x + 6, shell.y + 6, shell.w - 12, shell.h - 21);
    ctx.setLineDash([]);
    if (budget.majorAnimation) {
      const craneX = shell.x + shell.w * progress;
      ctx.strokeStyle = '#e0b768'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(craneX, shell.y - 4); ctx.lineTo(craneX, shell.y + 35); ctx.lineTo(craneX - 20, shell.y + 55); ctx.stroke();
      ctx.fillStyle = '#e0b768'; ctx.fillRect(craneX - 24, shell.y + 55, 9, 9);
    }
    text(ctx, '團隊樓擴建中', shell.x + shell.w / 2, shell.y + 20, { size: 10, align: 'center', color: '#f1d290', alpha: .9 });
    ctx.restore();
  }

  drawPublic(ctx, floor, width) {
    const shell = this.floorShell(ctx, floor, width, '#273039', '公共工作層', '研究室 · 測試工坊 · 印刷室');
    if (floor.collapsed) return;
    const labels = ['研究室', '測試工坊', '印刷室'];
    labels.forEach((label, index) => {
      const sectionW = (shell.w - 44) / 3;
      const x = shell.x + 12 + index * (sectionW + 10);
      ctx.fillStyle = '#1d2730'; roundedRect(ctx, x, shell.y + 32, sectionW, shell.h - 49, 6); ctx.fill();
      text(ctx, label, x + sectionW / 2, shell.y + 52, { size: 9, align: 'center', color: '#c3d0d9' });
      ctx.fillStyle = index === 0 ? '#657b79' : index === 1 ? '#6d647d' : '#7a6a55';
      ctx.fillRect(x + sectionW * .3, shell.y + 65, sectionW * .4, 18);
    });
  }

  drawLobby(ctx, floor, width) {
    const surfaces = Object.values(this.state.surfaces);
    const shell = this.floorShell(ctx, floor, width, '#242c34', '一樓大廳', '程序只表示 presence，不代表工作人口');
    if (floor.collapsed) return;
    const available = Math.max(1, surfaces.length);
    const cardW = Math.min(116, (shell.w - 26) / available - 6);
    surfaces.slice(0, 7).forEach((surface, index) => {
      const x = shell.x + 13 + index * (cardW + 6);
      const style = PROVIDERS[surface.provider] || PROVIDERS.other;
      ctx.fillStyle = surface.appOpen ? 'rgba(74,105,90,.7)' : 'rgba(21,29,37,.78)';
      roundedRect(ctx, x, shell.y + 38, cardW, 52, 7); ctx.fill();
      ctx.fillStyle = surface.appOpen ? '#8fc99a' : surface.installed ? '#d5b56b' : '#64717d';
      ctx.beginPath(); ctx.arc(x + 11, shell.y + 52, 4, 0, Math.PI * 2); ctx.fill();
      const provider = this.state.settings.privacyMask ? 'AI' : style.label;
      text(ctx, `${provider} · ${surface.kind}`, x + 20, shell.y + 55, { size: 8, color: '#dbe4eb', maxWidth: cardW - 24 });
      text(ctx, surface.appOpen ? '已開啟' : surface.installed ? '已安裝' : '未偵測', x + 10, shell.y + 76, { size: 8, color: '#99a9b7' });
    });
    if (!surfaces.length) text(ctx, '正在主動偵測已安裝的 App 與 CLI…', shell.x + shell.w / 2, shell.y + 69, { size: 10, align: 'center', color: '#a8b5bf' });
  }
}
