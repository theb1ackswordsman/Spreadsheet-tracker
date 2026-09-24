process.env['SPREADSHEET_LIB'] = '1';

import { WebSocket } from 'ws';
import { Engine } from '../src/engine/engine';
import { startServer } from '../src/server/index';
import { fnv1a32, cellsHash } from '../src/shared/hash';
import type { CellId, Edit } from '../src/engine/types';
import type { S2C, Op } from '../src/shared/protocol';
import http from 'node:http';

// ── Parse CLI args ──

function parseArgs(): { bots: number; edits: number } {
  let bots = 20;
  let edits = 2000;
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--?/, '').split('=');
    if (k === 'bots' && v) bots = parseInt(v, 10);
    if (k === 'edits' && v) edits = parseInt(v, 10);
  }
  return { bots, edits };
}

// ── Random helpers ──

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const MAX_ROW = 20;

function randInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function randCell(): CellId {
  return COLS[randInt(COLS.length)]! + (randInt(MAX_ROW) + 1);
}

function randFormula(): string {
  const fns = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'];
  const ops = ['+', '-', '*', '/'];
  const r = Math.random();
  if (r < 0.3) {
    // simple arithmetic
    return `=${randCell()}${ops[randInt(ops.length)]}${randCell()}`;
  }
  if (r < 0.6) {
    // function with range
    const c1 = COLS[randInt(COLS.length)]!;
    const r1 = randInt(MAX_ROW) + 1;
    const r2 = r1 + randInt(MAX_ROW - r1 + 1);
    return `=${fns[randInt(fns.length)]}(${c1}${r1}:${c1}${r2})`;
  }
  if (r < 0.8) {
    // function with individual refs
    const fn = fns[randInt(fns.length)];
    const count = 2 + randInt(3);
    const args: string[] = [];
    for (let i = 0; i < count; i++) args.push(randCell());
    return `=${fn}(${args.join(',')})`;
  }
  // chain/nested arithmetic
  return `=${randCell()}${ops[randInt(ops.length)]}${randCell()}${ops[randInt(ops.length)]}${Math.floor(Math.random() * 100)}`;
}

function randCycleFormula(targetCell: CellId): string {
  return `=${targetCell}+1`;
}

function randEdit(allBotCells: CellId[]): Edit {
  const r = Math.random();
  const cell = randCell();
  if (r < 0.05) {
    // deliberate cycle: reference a cell that might reference us
    const target = allBotCells.length > 0 ? allBotCells[randInt(allBotCells.length)]! : randCell();
    return { cell, raw: randCycleFormula(target) };
  }
  if (r < 0.10) {
    // clear
    return { cell, raw: '' };
  }
  if (r < 0.45) {
    // formula
    return { cell, raw: randFormula() };
  }
  // plain number or text
  if (r < 0.80) {
    return { cell, raw: String(Math.floor(Math.random() * 1000)) };
  }
  return { cell, raw: `text${randInt(100)}` };
}

// ── Bot ──

interface Bot {
  id: number;
  cid: string;
  u: string;
  engine: Engine;
  ws: WebSocket;
  version: number;
  opId: number;
  pending: { opId: number; edits: Edit[] }[];
  raw: Map<CellId, string>;
  editsDone: number;
  disconnects: number;
  connected: boolean;
  ready: Promise<void>;
  resolve: () => void;
}

function createBot(id: number, port: number): Bot {
  let resolve: () => void = () => {};
  const ready = new Promise<void>((r) => { resolve = r; });
  const bot: Bot = {
    id,
    cid: `bot-${id}-${Date.now()}`,
    u: '',
    engine: new Engine(),
    ws: null as unknown as WebSocket,
    version: 0,
    opId: 0,
    pending: [],
    raw: new Map(),
    editsDone: 0,
    disconnects: 0,
    connected: false,
    ready,
    resolve,
  };
  connectBot(bot, port, true);
  return bot;
}

function connectBot(bot: Bot, port: number, isJoin: boolean): void {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  bot.ws = ws;

  ws.on('open', () => {
    bot.connected = true;
    if (isJoin) {
      ws.send(JSON.stringify({ t: 'JOIN', sheetId: 'main', name: `Bot${bot.id}`, cid: bot.cid }));
    } else {
      ws.send(JSON.stringify({ t: 'RESUME', sheetId: 'main', name: `Bot${bot.id}`, lastVersion: bot.version, cid: bot.cid }));
    }
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as S2C;
    handleBotMessage(bot, msg);
  });

  ws.on('close', () => {
    bot.connected = false;
  });

  ws.on('error', () => {
    bot.connected = false;
  });
}

