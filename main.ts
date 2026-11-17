// Token Launch Radar — entrypoint (Node 22+, standard library only).
//
// MODES
//   node main.ts [--input <snapshot.json|dir>] [--output <dir>]
//       Grader / build mode (the default). Reads the sealed DefiLlama
//       snapshot, scores every pre-token protocol with the peer-multiple
//       model in lib/model.ts, and writes into the output directory:
//       board.json, data.js, dashboard/, screenshots/ and dossier.json
//       (built with vendor/makefun-board.ts). Deterministic, no network:
//       two runs on the same snapshot write identical bytes. The output
//       directory comes from --output, else $MAKEFUN_OUTPUT_DIR, else
//       /output, else ./out when /output does not exist locally.
//       With no snapshot anywhere it falls back to the built-in sample
//       snapshot so the demo still runs offline.
//
//   node main.ts --serve [--port 8787] [--input ...]
//       Builds the board in memory and serves the dashboard over HTTP
//       (dashboard at /, data at /data.js, board at /api/board.json).
//
//   node main.ts --live
//       Live Solana launch radar: polls free public endpoints
//       (DexScreener token profiles / latest pairs, no API key) for new
//       Solana token launches, scores them on liquidity, volume, age and
//       transaction count, and prints a ranked CLI table. Any network
//       failure falls back to embedded sample launches, labelled as such.
//       This mode is a demo extra; the grader never uses it.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, sampleSnapshot, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;

function arg(name: string, fallback?: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

function loadSnapshot(): { snapshot: Snapshot; note: string } {
  const inputArg = arg('input', process.env.MAKEFUN_INPUT_DIR ?? (existsSync('/input/snapshot.json') ? '/input' : undefined));
  const candidates: string[] = [];
  if (inputArg !== undefined) candidates.push(inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json'));
  candidates.push(join(here, 'input', 'snapshot.json'), join(here, '..', 'input', 'snapshot.json'));
  for (const file of candidates) {
    if (existsSync(file)) return { snapshot: parseSnapshot(readFileSync(file, 'utf8')), note: file };
  }
  return { snapshot: sampleSnapshot(), note: 'built-in sample snapshot (no sealed snapshot found)' };
}

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

function buildMode(): void {
  const { snapshot, note } = loadSnapshot();
  const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? (existsSync('/output') ? '/output' : join(here, 'out')))!;
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));
  copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
  const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3 (board, detail, filtered)\n`);
    process.exit(1);
  }
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
  );
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: input ${note}\n` +
      `token radar: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
  );
}

function serveMode(): void {
  const port = Number(arg('port', '8787'));
  const { snapshot } = loadSnapshot();
  const { board, radar } = buildRadar(snapshot);
  const dataJs = dataScript(radar);
  const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]!;
    if (url === '/api/board.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ rows: board }));
      return;
    }
    if (url === '/data.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(dataJs);
      return;
    }
    const rel = url === '/' ? 'index.html' : url.replace(/^\//, '');
    const file = join(here, 'dashboard', rel);
    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  });
  server.listen(port, () => process.stdout.write(`token radar: dashboard at http://localhost:${port}/ (${board.length} rows)\n`));
}

// ------------------------------------------------------------------ live

interface Launch {
  name: string;
  symbol: string;
  address: string;
  liquidityUsd: number;
  volume24h: number;
  txns24h: number;
  ageMinutes: number;
  source: string;
}

function scoreLaunch(l: Launch): number {
  const liq = Math.min(Math.log10(Math.max(1, l.liquidityUsd)) * 14, 84);
  const vol = Math.min(Math.log10(Math.max(1, l.volume24h)) * 10, 60);
  const act = Math.min(l.txns24h / 40, 30);
  const fresh = l.ageMinutes <= 60 ? 20 : l.ageMinutes <= 360 ? 12 : l.ageMinutes <= 1440 ? 6 : 2;
  const ratio = l.liquidityUsd > 0 ? l.volume24h / l.liquidityUsd : 0;
  const churnPenalty = ratio > 20 ? 12 : 0; // volume dwarfing liquidity = churn, not depth
  return Math.max(0, Math.round(liq + vol + act + fresh - churnPenalty));
}

const SAMPLE_LAUNCHES: Launch[] = [
  { name: 'Sample Moon Cat', symbol: 'SMCAT', address: 'sample1', liquidityUsd: 84_000, volume24h: 410_000, txns24h: 1900, ageMinutes: 42, source: 'sample' },
  { name: 'Sample Reef', symbol: 'SREEF', address: 'sample2', liquidityUsd: 21_500, volume24h: 96_000, txns24h: 640, ageMinutes: 180, source: 'sample' },
  { name: 'Sample Comet', symbol: 'SCMT', address: 'sample3', liquidityUsd: 6_200, volume24h: 88_000, txns24h: 1500, ageMinutes: 25, source: 'sample' },
  { name: 'Sample Dune', symbol: 'SDUNE', address: 'sample4', liquidityUsd: 150_000, volume24h: 120_000, txns24h: 300, ageMinutes: 900, source: 'sample' },
];

async function fetchLaunches(): Promise<{ launches: Launch[]; live: boolean }> {
  try {
    const res = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    const profiles = (await res.json()) as Array<{ chainId?: string; tokenAddress?: string }>;
    const solana = profiles.filter((p) => p.chainId === 'solana' && p.tokenAddress).slice(0, 12);
    const launches: Launch[] = [];
    for (const p of solana) {
      try {
        const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${p.tokenAddress}`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const data = (await r.json()) as { pairs?: Array<Record<string, unknown>> };
        const pair = (data.pairs ?? [])[0] as Record<string, any> | undefined;
        if (!pair) continue;
        launches.push({
          name: String(pair.baseToken?.name ?? 'unknown'),
          symbol: String(pair.baseToken?.symbol ?? '?'),
          address: String(p.tokenAddress),
          liquidityUsd: Number(pair.liquidity?.usd ?? 0),
          volume24h: Number(pair.volume?.h24 ?? 0),
          txns24h: Number((pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0)),
          ageMinutes: pair.pairCreatedAt ? Math.max(0, Math.round((Date.now() - Number(pair.pairCreatedAt)) / 60000)) : 9999,
          source: 'dexscreener',
        });
      } catch { /* one bad token never sinks the radar */ }
    }
    if (launches.length === 0) throw new Error('no solana launches returned');
    return { launches, live: true };
  } catch {
    return { launches: SAMPLE_LAUNCHES, live: false };
  }
}

async function liveMode(): Promise<void> {
  const { launches, live } = await fetchLaunches();
  const ranked = launches.map((l) => ({ l, score: scoreLaunch(l) })).sort((a, b) => b.score - a.score);
  process.stdout.write(live ? 'token radar (LIVE, DexScreener public endpoints):\n' : 'token radar (network unavailable — SAMPLE launches, scores still computed):\n');
  ranked.forEach(({ l, score }, i) => {
    process.stdout.write(
      `${String(i + 1).padStart(2)}. ${l.symbol.padEnd(8)} score ${String(score).padStart(3)}  liq $${Math.round(l.liquidityUsd).toLocaleString('en-US')}  vol24h $${Math.round(l.volume24h).toLocaleString('en-US')}  txns ${l.txns24h}  age ${l.ageMinutes}m  ${l.name}\n`,
    );
  });
}

if (has('live')) {
  await liveMode();
} else if (has('serve')) {
  serveMode();
} else {
  buildMode();
}
