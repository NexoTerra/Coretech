(function () {
'use strict';

const MONTH_ABBR = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

const MINES = [
  { slug: 'segovia', label: 'Aris Mining Segovia', sub: 'Sandra K · El Silencio · Providencia', icon: '⛏️', dataMina: ['SEGOVIA', 'SANDRA K', 'EL SILENCIO', 'PROVIDENCIA'] },
  { slug: 'marmato', label: 'Aris Mining Marmato', sub: 'Registros de campo móviles', icon: '⛏️', dataMina: ['MARMATO'] },
];
function mineCfg(slug) {
  return MINES.find(m => m.slug === slug) || MINES[0];
}
function mineValuesForSlugUI(slug) {
  const cfg = mineCfg(slug);
  return (cfg.dataMina || []).slice();
}
function mineStoredLabel(slug) {
  return slug === 'marmato' ? 'MARMATO' : 'SEGOVIA';
}
function emptyBundle() {
  return {
    meta: { epoch: '2020-01-01', generated: '', source: '' },
    dict: { mina: [], tipo: [], equipo: [], ref: [], herr: [], estado: [], causa: [], falla: [], operador: [] },
    catalog: {}, prod: [], life: [], sartas: {},
  };
}
const MINE_DEFAULT_BUNDLES = { segovia: window.__DATA_BUNDLE__, marmato: emptyBundle() };

let currentMine = null;
let presentationMode = false;
let DEFAULT_BUNDLE = MINE_DEFAULT_BUNDLES.segovia;
let BUNDLE = DEFAULT_BUNDLE;
const EMPTY_FILTERS = () => ({ mina: [], tipo: [], equipo: [], ref: [], estado: [], sarta: [], operador: [], months: [], dateFrom: null, dateTo: null });
let filters = EMPTY_FILTERS();
let tableState = { tab: 'herramienta', sortKey: 'metros', sortDir: 'desc', search: '', page: 1 };
const PAGE_SIZE = 20;
let currentUser = null;
let appInitialized = false;
let conciliacionCache = {};
let minePinnedValues = [];
let fieldHistoryRows = [];
let refreshTimer = null;
const FIELD_META_KEY = 'ct_field_meta_v1';
function canSeeMine(slug) {
  return currentUser && (currentUser.role === 'admin' || (currentUser.allowed_mines || []).includes(slug));
}

function containerWidth(id, fallback) {
  const elx = document.getElementById(id);
  const w = elx && elx.clientWidth;
  return (w && w > 40) ? w : (fallback || 560);
}

// ============ helpers ============
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function ymLabel(ym) {
  const [y, m] = ym.split('-');
  return MONTH_ABBR[parseInt(m, 10) - 1] + ' ' + y.slice(2);
}
function computePartialMonths(bundle) {
  const epoch = bundle.meta.epoch;
  let minD = Infinity, maxD = -Infinity;
  for (const p of bundle.prod) { if (p[0] < minD) minD = p[0]; if (p[0] > maxD) maxD = p[0]; }
  if (!isFinite(minD)) return new Set();
  const minDate = new Date(new Date(epoch + 'T00:00:00Z').getTime() + minD * 86400000);
  const maxDate = new Date(new Date(epoch + 'T00:00:00Z').getTime() + maxD * 86400000);
  const partial = new Set();
  if (minDate.getUTCDate() !== 1) partial.add(minDate.getUTCFullYear() + '-' + String(minDate.getUTCMonth() + 1).padStart(2, '0'));
  const lastDayOfMax = new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth() + 1, 0)).getUTCDate();
  if (maxDate.getUTCDate() !== lastDayOfMax) partial.add(maxDate.getUTCFullYear() + '-' + String(maxDate.getUTCMonth() + 1).padStart(2, '0'));
  return partial;
}

// ============ filter UI ============
// Called every time populateFilterOptions() runs (init, clearFilters, import,
// restore) with a fresh `options` list, but the underlying DOM elements
// (button/panel/search box) persist across calls. Click listeners must only
// be wired ONCE per element — otherwise they stack up on the same button and
// a single click fires several open/close toggles back-to-back, which cancel
// each other out (panel flashes open then immediately closes). Current
// options/filterKey are stashed on the panel element itself so the
// once-wired listeners always see fresh data instead of a stale closure.
function searchDropdown(btnId, panelId, searchId, listId, options, filterKey, labelPrefix, dropdownOpts) {
  const btn = document.getElementById(btnId);
  const panel = document.getElementById(panelId);
  const search = document.getElementById(searchId);
  const list = document.getElementById(listId);

  panel._ddOptions = options;
  panel._ddFilterKey = filterKey;
  panel._ddLabelPrefix = labelPrefix;
  panel._ddOpts = dropdownOpts || {};

  function renderList(q) {
    list.innerHTML = '';
    const ql = (q || '').toLowerCase();
    const curOptions = panel._ddOptions;
    const curKey = panel._ddFilterKey;
    curOptions.filter(o => o.label.toLowerCase().includes(ql)).forEach(o => {
      const checked = filters[curKey].includes(o.value);
      const lab = el(`<label class="opt"><input type="checkbox" ${checked ? 'checked' : ''}/> <span>${esc(o.label)}</span></label>`);
      lab.querySelector('input').addEventListener('change', (e) => {
        const arr = filters[curKey];
        if (e.target.checked) { if (!arr.includes(o.value)) arr.push(o.value); }
        else { const i = arr.indexOf(o.value); if (i >= 0) arr.splice(i, 1); }
        if (panel._ddOpts.clearDatesOnSelect && e.target.checked) {
          filters.dateFrom = null; filters.dateTo = null;
          document.getElementById('dateFrom').value = ''; document.getElementById('dateTo').value = '';
        }
        if (panel._ddOpts.onChange) panel._ddOpts.onChange();
        updateBtnLabel();
        renderAll();
      });
      list.appendChild(lab);
    });
  }
  function updateBtnLabel() {
    const n = filters[panel._ddFilterKey].length;
    btn.querySelector('.dd-label').textContent = n ? `${panel._ddLabelPrefix} (${n})` : panel._ddLabelPrefix;
  }
  // Lets other filter controls (e.g. los chips de Sarta) refrescar este
  // dropdown después de cambiar filters[filterKey] por su cuenta, sin tener
  // que volver a llamar a populateFilterOptions() entero (eso reconstruiría
  // todos los filtros y borraría cosas como el rango de fechas ya elegido).
  panel._ddRefresh = () => { renderList(search.value || ''); updateBtnLabel(); };

  if (!btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.style.display === 'block';
      document.querySelectorAll('.dropdown-panel').forEach(p => p.style.display = 'none');
      panel.style.display = open ? 'none' : 'block';
      if (!open) { search.value = ''; renderList(''); search.focus(); }
    });
    search.addEventListener('input', () => renderList(search.value));
    document.addEventListener('click', (e) => { if (!panel.contains(e.target) && e.target !== btn) panel.style.display = 'none'; });
  }
  renderList('');
  updateBtnLabel();
}

// Al activar una sarta, sus herramientas/referencias asociadas reemplazan la
// selección del filtro de Herramienta/Referencia (unión si hay varias sartas
// activas a la vez); al desactivar todas, ese filtro vuelve a quedar libre.
function applySartaSelectionToRef() {
  const refSet = new Set();
  filters.sarta.forEach(nombre => {
    (BUNDLE.sartas[nombre] || []).forEach(code => refSet.add(code));
  });
  filters.ref = Array.from(refSet);
  const refPanel = document.getElementById('refPanel');
  if (refPanel && refPanel._ddRefresh) refPanel._ddRefresh();
}
function populateFilterOptions() {
  const d = BUNDLE.dict;
  const minaOpts = d.mina.slice().sort().map(v => ({ label: v, value: v }));
  searchDropdown('minaBtn', 'minaPanel', 'minaSearch', 'minaList', minaOpts, 'mina', 'Mina');

  const tipoOpts = d.tipo.slice().sort().map(v => ({ label: v, value: v }));
  searchDropdown('tipoBtn', 'tipoPanel', 'tipoSearch', 'tipoList', tipoOpts, 'tipo', 'Tipo de perforación');

  const ESTADO_ORDER = ['ACTIVO', 'INACTIVO', 'RESERVA'];
  const estadoOpts = d.estado.slice().sort((a, b) => {
    const ia = ESTADO_ORDER.indexOf(a), ib = ESTADO_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  }).map(v => ({ label: v, value: v }));
  searchDropdown('estadoBtn', 'estadoPanel', 'estadoSearch', 'estadoList', estadoOpts, 'estado', 'Estado');

  const sartaNames = Object.keys(BUNDLE.sartas || {}).sort();
  document.getElementById('sartaFilterGroup').hidden = !sartaNames.length;
  const sartaOpts = sartaNames.map(v => ({ label: v, value: v }));
  searchDropdown('sartaBtn', 'sartaPanel', 'sartaSearch', 'sartaList', sartaOpts, 'sarta', 'Sarta', { onChange: applySartaSelectionToRef });

  const equipoOpts = d.equipo.slice().sort().map(v => ({ label: v, value: v }));
  searchDropdown('equipoBtn', 'equipoPanel', 'equipoSearch', 'equipoList', equipoOpts, 'equipo', 'Equipo / Jumbo');

  const operadorOpts = (d.operador || []).slice().sort().map(v => ({ label: v, value: v }));
  searchDropdown('operadorBtn', 'operadorPanel', 'operadorSearch', 'operadorList', operadorOpts, 'operador', 'Operador');

  const refOpts = d.ref.map((code, i) => {
    const herrIdx = findHerrForRef(i);
    const label = herrIdx !== null ? `${d.herr[herrIdx]} (${code})` : code;
    return { label, value: code };
  }).sort((a, b) => a.label.localeCompare(b.label));
  searchDropdown('refBtn', 'refPanel', 'refSearch', 'refList', refOpts, 'ref', 'Herramienta / Referencia');

  const monthSet = new Set();
  for (const p of BUNDLE.prod) monthSet.add(dayToYM(p[0], BUNDLE.meta.epoch));
  const monthOpts = Array.from(monthSet).sort().map(ym => ({ label: ymLabel(ym), value: ym }));
  searchDropdown('monthBtn', 'monthPanel', 'monthSearch', 'monthList', monthOpts, 'months', 'Mes', { clearDatesOnSelect: true });

  // date bounds
  let minD = Infinity, maxD = -Infinity;
  for (const p of BUNDLE.prod) { if (p[0] < minD) minD = p[0]; if (p[0] > maxD) maxD = p[0]; }
  const epoch = BUNDLE.meta.epoch;
  const fromInput = document.getElementById('dateFrom'), toInput = document.getElementById('dateTo');
  if (isFinite(minD)) {
    fromInput.min = dayToDateStr(minD, epoch); fromInput.max = dayToDateStr(maxD, epoch);
    toInput.min = dayToDateStr(minD, epoch); toInput.max = dayToDateStr(maxD, epoch);
  }
  fromInput.value = ''; toInput.value = '';
  applyMinePinUI();
}

