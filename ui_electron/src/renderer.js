const logsEl = document.getElementById('logs');
const fileTable = document.getElementById('fileTable');
const connStatus = document.getElementById('connStatus');
const toggleTheme = document.getElementById('toggleTheme');

// Dashboard metrics state
let totalUp = 0;
let totalDown = 0;
let totalFrames = 0;
let tputSeries = [];
let tputChart;

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB','MB','GB','TB'];
  let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < units.length-1);
  return `${n.toFixed(1)} ${units[i]}`;
}

function log(s) {
  const t = new Date().toISOString();
  logsEl.textContent += `[${t}] ${s}\n`;
  logsEl.scrollTop = logsEl.scrollHeight;
}

window.api.onLog((s) => log(s));

async function refresh() {
  try {
    const res = await window.api.list();
    if (!res.ok) throw new Error(res.error || 'List failed');
    fileTable.innerHTML = '';
    res.entries.forEach((name, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i + 1}</td><td>${name}</td>`;
      tr.addEventListener('click', () => {
        document.getElementById('downloadName').value = name;
        document.getElementById('deleteName').value = name;
      });
      fileTable.appendChild(tr);
    });
    log(`Refreshed list: ${res.entries.length} entries`);
  } catch (e) {
    log(`List error: ${e.message}`);
  }
}

async function connect() {
  const host = document.getElementById('host').value.trim();
  const port = parseInt(document.getElementById('port').value.trim(), 10);
  try {
    await window.api.init(host, port);
    log(`Connected to ${host}:${port}`);
    connStatus.className = 'badge text-bg-success';
    connStatus.textContent = 'Connected';
    await window.api.enableMetrics();
    await refresh();
  } catch (e) {
    log(`Init error: ${e.message}`);
    connStatus.className = 'badge text-bg-secondary';
    connStatus.textContent = 'Disconnected';
  }
}

document.getElementById('btnConnect').addEventListener('click', connect);

document.getElementById('btnRefresh').addEventListener('click', refresh);

document.getElementById('btnUpload').addEventListener('click', async () => {
  try {
    const res = await window.api.put();
    if (!res.ok) throw new Error(res.error || 'Upload failed');
    log(`Upload OK: ${res.bytes} bytes`);
    await refresh();
  } catch (e) {
    log(`Upload error: ${e.message}`);
  }
});

document.getElementById('btnDownload').addEventListener('click', async () => {
  const name = document.getElementById('downloadName').value.trim();
  if (!name) return;
  try {
    const res = await window.api.get(name);
    if (!res.ok) throw new Error(res.error || 'Download failed');
    log(`Download OK: ${res.bytes} bytes`);
  } catch (e) {
    log(`Download error: ${e.message}`);
  }
});

document.getElementById('btnDelete').addEventListener('click', async () => {
  const name = document.getElementById('deleteName').value.trim();
  if (!name) return;
  try {
    const res = await window.api.del(name);
    if (!res.ok) throw new Error(res.error || 'Delete failed');
    log('Delete OK');
    await refresh();
  } catch (e) {
    log(`Delete error: ${e.message}`);
  }
});

// Drag and drop upload
const dropZone = document.getElementById('dropZone');
if (dropZone) {
  const onOver = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
  const onLeave = (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); };
  const onDrop = async (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    const paths = [];
    for (const item of e.dataTransfer.items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        // Electron provides path on file objects in renderer
        if (file && file.path) paths.push(file.path);
      }
    }
    if (paths.length) {
      log(`Uploading ${paths.length} dropped file(s)...`);
      const res = await window.api.putPaths(paths);
      if (res.ok) {
        for (const r of res.results) {
          if (r.ok) log(`Upload OK: ${r.path} (${fmtBytes(r.bytes)})`);
          else log(`Upload failed: ${r.path} — ${r.error}`);
        }
        await refresh();
      }
    }
  };
  ['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, onOver));
  ['dragleave','dragend'].forEach(ev => dropZone.addEventListener(ev, onLeave));
  dropZone.addEventListener('drop', onDrop);
}

// Theme toggle
toggleTheme?.addEventListener('change', () => {
  document.body.classList.toggle('dark', toggleTheme.checked);
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'r') { e.preventDefault(); refresh(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'u') { e.preventDefault(); document.getElementById('btnUpload').click(); }
});

// Metrics and chart setup
function setupChart() {
  const ctx = document.getElementById('chartThroughput');
  if (!ctx) return;
  tputChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Bytes/s', data: [], borderColor: '#0d6efd', tension: .2 }] },
    options: { responsive: true, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
  });
}
setupChart();

function updateMetricsUi() {
  const mUpBytes = document.getElementById('mUpBytes');
  const mDownBytes = document.getElementById('mDownBytes');
  const mFrames = document.getElementById('mFrames');
  const mTput = document.getElementById('mTput');
  if (mUpBytes) mUpBytes.textContent = fmtBytes(totalUp);
  if (mDownBytes) mDownBytes.textContent = fmtBytes(totalDown);
  if (mFrames) mFrames.textContent = String(totalFrames);
  const last = tputSeries.at(-1) || { v: 0 };
  if (mTput) mTput.textContent = `${fmtBytes(last.v)}/s`;
}

// Aggregate metrics per second
let bucketBytes = 0;
let bucketTimer = setInterval(() => {
  if (!tputChart) return;
  const now = new Date();
  tputSeries.push({ t: now, v: bucketBytes });
  if (tputSeries.length > 60) tputSeries.shift();
  const labels = tputSeries.map(p => now.toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }));
  tputChart.data.labels = labels;
  tputChart.data.datasets[0].data = tputSeries.map(p => p.v);
  tputChart.update('none');
  bucketBytes = 0;
  updateMetricsUi();
}, 1000);

window.api.onMetrics((payload) => {
  totalFrames += 1;
  if (payload.type.startsWith('put')) totalUp = payload.bytesTotal || totalUp;
  if (payload.type.startsWith('get')) totalDown = payload.bytesTotal || totalDown;
  bucketBytes += payload.len || 0;
  updateMetricsUi();
});

// Ping button
document.getElementById('btnPing')?.addEventListener('click', async () => {
  try { const res = await window.api.ping(); document.getElementById('rttVal').textContent = `RTT: ${res.rttMs} ms`; }
  catch (e) { document.getElementById('rttVal').textContent = 'RTT: —'; }
});

// Checksum tool
document.getElementById('checksumFile')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file || !file.path) return;
  const out = document.getElementById('checksumOut');
  out.textContent = 'Computing…';
  try { const res = await window.api.checksumFile(file.path); if (res.ok) out.textContent = `${res.algo}: ${res.digest}`; else out.textContent = `Error: ${res.error}`; }
  catch (err) { out.textContent = `Error: ${err.message}`; }
});

// Speed hint tool (simple estimator)
document.getElementById('btnSpeedHint')?.addEventListener('click', async () => {
  const rttLabel = document.getElementById('rttVal').textContent;
  const m = /RTT: (\d+)/.exec(rttLabel);
  const rtt = m ? parseInt(m[1], 10) : 50; // ms default
  const win = parseInt(document.getElementById('swWindow')?.value || '8', 10);
  const frame = 2048; // bytes per frame payload approx
  const bytesPerRtt = win * frame;
  const tputBps = (bytesPerRtt / (rtt / 1000));
  document.getElementById('speedHint').textContent = `With window=${win} and RTT≈${rtt}ms, ideal throughput ≈ ${fmtBytes(tputBps)}/s (ignoring loss).`;
});

// Sliding window simulator
const swTimeline = document.getElementById('swTimeline');
function renderTimeline(win, lossPct) {
  if (!swTimeline) return;
  swTimeline.innerHTML = '';
  const width = swTimeline.clientWidth || 600;
  const slot = Math.max(24, Math.floor((width - 20) / win) - 6);
  let losses = 0;
  for (let i=0;i<win;i++) {
    const el = document.createElement('div');
    el.className = 'frame';
    const lost = Math.random()*100 < lossPct;
    if (lost) { el.classList.add('lost'); losses++; }
    el.style.left = (10 + i*(slot+6)) + 'px';
    el.style.width = slot + 'px';
    el.textContent = String(i+1);
    swTimeline.appendChild(el);
  }
  const rtt = Math.max(20, 50 + Math.floor(lossPct));
  const eff = Math.max(0, 1 - lossPct/100);
  const frame = 2048; const bytesPerRtt = win*frame*eff;
  document.getElementById('swThroughput').textContent = `${fmtBytes(bytesPerRtt / (rtt/1000))}/s (RTT≈${rtt}ms, loss≈${lossPct}%)`;
}
const swWindow = document.getElementById('swWindow');
const swLoss = document.getElementById('swLoss');
function rerenderSW() { renderTimeline(parseInt(swWindow.value,10), parseInt(swLoss.value,10)); }
swWindow?.addEventListener('input', rerenderSW);
swLoss?.addEventListener('input', rerenderSW);
setTimeout(rerenderSW, 0);
