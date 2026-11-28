// ---------- Lightweight inline-SVG chart builders (no external deps) ----------
// Reglas visuales (skill dataviz): barras finas (<= 24 px) con extremo de datos redondeado de 4 px y base recta;
// líneas de 2 px; marcadores de 8 px con anillo del color de la superficie; cuadrícula de línea fina y sólida;
// etiquetas selectivas (nunca un número en cada punto); texto con tokens de texto, nunca con el color de la serie;
// un tooltip propio (atributo data-tip) en vez del nativo. Los colores llevan valor de respaldo para que los
// informes imprimibles, que no cargan el CSS del tablero, se vean igual.
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
// Recorta el texto con «…» para que quepa en pxAvailable. Se mide con la fuente real (canvas) y, si no hay DOM,
// se estima: las etiquetas de herramientas vienen en MAYÚSCULAS, que son bastante más anchas que el texto normal.
let _measureCtx;
function truncateToWidth(text, pxAvailable, fontPx) {
  text = String(text);
  const px = fontPx || 10.5;
  if (typeof document !== 'undefined') {
    if (_measureCtx === undefined) { try { _measureCtx = document.createElement('canvas').getContext('2d'); } catch (e) { _measureCtx = null; } }
    if (_measureCtx) {
      _measureCtx.font = `${px}px Barlow, "Segoe UI", system-ui, sans-serif`;
      const fits = (s) => _measureCtx.measureText(s).width * 1.04 <= pxAvailable;
      if (fits(text)) return text;
      let lo = 1, hi = text.length - 1, best = 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (fits(text.slice(0, mid) + '…')) { best = mid; lo = mid + 1; } else hi = mid - 1; }
      return text.slice(0, best).trimEnd() + '…';
    }
  }
  const charPx = px * 0.62;
  const maxChars = Math.max(3, Math.floor(pxAvailable / charPx));
  return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
}

// Escala con marcas redondas (1, 2, 2,5, 5 × 10^k): 0 / 10K / 20K en vez de 0 / 10,1K / 20,1K.
// Sin tope fijo, el máximo sube hasta la siguiente marca; con tope fijo (p. ej. 150 %) se respeta el tope.
function niceScale(maxV, fixed, desired) {
  desired = desired || 5; // como máximo 5 intervalos
  const mx = Math.max(maxV, 1e-9);
  const pow = Math.pow(10, Math.floor(Math.log10(mx / desired)));
  const step = [1, 2, 2.5, 5, 10, 20].map(m => m * pow).find(s => Math.ceil(mx / s - 1e-9) <= desired);
  const top = fixed ? maxV : Math.ceil(mx / step - 1e-9) * step;
  const ticks = [];
  for (let v = 0; v <= top + step * 1e-6; v += step) ticks.push(v);
  return { max: top, ticks };
}

// Colores de las series (categóricos, en orden fijo; paleta validada para visión normal y daltonismo).
const CH = {
  s: ['var(--s1,#0b93cf)', 'var(--s2,#eb6834)', 'var(--s3,#1baf7a)', 'var(--s4,#eda100)', 'var(--s5,#e87ba4)', 'var(--s6,#008300)', 'var(--s7,#6250d6)', 'var(--s8,#e34948)'],
  grid: 'var(--grid,#E3E9F1)', base: 'var(--border-strong,#C8D2DF)',
  ink: 'var(--text,#12233F)', ink2: 'var(--text-dim,#475671)', ink3: 'var(--text-faint,#65748B)',
  surface: 'var(--surface,#fff)', ref: 'var(--ref-series,#9AAEC6)', other: 'var(--gray2,#9B9B9B)',
};
const tipAttr = (t) => ` data-tip="${esc(t)}" tabindex="0"`;
const tipJson = (h, rows) => ` data-tip="${esc(JSON.stringify({ h, r: rows }))}" tabindex="0"`;
// Rectángulo con el extremo de datos redondeado y la base recta (r = 4 px como máximo).
function pathTopRounded(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x.toFixed(1)},${(y + h).toFixed(1)}V${(y + r).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)}V${(y + h).toFixed(1)}Z`;
}
function pathRightRounded(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, h / 2, w));
  return `M${x.toFixed(1)},${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)}V${(y + h - r).toFixed(1)}Q${(x + w).toFixed(1)},${(y + h).toFixed(1)} ${(x + w - r).toFixed(1)},${(y + h).toFixed(1)}H${x.toFixed(1)}Z`;
}
const txt = (x, y, anchor, cls, content, extra) => `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" text-anchor="${anchor}" class="${cls}"${extra || ''}>${content}</text>`;
const gridLine = (x1, y1, x2, y2, base) => `<line x1="${(+x1).toFixed(1)}" y1="${(+y1).toFixed(1)}" x2="${(+x2).toFixed(1)}" y2="${(+y2).toFixed(1)}" stroke="${base ? CH.base : CH.grid}" stroke-width="1" class="axis-line"/>`;
const wrapSvg = (W, H, minW, inner, extraClass) => `<div class="chart-scroll"><svg class="ch${extraClass ? ' ' + extraClass : ''}" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="min-width:${minW}px" role="img">${inner}</svg></div>`;