const herrForRefCache = new Map();
function findHerrForRef(refIdx) {
  if (herrForRefCache.has(refIdx)) return herrForRefCache.get(refIdx);
  let found = null;
  for (const p of BUNDLE.prod) { if (p[4] === refIdx) { found = p[5]; break; } }
  if (found === null) { for (const l of BUNDLE.life) { if (l[1] === refIdx) { found = l[2]; break; } } }
  herrForRefCache.set(refIdx, found);
  return found;
}

function syncMonthBtnLabel() {
  const btn = document.getElementById('monthBtn');
  if (!btn) return;
  const n = filters.months.length;
  btn.querySelector('.dd-label').textContent = n ? `Mes (${n})` : 'Mes';
  document.querySelectorAll('#monthList input[type="checkbox"]').forEach(cb => { cb.checked = false; });
}

function clearFilters() {
  filters = EMPTY_FILTERS();
  document.getElementById('dateFrom').value = '';
  document.getElementById('dateTo').value = '';
  populateFilterOptions();
  renderAll();
}

function applyDatePreset(kind) {
  let minD = Infinity, maxD = -Infinity;
  for (const p of BUNDLE.prod) { if (p[0] < minD) minD = p[0]; if (p[0] > maxD) maxD = p[0]; }
  const epoch = BUNDLE.meta.epoch;
  const maxDate = new Date(new Date(epoch + 'T00:00:00Z').getTime() + maxD * 86400000);
  let from = null, to = dayToDateStr(maxD, epoch);
  if (kind === 'all') { from = null; to = null; }
  else if (kind === 'month') {
    from = new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth(), 1)).toISOString().slice(0, 10);
  } else if (kind === 'q') {
    const d = new Date(maxDate); d.setUTCMonth(d.getUTCMonth() - 2); d.setUTCDate(1);
    from = d.toISOString().slice(0, 10);
  } else if (kind === 'year') {
    from = new Date(Date.UTC(maxDate.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
  }
  filters.dateFrom = from; filters.dateTo = kind === 'all' ? null : to;
  filters.months = [];
  syncMonthBtnLabel();
  document.getElementById('dateFrom').value = from || '';
  document.getElementById('dateTo').value = filters.dateTo || '';
  renderAll();
}

// ============ KPI cards ============
function renderKPICards(kpis, vidaUtil) {
  const row = document.getElementById('kpiRow');
  const lastMonth = kpis.months.length ? kpis.months[kpis.months.length - 1] : null;
  const activeLastMonth = lastMonth ? kpis.toolsByMonth.get(lastMonth).size : 0;
  const avgPerToolMonth = kpis.months.length
    ? kpis.months.reduce((acc, ym) => acc + (kpis.byMonth.get(ym) / Math.max(kpis.toolsByMonth.get(ym).size, 1)), 0) / kpis.months.length
    : 0;

  const cards = [
    { label: 'Metros perforados', value: fmtNum(kpis.totalMetros) + ' <small>m</small>', sub: `${kpis.months.length} meses en el rango`, accent: true },
    { label: 'Promedio mensual', value: fmtNum(kpis.promedioCompletos || kpis.promedioTodos) + ' <small>m/mes</small>', sub: 'Excluye meses parciales en los extremos' },
    { label: 'Códigos activos', value: fmtNum(activeLastMonth), sub: lastMonth ? `En ${esc(ymLabel(lastMonth))}` : '—' },
    { label: 'Referencias activas', value: fmtNum(kpis.referenciasActivas), sub: `${fmtNum(kpis.piezasActivas)} piezas trazadas` },
    { label: 'Metros / herramienta activa', value: fmtNum(Math.round(avgPerToolMonth)) + ' <small>m/mes</small>', sub: 'Promedio del periodo filtrado' },
    { label: 'Cumplimiento global', value: (kpis.cumplimientoGlobal !== null ? kpis.cumplimientoGlobal.toFixed(1) + '<small>%</small>' : '—'), sub: `${kpis.nCiclosCerrados} piezas con ciclo cerrado` },
  ];
  if (!presentationMode) {
    cards.push({ label: 'Oportunidad recuperable', value: fmtCompact(kpis.recuperableM) + ' <small>m</small>', sub: `≈ USD ${fmtNum(Math.round(kpis.recuperableUSD))} · piezas dadas de baja antes de cumplir garantía` });
  }
  cards.push({ label: 'Vida útil promedio', value: (vidaUtil.mediaDias !== null ? fmtNum(Math.round(vidaUtil.mediaDias)) + ' <small>días</small>' : '—'), sub: vidaUtil.n ? `mediana ${fmtNum(Math.round(vidaUtil.medianaDias))} días · ${fmtNum(vidaUtil.n)} piezas con ambas fechas` : 'sin piezas con fecha de inicio y de baja' });
  row.innerHTML = '';
  cards.forEach(c => {
    row.appendChild(el(`<div class="card kpi ${c.accent ? 'accent' : ''}">
      <div class="label">${esc(c.label)}</div>
      <div class="value">${c.value}</div>
      <div class="sub">${esc(c.sub)}</div>
    </div>`));
  });
}

// ============ charts ============
function renderMonthlyChart(kpis) {
  const partial = computePartialMonths(BUNDLE);
  const items = kpis.months.map(ym => ({ label: ymLabel(ym), value: kpis.byMonth.get(ym), partial: partial.has(ym) }));
  document.getElementById('chartMonthly').innerHTML = svgVBarChart(items, { width: containerWidth('chartMonthly'), color: 'var(--blue)', partialColor: 'var(--gray3)' });
}
function renderActiveToolsChart(kpis) {
  const partial = computePartialMonths(BUNDLE);
  const items = kpis.months.map(ym => ({ label: ymLabel(ym), value: kpis.toolsByMonth.get(ym).size, partial: partial.has(ym) }));
  document.getElementById('chartActiveTools').innerHTML = svgVBarChart(items, { width: containerWidth('chartActiveTools'), color: 'var(--green)', partialColor: 'var(--gray3)' });
}
function renderToolsChart(rows) {
  const top = rows.slice(0, 10);
  const items = top.map((r, i) => ({ label: r.herramienta, value: r.metros, color: RAMP[i % RAMP.length], valueLabel: fmtCompact(r.metros) + ' m' }));
  document.getElementById('chartTools').innerHTML = svgHBarChart(items, { width: containerWidth('chartTools'), rowH: 24 });
}
const RAMP = ['var(--ramp1)', 'var(--ramp2)', 'var(--ramp3)', 'var(--ramp4)'];
function renderRendimientoChart(rows) {
  const top = rows.slice().sort((a, b) => b.metrosPerforados - a.metrosPerforados).slice(0, 12);
  const items = top.map(r => ({
    label: r.herramienta,
    value: Math.min(r.cumplimientoMedio, 200),
    color: rendColor(r.cumplimientoMedio),
    valueLabel: r.cumplimientoMedio.toFixed(0) + '%',
    tooltip: `${r.cumplimientoMedio.toFixed(1)}% cumplimiento medio · n=${r.n} piezas`,
  }));
  document.getElementById('chartRendimiento').innerHTML = svgHBarChart(items, { width: containerWidth('chartRendimiento'), rowH: 24, maxV: 150, refLines: [{ value: 85, label: '85% aceptable' }, { value: 100, label: '100% ideal' }] });
}
function renderCumplimientoTrend(bundle, life) {
  const rows = cumplimientoPorMes(bundle, life);
  const items = rows.map(r => ({
    label: ymLabel(r.ym),
    value: Math.min(r.cumplimientoMedio, 200),
    color: rendColor(r.cumplimientoMedio),
    tooltip: `${ymLabel(r.ym)}: ${r.cumplimientoMedio.toFixed(1)}% cumplimiento medio · n=${r.n} piezas`,
  }));
  document.getElementById('chartTrend').innerHTML = svgVBarChart(items, {
    width: containerWidth('chartTrend'), maxV: 150, valueFmt: v => v.toFixed(0) + '%',
    refLines: [{ value: 85, label: '85%' }, { value: 100, label: '100%' }],
  });
}

// ============ modo y causa de falla ============
function renderFallaCausa(bundle, life) {
  const causas = causaBreakdown(bundle, life);
  const fallas = fallaBreakdown(bundle, life);
  const topCausas = causas.slice(0, 10);
  const topFallas = fallas.slice(0, 10);

  const causaItems = topCausas.map(c => ({
    label: c.label, value: c.n, color: c.cumplimientoMedio !== null ? rendColor(c.cumplimientoMedio) : 'var(--gray2)',
    valueLabel: `${c.n} (${c.pct.toFixed(0)}%)`,
    tooltip: `${c.n} piezas · ${c.pct.toFixed(1)}% del total${c.cumplimientoMedio !== null ? ' · ' + c.cumplimientoMedio.toFixed(0) + '% cumplimiento medio' : ''}`,
  }));
  document.getElementById('chartCausa').innerHTML = svgHBarChart(causaItems, { width: containerWidth('chartCausa'), rowH: 24 });

  const fallaItems = topFallas.map(f => ({
    label: f.label, value: f.n, color: f.cumplimientoMedio !== null ? rendColor(f.cumplimientoMedio) : 'var(--gray2)',
    valueLabel: `${f.n} (${f.pct.toFixed(0)}%)`,
    tooltip: `${f.n} piezas · ${f.pct.toFixed(1)}% del total${f.cumplimientoMedio !== null ? ' · ' + f.cumplimientoMedio.toFixed(0) + '% cumplimiento medio' : ''}`,
  }));
  document.getElementById('chartFalla').innerHTML = svgHBarChart(fallaItems, { width: containerWidth('chartFalla'), rowH: 24 });

  const table = document.getElementById('causaTable');
  const rowsHtml = causas.slice(0, 12).map(c => `<tr>
    <td>${esc(c.label)}</td>
    <td class="num">${fmtNum(c.n)}</td>
    <td class="num">${c.pct.toFixed(1)}%</td>
    <td class="num">${c.cumplimientoMedio !== null ? c.cumplimientoMedio.toFixed(1) + '%' : '—'}</td>
    <td class="num">${fmtNum(Math.round(c.gapM))}</td>
    <td class="num">${fmtNum(Math.round(c.gapUSD))}</td>
  </tr>`).join('');
  table.innerHTML = `<thead><tr><th>Causa de baja</th><th>N° piezas</th><th>% del total</th><th>Cumplimiento medio</th><th>Metros perdidos</th><th>USD perdidos (aprox.)</th></tr></thead><tbody>${rowsHtml}</tbody>`;
}

// ============ CPM por sarta (costo total de la sarta) ============
// El CPM de la sarta es la suma de los CPM individuales de las herramientas
// que la componen; el "ideal" es fijo (viene de la hoja DATOS KPIs, ya sumado
// por sarta) y sirve para comparar mes a mes si el costo real subió o bajó.
function describeCpmPorSarta(sartaTotals) {
  const withIdeal = sartaTotals.filter(s => s.months.length && s.cpmIdeal !== null);
  if (!withIdeal.length) return '';
  const lastYm = withIdeal.reduce((acc, s) => {
    const last = s.months[s.months.length - 1].ym;
    return !acc || last > acc ? last : acc;
  }, null);
  const rows = withIdeal.map(s => {
    const m = s.months.find(mm => mm.ym === lastYm);
    if (!m) return null;
    return { sarta: s.sarta, pct: (m.cpmSarta - s.cpmIdeal) / s.cpmIdeal * 100 };
  }).filter(Boolean);
  if (!rows.length) return '';
  const arriba = rows.filter(r => r.pct > 1);
  const abajo = rows.filter(r => r.pct < -1);
  const peor = rows.reduce((a, b) => b.pct > a.pct ? b : a);
  let txt = `En ${ymLabel(lastYm)}: ${arriba.length} de ${rows.length} sartas están por encima de su CPM ideal, ${abajo.length} por debajo.`;
  if (peor.pct > 1) txt += ` La más alejada de su ideal es ${peor.sarta} (+${peor.pct.toFixed(0)}%).`;
  return txt;
}
function renderCpmPorSarta(bundle, life) {
  const chartEl = document.getElementById('chartCpmSarta');
  const conclusionEl = document.getElementById('cpmSartaConclusion');
  let sartaTotals = cpmPorSartaTotal(bundle, life);
  if (!sartaTotals.length) {
    chartEl.innerHTML = '<div class="empty-note">Este archivo no trae la hoja SARTAS.</div>';
    conclusionEl.textContent = '';
    return;
  }
  if (filters.sarta.length) sartaTotals = sartaTotals.filter(s => filters.sarta.includes(s.sarta));
  if (!sartaTotals.length) {
    chartEl.innerHTML = '<div class="empty-note">Sin datos para la sarta seleccionada.</div>';
    conclusionEl.textContent = '';
    return;
  }
  const monthSet = new Set();
  sartaTotals.forEach(s => s.months.forEach(m => monthSet.add(m.ym)));
  const months = Array.from(monthSet).sort();
  if (!months.length) {
    chartEl.innerHTML = '<div class="empty-note">Todavía no hay piezas con fecha de baja registrada — el CPM solo se calcula con piezas que ya finalizaron su vida útil.</div>';
    conclusionEl.textContent = '';
    return;
  }
  conclusionEl.textContent = describeCpmPorSarta(sartaTotals);
  const series = sartaTotals.filter(s => s.months.length).map(s => {
    const byYm = new Map(s.months.map(m => [m.ym, m]));
    const label = s.sarta + (s.cpmIdeal !== null ? ` (ideal $${s.cpmIdeal.toFixed(2)})` : '');
    return { name: label, values: months.map(ym => { const m = byYm.get(ym); return m ? m.cpmSarta : null; }) };
  });
  chartEl.innerHTML = svgLineChart(months.map(ymLabel), series, { width: containerWidth('chartCpmSarta'), valueFmt: v => '$' + v.toFixed(2) });
}

// ============ Metros por código dentro de cada referencia ============
function renderMetrosPorCodigo(bundle, life) {
  const chartEl = document.getElementById('chartMetrosPorCodigo');
  if (filters.ref.length !== 1) {
    chartEl.innerHTML = '<div class="empty-note">Selecciona una única Herramienta/Referencia en el filtro de arriba para ver, código por código, cuántos metros hizo cada pieza frente al metro garantizado.</div>';
    return;
  }
  const refcode = filters.ref[0];
  const row = metrosPorCodigoPorReferencia(bundle, life).find(r => r.ref === refcode);
  if (!row || !row.codigos.length) {
    chartEl.innerHTML = '<div class="empty-note">Sin datos para esta referencia con los filtros actuales.</div>';
    return;
  }
  const items = row.codigos.map(c => ({
    label: c.codigo.includes(':') ? c.codigo.slice(c.codigo.indexOf(':') + 1) : c.codigo,
    a: row.garantizado, b: c.metros,
    aValueLabel: row.garantizado ? fmtCompact(row.garantizado) : '—',
    bValueLabel: fmtCompact(c.metros),
    bColor: c.cumplimiento === null ? 'var(--gray3)' : rendColor(c.cumplimiento),
    tooltipA: row.garantizado ? fmtNum(row.garantizado) + ' m garantizados' : 'sin metro garantizado',
    tooltipB: fmtNum(Math.round(c.metros)) + ' m' + (c.cumplimiento !== null ? ' · ' + c.cumplimiento.toFixed(0) + '% cumplimiento' : ''),
  }));
  chartEl.innerHTML = svgVBarChartGrouped(items, {
    width: containerWidth('chartMetrosPorCodigo'), height: 280, groupWidth: 64,
    aLabel: 'Metro garantizado', bLabel: 'Metros logrados',
  });
}

// ============ Promedio mensual de metros por referencia ============
function renderPromedioReferencia(bundle, prod, life) {
  const d = bundle.dict;
  const chartEl = document.getElementById('chartPromedioReferencia');
  const table = document.getElementById('promedioReferenciaTable');
  const totals = byHerramientaProd(bundle, prod, null).sort((a, b) => b.metros - a.metros).slice(0, 8);
  const avgByRef = avgMetrosPorReferenciaPorMes(bundle, life);
  const monthSet = new Set();
  totals.forEach(t => {
    const byYm = avgByRef.get(d.ref.indexOf(t.ref));
    if (byYm) byYm.forEach((_, ym) => monthSet.add(ym));
  });
  const months = Array.from(monthSet).sort();
  if (!months.length) {
    chartEl.innerHTML = '<div class="empty-note">Todavía no hay piezas con fecha de baja registrada para calcular este promedio.</div>';
    table.innerHTML = '';
    return;
  }
  const series = totals.map(t => {
    const byYm = avgByRef.get(d.ref.indexOf(t.ref)) || new Map();
    return { name: t.herramienta, values: months.map(ym => { const e = byYm.get(ym); return e ? e.avg : null; }) };
  });
  chartEl.innerHTML = svgLineChart(months.map(ymLabel), series, { width: containerWidth('chartPromedioReferencia') });

  const thead = `<tr><th>Referencia</th>${months.map(ym => `<th class="num">${esc(ymLabel(ym))}</th>`).join('')}</tr>`;
  const tbody = totals.map(t => {
    const byYm = avgByRef.get(d.ref.indexOf(t.ref)) || new Map();
    const cells = months.map(ym => { const e = byYm.get(ym); return `<td class="num">${e ? fmtNum(Math.round(e.avg)) : '—'}</td>`; }).join('');
    return `<tr><td>${esc(t.herramienta)}</td>${cells}</tr>`;
  }).join('');
  table.innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
}

// ============ CPM ============
function renderCPM(bundle, life) {
  const g = cpmGlobal(bundle, life);
  const rows = cpmPorHerramienta(bundle, life);

  const cards = [
    { label: 'CPM real', value: (g.cpmReal !== null ? 'USD ' + g.cpmReal.toFixed(3) : '—') + ' <small>/m</small>', sub: 'Precio unitario / metros realmente logrados' },
    { label: 'CPM ideal', value: (g.cpmIdeal !== null ? 'USD ' + g.cpmIdeal.toFixed(3) : '—') + ' <small>/m</small>', sub: 'Precio unitario / metro garantizado' },
    { label: 'USD invertido', value: 'USD ' + fmtNum(Math.round(g.usdGastado)), sub: `${fmtNum(g.nConUsd)} piezas con precio registrado` },
    { label: 'Sobrecosto por bajo rendimiento', value: 'USD ' + fmtNum(Math.round(g.sobrecostoUSD)), sub: 'Piezas que no llegaron a su metro garantizado' },
  ];
  const row = document.getElementById('cpmKpiRow');
  row.innerHTML = '';
  cards.forEach(c => row.appendChild(el(`<div class="card kpi"><div class="label">${esc(c.label)}</div><div class="value">${c.value}</div><div class="sub">${esc(c.sub)}</div></div>`)));

  const top = rows.filter(r => r.cpmReal !== null).slice().sort((a, b) => b.metrosTotales - a.metrosTotales).slice(0, 12);
  const items = top.map(r => ({
    label: r.herramienta,
    a: r.cpmReal, b: r.cpmIdeal,
    aValueLabel: `$${r.cpmReal.toFixed(2)}`,
    bValueLabel: r.cpmIdeal !== null ? `$${r.cpmIdeal.toFixed(2)}` : '—',
    tooltipA: `$${r.cpmReal.toFixed(3)}/m · ${r.n} piezas`,
    tooltipB: r.cpmIdeal !== null ? `$${r.cpmIdeal.toFixed(3)}/m` : 'sin precio registrado',
  }));
  document.getElementById('chartCPM').innerHTML = svgHBarChartPaired(items, { width: containerWidth('chartCPM'), rowH: 34, aLabel: 'CPM real', bLabel: 'CPM ideal' });
}

// ============ CPM mensual comparable (histórico + actual) ============
// CPM mensual agrupado por Sarta: cada sarta agrupa varias referencias
// (hoja SARTAS); el CPM de cada referencia se calcula con su propio
// promedio mensual de metros, aunque esa referencia se repita en otra sarta.
// Conclusión calculada a partir de los dos últimos meses con datos, en vez de
// un texto fijo de metodología.
function describeCpmTrend(sartaRows, months) {
  if (months.length < 2) return 'Se necesitan al menos dos meses con datos para comparar la tendencia de CPM.';
  const mLast = months[months.length - 1], mPrev = months[months.length - 2];
  const moves = []; // {sarta, herramienta, pct}
  const seen = new Set(); // evita contar dos veces una referencia repetida en varias sartas
  for (const s of sartaRows) {
    for (const r of s.referencias) {
      const byYm = new Map(r.months.map(m => [m.ym, m]));
      const cur = byYm.get(mLast), prev = byYm.get(mPrev);
      if (!cur || !prev || cur.cpm === null || prev.cpm === null) continue;
      const key = r.ref;
      if (seen.has(key)) continue;
      seen.add(key);
      moves.push({ herramienta: r.herramienta, pct: (cur.cpm - prev.cpm) / prev.cpm * 100 });
    }
  }
  if (!moves.length) return `Sin referencias con CPM en ${ymLabel(mPrev)} y ${ymLabel(mLast)} a la vez para comparar.`;
  const subieron = moves.filter(m => m.pct > 1);
  const bajaron = moves.filter(m => m.pct < -1);
  const peorMovida = moves.reduce((a, b) => b.pct > a.pct ? b : a);
  const mejorMovida = moves.reduce((a, b) => b.pct < a.pct ? b : a);
  let txt = `De ${moves.length} referencias comparables entre ${ymLabel(mPrev)} y ${ymLabel(mLast)}, ${subieron.length} subieron de costo y ${bajaron.length} bajaron.`;
  if (peorMovida.pct > 1) txt += ` La mayor alza fue en ${peorMovida.herramienta} (+${peorMovida.pct.toFixed(0)}%).`;
  if (mejorMovida.pct < -1) txt += ` La mayor baja fue en ${mejorMovida.herramienta} (${mejorMovida.pct.toFixed(0)}%).`;
  return txt;
}

function renderCPMTrend(bundle, life) {
  const section = document.getElementById('cpmTrendSection');
  let sartaRows = cpmPorSarta(bundle, life);
  if (!sartaRows.length) {
    section.innerHTML = '<div class="empty-note">Este archivo no trae la hoja SARTAS.</div>';
    return;
  }
  // Si hay una o más sartas activas en el filtro superior, solo se muestran
  // esas — el resto queda oculto en vez de saturar la sección con todas.
  if (filters.sarta.length) {
    sartaRows = sartaRows.filter(s => filters.sarta.includes(s.sarta));
    if (!sartaRows.length) {
      section.innerHTML = '<div class="empty-note">Sin datos para la sarta seleccionada.</div>';
      return;
    }
  }
  const monthSet = new Set();
  sartaRows.forEach(s => s.referencias.forEach(r => r.months.forEach(m => monthSet.add(m.ym))));
  const months = Array.from(monthSet).sort();
  document.getElementById('cpmTrendConclusion').textContent = describeCpmTrend(sartaRows, months);

  const blocks = sartaRows.map((s, si) => {
    const withData = s.referencias.filter(r => r.months.some(m => m.cpm !== null));
    const missing = s.referencias.filter(r => !r.found);
    const chartId = `cpmTrendChart_${si}`;
    const thead = `<tr><th>Referencia</th><th>Herramienta</th>${months.map(ym => `<th class="num">${esc(ymLabel(ym))}</th>`).join('')}</tr>`;
    const tbody = withData.map(r => {
      const byYm = new Map(r.months.map(m => [m.ym, m]));
      let prevCpm = null;
      const cells = months.map(ym => {
        const m = byYm.get(ym);
        if (!m || m.cpm === null) return '<td class="num">—</td>';
        let trendMark = '';
        if (prevCpm !== null) {
          const pct = (m.cpm - prevCpm) / prevCpm * 100;
          if (Math.abs(pct) >= 1) trendMark = ` <span class="${pct > 0 ? 'trend-up' : 'trend-down'}">${pct > 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(0)}%</span>`;
        }
        prevCpm = m.cpm;
        return `<td class="num" title="promedio ${fmtNum(m.avgMetros)} m · n=${m.n} piezas">$${m.cpm.toFixed(3)}${trendMark}</td>`;
      }).join('');
      return `<tr><td>${esc(r.ref)}</td><td>${esc(r.herramienta)}</td>${cells}</tr>`;
    }).join('');
    const missingNote = missing.length
      ? `<p class="chart-sub" style="margin-top:8px;">Sin catálogo/uso registrado en este archivo: ${missing.map(r => esc(r.herramienta)).join(', ')}.</p>`
      : '';
    return `<div class="sarta-block">
      <h4 style="margin:14px 0 6px; font-size:13px;">${esc(s.sarta)}</h4>
      <div id="${chartId}"></div>
      <div class="table-wrap"><table>${thead}<tbody>${tbody || `<tr><td colspan="${2 + months.length}" class="empty-note">Sin datos.</td></tr>`}</tbody></table></div>
      ${missingNote}
    </div>`;
  }).join('');
  section.innerHTML = blocks;

  sartaRows.forEach((s, si) => {
    const chartEl = document.getElementById(`cpmTrendChart_${si}`);
    if (!chartEl) return;
    const withData = s.referencias.filter(r => r.months.some(m => m.cpm !== null));
    const series = withData.map(r => {
      const byYm = new Map(r.months.map(m => [m.ym, m]));
      return { name: r.herramienta, values: months.map(ym => { const m = byYm.get(ym); return m && m.cpm !== null ? m.cpm : null; }) };
    });
    chartEl.innerHTML = svgLineChart(months.map(ymLabel), series, { width: containerWidth(`cpmTrendChart_${si}`), valueFmt: v => '$' + v.toFixed(2) });
  });
}

// ============ ganancia / pérdida por herramienta ============
function renderGananciaPerdida(bundle, life) {
  const rows = gananciaPerdidaPorHerramienta(bundle, life);
  const kpiRow = document.getElementById('gpKpiRow');
  const totalPerdida = rows.reduce((a, r) => a + r.perdidaUSD, 0);
  const totalGanancia = rows.reduce((a, r) => a + r.gananciaUSD, 0);
  kpiRow.innerHTML = '';
  [
    { label: 'Pérdida total (< 85%)', value: 'USD ' + fmtNum(Math.round(totalPerdida)), sub: 'Piezas bajo el rango aceptable', accentCls: 'kpi-bad' },
    { label: 'Ganancia total (> 100%)', value: 'USD ' + fmtNum(Math.round(totalGanancia)), sub: 'Piezas que superaron el metro ideal', accentCls: 'kpi-good' },
    { label: 'Neto', value: 'USD ' + fmtNum(Math.round(totalGanancia - totalPerdida)), sub: 'Ganancia menos pérdida', accentCls: (totalGanancia - totalPerdida) >= 0 ? 'kpi-good' : 'kpi-bad' },
  ].forEach(c => kpiRow.appendChild(el(`<div class="card kpi ${c.accentCls}"><div class="label">${esc(c.label)}</div><div class="value">${c.value}</div><div class="sub">${esc(c.sub)}</div></div>`)));

  const table = document.getElementById('gpTable');
  const thead = `<tr><th>Referencia</th><th>Herramienta</th><th class="num">Piezas &lt;85%</th><th class="num">Pérdida (m)</th><th class="num">Pérdida (USD)</th><th class="num">Piezas &gt;100%</th><th class="num">Ganancia (m)</th><th class="num">Ganancia (USD)</th><th class="num">Neto (USD)</th></tr>`;
  const tbody = rows.map(r => `<tr>
    <td>${esc(r.ref)}</td><td>${esc(r.herramienta)}</td>
    <td class="num">${fmtNum(r.nPerdida)}</td><td class="num">${fmtNum(Math.round(r.perdidaM))}</td><td class="num">${fmtNum(Math.round(r.perdidaUSD))}</td>
    <td class="num">${fmtNum(r.nGanancia)}</td><td class="num">${fmtNum(Math.round(r.gananciaM))}</td><td class="num">${fmtNum(Math.round(r.gananciaUSD))}</td>
    <td class="num"><span class="pill ${r.netoUSD >= 0 ? 'ok' : 'bad'}">${fmtNum(Math.round(r.netoUSD))}</span></td>
  </tr>`).join('');
  table.innerHTML = `<thead>${thead}</thead><tbody>${tbody || `<tr><td colspan="9" class="empty-note">Sin datos.</td></tr>`}</tbody>`;
}

// ============ motivo de baja ============
const MOTIVO_META = {
  FIN_VIDA_UTIL: { title: 'Fin de vida útil', cls: 'fin' },
  CONDICION_OPERATIVA: { title: 'Condición operativa', cls: 'operativa' },
  SIN_CAUSA: { title: 'Sin causa registrada', cls: 'sincausa' },
  OTRA: { title: 'Otra / por determinar', cls: 'otra' },
};
function renderMotivo(motivo) {
  const grid = document.getElementById('motivoGrid');
  grid.innerHTML = '';
  const order = ['FIN_VIDA_UTIL', 'CONDICION_OPERATIVA', 'SIN_CAUSA', 'OTRA'];
  order.forEach(k => {
    const m = motivo[k];
    const meta = MOTIVO_META[k];
    if (!m) return;
    grid.appendChild(el(`<div class="motivo-box ${meta.cls}">
      <div class="m-title">${meta.title}</div>
      <div class="m-value">${m.n}</div>
      <div class="m-detail">${m.cumplimientoMedio !== null ? m.cumplimientoMedio.toFixed(1) + '% cumplimiento medio' : 'sin garantía asociada'}</div>
      <div class="m-detail">${m.pctSupera !== null ? m.pctSupera.toFixed(1) + '% supera garantía' : ''}</div>
    </div>`));
  });
}

// ============ table ============
function buildHerramientaRows(prod, life) {
  const prodByRef = byHerramientaProd(BUNDLE, prod, null);
  const rendByRef = new Map(rendimientoPorHerramienta(BUNDLE, life).map(r => [r.ref, r]));
  return prodByRef.map(p => {
    const r = rendByRef.get(p.ref);
    return {
      referencia: p.ref, herramienta: p.herramienta, metros: p.metros, piezas: p.piezas,
      ciclosCerrados: r ? r.n : 0, cumplimiento: r ? r.cumplimientoMedio : null, pctSupera: r ? r.pctSupera : null,
    };
  });
}
function buildPiezaRows(life) {
  const d = BUNDLE.dict;
  const conc = conciliacionCache;
  return life.map(l => {
    const [cm, refIdx, herrIdx, mp, mg, estadoIdx, bucket, causaIdx, , minaIdx, equipoIdx, fechaFinal] = l;
    return {
      codigo: cm, referencia: d.ref[refIdx] || '', herramienta: d.herr[herrIdx] || '',
      mina: d.mina[minaIdx] || '', equipo: d.equipo[equipoIdx] || '',
      metros: mp, garantizado: mg, aceptable: mg ? mg * 0.85 : null, cumplimiento: mg ? (mp / mg * 100) : null,
      estado: d.estado[estadoIdx] || '', motivo: d.causa[causaIdx] || (bucket === 'SIN_CAUSA' ? '—' : bucket),
      fechaBaja: fechaFinal !== null ? dayToDateStr(fechaFinal, BUNDLE.meta.epoch) : '',
      conciliado: conc[cm] === 'SI' ? 'SI' : 'NO',
    };
  });
}

function buildCPMRows(life) {
  const vidaByRef = new Map(vidaUtilPorHerramienta(BUNDLE, life).map(v => [v.ref, v]));
  return cpmPorHerramienta(BUNDLE, life).map(r => {
    const v = vidaByRef.get(r.ref);
    return {
      referencia: r.ref, herramienta: r.herramienta, piezas: r.n,
      precio: r.precio, avgMetrosReal: r.avgMetrosReal, garantizado: r.garantizado,
      cpmReal: r.cpmReal, cpmIdeal: r.cpmIdeal, sobrecostoPct: r.sobrecostoPct,
      vidaUtilDias: v ? v.mediaDias : null, metrosPorDia: v ? v.metrosPorDia : null,
    };
  });
}

const COLS_HERRAMIENTA = [
  { key: 'referencia', label: 'Referencia' },
  { key: 'herramienta', label: 'Herramienta' },
  { key: 'metros', label: 'Metros perforados', num: true, fmt: v => fmtNum(v) },
  { key: 'piezas', label: 'Piezas', num: true },
  { key: 'ciclosCerrados', label: 'Ciclos cerrados', num: true },
  { key: 'cumplimiento', label: 'Cumplimiento medio', num: true, fmt: v => v === null ? '—' : v.toFixed(1) + '%', pill: true },
  { key: 'pctSupera', label: '% supera garantía', num: true, fmt: v => v === null ? '—' : v.toFixed(1) + '%' },
];
const COLS_PIEZA = [
  { key: 'codigo', label: 'Código' },
  { key: 'referencia', label: 'Referencia' },
  { key: 'herramienta', label: 'Herramienta' },
  { key: 'mina', label: 'Mina' },
  { key: 'equipo', label: 'Equipo' },
  { key: 'metros', label: 'Metros perforados', num: true, fmt: v => fmtNum(v) },
  { key: 'garantizado', label: 'Metro ideal (garantizado)', num: true, fmt: v => v === null ? '—' : fmtNum(v) },
  { key: 'aceptable', label: 'Metros aceptables (85%)', num: true, fmt: v => v === null ? '—' : fmtNum(v) },
  { key: 'cumplimiento', label: '% cumplimiento', num: true, fmt: v => v === null ? '—' : v.toFixed(1) + '%', pill: true },
  { key: 'estado', label: 'Estado' },
  { key: 'motivo', label: 'Motivo de baja' },
  { key: 'fechaBaja', label: 'Fecha de baja' },
  {
    key: 'conciliado', label: 'Conciliado',
    render: (raw, row) => {
      const isAdmin = currentUser && currentUser.role === 'admin';
      if (!isAdmin) return `<td><span class="pill ${raw === 'SI' ? 'ok' : 'warn'}">${raw === 'SI' ? '✓ Sí' : '— No'}</span></td>`;
      return `<td><button type="button" class="small conc-toggle ${raw === 'SI' ? 'conc-si' : 'conc-no'}" data-codigo="${esc(row.codigo)}">${raw === 'SI' ? '✓ Sí' : '— No'}</button></td>`;
    },
  },
];
const COLS_CPM = [
  { key: 'referencia', label: 'Referencia' },
  { key: 'herramienta', label: 'Herramienta' },
  { key: 'piezas', label: 'Piezas', num: true },
  { key: 'precio', label: 'Precio unitario', num: true, fmt: v => v == null ? '—' : 'USD ' + fmtNum(v, 0) },
  { key: 'avgMetrosReal', label: 'Metros promedio real', num: true, fmt: v => v == null ? '—' : fmtNum(v) },
  { key: 'garantizado', label: 'Metro garantizado', num: true, fmt: v => v == null ? '—' : fmtNum(v) },
  { key: 'cpmReal', label: 'CPM real', num: true, fmt: v => v == null ? '—' : 'USD ' + v.toFixed(3) },
  { key: 'cpmIdeal', label: 'CPM ideal', num: true, fmt: v => v == null ? '—' : 'USD ' + v.toFixed(3) },
  { key: 'sobrecostoPct', label: 'Sobrecosto vs. ideal', num: true, fmt: v => v == null ? '—' : v.toFixed(0) + '%' },
  { key: 'vidaUtilDias', label: 'Vida útil media', num: true, fmt: v => v == null ? '—' : fmtNum(v, 1) + ' días' },
  { key: 'metrosPorDia', label: 'Metros / día', num: true, fmt: v => v == null ? '—' : fmtNum(v, 1) },
];
const TABLE_TABS = {
  herramienta: { cols: COLS_HERRAMIENTA, build: (prod, life) => buildHerramientaRows(prod, life) },
  pieza: { cols: COLS_PIEZA, build: (prod, life) => buildPiezaRows(life) },
  cpm: { cols: COLS_CPM, build: (prod, life) => buildCPMRows(life) },
};

function renderTable(prod, life) {
  const cols = TABLE_TABS[tableState.tab].cols;
  let rows = TABLE_TABS[tableState.tab].build(prod, life);

  if (tableState.search) {
    const q = tableState.search.toLowerCase();
    rows = rows.filter(r => cols.some(c => String(r[c.key] ?? '').toLowerCase().includes(q)));
  }
  rows.sort((a, b) => {
    const va = a[tableState.sortKey], vb = b[tableState.sortKey];
    let cmp;
    if (va === null || va === undefined) cmp = 1; else if (vb === null || vb === undefined) cmp = -1;
    else if (typeof va === 'number') cmp = va - vb; else cmp = String(va).localeCompare(String(vb));
    return tableState.sortDir === 'asc' ? cmp : -cmp;
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  tableState.page = Math.min(tableState.page, totalPages);
  const pageRows = rows.slice((tableState.page - 1) * PAGE_SIZE, tableState.page * PAGE_SIZE);

  const thead = `<tr>${cols.map(c => `<th data-key="${c.key}" class="${tableState.sortKey === c.key ? 'sorted' : ''}">${esc(c.label)}</th>`).join('')}</tr>`;
  const tbody = pageRows.map(r => `<tr>${cols.map(c => {
    const raw = r[c.key];
    if (c.render) return c.render(raw, r);
    const val = c.fmt ? c.fmt(raw) : (raw === null || raw === undefined || raw === '' ? '—' : esc(raw));
    if (c.pill && raw !== null && raw !== undefined) {
      return `<td class="num"><span class="pill ${rendPillClass(raw)}">${val}</span></td>`;
    }
    return `<td class="${c.num ? 'num' : ''}">${val}</td>`;
  }).join('')}</tr>`).join('');

  document.getElementById('tableHead').innerHTML = thead;
  document.getElementById('tableBody').innerHTML = tbody || `<tr><td colspan="${cols.length}" class="empty-note">Sin resultados.</td></tr>`;
  document.getElementById('pagination').innerHTML = `
    <button class="small" id="pgPrev" ${tableState.page <= 1 ? 'disabled' : ''}>← Anterior</button>
    <span>Página ${tableState.page} de ${totalPages} · ${fmtNum(total)} filas</span>
    <button class="small" id="pgNext" ${tableState.page >= totalPages ? 'disabled' : ''}>Siguiente →</button>
  `;
  document.getElementById('tableHead').querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (tableState.sortKey === key) tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
      else { tableState.sortKey = key; tableState.sortDir = 'desc'; }
      tableState.page = 1;
      renderTable(currentProd, currentLife);
    });
  });
  const prevBtn = document.getElementById('pgPrev'), nextBtn = document.getElementById('pgNext');
  if (prevBtn) prevBtn.addEventListener('click', () => { tableState.page--; renderTable(currentProd, currentLife); });
  if (nextBtn) nextBtn.addEventListener('click', () => { tableState.page++; renderTable(currentProd, currentLife); });
  document.querySelectorAll('#tableBody .conc-toggle').forEach(btn => btn.addEventListener('click', () => {
    btn.disabled = true;
    toggleConciliacion(btn.dataset.codigo).finally(() => renderTable(currentProd, currentLife));
  }));
}

