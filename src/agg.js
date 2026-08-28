// ---------- Pure aggregation engine (no DOM) ----------
// Works over a "bundle": {dict:{mina,tipo,equipo,ref,herr,estado,causa,falla,operador}, catalog, prod, life, meta}
// prod row: [fecha(dayNum), minaIdx, tipoIdx, equipoIdx, refIdx, herrIdx, codigoMarcado, metros, primary(0|1), operadorIdx]
// `primary` marks, per original report row, the single tool that should count once toward
// "total metros" / monthly totals when several tools share one drilling event (wide-format
// sources). Every melted record still counts fully in by-herramienta breakdowns.
// life row: [codigoMarcado, refIdx, herrIdx, metrosPerforados, metrosGarantizados, estadoIdx, bucket, causaIdx, fallaIdx, minaIdx, equipoIdx, fechaFinal(dayNum|null), usd, fechaInicio(dayNum|null), operadorIdx]

const EPOCH_DEFAULT = '2020-01-01';

function dayToDate(dayNum, epochStr) {
  const epoch = new Date(epochStr + 'T00:00:00Z');
  const d = new Date(epoch.getTime() + dayNum * 86400000);
  return d;
}
function dayToYM(dayNum, epochStr) {
  const d = dayToDate(dayNum, epochStr);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
function dayToYear(dayNum, epochStr) {
  return dayToDate(dayNum, epochStr).getUTCFullYear();
}
function dayToDateStr(dayNum, epochStr) {
  return dayToDate(dayNum, epochStr).toISOString().slice(0, 10);
}

const MONTH_NAMES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

function applyFilters(bundle, filters) {
  const { dict } = bundle;
  const epoch = bundle.meta.epoch || EPOCH_DEFAULT;

  const minaSet = filters.mina && filters.mina.length ? new Set(filters.mina) : null;
  const tipoSet = filters.tipo && filters.tipo.length ? new Set(filters.tipo) : null;
  const equipoSet = filters.equipo && filters.equipo.length ? new Set(filters.equipo) : null;
  const refSet = filters.ref && filters.ref.length ? new Set(filters.ref) : null;
  const estadoSet = filters.estado && filters.estado.length ? new Set(filters.estado) : null;
  const operadorSet = filters.operador && filters.operador.length ? new Set(filters.operador) : null;
  const monthSet = filters.months && filters.months.length ? new Set(filters.months) : null;
  const dFrom = (!monthSet && filters.dateFrom) ? Math.floor((new Date(filters.dateFrom + 'T00:00:00Z') - new Date(epoch + 'T00:00:00Z')) / 86400000) : null;
  const dTo = (!monthSet && filters.dateTo) ? Math.floor((new Date(filters.dateTo + 'T00:00:00Z') - new Date(epoch + 'T00:00:00Z')) / 86400000) : null;

  const prod = bundle.prod.filter(p => {
    const [fecha, minaIdx, tipoIdx, equipoIdx, refIdx, , , , , operadorIdx] = p;
    if (minaSet && !minaSet.has(dict.mina[minaIdx])) return false;
    if (tipoSet && !tipoSet.has(dict.tipo[tipoIdx])) return false;
    if (equipoSet && !equipoSet.has(dict.equipo[equipoIdx])) return false;
    if (refSet && !refSet.has(dict.ref[refIdx])) return false;
    if (operadorSet && !operadorSet.has(dict.operador[operadorIdx])) return false;
    if (monthSet && !monthSet.has(dayToYM(fecha, epoch))) return false;
    if (dFrom !== null && fecha < dFrom) return false;
    if (dTo !== null && fecha > dTo) return false;
    return true;
  });

  const life = bundle.life.filter(l => {
    const [, refIdx, , , , estadoIdx, , , , minaIdx, equipoIdx, fechaFinal, , , operadorIdx] = l;
    if (minaSet && !minaSet.has(dict.mina[minaIdx])) return false;
    if (equipoSet && !equipoSet.has(dict.equipo[equipoIdx])) return false;
    if (refSet && !refSet.has(dict.ref[refIdx])) return false;
    if (estadoSet && !estadoSet.has(dict.estado[estadoIdx])) return false;
    if (operadorSet && !operadorSet.has(dict.operador[operadorIdx])) return false;
    // Date/month filters only apply to pieces with a recorded discharge date;
    // pieces without one (still undated in the source) are always kept.
    if (fechaFinal !== null && fechaFinal !== undefined) {
      if (monthSet && !monthSet.has(dayToYM(fechaFinal, epoch))) return false;
      if (dFrom !== null && fechaFinal < dFrom) return false;
      if (dTo !== null && fechaFinal > dTo) return false;
    }
    return true;
  });

  return { prod, life };
}

function kpiTotals(bundle, prod, life) {
  const { dict } = bundle;
  const epoch = bundle.meta.epoch || EPOCH_DEFAULT;

  let totalMetros = 0;
  const byMonth = new Map();
  const toolsByMonth = new Map(); // ym -> Set(codigoMarcado)
  const piezasSet = new Set();
  const refSet = new Set();

  for (const p of prod) {
    const [fecha, , , , refIdx, , cm, metros, primary] = p;
    const ym = dayToYM(fecha, epoch);
    // Wide-format sources can list several tools sharing one report row's metros
    // (a full string drilling together); `primary` counts that row's metros once.
    if (primary === undefined || primary === 1) {
      totalMetros += metros;
      byMonth.set(ym, (byMonth.get(ym) || 0) + metros);
    }
    if (metros > 0) {
      if (cm) piezasSet.add(cm);
      if (refIdx !== null && refIdx !== undefined) refSet.add(refIdx);
      if (!toolsByMonth.has(ym)) toolsByMonth.set(ym, new Set());
      if (cm) toolsByMonth.get(ym).add(cm);
    }
  }

  const months = Array.from(byMonth.keys()).sort();
  // "complete months" = exclude first and last if the data doesn't start/end on day 1 / month-end
  let promedioCompletos = null;
  if (months.length > 2) {
    const inner = months.slice(1, -1);
    const sum = inner.reduce((a, m) => a + byMonth.get(m), 0);
    promedioCompletos = inner.length ? sum / inner.length : null;
  }
  const promedioTodos = months.length ? Array.from(byMonth.values()).reduce((a, b) => a + b, 0) / months.length : 0;

  // rendimiento global (piezas usadas y de ciclo cerrado)
  const used = life.filter(l => l[3] > 0);
  const closed = used.filter(l => dict.estado[l[5]] !== 'ACTIVA');
  const ratios = closed.filter(l => l[4]).map(l => l[3] / l[4]);
  const cumplimientoGlobal = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length * 100 : null;

  // recoverable meters: pieces retired for operational reasons (not end-of-life) that fell short of guarantee
  let recuperableM = 0, recuperableUSD = 0;
  for (const l of closed) {
    const [, , , mp, mg, , bucket, , , , , , usd] = l;
    if (bucket !== 'FIN_VIDA_UTIL' && mg && mp < mg) {
      const gap = mg - mp;
      recuperableM += gap;
      if (usd && mg) recuperableUSD += gap * (usd / mg);
    }
  }

  return {
    totalMetros, byMonth, toolsByMonth, months,
    piezasActivas: piezasSet.size, referenciasActivas: refSet.size,
    promedioCompletos, promedioTodos,
    cumplimientoGlobal, nCiclosCerrados: closed.length, nUsadas: used.length,
    recuperableM, recuperableUSD,
  };
}

function byHerramientaProd(bundle, prod, topN) {
  const { dict } = bundle;
  const map = new Map(); // refIdx -> {metros, piezas:Set}
  for (const p of prod) {
    const [, , , , refIdx, herrIdx, cm, metros] = p;
    if (refIdx === null || refIdx === undefined) continue;
    if (!map.has(refIdx)) map.set(refIdx, { metros: 0, piezas: new Set(), herrIdx });
    const e = map.get(refIdx);
    e.metros += metros;
    if (cm) e.piezas.add(cm);
  }
  const rows = Array.from(map.entries()).map(([refIdx, e]) => ({
    ref: dict.ref[refIdx],
    herramienta: dict.herr[e.herrIdx] || dict.ref[refIdx],
    metros: e.metros,
    piezas: e.piezas.size,
  }));
  rows.sort((a, b) => b.metros - a.metros);
  return topN ? rows.slice(0, topN) : rows;
}

function rendimientoPorHerramienta(bundle, life) {
  const { dict } = bundle;
  const used = life.filter(l => l[3] > 0);
  const closed = used.filter(l => dict.estado[l[5]] !== 'ACTIVA');
  const map = new Map(); // refIdx -> {n, mpSum, mgSum, ratios:[], superaCount}
  for (const l of closed) {
    const [, refIdx, herrIdx, mp, mg] = l;
    if (!mg) continue;
    if (!map.has(refIdx)) map.set(refIdx, { n: 0, mpSum: 0, mgSum: 0, ratios: [], herrIdx });
    const e = map.get(refIdx);
    e.n++; e.mpSum += mp; e.mgSum += mg; e.ratios.push(mp / mg);
  }
  const rows = Array.from(map.entries()).map(([refIdx, e]) => ({
    ref: dict.ref[refIdx],
    herramienta: dict.herr[e.herrIdx] || dict.ref[refIdx],
    n: e.n,
    metrosPerforados: e.mpSum,
    metrosGarantizados: e.mgSum,
    cumplimientoMedio: e.ratios.reduce((a, b) => a + b, 0) / e.ratios.length * 100,
    pctSupera: e.ratios.filter(r => r >= 1).length / e.ratios.length * 100,
  }));
  rows.sort((a, b) => b.n - a.n);
  return rows;
}

function motivoBaja(bundle, life) {
  const { dict } = bundle;
  const used = life.filter(l => l[3] > 0);
  const closed = used.filter(l => dict.estado[l[5]] !== 'ACTIVA');
  const buckets = {};
  for (const l of closed) {
    const bucket = l[6];
    const mg = l[4];
    if (!buckets[bucket]) buckets[bucket] = { n: 0, ratios: [] };
    buckets[bucket].n++;
    if (mg) buckets[bucket].ratios.push(l[3] / mg);
  }
  const out = {};
  for (const [k, v] of Object.entries(buckets)) {
    out[k] = {
      n: v.n,
      cumplimientoMedio: v.ratios.length ? v.ratios.reduce((a, b) => a + b, 0) / v.ratios.length * 100 : null,
      pctSupera: v.ratios.length ? v.ratios.filter(r => r >= 1).length / v.ratios.length * 100 : null,
    };
  }
  return out;
}

// ---------- CPM (costo por metro) ----------
// Sigue la convención heredada de Marmato: CPM = precio unitario / metros logrados.
// cpmIdeal usa el metro garantizado (catálogo); cpmReal usa el promedio de metros
// realmente perforados por las piezas usadas de esa referencia. Solo se cuentan
// piezas con fecha de baja registrada (ya finalizaron su vida útil) — una pieza
// activa todavía no tiene su total definitivo de metros.
function cpmPorHerramienta(bundle, life) {
  const { dict, catalog } = bundle;
  const used = life.filter(l => l[3] > 0 && l[11] !== null && l[11] !== undefined);
  const map = new Map();
  for (const l of used) {
    const [, refIdx, herrIdx, mp, , , , , , , , , usd] = l;
    if (refIdx === null || refIdx === undefined) continue;
    if (!map.has(refIdx)) map.set(refIdx, { mpSum: 0, mpN: 0, usdSum: 0, usdN: 0, herrIdx });
    const e = map.get(refIdx);
    e.mpSum += mp; e.mpN++;
    if (usd) { e.usdSum += usd; e.usdN++; }
  }
  const rows = [];
  for (const [refIdx, e] of map.entries()) {
    const ref = dict.ref[refIdx];
    const cat = catalog[ref] || {};
    const precio = cat.p != null ? cat.p : (e.usdN ? e.usdSum / e.usdN : null);
    const avgMetrosReal = e.mpN ? e.mpSum / e.mpN : null;
    const garantizado = cat.g != null ? cat.g : null;
    const cpmReal = (precio != null && avgMetrosReal) ? precio / avgMetrosReal : null;
    // El CPM ideal viene de DATOS KPIs (columna "Total CPM") cuando el archivo
    // lo trae; si no, se aproxima con precio/garantizado.
    const cpmIdeal = cat.cpmIdeal != null ? cat.cpmIdeal : ((precio != null && garantizado) ? precio / garantizado : null);
    rows.push({
      ref, herramienta: dict.herr[e.herrIdx] || ref, n: e.mpN, precio,
      avgMetrosReal, garantizado, cpmReal, cpmIdeal,
      metrosTotales: e.mpSum,
      sobrecostoPct: (cpmReal && cpmIdeal) ? (cpmReal / cpmIdeal - 1) * 100 : null,
    });
  }
  rows.sort((a, b) => (b.cpmReal || 0) - (a.cpmReal || 0));
  return rows;
}

function cpmGlobal(bundle, life) {
  const used = life.filter(l => l[3] > 0 && l[11] !== null && l[11] !== undefined);
  let usdGastado = 0, metrosReales = 0, metrosIdeales = 0, sobrecostoUSD = 0;
  let nConUsd = 0;
  for (const l of used) {
    const [, , , mp, mg, , , , , , , , usd] = l;
    if (usd) {
      usdGastado += usd; nConUsd++;
      metrosReales += mp;
      if (mg) {
        metrosIdeales += mg;
        if (mp < mg) sobrecostoUSD += usd * (mg - mp) / mg;
      }
    }
  }
  const cpmReal = metrosReales ? usdGastado / metrosReales : null;
  const cpmIdeal = metrosIdeales ? usdGastado / metrosIdeales : null;
  return { usdGastado, metrosReales, metrosIdeales, cpmReal, cpmIdeal, sobrecostoUSD, nConUsd };
}

// ---------- Desglose detallado de modo (tipo de falla) y causa probable ----------
function causaBreakdown(bundle, life) {
  const { dict } = bundle;
  const used = life.filter(l => l[3] > 0);
  const closed = used.filter(l => dict.estado[l[5]] !== 'ACTIVA');
  const map = new Map();
  for (const l of closed) {
    const [, , , mp, mg, , , causaIdx] = l;
    const key = causaIdx === null || causaIdx === undefined ? 'SIN REGISTRO' : dict.causa[causaIdx];
    if (!map.has(key)) map.set(key, { n: 0, ratios: [], gapM: 0, gapUSD: 0 });
    const e = map.get(key);
    e.n++;
    if (mg) {
      e.ratios.push(mp / mg);
      if (mp < mg) {
        e.gapM += mg - mp;
        const usd = l[12];
        if (usd) e.gapUSD += usd * (mg - mp) / mg;
      }
    }
  }
  const total = closed.length;
  const rows = Array.from(map.entries()).map(([label, e]) => ({
    label, n: e.n, pct: total ? e.n / total * 100 : 0,
    cumplimientoMedio: e.ratios.length ? e.ratios.reduce((a, b) => a + b, 0) / e.ratios.length * 100 : null,
    gapM: e.gapM, gapUSD: e.gapUSD,
  }));
  rows.sort((a, b) => b.n - a.n);
  return rows;
}

function fallaBreakdown(bundle, life) {
  const { dict } = bundle;
  const used = life.filter(l => l[3] > 0);
  const closed = used.filter(l => dict.estado[l[5]] !== 'ACTIVA');
  const map = new Map();
  for (const l of closed) {
    const [, , , mp, mg, , , , fallaIdx] = l;
    const key = fallaIdx === null || fallaIdx === undefined ? 'SIN REGISTRO' : dict.falla[fallaIdx];
    if (!map.has(key)) map.set(key, { n: 0, ratios: [] });
    const e = map.get(key);
    e.n++;
    if (mg) e.ratios.push(mp / mg);
  }
  const total = closed.length;
  const rows = Array.from(map.entries()).map(([label, e]) => ({
    label, n: e.n, pct: total ? e.n / total * 100 : 0,
    cumplimientoMedio: e.ratios.length ? e.ratios.reduce((a, b) => a + b, 0) / e.ratios.length * 100 : null,
  }));
  rows.sort((a, b) => b.n - a.n);
  return rows;
}

// ---------- Vida útil (días en servicio: fecha de inicio -> fecha de baja) ----------
function vidaUtilGlobal(bundle, life) {
  const { dict } = bundle;
  const used = life.filter(l => l[3] > 0);
  const closed = used.filter(l => dict.estado[l[5]] !== 'ACTIVA');
  const dias = [];
  for (const l of closed) {
    const fechaFinal = l[11], fechaInicio = l[13];
    if (fechaFinal !== null && fechaFinal !== undefined && fechaInicio !== null && fechaInicio !== undefined) {
      const d = fechaFinal - fechaInicio;
      if (d >= 0) dias.push(d);
    }
  }
  if (!dias.length) return { n: 0, mediaDias: null, medianaDias: null, metrosPorDia: null };
  const mediaDias = dias.reduce((a, b) => a + b, 0) / dias.length;
  const sorted = dias.slice().sort((a, b) => a - b);
  const medianaDias = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  // blended meters/day across the same cohort (pieces with both dates)
  let mpSum = 0, diasSum = 0;
  for (const l of closed) {
    const fechaFinal = l[11], fechaInicio = l[13];
    if (fechaFinal !== null && fechaFinal !== undefined && fechaInicio !== null && fechaInicio !== undefined && fechaFinal >= fechaInicio) {
      mpSum += l[3]; diasSum += (fechaFinal - fechaInicio);
    }
  }
  return { n: dias.length, mediaDias, medianaDias, metrosPorDia: diasSum ? mpSum / diasSum : null };
}

function vidaUtilPorHerramienta(bundle, life) {
  const { dict } = bundle;
  const used = life.filter(l => l[3] > 0);
  const closed = used.filter(l => dict.estado[l[5]] !== 'ACTIVA');
  const map = new Map();
  for (const l of closed) {
    const [, refIdx, herrIdx, mp, , , , , , , , fechaFinal, , fechaInicio] = l;
    if (fechaFinal === null || fechaFinal === undefined || fechaInicio === null || fechaInicio === undefined) continue;
    const d = fechaFinal - fechaInicio;
    if (d < 0) continue;
    if (!map.has(refIdx)) map.set(refIdx, { n: 0, diasSum: 0, mpSum: 0, herrIdx });
    const e = map.get(refIdx);
    e.n++; e.diasSum += d; e.mpSum += mp;
  }
  const rows = Array.from(map.entries()).map(([refIdx, e]) => ({
    ref: dict.ref[refIdx], herramienta: dict.herr[e.herrIdx] || dict.ref[refIdx],
    n: e.n, mediaDias: e.diasSum / e.n, metrosPorDia: e.diasSum ? e.mpSum / e.diasSum : null,
  }));
  rows.sort((a, b) => b.n - a.n);
  return rows;
}

// ---------- Tendencia de cumplimiento mes a mes (por fecha de baja) ----------
function cumplimientoPorMes(bundle, life) {
  const { dict } = bundle;
  const epoch = bundle.meta.epoch || EPOCH_DEFAULT;
  const used = life.filter(l => l[3] > 0);
  const closed = used.filter(l => dict.estado[l[5]] !== 'ACTIVA');
  const map = new Map();
  for (const l of closed) {
    const [, , , mp, mg, , , , , , , fechaFinal] = l;
    if (fechaFinal === null || fechaFinal === undefined || !mg) continue;
    const ym = dayToYM(fechaFinal, epoch);
    if (!map.has(ym)) map.set(ym, []);
    map.get(ym).push(mp / mg);
  }
  const months = Array.from(map.keys()).sort();
  return months.map(ym => {
    const ratios = map.get(ym);
    return { ym, n: ratios.length, cumplimientoMedio: ratios.reduce((a, b) => a + b, 0) / ratios.length * 100 };
  });
}

// ---------- CPM mensual comparable (histórico de DATOS KPIs + "actual" vivo desde BD) ----------
// bundle.cpmHistorico row: [refIdx, herrIdx, fecha(dayNum, mes), promedio, valor, cpm]
function cpmTrend(bundle, life) {
  const { dict } = bundle;
  const epoch = bundle.meta.epoch || EPOCH_DEFAULT;
  const hist = bundle.cpmHistorico || [];

  const byRef = new Map(); // refIdx -> {herrIdx, points: [{label, ym, cpm, promedio, live}]}
  for (const [refIdx, herrIdx, fecha, promedio, valor, cpm] of hist) {
    if (refIdx === null || refIdx === undefined || fecha === null) continue;
    if (!byRef.has(refIdx)) byRef.set(refIdx, { herrIdx, points: [] });
    const ym = dayToYM(fecha, epoch);
    byRef.get(refIdx).points.push({ label: ym, ym, cpm, promedio, live: false });
  }

  // "actual": live-computed from the current BD snapshot, same formula as cpmPorHerramienta
  // (precio del catálogo / promedio real de metros de las piezas usadas de esa referencia).
  const live = cpmPorHerramienta(bundle, life);
  for (const r of live) {
    const refIdx = dict.ref.indexOf(r.ref);
    if (refIdx < 0) continue;
    if (!byRef.has(refIdx)) byRef.set(refIdx, { herrIdx: dict.herr.indexOf(r.herramienta), points: [] });
    byRef.get(refIdx).points.push({ label: 'ACTUAL', ym: '9999-99', cpm: r.cpmReal, promedio: r.avgMetrosReal, live: true });
  }

  const rows = Array.from(byRef.entries()).map(([refIdx, e]) => {
    const points = e.points.slice().sort((a, b) => a.ym.localeCompare(b.ym));
    return { ref: dict.ref[refIdx], herramienta: dict.herr[e.herrIdx] || dict.ref[refIdx], points };
  });
  rows.sort((a, b) => a.herramienta.localeCompare(b.herramienta));
  return rows;
}

// ---------- Promedio mensual de metros por referencia (para CPM por sarta) ----------
// "Promedio mensual" = para cada referencia y mes, el promedio de metros totales
// logrados ESE MES por cada pieza (código) que tuvo actividad de esa referencia.
// Alimenta el CPM, así que solo cuentan piezas que ya finalizaron su vida útil
// (tienen fecha de baja registrada) — una pieza todavía activa no ha terminado
// de acumular metros y distorsionaría el promedio hacia abajo.
function avgMetrosPorReferenciaPorMes(bundle, prod) {
  const epoch = bundle.meta.epoch || EPOCH_DEFAULT;
  const dadaDeBaja = new Set();
  for (const l of bundle.life) {
    if (l[11] !== null && l[11] !== undefined) dadaDeBaja.add(l[0]);
  }
  // refIdx -> ym -> codigoMarcado -> metros acumulados ese mes
  const acc = new Map();
  for (const p of prod) {
    const [fecha, , , , refIdx, , cm, metros] = p;
    if (refIdx === null || refIdx === undefined) continue;
    if (!dadaDeBaja.has(cm)) continue;
    const ym = dayToYM(fecha, epoch);
    if (!acc.has(refIdx)) acc.set(refIdx, new Map());
    const byYm = acc.get(refIdx);
    if (!byYm.has(ym)) byYm.set(ym, new Map());
    const byCode = byYm.get(ym);
    byCode.set(cm, (byCode.get(cm) || 0) + metros);
  }
  // refIdx -> ym -> {avg, n}
  const out = new Map();
  for (const [refIdx, byYm] of acc.entries()) {
    const m = new Map();
    for (const [ym, byCode] of byYm.entries()) {
      const vals = Array.from(byCode.values());
      m.set(ym, { avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length });
    }
    out.set(refIdx, m);
  }
  return out;
}

// ---------- CPM mensual agrupado por Sarta ----------
// Una sarta agrupa varias referencias (bundle.sartas); el CPM de cada referencia
// usa su propio promedio mensual de metros sin importar que la referencia se
// repita en otra sarta (precio y promedio son siempre por referencia, no por sarta).
function cpmPorSarta(bundle, prod) {
  const { dict, catalog } = bundle;
  const avgByRef = avgMetrosPorReferenciaPorMes(bundle, prod);
  const sartas = bundle.sartas || {};
  const out = [];
  for (const [sartaNombre, refcodes] of Object.entries(sartas)) {
    const referencias = refcodes.map(refcode => {
      const refIdx = dict.ref.indexOf(refcode);
      const cat = catalog[refcode];
      const precio = cat ? cat.p : null;
      const byYm = refIdx >= 0 ? avgByRef.get(refIdx) : null;
      const months = byYm
        ? Array.from(byYm.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([ym, e]) => ({
            ym, avgMetros: e.avg, n: e.n,
            cpm: (precio !== null && e.avg) ? precio / e.avg : null,
          }))
        : [];
      const herrIdx = refIdx >= 0 ? dict.herr[refIdx] : undefined;
      return { ref: refcode, herramienta: (cat && cat.d) || refcode, precio, months, found: refIdx >= 0 };
    });
    out.push({ sarta: sartaNombre, referencias });
  }
  return out;
}

// ---------- CPM mensual de la SARTA completa (suma de los CPM de sus referencias) ----------
// El CPM ideal de cada sarta es un valor fijo (bundle.cpmIdealPorSarta, viene de
// la hoja DATOS KPIs — ya es la suma de los CPM individuales de sus referencias)
// que sirve de referencia para comparar contra el CPM real mes a mes.
function cpmPorSartaTotal(bundle, prod) {
  const porSarta = cpmPorSarta(bundle, prod);
  const cpmIdealMap = bundle.cpmIdealPorSarta || {};
  return porSarta.map(s => {
    const monthMap = new Map(); // ym -> {suma, refsConDatos}
    s.referencias.forEach(r => {
      r.months.forEach(m => {
        if (m.cpm === null) return;
        if (!monthMap.has(m.ym)) monthMap.set(m.ym, { suma: 0, refsConDatos: 0 });
        const e = monthMap.get(m.ym);
        e.suma += m.cpm; e.refsConDatos++;
      });
    });
    const months = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, e]) => ({ ym, cpmSarta: e.suma, refsConDatos: e.refsConDatos, refsTotal: s.referencias.length }));
    return { sarta: s.sarta, months, cpmIdeal: cpmIdealMap[s.sarta] ?? null, refsTotal: s.referencias.length };
  });
}

