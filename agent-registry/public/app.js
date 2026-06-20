const canvas = document.getElementById('mesh');
const ctx = canvas.getContext('2d');
const pointer = { x: 0, y: 0, active: false };

let width = 0;
let height = 0;
let nodes = [];
let rafId = 0;

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const count = Math.min(170, Math.max(72, Math.floor((width * height) / 12000)));
  nodes = Array.from({ length: count }, (_, index) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.42,
    vy: (Math.random() - 0.5) * 0.42,
    r: index % 9 === 0 ? 2.1 : 1.25,
    phase: Math.random() * Math.PI * 2,
  }));
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(5, 7, 10, 0.36)';
  ctx.fillRect(0, 0, width, height);

  for (const node of nodes) {
    node.x += node.vx;
    node.y += node.vy;
    node.phase += 0.014;

    if (node.x < -20) node.x = width + 20;
    if (node.x > width + 20) node.x = -20;
    if (node.y < -20) node.y = height + 20;
    if (node.y > height + 20) node.y = -20;

    if (pointer.active) {
      const dx = pointer.x - node.x;
      const dy = pointer.y - node.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 180 && dist > 1) {
        node.x -= (dx / dist) * 0.22;
        node.y -= (dy / dist) * 0.22;
      }
    }
  }

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy);
      const limit = width < 700 ? 92 : 132;

      if (dist < limit) {
        const alpha = (1 - dist / limit) * 0.42;
        const mix = (Math.sin(a.phase + b.phase) + 1) / 2;
        const r = Math.round(124 + mix * 45);
        const g = Math.round(210 + mix * 30);
        const bl = Math.round(190 - mix * 80);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${bl}, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  for (const node of nodes) {
    const glow = (Math.sin(node.phase) + 1) / 2;
    ctx.fillStyle = `rgba(236, 255, 246, ${0.44 + glow * 0.34})`;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r + glow * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  rafId = requestAnimationFrame(draw);
}

window.addEventListener('resize', resize);
window.addEventListener('pointermove', (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.active = true;
});
window.addEventListener('pointerleave', () => {
  pointer.active = false;
});

resize();
draw();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
  } else {
    draw();
  }
});

// ---- live data: feed landing KPIs and let the mesh react to real activity ----
(function axpLive() {
  const strip = document.getElementById('kpis');
  const fetchJson = async (path) => {
    try {
      const res = await fetch(path, { headers: { accept: 'application/json' } });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  const f = (n) => {
    const v = Number(n) || 0;
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return String(Math.round(v));
  };

  function syncLiveNodes(target) {
    nodes = nodes.filter((node) => !node.live);
    const count = Math.max(0, Math.min(60, Math.round(target)));
    for (let i = 0; i < count; i += 1) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: 2.1,
        phase: Math.random() * Math.PI * 2,
        live: true,
      });
    }
  }

  async function tick() {
    const live = await fetchJson('/network/live');
    if (!live) return;
    const a = live.agents?.count ?? 0;
    const ev = live.events?.count ?? 0;
    const k = Number(live.metrics?.k_factor ?? 0);
    const it = live.intents?.count ?? 0;
    const scions = live.metrics?.population?.scions ?? 0;

    if (strip) {
      const cards = [
        ['Live Agents', String(a)],
        ['Trust Events', ev >= 500 ? '500+' : String(ev)],
        ['Open Intents', String(it)],
        ['Scions', String(scions)],
        ['Viral K', k.toFixed(2)],
        ['Network', 'Live'],
      ];
      strip.innerHTML = cards
        .map(([l, v], i) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-value ${i % 2 ? '' : 'accent'}">${v}</div></div>`)
        .join('');
    }
    // the web densifies with the real agent population
    syncLiveNodes(a + scions);
  }

  tick();
  setInterval(tick, 15000);
})();