// Vertical bar chart. items: [{label, value, partial?, color?, tooltip?}]
function svgVBarChart(items, opts) {
  opts = opts || {};
  const W = opts.width || 560, H = opts.height || 230;
  const padL = 40, padR = 8, padT = 24, padB = 32;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  if (!items.length) return `<div class="empty-note">Sin datos para los filtros actuales.</div>`;
  const sc = niceScale(opts.maxV || Math.max(...items.map(d => d.value), 1), !!opts.maxV);
  const maxV = sc.max;
  const fmtV = opts.valueFmt || fmtCompact;
  const n = items.length;
  const slot = plotW / n;
  const bw = Math.min(24, Math.max(4, slot * 0.62));
  const color = opts.color || CH.s[0];
  let grid = '', bars = '', labels = '', marks = '';
  sc.ticks.forEach((tv, i) => {
    const y = padT + plotH - plotH * (tv / maxV);
    grid += gridLine(padL, y, W - padR, y, i === 0);
    grid += txt(padL - 8, y + 4, 'end', 'bar-label', fmtV(tv));
  });
  if (opts.refLines) {
    opts.refLines.forEach(rl => {
      const y = padT + plotH - plotH * (Math.min(rl.value, maxV) / maxV);
      marks += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="ref-line"/>`;
      marks += txt(W - padR, y - 4, 'end', 'bar-label', esc(rl.label));
    });
  }
  // etiquetas selectivas: la barra más alta y la última
  const iMax = items.reduce((m, d, i) => (d.value > items[m].value ? i : m), 0);
  const showEvery = slot < 30 ? Math.ceil(30 / slot) : 1;
  items.forEach((d, i) => {
    const cx = padL + i * slot + slot / 2, x = cx - bw / 2;
    const v = Math.min(d.value, maxV);
    const h = Math.max(plotH * (v / maxV), 0);
    const y = padT + plotH - h;
    const c = d.color || color;
    const tooltip = d.tooltip || `${d.label}: ${fmtNum(d.value)}${d.partial ? ' (mes parcial)' : ''}`;
    bars += `<path class="mk" d="${pathTopRounded(x, y, bw, h, 4)}" fill="${c}"${d.partial ? ' fill-opacity=".38"' : ''}${tipAttr(tooltip)}/>`;
    if (i === iMax || i === n - 1) bars += txt(cx, y - 6, 'middle', 'bar-value', fmtV(d.value));
    if (i % showEvery === 0) labels += txt(cx, H - padB + 17, 'middle', 'bar-label', esc(d.label));
    if (d.partial && i % showEvery === 0) labels += txt(cx, H - padB + 28, 'middle', 'badge-partial', 'parcial');
  });
  return wrapSvg(W, H, Math.min(W, 320), grid + marks + bars + labels);
}

// Vertical grouped bar chart, 2 bars per categoría (p.ej. metro garantizado vs. metros logrados por cada código
// de una referencia). El ancho crece con la cantidad de categorías (hay decenas de códigos): el usuario se desplaza
// horizontalmente en vez de ver barras ilegibles.
// items: [{label, a, b, aValueLabel?, bValueLabel?, tooltipA?, tooltipB?, bColor?}]
function svgVBarChartGrouped(items, opts) {
  opts = opts || {};
  const H = opts.height || 260;
  const padL = 48, padR = 14, padT = 22, padB = 66;
  const groupW = opts.groupWidth || 64;
  const plotH = H - padT - padB;
  if (!items.length) return `<div class="empty-note">Sin datos para los filtros actuales.</div>`;
  const containerW = opts.width || 560;
  const W = Math.max(containerW, padL + padR + groupW * items.length);
  const plotEndX = W - padR;
  const sc = niceScale(opts.maxV || Math.max(...items.map(d => Math.max(d.a || 0, d.b || 0)), 1), !!opts.maxV);
  const maxV = sc.max;
  const fmtV = opts.valueFmt || fmtCompact;
  const colorA = opts.colorA || CH.ref, colorB = opts.colorB || CH.s[0];
  const barW = Math.min(14, groupW * 0.32);
  let grid = '', bars = '', labels = '';
  sc.ticks.forEach((tv, i) => {
    const y = padT + plotH - plotH * (tv / maxV);
    grid += gridLine(padL, y, plotEndX, y, i === 0);
    grid += txt(padL - 8, y + 4, 'end', 'bar-label', fmtV(tv));
  });
  items.forEach((d, i) => {
    const cx = padL + i * groupW + groupW / 2;
    if (d.a !== null && d.a !== undefined) {
      const h = plotH * (Math.min(d.a, maxV) / maxV);
      bars += `<path class="mk" d="${pathTopRounded(cx - barW - 1, padT + plotH - h, barW, h, 4)}" fill="${colorA}"${tipAttr(`${d.label}: ${d.tooltipA || fmtNum(d.a)}`)}/>`;
    }
    if (d.b !== null && d.b !== undefined) {
      const h = plotH * (Math.min(d.b, maxV) / maxV);
      bars += `<path class="mk" d="${pathTopRounded(cx + 1, padT + plotH - h, barW, h, 4)}" fill="${d.bColor || colorB}"${tipAttr(`${d.label}: ${d.tooltipB || fmtNum(d.b)}`)}/>`;
    }
    const label = truncateToWidth(d.label, groupW + 24, 10);
    labels += txt(cx, H - padB + 16, 'middle', 'bar-label', esc(label), ` transform="rotate(30 ${cx.toFixed(1)} ${H - padB + 16})"`);
  });
  const legend = opts.aLabel || opts.bLabel
    ? `<div class="chart-legend"><span class="legend-item"><span class="legend-dot" style="background:${colorA}"></span>${esc(opts.aLabel || 'A')}</span><span class="legend-item"><span class="legend-dot" style="background:${colorB}"></span>${esc(opts.bLabel || 'B')}</span></div>` : '';
  return legend + wrapSvg(W, H, W, grid + bars + labels);
}

// Horizontal bar chart. items: [{label, value, color?, valueLabel?, tooltip?}]
function svgHBarChart(items, opts) {
  opts = opts || {};
  const W = Math.max(opts.width || 560, 280);
  const rowH = opts.rowH || 26;
  const refRows = opts.refLines ? Math.min(opts.refLines.length, 2) : 0;
  const padT = 6 + refRows * 12; // sitio arriba para las etiquetas de las líneas de referencia
  // Reserve proportional space for labels/values so long text can never spill outside the SVG.
  const padL = Math.round(Math.min(opts.padL || 190, W * 0.42));
  const padR = Math.round(Math.min(opts.padR || 64, W * 0.22));
  const H = padT + 6 + items.length * rowH;
  if (!items.length) return `<div class="empty-note">Sin datos para los filtros actuales.</div>`;
  const maxV = opts.maxV || Math.max(...items.map(d => d.value), 1);
  const plotW = W - padL - padR;
  const color = opts.color || CH.s[0];
  const bh = Math.min(16, rowH - 10);
  let rows = '', refLines = '';
  items.forEach((d, i) => {
    const y = padT + i * rowH, cy = y + rowH / 2;
    const w = Math.max(plotW * (Math.min(d.value, maxV) / maxV), 3);
    const label = truncateToWidth(d.label, padL - 14, 12);
    const valueLabel = truncateToWidth(d.valueLabel || fmtCompact(d.value), Math.max(padR - 6, 30), 12);
    rows += `<g class="row"${tipAttr(`${d.label}: ${d.tooltip || fmtNum(d.value)}`)}><rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>`
      + txt(padL - 10, cy + 4, 'end', 'bar-label', esc(label))
      + `<path class="mk" d="${pathRightRounded(padL, cy - bh / 2, w, bh, 4)}" fill="${d.color || color}"/>`
      + txt(padL + w + 8, cy + 4, 'start', 'bar-value', esc(valueLabel)) + `</g>`;
  });
  rows = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - 6}" stroke="${CH.base}" stroke-width="1" class="axis-line"/>` + rows;
  if (opts.refLines) {
    opts.refLines.forEach((rl, i) => {
      const x = padL + plotW * (Math.min(rl.value, maxV) / maxV);
      const nearRight = x > W - 40, nearLeft = x < 40;
      const ty = 10 + (i % 2) * 12; // las etiquetas se escalonan para que dos líneas cercanas no se pisen
      refLines += `<line x1="${x.toFixed(1)}" y1="${ty + 3}" x2="${x.toFixed(1)}" y2="${H - 6}" class="ref-line"/>`;
      refLines += txt(nearRight ? Math.min(x, W - 2) : nearLeft ? Math.max(x, 2) : x, ty, nearRight ? 'end' : nearLeft ? 'start' : 'middle', 'bar-label', esc(rl.label));
    });
  }
  return wrapSvg(W, H, Math.min(W, 320), rows + refLines);
}

// Horizontal grouped bar chart, 2 bars per row for comparison (e.g. CPM real vs. CPM ideal).
// items: [{label, a, b, aValueLabel?, bValueLabel?, tooltipA?, tooltipB?}]
function svgHBarChartPaired(items, opts) {
  opts = opts || {};
  const W = Math.max(opts.width || 560, 280);
  const rowH = opts.rowH || 34;
  const padT = 6;
  const padL = Math.round(Math.min(opts.padL || 190, W * 0.42));
  const padR = Math.round(Math.min(opts.padR || 70, W * 0.22));
  const H = padT * 2 + items.length * rowH;
  if (!items.length) return `<div class="empty-note">Sin datos para los filtros actuales.</div>`;
  const maxV = opts.maxV || Math.max(...items.map(d => Math.max(d.a || 0, d.b || 0)), 1);
  const plotW = W - padL - padR;
  const colorA = opts.colorA || CH.s[0], colorB = opts.colorB || CH.ref;
  const aLabel = opts.aLabel || 'A', bLabel = opts.bLabel || 'B';
  const subH = Math.min(9, (rowH - 12) / 2);
  const labelB = items.length <= 6;
  let rows = '';
  items.forEach((d, i) => {
    const y = padT + i * rowH, cy = y + rowH / 2;
    const label = truncateToWidth(d.label, padL - 14, 12);
    const ya = cy - subH - 1, yb = cy + 1;
    let g = `<g class="row"${tipAttr(`${d.label}\n${aLabel}: ${d.tooltipA || (d.a === null || d.a === undefined ? '—' : fmtNum(d.a, 3))}\n${bLabel}: ${d.tooltipB || (d.b === null || d.b === undefined ? '—' : fmtNum(d.b, 3))}`)}><rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>`;
    g += txt(padL - 10, cy + 4, 'end', 'bar-label', esc(label));
    if (d.a !== null && d.a !== undefined) {
      const wa = Math.max(plotW * (Math.min(d.a, maxV) / maxV), 3);
      g += `<path class="mk" d="${pathRightRounded(padL, ya, wa, subH, 4)}" fill="${colorA}"/>` + txt(padL + wa + 7, ya + subH / 2 + 4, 'start', 'bar-value', esc(d.aValueLabel || fmtCompact(d.a)));
    }
    if (d.b !== null && d.b !== undefined) {
      const wb = Math.max(plotW * (Math.min(d.b, maxV) / maxV), 3);
      g += `<path class="mk" d="${pathRightRounded(padL, yb, wb, subH, 4)}" fill="${colorB}"/>` + (labelB ? txt(padL + wb + 7, yb + subH / 2 + 4, 'start', 'bar-label', esc(d.bValueLabel || fmtCompact(d.b))) : '');
    }
    rows += g + `</g>`;
  });
  rows = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padT}" stroke="${CH.base}" stroke-width="1" class="axis-line"/>` + rows;
  const legend = `<div class="chart-legend"><span class="legend-item"><span class="legend-dot" style="background:${colorA}"></span>${esc(aLabel)}</span><span class="legend-item"><span class="legend-dot" style="background:${colorB}"></span>${esc(bLabel)}</span></div>`;
  return legend + wrapSvg(W, H, Math.min(W, 320), rows);
}

// Multi-series line chart (e.g. CPM por herramienta a través de varios meses).
// categories: [string]; series: [{name, color?, values: [number|null], refValue?}]
// — un valor null deja un hueco en la línea (mes sin dato) en vez de interpolar. refValue (opcional, por serie)
// dibuja una línea horizontal tenue del color de la serie para un valor de referencia fijo (p.ej. el CPM ideal).
// opts.showValues rotula SOLO el último punto de cada serie; el resto de valores salen en el tooltip, que al
// pasar el mouse muestra todas las series en esa categoría junto a una línea guía vertical.
function svgLineChart(categories, series, opts) {
  opts = opts || {};
  const W = opts.width || 560, H = opts.height || 230;
  const padL = 44, padR = 56, padT = 12, padB = 32;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const usable = series.filter(s => s.values.some(v => v !== null && v !== undefined));
  if (!categories.length || !usable.length) return `<div class="empty-note">Sin datos para los filtros actuales.</div>`;
  const allVals = usable.flatMap(s => s.values.filter(v => v !== null && v !== undefined));
  const refVals = usable.map(s => s.refValue).filter(v => v !== null && v !== undefined);
  const sc = niceScale(opts.maxV || Math.max(...allVals, ...refVals) * 1.05, !!opts.maxV);
  const maxV = sc.max;
  const fmtV = opts.valueFmt || fmtCompact;
  const n = categories.length;
  const stepX = n > 1 ? plotW / (n - 1) : 0;
  const xAt = i => n > 1 ? padL + i * stepX : padL + plotW / 2;
  const yAt = v => padT + plotH - plotH * (Math.min(v, maxV) / maxV);
  const colorOf = (s, si) => s.color || CH.s[si] || CH.other;

  let grid = '';
  sc.ticks.forEach((tv, i) => {
    const y = padT + plotH - plotH * (tv / maxV);
    grid += gridLine(padL, y, W - padR, y, i === 0);
    grid += txt(padL - 8, y + 4, 'end', 'bar-label', fmtV(tv));
  });
  const showEvery = stepX && stepX < 40 ? Math.ceil(40 / stepX) : 1;
  let labels = '';
  categories.forEach((cat, i) => { if (i % showEvery === 0) labels += txt(xAt(i), H - padB + 17, 'middle', 'bar-label', esc(truncateToWidth(cat, (stepX || plotW) * showEvery, 10))); });

  // franjas de hover: una por categoría, con el tooltip de TODAS las series y una línea guía
  let slots = '';
  const slotW = n > 1 ? stepX : plotW;
  categories.forEach((cat, i) => {
    const rows = [];
    usable.forEach((s, si) => { const v = s.values[i]; if (v !== null && v !== undefined) rows.push([colorOf(s, si), s.name, fmtV(v)]); });
    if (!rows.length) return;
    const x = xAt(i);
    slots += `<g class="xslot"${tipJson(cat, rows)}><rect class="hit" x="${(x - slotW / 2).toFixed(1)}" y="${padT}" width="${slotW.toFixed(1)}" height="${plotH}" fill="transparent"/><line class="xh" x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + plotH}"/></g>`;
  });

  let paths = '', legend = '', refLines = '', ends = '';
  const endLabels = [];
  usable.forEach((s, si) => {
    const color = colorOf(s, si);
    let d = '', drawing = false, dots = '', last = null;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) { drawing = false; return; }
      const x = xAt(i), y = yAt(v);
      d += (drawing ? ' L ' : ' M ') + x.toFixed(1) + ',' + y.toFixed(1);
      drawing = true; last = { x, y, v };
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" stroke="${CH.surface}" stroke-width="2" pointer-events="none"/>`;
    });
    paths += `<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>${dots}`;
    if (opts.showValues && last) endLabels.push({ x: last.x, y: last.y, v: last.v });
    legend += `<span class="legend-item"><span class="legend-line" style="background:${color}"></span>${esc(s.name)}</span>`;
    if (s.refValue !== null && s.refValue !== undefined) {
      const ry = yAt(s.refValue);
      refLines += `<line x1="${padL}" y1="${ry.toFixed(1)}" x2="${W - padR}" y2="${ry.toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="2 4" opacity=".7" pointer-events="none"/>`;
    }
  });
  // Etiquetas finales: solo las que no se pisan (si las líneas convergen, el tooltip y la leyenda llevan los valores).
  endLabels.sort((a, b) => a.y - b.y);
  let lastY = -99;
  endLabels.forEach(e => { if (e.y - lastY >= 14) { ends += txt(Math.min(e.x + 9, W - 2), e.y + 4, 'start', 'bar-value', fmtV(e.v)); lastY = e.y; } });
  const hasRef = usable.some(s => s.refValue !== null && s.refValue !== undefined);
  const legendHtml = usable.length > 1 || hasRef ? `<div class="chart-legend">${legend}${hasRef ? '<span class="legend-item legend-note"><span class="legend-dash"></span>CPM ideal de la sarta</span>' : ''}</div>` : '';
  return legendHtml + wrapSvg(W, H, Math.min(W, 320), grid + refLines + paths + ends + labels + slots);
}

function rendPillClass(pct) {
  if (pct >= 100) return 'ok';
  if (pct >= 85) return 'warn';
  return 'bad';
}
function rendColor(pct) {
  if (pct >= 100) return 'var(--good,#0ca30c)';
  if (pct >= 85) return 'var(--warn,#fab219)';
  return 'var(--crit,#d03b3b)';
}

if (typeof module !== 'undefined') {
  module.exports = { fmtNum, fmtCompact, esc, svgVBarChart, svgVBarChartGrouped, svgHBarChart, svgHBarChartPaired, svgLineChart, rendPillClass, rendColor };
}