// ---------- Metros por código dentro de cada referencia (para validar pieza a pieza) ----------
function metrosPorCodigoPorReferencia(bundle, life) {
  const { dict } = bundle;
  const map = new Map(); // refIdx -> {herrIdx, garantizado, codigos:[{codigo,metros,cumplimiento}]}
  for (const l of life) {
    const [codigo, refIdx, herrIdx, mp, mg] = l;
    if (refIdx === null || refIdx === undefined || !(mp > 0)) continue;
    if (!map.has(refIdx)) map.set(refIdx, { herrIdx, garantizado: mg, codigos: [] });
    const e = map.get(refIdx);
    e.codigos.push({ codigo, metros: mp, cumplimiento: mg ? (mp / mg * 100) : null });
  }
  const rows = Array.from(map.entries()).map(([refIdx, e]) => {
    e.codigos.sort((a, b) => b.metros - a.metros);
    return {
      ref: dict.ref[refIdx], herramienta: dict.herr[e.herrIdx] || dict.ref[refIdx],
      garantizado: e.garantizado, codigos: e.codigos,
      metrosTotales: e.codigos.reduce((a, c) => a + c.metros, 0),
    };
  });
  rows.sort((a, b) => b.metrosTotales - a.metrosTotales);
  return rows;
}

// ---------- Ganancia / pérdida en USD por herramienta ----------
// Por debajo de 85% del metro garantizado: el cliente pierde (no recibió los
// metros que pagó). Por encima de 100%: el cliente gana (recibió más metros
// de los que garantizaba el precio pagado). Entre 85% y 100%: zona aceptable,
// no se cuantifica ni pérdida ni ganancia.
function gananciaPerdidaPorHerramienta(bundle, life) {
  const { dict } = bundle;
  const map = new Map();
  for (const l of life) {
    const [, refIdx, herrIdx, mp, mg, , , , , , , , usd] = l;
    if (refIdx === null || refIdx === undefined || !mg || mp <= 0) continue;
    if (!map.has(refIdx)) map.set(refIdx, { herrIdx, nPerdida: 0, perdidaM: 0, perdidaUSD: 0, nGanancia: 0, gananciaM: 0, gananciaUSD: 0, nAceptable: 0 });
    const e = map.get(refIdx);
    const cpmIdeal = usd ? usd / mg : null;
    const ratio = mp / mg;
    if (ratio < 0.85) {
      const gap = mg - mp;
      e.nPerdida++; e.perdidaM += gap;
      if (cpmIdeal) e.perdidaUSD += gap * cpmIdeal;
    } else if (ratio > 1) {
      const extra = mp - mg;
      e.nGanancia++; e.gananciaM += extra;
      if (cpmIdeal) e.gananciaUSD += extra * cpmIdeal;
    } else {
      e.nAceptable++;
    }
  }
  const rows = Array.from(map.entries()).map(([refIdx, e]) => ({
    ref: dict.ref[refIdx], herramienta: dict.herr[e.herrIdx] || dict.ref[refIdx],
    nPerdida: e.nPerdida, perdidaM: e.perdidaM, perdidaUSD: e.perdidaUSD,
    nGanancia: e.nGanancia, gananciaM: e.gananciaM, gananciaUSD: e.gananciaUSD,
    nAceptable: e.nAceptable, netoUSD: e.gananciaUSD - e.perdidaUSD,
  }));
  rows.sort((a, b) => a.netoUSD - b.netoUSD);
  return rows;
}

