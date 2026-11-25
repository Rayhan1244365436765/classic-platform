import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Layout probe: logs in as the existing throwaway user (no new DB rows), loads the
// Dice and Slots pages in hidden iframes of several phone sizes, and prints where
// the bottom bar sits relative to the board and the "Provably fair" line.
const API = 'http://localhost:3000/api';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const phone = readFileSync('_shot_phone.txt', 'utf8').trim();

const login = await (
  await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: 'secret123' }),
  })
).json();
if (!login.token) throw new Error('login failed: ' + JSON.stringify(login));

const SIZES = [[390, 780], [360, 640], [340, 640], [320, 568], [700, 400], [900, 1000]];
const frames = [];
for (const path of ['/dice', '/slots']) for (const [w, h] of SIZES) frames.push({ path, w, h });

const seed = `localStorage.setItem('token',${JSON.stringify(login.token)});localStorage.setItem('user',${JSON.stringify(JSON.stringify(login.user))});`;

const iframes = frames
  .map((f, i) => `<iframe id="f${i}" src="${f.path}" style="position:absolute;left:0;top:0;width:${f.w}px;height:${f.h}px;border:0;visibility:hidden"></iframe>`)
  .join('\n');

const probe = `
const frames = ${JSON.stringify(frames)};
const SEL = {
  dice: ['.gs__top', '.dx', '.dx__caption', '.dx__dial', '.dx__fair', '.gs__bar'],
  slots: ['.gs__top', '.slots-stage .cabinet', '.slots-stage .rt__fair', '.gs__bar'],
};
function rect(d, s) {
  const e = d.querySelector(s);
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) };
}
setTimeout(() => {
  const lines = [];
  frames.forEach((f, i) => {
    const d = document.getElementById('f' + i).contentDocument;
    const game = f.path === '/dice' ? 'dice' : 'slots';
    const r = {};
    SEL[game].forEach((s) => { r[s] = rect(d, s); });
    const bar = r['.gs__bar'];
    const top = r['.gs__top'];
    const board = game === 'dice' ? r['.dx'] : r['.slots-stage .cabinet'];
    const fair = game === 'dice' ? r['.dx__fair'] : r['.slots-stage .rt__fair'];
    const cap = r['.dx__caption'];
    let line = f.path + ' ' + f.w + 'x' + f.h + ' | bar top=' + (bar && bar.t) + ' h=' + (bar && bar.h);
    line += ' | board bottom=' + (board && board.b) + ' overlap=' + (board && bar ? board.b - bar.t : '?');
    if (fair) line += ' | fair bottom=' + fair.b + ' overlap=' + (bar ? fair.b - bar.t : '?');
    if (cap && top) line += ' | caption top - topbar bottom=' + (cap.t - top.b);
    if (game === 'dice' && r['.dx__dial']) line += ' | dial=' + r['.dx__dial'].w + 'px';
    lines.push(line);
  });
  document.getElementById('out').textContent = lines.join('\\n');
}, 8000);
`;

const page = `<body style="margin:0"><script>${seed}</script>\n${iframes}\n<pre id="out"></pre>\n<script>${probe}</script></body>`;
writeFileSync('dist/_measure.html', page);
writeFileSync(
  'dist/_frame.html',
  `<body style="margin:0;background:#111"><script>${seed}</script><iframe src="/dice" style="width:390px;height:780px;border:0;display:block"></iframe></body>`,
);

const prof = join(tmpdir(), 'measure-prof');
rmSync(prof, { recursive: true, force: true });
const run = spawnSync(
  EDGE,
  ['--headless', '--disable-gpu', '--no-first-run', `--user-data-dir=${prof}`, '--window-size=1000,1000', '--virtual-time-budget=40000', '--dump-dom', 'http://localhost:4173/_measure.html'],
  { encoding: 'utf8', timeout: 150000, maxBuffer: 64 * 1024 * 1024 },
);
const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(run.stdout ?? '');
console.log(
  match
    ? match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    : 'NO MEASUREMENT stdout=' + (run.stdout ?? '').length + ' stderr=' + (run.stderr ?? '').slice(-300),
);
