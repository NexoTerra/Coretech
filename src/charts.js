// ---------- Lightweight inline-SVG chart builders (no external deps) ----------
function fmtNum(n, decimals) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('es-CO', { maximumFractionDigits: decimals === undefined ? 0 : decimals, minimumFractionDigits: decimals === undefined ? 0 : decimals });
}
function fmtCompact(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return fmtNum(n);
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// Rough average glyph width for the body font at a given px size (Latin text).
function truncateToWidth(text, pxAvailable, fontPx) {
  const charPx = (fontPx || 10.5) * 0.58;
  const maxChars = Math.max(3, Math.floor(pxAvailable / charPx));
  text = String(text);
  return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
}

// Vertical bar chart. items: [{label, value, partial?, color?, tooltip?}]
function svgVBarChart(items, opts) {
  opts = opts || {};
  const W = opts.width || 560, H = opts.height || 220;
  const padL = 44, padR = 10, padT = 14, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  if (!items.length) return `<div class="empty-note">Sin datos para los filtros actuales.</div>`;
  const maxV = opts.maxV || Math.max(...items.map(d => d.value), 1);
  const fmtV = opts.valueFmt || fmtCompact;
  const n = items.length;
  const gap = plotW / n * 0.28;
  const bw = plotW / n - gap;
  const color = opts.color || 'var(--blue)';
  const partialColor = opts.partialColor || 'var(--gray3)';

  let bars = '', labels = '', gridLines = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const y = padT + plotH - (plotH * i / ticks);
    const val = maxV * i / ticks;
    gridLines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="axis-line"/>`;
    gridLines += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="bar-label">${fmtV(val)}</text>`;
  }
  if (opts.refLines) {
    opts.refLines.forEach(rl => {
      const y = padT + plotH - plotH * (Math.min(rl.value, maxV) / maxV);
      gridLines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="ref-line"/>`;
      gridLines += `<text x="${W - padR}" y="${(y - 3).toFixed(1)}" text-anchor="end" class="badge-partial">${esc(rl.label)}</text>`;
    });
  }
  items.forEach((d, i) => {
    const x = padL + i * (plotW / n) + gap / 2;
    const v = Math.min(d.value, maxV);
    const h = plotH * (v / maxV);
    const y = padT + plotH - h;
    const c = d.color || (d.partial ? partialColor : color);
    const tooltip = d.tooltip || `${esc(d.label)}: ${fmtNum(d.value)}${d.partial ? ' (mes parcial)' : ''}`;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h,0).toFixed(1)}" rx="3" fill="${c}"><title>${tooltip}</title></rect>`;
    if (bw > 18) {
      bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" class="bar-value">${fmtV(d.value)}</text>`;
    }
    labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - padB + 15}" text-anchor="middle" class="bar-label">${esc(d.label)}</text>`;
    if (d.partial) labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - padB + 26}" text-anchor="middle" class="badge-partial">parcial</text>`;
  });
  return `<div style="overflow-x:auto;"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="min-width:${Math.min(W,320)}px" role="img">${gridLines}${bars}${labels}</svg></div>`;
}

// Horizontal bar chart. items: [{label, value, color?, sub?}]
function svgHBarChart(items, opts) {
  opts = opts || {};
  const W = Math.max(opts.width || 560, 280);
  const rowH = opts.rowH || 26;
  const padT = 8;
  // Reserve proportional space for labels/values so long text can never spill
  // outside the SVG (which is what caused the "desbordada" chart before).
  const padL = Math.round(Math.min(opts.padL || 190, W * 0.42));
  const padR = Math.round(Math.min(opts.padR || 64, W * 0.22));
  const H = padT * 2 + items.length * rowH;
  if (!items.length) return `<div class="empty-note">Sin datos para los filtros actuales.</div>`;
  const maxV = opts.maxV || Math.max(...items.map(d => d.value), 1);
  const plotW = W - padL - padR;
  const color = opts.color || 'var(--blue)';

  let rows = '';
  items.forEach((d, i) => {
    const y = padT + i * rowH;
    const w = Math.max(plotW * (Math.min(d.value, maxV) / maxV), 2);
    const c = d.color || color;
    const label = truncateToWidth(d.label, padL - 14);
    const valueLabel = truncateToWidth(d.valueLabel || fmtCompact(d.value), Math.max(padR - 8, 30));
    rows += `<text x="${padL - 10}" y="${(y + rowH / 2 + 4).toFixed(1)}" text-anchor="end" class="bar-label">${esc(label)}</text>`;
    rows += `<rect x="${padL}" y="${(y + 4).toFixed(1)}" width="${w.toFixed(1)}" height="${rowH - 8}" rx="4" fill="${c}"><title>${esc(d.label)}: ${d.tooltip || fmtNum(d.value)}</title></rect>`;
    rows += `<text x="${(padL + w + 8).toFixed(1)}" y="${(y + rowH / 2 + 4).toFixed(1)}" class="bar-value">${esc(valueLabel)}</text>`;
  });
  let refLines = '';
  if (opts.refLines) {
    // Anchor each label so its text never spills past the SVG edges — a
    // centered label near the right/left border was getting clipped and
    // overlapping its neighbor (the "no se ve la leyenda" overflow bug).
    opts.refLines.forEach((rl, i) => {
      const x = padL + plotW * (Math.min(rl.value, maxV) / maxV);
      const nearRight = x > W - 34;
      const nearLeft = x < 34;
      const anchor = nearRight ? 'end' : nearLeft ? 'start' : 'middle';
      const labelX = nearRight ? Math.min(x, W - 2) : nearLeft ? Math.max(x, 2) : x;
      const ty = padT - 4 - (i % 2) * 11; // stagger alternating labels so close ref lines don't overlap
      refLines += `<line x1="${x.toFixed(1)}" y1="${padT - 2}" x2="${x.toFixed(1)}" y2="${H - padT + 2}" class="ref-line"/>`;
      refLines += `<text x="${labelX.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" class="badge-partial">${esc(rl.label)}</text>`;
    });
  }
  const topPad = opts.refLines && opts.refLines.length > 1 ? 12 : 0;
  return `<div style="overflow-x:auto;"><svg viewBox="0 ${-topPad} ${W} ${H + topPad}" width="100%" height="${H + topPad}" style="min-width:${Math.min(W,320)}px" role="img">${rows}${refLines}</svg></div>`;
}

function rendPillClass(pct) {
  if (pct >= 100) return 'ok';
  if (pct >= 85) return 'warn';
  return 'bad';
}
function rendColor(pct) {
  if (pct >= 100) return 'var(--green)';
  if (pct >= 85) return 'var(--orange)';
  return 'var(--red)';
}

if (typeof module !== 'undefined') {
  module.exports = { fmtNum, fmtCompact, esc, svgVBarChart, svgHBarChart, rendPillClass, rendColor };
}