// ============ footer / subtitle ============
function renderMeta(kpis) {
  const months = kpis.months;
  const range = months.length ? `${ymLabel(months[0])} – ${ymLabel(months[months.length - 1])}` : 'sin datos';
  document.getElementById('subtitle').textContent = `Rango de datos: ${range} · ${fmtNum(currentProd.length)} registros diarios · ${fmtNum(currentLife.length)} piezas en el ciclo de vida`;
  document.getElementById('footerMeta').textContent = `Fuente activa: ${BUNDLE.meta.source || '—'} · generado ${BUNDLE.meta.generated || '—'}.`;
}

// ============ orchestrator ============
let currentProd = [], currentLife = [];
function renderAll() {
  const { prod, life } = applyFilters(BUNDLE, filters);
  currentProd = prod; currentLife = life;
  const kpis = kpiTotals(BUNDLE, prod, life);
  renderKPICards(kpis, vidaUtilGlobal(BUNDLE, life));
  renderMonthlyChart(kpis);
  renderActiveToolsChart(kpis);
  renderToolsChart(byHerramientaProd(BUNDLE, prod, null));
  renderRendimientoChart(rendimientoPorHerramienta(BUNDLE, life));
  renderCumplimientoTrend(BUNDLE, life);
  renderMotivo(motivoBaja(BUNDLE, life));
  renderFallaCausa(BUNDLE, life);
  renderCpmPorSarta(BUNDLE, life);
  renderMetrosPorCodigo(BUNDLE, life);
  renderPromedioReferencia(BUNDLE, prod, life);
  renderCPM(BUNDLE, life);
  renderCPMTrend(BUNDLE, life);
  renderGananciaPerdida(BUNDLE, life);
  renderAlertasVida(alertasVidaUtil(BUNDLE, life));
  tableState.page = 1;
  renderTable(prod, life);
  renderMeta(kpis);
}