function handleBotMessage(bot: Bot, msg: S2C): void {
  switch (msg.t) {
    case 'SNAPSHOT': {
      bot.u = msg.you.u;
      bot.version = msg.v;
      bot.raw.clear();
      bot.engine = new Engine();
      for (const [id, raw] of msg.cells) {
        bot.raw.set(id, raw);
        bot.engine.setRaw(id, raw);
      }
      // Full recompute
      const changed: CellId[] = [];
      for (const [id] of msg.cells) changed.push(id);
      if (changed.length > 0) {
        bot.engine.recompute(changed, 'naive');
      }
      // Replay pending
      for (const p of bot.pending) {
        bot.ws.send(JSON.stringify({ t: 'EDIT', opId: p.opId, edits: p.edits }));
      }
      bot.resolve();
      break;
    }
    case 'OPS': {
      for (const op of msg.ops) {
        applyOp(bot, op);
      }
      // Replay pending
      for (const p of bot.pending) {
        bot.ws.send(JSON.stringify({ t: 'EDIT', opId: p.opId, edits: p.edits }));
      }
      bot.resolve();
      break;
    }
    case 'OP': {
      applyOp(bot, msg.op);
      break;
    }
    case 'PRESENCE':
    case 'ERROR':
      break;
  }
}

function applyOp(bot: Bot, op: Op): void {
  bot.version = Math.max(bot.version, op.v);
  const changed: CellId[] = [];
  for (const edit of op.edits) {
    if (edit.raw === '') {
      bot.raw.delete(edit.cell);
    } else {
      bot.raw.set(edit.cell, edit.raw);
    }
    bot.engine.setRaw(edit.cell, edit.raw);
    changed.push(edit.cell);
  }
  if (changed.length > 0) {
    bot.engine.recompute(changed, 'inc');
  }
  // Remove from pending if this is our own op
  if (bot.u && op.u === bot.u) {
    bot.pending = bot.pending.filter(p => p.opId !== op.opId);
  }
}

// ── Value hashing ──

function valueHash(engine: Engine, raw: Map<CellId, string>): string {
  const lines: string[] = [];
  const allCells = new Set<CellId>(raw.keys());
  for (const id of allCells) {
    const r = engine.getResult(id);
    const vStr = r.e ? r.e : String(r.v ?? '');
    lines.push(`${id}=${vStr}`);
  }
  lines.sort();
  return fnv1a32(lines.join('\n'));
}

function rawHash(raw: Map<CellId, string>): string {
  return cellsHash(raw);
}

// ── Main ──