// ---------- Rendimiento por código de marcado (pieza individual, no agregado) ----------
function rendimientoPorPieza(bundle, life) {
  const { dict } = bundle;
  return life.filter(l => l[3] > 0).map(l => {
    const [cm, refIdx, herrIdx, mp, mg] = l;
    const ratio = mg ? mp / mg * 100 : null;
    return {
      codigo: cm, ref: dict.ref[refIdx] || '', herramienta: dict.herr[herrIdx] || '',
      metros: mp, garantizado: mg, aceptable: mg ? mg * 0.85 : null,
      cumplimiento: ratio, cumpleAceptable: ratio === null ? null : ratio >= 85,
    };
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    applyFilters, kpiTotals, byHerramientaProd, rendimientoPorHerramienta, motivoBaja,
    cpmPorHerramienta, cpmGlobal, causaBreakdown, fallaBreakdown,
    vidaUtilGlobal, vidaUtilPorHerramienta, cumplimientoPorMes,
    cpmTrend, rendimientoPorPieza,
    avgMetrosPorReferenciaPorMes, cpmPorSarta, cpmPorSartaTotal, metrosPorCodigoPorReferencia,
    gananciaPerdidaPorHerramienta,
    dayToYM, dayToYear, dayToDateStr, MONTH_NAMES,
  };
}
