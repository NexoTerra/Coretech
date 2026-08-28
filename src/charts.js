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

// Vertical STACKED bar chart. items: [{label, total, segments: [{value, color, tooltip}]}]
// Usado para "metros por código dentro de cada referencia": cada barra es una
// referencia, cada segmento un código individual (puede haber decenas), así
// que no se rotulan los segmentos por separado — el color y el tooltip cargan
// el detalle.
function svgVBarChartStacked(items, opts) {
  opts = opts || {};
  const W = opts.width || 560, H = opts.height || 240;
  const padL = 54, padR = 10, padT = 18, padB = 60;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  if (!items.length) return `<div class="empty-note">Sin datos para los filtros actuales.</div>`;
  const maxV = opts.maxV || Math.max(...items.map(d => d.total), 1);
  const fmtV = opts.valueFmt || fmtCompact;
  const n = items.length;
  const gap = plotW / n * 0.28;
  const bw = plotW / n - gap;

  let bars = '', labels = '', gridLines = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const y = padT + plotH - (plotH * i / ticks);
    const val = maxV * i / ticks;
    gridLines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="axis-line"/>`;
    gridLines += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="bar-label">${fmtV(val)}</text>`;
  }
  items.forEach((d, i) => {
    const x = padL + i * (plotW / n) + gap / 2;
    let yCursor = padT + plotH;
    (d.segments || []).forEach(seg => {
      const segH = plotH * (Math.min(seg.value, maxV) / maxV);
      const y = yCursor - segH;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(segH, 0).toFixed(1)}" fill="${seg.color}"><title>${esc(seg.tooltip)}</title></rect>`;
      yCursor = y;
    });
    const topY = padT + plotH - plotH * (Math.min(d.total, maxV) / maxV);
    bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${(topY - 6).toFixed(1)}" text-anchor="middle" class="bar-value">${fmtV(d.total)}</text>`;
    const label = truncateToWidth(d.label, plotW / n + 10, 10);
    labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" class="bar-label" transform="rotate(20 ${(x + bw / 2).toFixed(1)} ${H - padB + 16})">${esc(label)}</text>`;
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

// Horizontal grouped bar chart, 2 bars per row for comparison (e.g. CPM real
// vs. CPM ideal). items: [{label, a, b, aValueLabel?, bValueLabel?, tooltipA?, tooltipB?}]
function svgHBarChartPaired(items, opts) {
  opts = opts || {};
  const W = Math.max(opts.width || 560, 280);
  const rowH = opts.rowH || 34;
  const padT = 8;
  const padL = Math.round(Math.min(opts.padL || 190, W * 0.42));
  const padR = Math.round(Math.min(opts.padR || 70, W * 0.22));
  const H = padT * 2 + items.length * rowH;
  if (!items.length) return `<div class="empty-note">Sin datos para los filtros actuales.</div>`;
  const maxV = opts.maxV || Math.max(...items.map(d => Math.max(d.a || 0, d.b || 0)), 1);
  const plotW = W - padL - padR;
  const colorA = opts.colorA || 'var(--navy)';
  const colorB = opts.colorB || 'var(--cyan3)';
  const aLabel = opts.aLabel || 'A', bLabel = opts.bLabel || 'B';
  const subH = Math.min(12, (rowH - 10) / 2);

  let rows = '';
  items.forEach((d, i) => {
    const y = padT + i * rowH;
    const label = truncateToWidth(d.label, padL - 14);
    rows += `<text x="${padL - 10}" y="${(y + rowH / 2 + 4).toFixed(1)}" text-anchor="end" class="bar-label">${esc(label)}</text>`;
    if (d.a !== null && d.a !== undefined) {
      const wa = Math.max(plotW * (Math.min(d.a, maxV) / maxV), 2);
      rows += `<rect x="${padL}" y="${(y + 2).toFixed(1)}" width="${wa.toFixed(1)}" height="${subH.toFixed(1)}" rx="3" fill="${colorA}"><title>${esc(d.label)} · ${esc(aLabel)}: ${d.tooltipA || fmtNum(d.a, 3)}</title></rect>`;
      rows += `<text x="${(padL + wa + 6).toFixed(1)}" y="${(y + 2 + subH / 2 + 3.5).toFixed(1)}" class="bar-value">${esc(d.aValueLabel || fmtCompact(d.a))}</text>`;
    }
    if (d.b !== null && d.b !== undefined) {
      const yb = y + 2 + subH + 3;
      const wb = Math.max(plotW * (Math.min(d.b, maxV) / maxV), 2);
      rows += `<rect x="${padL}" y="${yb.toFixed(1)}" width="${wb.toFixed(1)}" height="${subH.toFixed(1)}" rx="3" fill="${colorB}"><title>${esc(d.label)} · ${esc(bLabel)}: ${d.tooltipB || fmtNum(d.b, 3)}</title></rect>`;
      rows += `<text x="${(padL + wb + 6).toFixed(1)}" y="${(yb + subH / 2 + 3.5).toFixed(1)}" class="bar-value">${esc(d.bValueLabel || fmtCompact(d.b))}</text>`;
    }
  });
  const legend = `<div class="chart-legend"><span class="legend-item"><span class="legend-dot" style="background:${colorA}"></span>${esc(aLabel)}</span><span class="legend-item"><span class="legend-dot" style="background:${colorB}"></span>${esc(bLabel)}</span></div>`;
  return `${legend}<div style="overflow-x:auto;"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="min-width:${Math.min(W,320)}px" role="img">${rows}</svg></div>`;
}

// Multi-series line chart (e.g. CPM por herramienta a través de varios meses).
// categories: [string]; series: [{name, color?, values: [number|null]}] — un
// valor null deja un hueco en la línea (mes sin dato) en vez de interpolar.
function svgLineChart(categories, series, opts) {
  opts = opts || {};
  const W = opts.width || 560, H = opts.height || 220;
  const padL = 44, padR = 14, padT = 10, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const usable = series.filter(s => s.values.some(v => v !== null && v !== undefined));
  if (!categories.length || !usable.length) return `<div class="empty-note">Sin datos para los filtros actuales.</div>`;
  const allVals = usable.flatMap(s => s.values.filter(v => v !== null && v !== undefined));
  const maxV = opts.maxV || Math.max(...allVals) * 1.15;
  const fmtV = opts.valueFmt || fmtCompact;
  const n = categories.length;
  const stepX = n > 1 ? plotW / (n - 1) : 0;
  const xAt = i => n > 1 ? padL + i * stepX : padL + plotW / 2;
  const yAt = v => padT + plotH - plotH * (Math.min(v, maxV) / maxV);

  let gridLines = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const y = padT + plotH - (plotH * i / ticks);
    const val = maxV * i / ticks;
    gridLines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="axis-line"/>`;
    gridLines += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="bar-label">${fmtV(val)}</text>`;
  }
  let labels = '';
  categories.forEach((cat, i) => {
    labels += `<text x="${xAt(i).toFixed(1)}" y="${H - padB + 15}" text-anchor="middle" class="bar-label">${esc(truncateToWidth(cat, stepX || plotW, 9.5))}</text>`;
  });

  let paths = '', legend = '';
  const palette = ['var(--ramp3)', 'var(--orange)', 'var(--green)', 'var(--ramp1)', 'var(--red)', 'var(--navy)'];
  usable.forEach((s, si) => {
    const color = s.color || palette[si % palette.length];
    let d = '', drawing = false, dots = '';
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) { drawing = false; return; }
      const x = xAt(i), y = yAt(v);
      d += (drawing ? ' L ' : ' M ') + x.toFixed(1) + ',' + y.toFixed(1);
      drawing = true;
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}"><title>${esc(s.name)} · ${esc(categories[i])}: ${fmtV(v)}</title></circle>`;
    });
    paths += `<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2"/>${dots}`;
    legend += `<span class="legend-item"><span class="legend-dot" style="background:${color}"></span>${esc(s.name)}</span>`;
  });

  return `<div class="chart-legend">${legend}</div><div style="overflow-x:auto;"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="min-width:${Math.min(W,320)}px" role="img">${gridLines}${paths}${labels}</svg></div>`;
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
  module.exports = { fmtNum, fmtCompact, esc, svgVBarChart, svgVBarChartStacked, svgHBarChart, svgHBarChartPaired, svgLineChart, rendPillClass, rendColor };
}