// ============ import ============
function showImportStatus(msg, kind) {
  const box = document.getElementById('importStatus');
  box.textContent = msg;
  box.className = 'import-status ' + kind;
  box.style.display = 'block';
}
function handleFile(file) {
  if (!file) return;
  showImportStatus('Leyendo ' + file.name + '…', 'info');
  const reader = new FileReader();
  reader.onload = async (e) => {
    let newBundle;
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array', cellDates: false });
      const fallbackCatalog = (BUNDLE.catalog && Object.keys(BUNDLE.catalog).length) ? BUNDLE.catalog : DEFAULT_BUNDLE.catalog;
      newBundle = buildBundleFromWorkbook(wb, file.name, fallbackCatalog);
      if (!newBundle.prod.length) throw new Error('El archivo no contiene registros de producción reconocibles.');
      if (!Object.keys(newBundle.catalog || {}).length) newBundle.catalog = fallbackCatalog;
      BUNDLE = newBundle;
      filters = EMPTY_FILTERS();
      herrForRefCache.clear();
      populateFilterOptions();
      renderAll();
      showImportStatus(`Cargado en tu vista: ${fmtNum(newBundle.prod.length)} registros y ${fmtNum(newBundle.life.length)} piezas desde "${file.name}". Guardando para todos los usuarios…`, 'info');
    } catch (err) {
      showImportStatus('No se pudo procesar el archivo: ' + err.message, 'err');
      return;
    }
    try {
      await publishSharedBundle(newBundle, file.name);
      cachedSharedBundle = newBundle;
      populateFieldControls();
      populateBajaControls();
      await refreshFieldHistory();
      showImportStatus(`Listo: ${fmtNum(newBundle.prod.length)} registros y ${fmtNum(newBundle.life.length)} piezas desde "${file.name}", guardado y visible para todos los usuarios.`, 'ok');
    } catch (pubErr) {
      showImportStatus(`Tu vista se actualizó, pero no se pudo guardar para los demás usuarios (${pubErr.message}). Vuelve a intentarlo.`, 'err');
    }
  };
  reader.onerror = () => showImportStatus('Error leyendo el archivo.', 'err');
  reader.readAsArrayBuffer(file);
}