async function main(): Promise<void> {
  const { bots: botCount, edits: editCount } = parseArgs();
  const editsPerBot = Math.ceil(editCount / botCount);
  console.log(`Sim: ${botCount} bots, ${editCount} total edits (${editsPerBot} edits/bot)`);

  // Start server
  const server = startServer({ port: 0, persist: false });
  console.log(`Server on port ${server.port}`);

  const startTime = Date.now();
  let totalOps = 0;
  let totalReconnects = 0;

  // Create bots
  const botsArr: Bot[] = [];
  for (let i = 0; i < botCount; i++) {
    botsArr.push(createBot(i, server.port));
  }

  // Wait for all bots to be ready
  await Promise.all(botsArr.map(b => b.ready));
  console.log(`All ${botCount} bots connected`);

  // Collect all cells being edited for cycle generation
  const allCells: CellId[] = [];
  for (const c of COLS) {
    for (let r = 1; r <= MAX_ROW; r++) {
      allCells.push(`${c}${r}`);
    }
  }

  const MSG_INTERVAL = 30; // ~33 msgs/s pacing per socket

  const botPromises = botsArr.map(async (bot) => {
    for (let i = 0; i < editsPerBot; i++) {
      if (!bot.connected) {
        await new Promise<void>((r) => {
          bot.resolve = r;
          connectBot(bot, server.port, false);
          setTimeout(r, 2000);
        });
      }

      const r = Math.random();
      if (r < 0.02 && bot.connected) {
        // Random disconnect
        bot.disconnects++;
        totalReconnects++;
        bot.ws.terminate();
        bot.connected = false;
        // Reconnect after short delay
        await sleep(50 + randInt(50));
        await new Promise<void>((res) => {
          bot.resolve = res;
          connectBot(bot, server.port, false);
          setTimeout(res, 2000);
        });
        continue;
      }

      const edit = randEdit(allCells);
      bot.opId++;
      const opId = bot.opId;
      bot.pending.push({ opId, edits: [edit] });
      totalOps++;

      try {
        if (bot.ws && bot.ws.readyState === WebSocket.OPEN) {
          bot.ws.send(JSON.stringify({ t: 'EDIT', opId, edits: [edit] }));
        }
      } catch {
        // Socket may have closed
      }
      bot.editsDone++;

      await sleep(MSG_INTERVAL);
    }
  });

  await Promise.all(botPromises);
  console.log(`All edits sent. Waiting for convergence...`);

  // Reconnect any disconnected bot so it catches up
  for (const bot of botsArr) {
    if (!bot.connected) {
      await new Promise<void>((res) => {
        bot.resolve = res;
        connectBot(bot, server.port, false);
        setTimeout(res, 2000);
      });
    }
  }

  // Wait for convergence: all bots' version == server version, all pending empty
  const CONVERGE_TIMEOUT = 30_000;
  const deadline = Date.now() + CONVERGE_TIMEOUT;
  let converged = false;

  while (Date.now() < deadline) {
    const serverV = server.room.getVersion();
    let allCaughtUp = true;
    for (const bot of botsArr) {
      if (bot.version < serverV || bot.pending.length > 0) {
        allCaughtUp = false;
        break;
      }
    }
    if (allCaughtUp) {
      converged = true;
      break;
    }
    await sleep(100);
  }

  if (!converged) {
    const serverV = server.room.getVersion();
    for (const bot of botsArr) {
      if (bot.version < serverV || bot.pending.length > 0) {
        console.error(`Bot ${bot.id} at v${bot.version} (server at v${serverV}), pending=${bot.pending.length}`);
      }
    }
    console.error('FAILED: convergence timeout');
    await server.close();
    process.exit(1);
  }

  // Fetch server hash
  const serverHash = await fetchDebugHash(server.port);

  // Compute bot hashes
  const rawHashes: string[] = [];
  const valHashes: string[] = [];
  for (const bot of botsArr) {
    rawHashes.push(rawHash(bot.raw));
    valHashes.push(valueHash(bot.engine, bot.raw));
  }

  // Check convergence
  let pass = true;
  const firstRaw = rawHashes[0]!;
  const firstVal = valHashes[0]!;

  for (let i = 1; i < botsArr.length; i++) {
    if (rawHashes[i] !== firstRaw) {
      console.error(`FAILED: Bot 0 raw hash ${firstRaw} != Bot ${i} raw hash ${rawHashes[i]}`);
      findDiffCell(botsArr[0]!, botsArr[i]!, 'raw');
      pass = false;
      break;
    }
    if (valHashes[i] !== firstVal) {
      console.error(`FAILED: Bot 0 val hash ${firstVal} != Bot ${i} val hash ${valHashes[i]}`);
      findDiffCell(botsArr[0]!, botsArr[i]!, 'value');
      pass = false;
      break;
    }
  }

  if (pass && firstRaw !== serverHash.hash) {
    console.error(`FAILED: bot raw hash ${firstRaw} != server hash ${serverHash.hash}`);
    pass = false;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (pass) {
    console.log(`converged`);
    console.log(`  ops=${totalOps} reconnects=${totalReconnects} elapsed=${elapsed}s`);
    console.log(`  raw_hash=${firstRaw} val_hash=${firstVal} server_v=${serverHash.v}`);
  }

  // Cleanup
  for (const bot of botsArr) {
    if (bot.ws.readyState === WebSocket.OPEN || bot.ws.readyState === WebSocket.CONNECTING) {
      bot.ws.close();
    }
  }
  await server.close();

  if (!pass) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

function findDiffCell(a: Bot, b: Bot, kind: 'raw' | 'value'): void {
  const allIds = new Set([...a.raw.keys(), ...b.raw.keys()]);
  for (const id of [...allIds].sort()) {
    if (kind === 'raw') {
      const aRaw = a.raw.get(id) ?? '';
      const bRaw = b.raw.get(id) ?? '';
      if (aRaw !== bRaw) {
        console.error(`  first diff: ${id} raw: Bot${a.id}="${aRaw}" Bot${b.id}="${bRaw}"`);
        return;
      }
    } else {
      const aRes = a.engine.getResult(id);
      const bRes = b.engine.getResult(id);
      const aStr = aRes.e ? aRes.e : String(aRes.v ?? '');
      const bStr = bRes.e ? bRes.e : String(bRes.v ?? '');
      if (aStr !== bStr) {
        console.error(`  first diff: ${id} value: Bot${a.id}="${aStr}" Bot${b.id}="${bStr}"`);
        return;
      }
    }
  }
}

async function fetchDebugHash(port: number): Promise<{ v: number; hash: string }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/debug/hash`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as { v: number; hash: string });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