// ============ conciliación (SI/NO por código — compartida vía Supabase) ============
async function refreshConciliacion() {
  try { conciliacionCache = await CTAuth.loadConciliacionRemote(); }
  catch (e) { conciliacionCache = {}; }
}
async function toggleConciliacion(codigo) {
  const prev = conciliacionCache[codigo] === 'SI' ? 'SI' : 'NO';
  const next = prev === 'SI' ? 'NO' : 'SI';
  conciliacionCache[codigo] = next;
  try {
    await CTAuth.setConciliacion(codigo, next === 'SI');
  } catch (e) {
    conciliacionCache[codigo] = prev;
    alert('No se pudo guardar la conciliación (' + e.message + ').');
  }
}

function normUpperText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.toUpperCase() : null;
}
function mineMatchesCurrent(v) {
  if (!minePinnedValues.length) return true;
  return minePinnedValues.includes(normUpperText(v));
}
function canWriteFieldData() {
  if (!currentUser) return false;
  return currentUser.role === 'admin' || currentUser.role === 'operator';
}
function canManageBajas() {
  return currentUser && currentUser.role === 'admin';
}
function readFieldMetaMap() {
  try { return JSON.parse(localStorage.getItem(FIELD_META_KEY) || '{}'); }
  catch (e) { return {}; }
}
function writeFieldMetaMap(map) {
  try { localStorage.setItem(FIELD_META_KEY, JSON.stringify(map)); }
  catch (e) {}
}
function saveFieldMetaForRows(insertedRows, payload) {
  const map = readFieldMetaMap();
  insertedRows.forEach(r => {
    if (!r || r.id === null || r.id === undefined) return;
    map[String(r.id)] = {
      turno: payload.turno || null,
      barrenos: payload.barrenos || null,
      longitud: payload.longitud || null,
      observaciones: payload.observaciones || null,
      sarta: payload.sarta || null,
      mineSlug: payload.mineSlug || null,
      ownerEmail: currentUser ? currentUser.email : null,
      updatedAt: new Date().toISOString(),
    };
  });
  writeFieldMetaMap(map);
}
function applyMinePinUI() {
  if (!minePinnedValues.length) return;
  filters.mina = minePinnedValues.filter(v => BUNDLE.dict.mina.includes(v));
  if (!filters.mina.length && minePinnedValues.length) filters.mina = minePinnedValues.slice();
  const minaBtn = document.getElementById('minaBtn');
  if (minaBtn) {
    minaBtn.disabled = true;
    minaBtn.title = 'La mina se controla desde el módulo seleccionado.';
  }
}
function defaultToday() {
  return new Date().toISOString().slice(0, 10);
}
function autoCalcMetros() {
  const b = Number(document.getElementById('fieldBarrenos').value || 0);
  const l = Number(document.getElementById('fieldLongitud').value || 0);
  const m = Math.round((b * l) * 1000) / 1000;
  document.getElementById('fieldMetros').value = String(m);
}
function currentMineSlugFromField() {
  const sel = document.getElementById('fieldMina');
  return sel && sel.value ? sel.value : (currentMine || 'segovia');
}
function collectInventoryRows() {
  const d = BUNDLE.dict;
  const out = [];
  for (const l of BUNDLE.life) {
    const codigo = l[0];
    const ref = d.ref[l[1]] || '';
    const herr = d.herr[l[2]] || ref;
    const estado = d.estado[l[5]] || '';
    const mina = d.mina[l[9]] || '';
    if (!mineMatchesCurrent(mina)) continue;
    if (estado === 'INACTIVO' || estado === 'INACTIVA') continue;
    out.push({ codigo, ref, herr, estado, mina });
  }
  out.sort((a, b) => (a.herr + a.codigo).localeCompare(b.herr + b.codigo));
  return out;
}
function populateFieldControls() {
  const writeEnabled = canWriteFieldData();
  const btn = document.getElementById('fieldBtn');
  if (btn) btn.hidden = presentationMode || !currentUser || !(currentUser.role === 'admin' || currentUser.role === 'operator');
  const card = document.getElementById('fieldCard');
  if (!card) return;
  const mineSel = document.getElementById('fieldMina');
  mineSel.innerHTML = '';
  MINES.filter(m => canSeeMine(m.slug)).forEach(m => {
    mineSel.appendChild(el(`<option value="${esc(m.slug)}" ${m.slug === currentMine ? 'selected' : ''}>${esc(m.label)}</option>`));
  });
  if (!mineSel.value && currentMine) mineSel.value = currentMine;

  const equipoSet = new Set();
  BUNDLE.dict.equipo.forEach(e => { if (e) equipoSet.add(e); });
  const equipoList = document.getElementById('fieldEquipoList');
  equipoList.innerHTML = Array.from(equipoSet).sort().map(e => `<option value="${esc(e)}"></option>`).join('');

  const sartaSel = document.getElementById('fieldSarta');
  const names = Object.keys(BUNDLE.sartas || {}).sort();
  sartaSel.innerHTML = `<option value="">Sin sarta</option>${names.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;

  const inv = collectInventoryRows();
  const codes = document.getElementById('fieldCodigos');
  codes.innerHTML = inv.map(r => `<option value="${esc(r.codigo)}">${esc(r.herr)} · ${esc(r.codigo)}${r.estado ? ' · ' + esc(r.estado) : ''}</option>`).join('');

  const opInput = document.getElementById('fieldOperador');
  if (!opInput.value && currentUser && currentUser.email) opInput.value = currentUser.email.split('@')[0].toUpperCase();
  document.getElementById('fieldFecha').value = defaultToday();
  const baseNote = writeEnabled
    ? 'Nota: Turno y observaciones se guardan en la bitácora local de este dispositivo. Para guardarlas en base compartida, falta agregar columnas en Supabase.'
    : 'Tu rol es de solo lectura en producción. Puedes ver historial, pero no registrar datos.';
  const noteEl = document.getElementById('fieldMetaNote');
  noteEl.dataset.baseNote = baseNote;
  noteEl.textContent = baseNote;
  Array.from(card.querySelectorAll('input,select,textarea,button')).forEach(x => {
    if (x.id === 'fieldBtn') return;
    if (x.id === 'fieldResetBtn') return;
    if (x.id === 'fieldMina') x.disabled = !writeEnabled;
    else if (x.tagName === 'BUTTON' && x.type === 'submit') x.disabled = !writeEnabled;
    else x.disabled = !writeEnabled && x.id !== 'fieldCodigos';
  });
  document.getElementById('fieldResetBtn').disabled = !writeEnabled;
}
function selectedCodesFromForm() {
  return Array.from(document.getElementById('fieldCodigos').selectedOptions).map(o => o.value);
}
async function submitFieldForm(e) {
  e.preventDefault();
  const status = document.getElementById('fieldStatus');
  status.style.display = 'none';
  if (!canWriteFieldData()) {
    status.textContent = 'Tu rol actual no tiene permiso para guardar registros de campo.';
    status.className = 'import-status err';
    status.style.display = 'block';
    return;
  }
  const payload = {
    fecha: document.getElementById('fieldFecha').value,
    turno: document.getElementById('fieldTurno').value,
    mineSlug: currentMineSlugFromField(),
    equipo: document.getElementById('fieldEquipo').value,
    sarta: document.getElementById('fieldSarta').value || null,
    operador: document.getElementById('fieldOperador').value,
    barrenos: Number(document.getElementById('fieldBarrenos').value || 0),
    longitud: Number(document.getElementById('fieldLongitud').value || 0),
    metros: Number(document.getElementById('fieldMetros').value || 0),
    observaciones: document.getElementById('fieldObs').value.trim(),
    codigos: selectedCodesFromForm(),
  };
  if (!payload.fecha || !payload.turno || !payload.equipo || !payload.operador || payload.metros <= 0 || !payload.codigos.length) {
    status.textContent = 'Completa fecha, turno, equipo, operador, metros y al menos un código de herramienta.';
    status.className = 'import-status err';
    status.style.display = 'block';
    return;
  }
  status.textContent = 'Guardando registro de campo…';
  status.className = 'import-status info';
  status.style.display = 'block';
  try {
    const rows = await saveFieldRegistro(BUNDLE, payload);
    saveFieldMetaForRows(rows, payload);
    status.textContent = `Registro guardado: ${fmtNum(rows.length)} fila(s) en producción.`;
    status.className = 'import-status ok';
    await forceRefreshData('save-field');
    await refreshFieldHistory();
  } catch (err) {
    status.textContent = `No se pudo guardar el registro (${err.message}). Si tu usuario es de campo, falta habilitar permisos RLS para escritura en producción.`;
    status.className = 'import-status err';
  }
}
function renderFieldHistoryTable(rows) {
  const table = document.getElementById('fieldHistoryTable');
  if (!table) return;
  const meta = readFieldMetaMap();
  if (!rows.length) {
    table.innerHTML = '<thead><tr><th>Resultado</th></tr></thead><tbody><tr><td class="empty-note">Sin registros para este operario/mina.</td></tr></tbody>';
    return;
  }
  const body = rows.map(r => {
    const m = meta[String(r.id)] || {};
    const canEdit = canWriteFieldData() && (currentUser.role === 'admin' || normUpperText(r.operador) === normUpperText(document.getElementById('fieldOperador').value));
    return `<tr>
      <td>${esc(String(r.id))}</td>
      <td>${esc(r.fecha || '')}</td>
      <td>${esc(r.equipo || '')}</td>
      <td>${esc(r.operador || '')}</td>
      <td class="num">${fmtNum(r.metros, 2)}</td>
      <td>${esc(r.codigo_marcado || '')}</td>
      <td>${esc(m.turno || '—')}</td>
      <td>${esc(m.observaciones || '—')}</td>
      <td>${canEdit ? `<button type="button" class="small" data-edit-row="${esc(String(r.id))}">Corregir</button>` : '—'}</td>
    </tr>`;
  }).join('');
  table.innerHTML = `<thead><tr><th>ID</th><th>Fecha</th><th>Equipo</th><th>Operador</th><th>Metros</th><th>Código</th><th>Turno</th><th>Observación</th><th>Acción</th></tr></thead><tbody>${body}</tbody>`;
  table.querySelectorAll('button[data-edit-row]').forEach(btn => btn.addEventListener('click', () => editFieldRow(btn.dataset.editRow)));
}
async function refreshFieldHistory() {
  const mineValues = mineValuesForSlugUI(currentMineSlugFromField());
  const operador = normUpperText(document.getElementById('fieldOperador').value || '');
  try {
    const rows = await loadMisRegistros({ mineValues, operador, limit: 60 });
    fieldHistoryRows = rows;
    renderFieldHistoryTable(rows);
  } catch (err) {
    renderFieldHistoryTable([]);
    const status = document.getElementById('fieldStatus');
    status.textContent = `No se pudo leer historial (${err.message}).`;
    status.className = 'import-status err';
    status.style.display = 'block';
  }
}
async function editFieldRow(id) {
  const row = fieldHistoryRows.find(r => String(r.id) === String(id));
  if (!row) return;
  const nMetros = prompt('Nuevo valor de metros para el registro #' + id, String(row.metros || ''));
  if (nMetros === null) return;
  const nEquipo = prompt('Nuevo equipo/taladro para el registro #' + id, String(row.equipo || ''));
  if (nEquipo === null) return;
  const nOperador = prompt('Nuevo operador para el registro #' + id, String(row.operador || ''));
  if (nOperador === null) return;
  try {
    await patchRegistroProduccion(id, {
      metros: Math.round(Number(nMetros || 0) * 1000) / 1000,
      equipo: normUpperText(nEquipo),
      operador: normUpperText(nOperador),
    });
    await forceRefreshData('edit-field');
    await refreshFieldHistory();
  } catch (err) {
    alert('No se pudo corregir el registro (' + err.message + '). Si tu usuario es de campo, falta habilitar permisos de actualización en producción.');
  }
}
function populateBajaControls() {
  const card = document.getElementById('bajaCard');
  const show = !presentationMode && canManageBajas();
  card.hidden = !show;
  if (!show) return;
  const inv = collectInventoryRows();
  const codigoSel = document.getElementById('bajaCodigo');
  codigoSel.innerHTML = inv.length ? inv.map(r => `<option value="${esc(r.codigo)}">${esc(r.herr)} · ${esc(r.codigo)} · ${esc(r.mina || '')}</option>`).join('') : '<option value="">Sin piezas activas</option>';
  document.getElementById('bajaFecha').value = defaultToday();
  const modos = (BUNDLE.dict.falla || []).filter(Boolean).sort();
  const causas = (BUNDLE.dict.causa || []).filter(Boolean).sort();
  document.getElementById('bajaModo').innerHTML = `<option value="">Sin modo</option>${modos.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}`;
  document.getElementById('bajaCausa').innerHTML = `<option value="">Sin causa</option>${causas.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}`;
}
async function submitBajaForm(e) {
  e.preventDefault();
  const status = document.getElementById('bajaStatus');
  status.style.display = 'none';
  if (!canManageBajas()) {
    status.textContent = 'Solo los administradores pueden registrar bajas.';
    status.className = 'import-status err';
    status.style.display = 'block';
    return;
  }
  const payload = {
    codigo: document.getElementById('bajaCodigo').value,
    fecha: document.getElementById('bajaFecha').value,
    modo: document.getElementById('bajaModo').value || null,
    causa: document.getElementById('bajaCausa').value || null,
    observacion: document.getElementById('bajaObs').value.trim(),
  };
  if (!payload.codigo || !payload.fecha) {
    status.textContent = 'Selecciona código y fecha de baja.';
    status.className = 'import-status err';
    status.style.display = 'block';
    return;
  }
  try {
    await registrarBaja(payload);
    status.textContent = 'Baja registrada correctamente.';
    status.className = 'import-status ok';
    status.style.display = 'block';
    await forceRefreshData('baja');
    populateFieldControls();
    populateBajaControls();
  } catch (err) {
    status.textContent = `No se pudo registrar la baja (${err.message}).`;
    status.className = 'import-status err';
    status.style.display = 'block';
  }
}
function renderAlertasVida(alertas) {
  const box = document.getElementById('fieldMetaNote');
  if (!box) return;
  const base = box.dataset.baseNote || box.textContent || '';
  if (!alertas || !alertas.totalActivasEvaluadas) {
    box.textContent = `${base} | Alertas de vida útil: no hay piezas activas con MGAR para evaluar.`;
    return;
  }
  box.textContent = `${base} | Alertas: preventivo 80%=${alertas.preventivo80}, alto 90%=${alertas.alto90}, crítico 100%=${alertas.critico100}.`;
}
async function forceRefreshData(_reason) {
  await loadSharedBundleIntoApp(true);
  applyMinePinUI();
  herrForRefCache.clear();
  populateFilterOptions();
  renderAll();
}
async function periodicRefreshTick() {
  if (!currentUser || !currentMine) return;
  try {
    await forceRefreshData('poll');
    await refreshFieldHistory();
  } catch (e) {}
}
function setupRefreshTimer() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(periodicRefreshTick, 30000);
}

// ============ theme ============
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('ct_theme'); } catch (e) {}
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  updateThemeBtn();
}
function updateThemeBtn() {
  const cur = document.documentElement.getAttribute('data-theme') || 'auto';
  const label = { auto: '🌓 Auto', light: '☀️ Claro', dark: '🌙 Oscuro' }[cur];
  document.getElementById('themeToggle').textContent = label;
}
function cycleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === null ? 'light' : cur === 'light' ? 'dark' : null;
  if (next === null) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', next);
  try { if (next) localStorage.setItem('ct_theme', next); else localStorage.removeItem('ct_theme'); } catch (e) {}
  updateThemeBtn();
}

// ============ usuarios (gestión real — vía Supabase; solo visible para administradores) ============
async function renderUserMgmt() {
  const listEl = document.getElementById('userList');
  if (!listEl || !currentUser || currentUser.role !== 'admin') return;
  let profiles;
  try { profiles = await CTAuth.listProfiles(); }
  catch (err) {
    listEl.innerHTML = `<p class="chart-sub">No se pudo cargar la lista de usuarios (${esc(err.message)}).</p>`;
    return;
  }
  listEl.innerHTML = '';
  profiles.forEach(p => {
    const isSelf = currentUser && p.id === currentUser.id;
    const minesHtml = p.role === 'admin'
      ? '<span class="mine-checks"><span class="admin-note">ve todas las minas</span></span>'
      : `<span class="mine-checks">${MINES.map(m => `<label><input type="checkbox" data-mine="${esc(m.slug)}" ${(p.allowed_mines || []).includes(m.slug) ? 'checked' : ''}> ${esc(m.label.replace('Aris Mining ', ''))}</label>`).join('')}</span>`;
    const row = el(`<div class="user-row">
      <span class="user-email">${esc(p.email)}</span>
      <select data-id="${esc(p.id)}">
        <option value="viewer" ${p.role === 'viewer' ? 'selected' : ''}>Visualizador</option>
        <option value="operator" ${p.role === 'operator' ? 'selected' : ''}>Operador de campo</option>
        <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Administrador</option>
      </select>
      ${minesHtml}
      <button class="small ghost" type="button" ${isSelf ? 'disabled title="No puedes revocar tu propio acceso"' : ''}>Revocar</button>
    </div>`);
    const status = document.getElementById('userAddStatus');
    const select = row.querySelector('select');
    select.addEventListener('change', async () => {
      try {
        await CTAuth.updateProfileRole(p.id, select.value);
        status.textContent = `Rol de ${p.email} actualizado a ${select.value === 'admin' ? 'Administrador' : (select.value === 'operator' ? 'Operador de campo' : 'Visualizador')}.`;
        status.className = 'import-status ok'; status.style.display = 'block';
        if (isSelf) { currentUser.role = select.value; updateAuthUI(); }
        renderUserMgmt();
      } catch (err) {
        select.value = p.role;
        status.textContent = 'No se pudo actualizar el rol (' + err.message + ').';
        status.className = 'import-status err'; status.style.display = 'block';
      }
    });
    row.querySelectorAll('input[type="checkbox"][data-mine]').forEach(cb => {
      cb.addEventListener('change', async () => {
        const current = new Set(p.allowed_mines || []);
        if (cb.checked) current.add(cb.dataset.mine); else current.delete(cb.dataset.mine);
        const mines = Array.from(current);
        try {
          await CTAuth.updateProfileMines(p.id, mines);
          p.allowed_mines = mines;
          status.textContent = `Acceso de ${p.email} actualizado.`;
          status.className = 'import-status ok'; status.style.display = 'block';
          if (isSelf) { currentUser.allowed_mines = mines; }
        } catch (err) {
          cb.checked = !cb.checked;
          status.textContent = 'No se pudo actualizar el acceso (' + err.message + ').';
          status.className = 'import-status err'; status.style.display = 'block';
        }
      });
    });
    const delBtn = row.querySelector('button');
    if (!isSelf) delBtn.addEventListener('click', async () => {
      if (!confirm(`¿Revocar el acceso de ${p.email}?`)) return;
      try {
        await CTAuth.removeProfile(p.id);
        renderUserMgmt();
      } catch (err) {
        alert('No se pudo revocar el acceso (' + err.message + ').');
      }
    });
    listEl.appendChild(row);
  });
}

// ============ autenticación (real — Supabase Auth, ver auth.js) ============
function updateAuthUI() {
  if (!currentUser) return;
  const roleLabel = currentUser.role === 'admin' ? 'Administrador' : (currentUser.role === 'operator' ? 'Operador' : 'Visualizador');
  const label = `${currentUser.email} · ${roleLabel}`;
  const badge = document.getElementById('userBadge');
  badge.textContent = label; badge.hidden = false;
  document.getElementById('hubUserBadge').textContent = label;
  document.getElementById('importBtn').hidden = presentationMode || currentUser.role !== 'admin';
  document.getElementById('fieldBtn').hidden = presentationMode || !(currentUser.role === 'admin' || currentUser.role === 'operator');
}
// Se guarda en memoria durante la sesión para que entrar y salir del módulo
// varias veces no vuelva a traer todo desde Supabase cada vez — solo la
// primera vez (o después de importar un Excel nuevo, que ya actualiza esto
// directamente).
let cachedSharedBundle = null;
async function loadSharedBundleIntoApp(force) {
  if (!force && cachedSharedBundle) { BUNDLE = cachedSharedBundle; return; }
  try {
    const shared = await loadSharedBundle();
    if (shared) { BUNDLE = shared; cachedSharedBundle = shared; }
    else if (force) { BUNDLE = DEFAULT_BUNDLE; }
  } catch (e) { /* se queda con el bundle base embebido */ }
}
function showScreen(name) {
  document.body.classList.remove('screen-hub', 'screen-app', 'screen-users');
  document.body.classList.add('screen-' + name);
}
function mineInfo(slug) {
  return MINES.find(m => m.slug === slug) || { label: slug, sub: '' };
}
function renderHub() {
  const grid = document.getElementById('hubGrid');
  grid.innerHTML = '';
  MINES.forEach(m => {
    if (!canSeeMine(m.slug)) return;
    const card = el(`<button type="button" class="hub-card">
      <span class="hub-card-icon">${m.icon}</span>
      <span class="hub-card-title">${esc(m.label)}</span>
      <span class="hub-card-sub">${esc(m.sub)}</span>
    </button>`);
    card.addEventListener('click', () => enterMine(m.slug));
    grid.appendChild(card);
  });
  if (MINES.some(m => canSeeMine(m.slug))) {
    const card = el(`<button type="button" class="hub-card">
      <span class="hub-card-icon">📊</span>
      <span class="hub-card-title">Presentación al cliente</span>
      <span class="hub-card-sub">Vista resumida, sin CPM ni cifras de pérdida</span>
    </button>`);
    card.addEventListener('click', () => enterMine(MINES.find(m => canSeeMine(m.slug)).slug, { presentation: true }));
    grid.appendChild(card);
  }
  if (currentUser.role === 'admin') {
    const card = el(`<button type="button" class="hub-card">
      <span class="hub-card-icon">👤</span>
      <span class="hub-card-title">Gestión de usuarios</span>
      <span class="hub-card-sub">Roles y acceso por mina</span>
    </button>`);
    card.addEventListener('click', enterUsersScreen);
    grid.appendChild(card);
  }
  if (!grid.children.length) {
    grid.innerHTML = '<div class="hub-empty">No tienes acceso a ningún módulo todavía. Pide a un administrador que te asigne acceso.</div>';
  }
}
async function enterHub(user) {
  currentUser = user;
  document.body.classList.add('authed');
  updateAuthUI();
  renderHub();
  showScreen('hub');
}
function populatePresentationMineSelect() {
  const sel = document.getElementById('presentationMineSelect');
  sel.innerHTML = '';
  MINES.filter(m => canSeeMine(m.slug)).forEach(m => {
    sel.appendChild(el(`<option value="${esc(m.slug)}" ${m.slug === currentMine ? 'selected' : ''}>${esc(m.label)}</option>`));
  });
  if (!sel.dataset.wired) {
    sel.dataset.wired = '1';
    sel.addEventListener('change', () => enterMine(sel.value, { presentation: true }));
  }
}
async function enterMine(slug, opts) {
  opts = opts || {};
  currentMine = slug;
  minePinnedValues = mineValuesForSlugUI(slug).map(normUpperText);
  presentationMode = !!opts.presentation;
  document.body.classList.toggle('presentation', presentationMode);
  document.getElementById('presentationMineSelect').hidden = !presentationMode;
  updateAuthUI();
  const info = mineInfo(slug);
  document.title = 'CORE TECH · ' + info.label;
  document.getElementById('presentationBadge').hidden = !presentationMode;
  if (presentationMode) populatePresentationMineSelect();
  DEFAULT_BUNDLE = MINE_DEFAULT_BUNDLES[slug] || emptyBundle();
  BUNDLE = DEFAULT_BUNDLE;
  filters = EMPTY_FILTERS();
  herrForRefCache.clear();
  await refreshConciliacion();
  await loadSharedBundleIntoApp(true);
  showScreen('app');
  if (!appInitialized) { appInitialized = true; initApp(); }
  else {
    populateFilterOptions();
    renderAll();
    populateFieldControls();
    populateBajaControls();
    refreshFieldHistory();
  }
  setupRefreshTimer();
}
function backToHub() {
  currentMine = null;
  minePinnedValues = [];
  presentationMode = false;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  document.body.classList.remove('presentation');
  document.title = 'CORE TECH · Desempeño de Aceros de Perforación';
  renderHub();
  showScreen('hub');
}
async function enterUsersScreen() {
  showScreen('users');
  await renderUserMgmt();
}
async function handleLoginSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('loginError');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  errorEl.style.display = 'none';
  submitBtn.disabled = true;
  try {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    await CTAuth.signIn(email, password);
    const profile = await CTAuth.getMyProfile();
    if (!profile) {
      await CTAuth.signOut();
      errorEl.textContent = 'Tu acceso fue revocado. Contacta a un administrador.';
      errorEl.style.display = 'block';
      return;
    }
    await enterHub(profile);
  } catch (err) {
    errorEl.textContent = /invalid/i.test(err.message) ? 'Correo o contraseña incorrectos.' : ('No se pudo iniciar sesión (' + err.message + ').');
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
}
async function handleSetPasswordSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('setPasswordError');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  errorEl.style.display = 'none';
  submitBtn.disabled = true;
  try {
    const password = document.getElementById('newPassword1').value;
    await CTAuth.setPassword(password);
    const profile = await CTAuth.getMyProfile();
    if (!profile) {
      errorEl.textContent = 'Tu cuenta no tiene un perfil asignado todavía. Contacta a un administrador.';
      errorEl.style.display = 'block';
      return;
    }
    await enterHub(profile);
  } catch (err) {
    errorEl.textContent = 'No se pudo guardar la contraseña (' + err.message + ').';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
}
async function handleLogout() {
  await CTAuth.signOut();
  currentUser = null;
  currentMine = null;
  minePinnedValues = [];
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  document.body.classList.remove('authed', 'screen-hub', 'screen-app', 'screen-users');
  document.getElementById('loginPassword').value = '';
}
async function restoreSession() {
  try {
    const session = await CTAuth.getSession();
    if (!session) return;
    const profile = await CTAuth.getMyProfile();
    if (!profile) { await CTAuth.signOut(); return; }
    await enterHub(profile);
  } catch (e) { /* se queda en la pantalla de inicio */ }
}
function initAuth() {
  document.getElementById('loginForm').addEventListener('submit', handleLoginSubmit);
  document.getElementById('setPasswordForm').addEventListener('submit', handleSetPasswordSubmit);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('hubLogoutBtn').addEventListener('click', handleLogout);
  document.getElementById('appBackBtn').addEventListener('click', backToHub);
  document.getElementById('usersBackBtn').addEventListener('click', backToHub);

  if (CTAuth.cameFromAuthLink) {
    document.getElementById('loginPanel').hidden = true;
    document.getElementById('setPasswordPanel').hidden = false;
    return;
  }
  restoreSession();
}

// ============ wire up ============
function initApp() {
  initTheme();
  document.getElementById('themeToggle').addEventListener('click', cycleTheme);
  document.getElementById('clearFilters').addEventListener('click', clearFilters);
  document.querySelectorAll('.datepreset').forEach(b => b.addEventListener('click', () => applyDatePreset(b.dataset.preset)));
  document.getElementById('dateFrom').addEventListener('change', (e) => { filters.dateFrom = e.target.value || null; filters.months = []; syncMonthBtnLabel(); renderAll(); });
  document.getElementById('dateTo').addEventListener('change', (e) => { filters.dateTo = e.target.value || null; filters.months = []; syncMonthBtnLabel(); renderAll(); });

const DEFAULT_SORT = { herramienta: 'metros', pieza: 'metros', cpm: 'cpmReal' };
document.querySelectorAll('.table-tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.table-tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    tableState.tab = b.dataset.tab; tableState.sortKey = DEFAULT_SORT[b.dataset.tab]; tableState.sortDir = 'desc'; tableState.page = 1;
    renderTable(currentProd, currentLife);
  }));
  document.getElementById('tableSearch').addEventListener('input', (e) => { tableState.search = e.target.value; tableState.page = 1; renderTable(currentProd, currentLife); });

  const fileInput = document.getElementById('fileInput');
  const importCard = document.getElementById('importCard');
  const fieldCard = document.getElementById('fieldCard');
  const bajaCard = document.getElementById('bajaCard');

  document.getElementById('fieldBtn').addEventListener('click', async () => {
    fieldCard.hidden = !fieldCard.hidden;
    if (!fieldCard.hidden) {
      importCard.hidden = true;
      populateFieldControls();
      await refreshFieldHistory();
      fieldCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    importCard.hidden = !importCard.hidden;
    if (!importCard.hidden) {
      fieldCard.hidden = true;
      if (canManageBajas()) bajaCard.hidden = false;
      importCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  document.getElementById('fieldForm').addEventListener('submit', submitFieldForm);
  document.getElementById('fieldResetBtn').addEventListener('click', () => {
    document.getElementById('fieldTurno').value = '';
    document.getElementById('fieldEquipo').value = '';
    document.getElementById('fieldSarta').value = '';
    document.getElementById('fieldBarrenos').value = '1';
    document.getElementById('fieldLongitud').value = '0';
    document.getElementById('fieldObs').value = '';
    autoCalcMetros();
  });
  document.getElementById('fieldBarrenos').addEventListener('input', autoCalcMetros);
  document.getElementById('fieldLongitud').addEventListener('input', autoCalcMetros);
  document.getElementById('fieldMina').addEventListener('change', async (e) => {
    currentMine = e.target.value;
    minePinnedValues = mineValuesForSlugUI(currentMine).map(normUpperText);
    await forceRefreshData('mine-switch-field');
    populateFieldControls();
    populateBajaControls();
    await refreshFieldHistory();
  });
  document.getElementById('fieldSarta').addEventListener('change', () => {
    const sel = document.getElementById('fieldSarta').value;
    if (!sel) return;
    const refSet = new Set(BUNDLE.sartas[sel] || []);
    const codSel = document.getElementById('fieldCodigos');
    Array.from(codSel.options).forEach(opt => {
      const code = opt.value;
      const life = BUNDLE.life.find(l => l[0] === code);
      const ref = life ? BUNDLE.dict.ref[life[1]] : null;
      opt.selected = !!(ref && refSet.has(ref));
    });
  });
  document.getElementById('fieldOperador').addEventListener('change', refreshFieldHistory);

  document.getElementById('bajaForm').addEventListener('submit', submitBajaForm);

  document.getElementById('browseBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
  const dz = document.getElementById('dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  document.getElementById('restoreBtn').addEventListener('click', () => {
    BUNDLE = DEFAULT_BUNDLE; filters = EMPTY_FILTERS();
    herrForRefCache.clear(); populateFilterOptions(); renderAll();
    populateFieldControls(); populateBajaControls(); refreshFieldHistory();
    showImportStatus('Se restauró tu vista al archivo base original. Esto no cambia la base de datos compartida — para eso, importa un Excel.', 'info');
  });

  populateFilterOptions();
  renderAll();
  populateFieldControls();
  populateBajaControls();
  refreshFieldHistory();
}

document.addEventListener('DOMContentLoaded', initAuth);
})();
