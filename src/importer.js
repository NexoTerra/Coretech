// ---------- Excel importer: builds a bundle identical in shape to the Python export ----------
// Accepts either the already-processed workbook (sheets AMS_Diario / BD_Aceros / Referencia)
// or the raw AMS master file (sheets NUEVO AMS BD RENDIMIENTOS / BD CONSECUTIVOS ACEROS / RENDIMIENTOS).

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normHeader(s) {
  return stripAccents(String(s || '')).toUpperCase().replace(/\s+/g, ' ').trim();
}
function findSheet(workbook, aliases) {
  const names = workbook.SheetNames;
  for (const alias of aliases) {
    const a = normHeader(alias);
    const hit = names.find(n => normHeader(n) === a);
    if (hit) return hit;
  }
  for (const alias of aliases) {
    const a = normHeader(alias);
    const hit = names.find(n => normHeader(n).includes(a) || a.includes(normHeader(n)));
    if (hit) return hit;
  }
  return null;
}
function sheetToRows(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  if (!rows.length) return { headers: [], data: [] };
  const headers = rows[0].map(normHeader);
  return { headers, data: rows.slice(1) };
}
function colIndex(headers, aliases) {
  for (const alias of aliases) {
    const a = normHeader(alias);
    let idx = headers.indexOf(a);
    if (idx >= 0) return idx;
  }
  for (const alias of aliases) {
    const a = normHeader(alias);
    let idx = headers.findIndex(h => h.includes(a));
    if (idx >= 0) return idx;
  }
  return -1;
}

function excelDateToDayNum(val, epoch) {
  if (val === null || val === undefined || val === '') return null;
  let d;
  if (typeof val === 'number') {
    // Excel serial date (days since 1899-12-30)
    d = new Date(Date.UTC(1899, 11, 30) + val * 86400000);
  } else {
    d = new Date(val);
    if (isNaN(d.getTime())) return null;
  }
  const epochMs = new Date(epoch + 'T00:00:00Z').getTime();
  return Math.round((d.getTime() - epochMs) / 86400000);
}

// Matches pandas' default na_values so text sentinels in raw sheets (SheetJS
// reads cells literally, unlike pandas' read_excel which auto-converts these)
// don't get treated as real codes/descriptions.
const NA_SENTINELS = new Set([
  '', '#N/A', '#N/A N/A', '#NA', '-1.#IND', '-1.#QNAN', '-NAN', '1.#IND', '1.#QNAN',
  '<NA>', 'N/A', 'NA', 'NULL', 'NAN', 'NONE', 'N/D', 'S/N', 'SIN DATO', '-',
]);
function norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (s === '' || NA_SENTINELS.has(s.toUpperCase())) return null;
  return s;
}
function normUpper(v) {
  const s = norm(v);
  return s ? s.toUpperCase() : null;
}
function cleanMina(v) {
  let s = normUpper(v);
  if (!s) return null;
  if (s === 'PROVIDENCA') s = 'PROVIDENCIA';
  return /^[A-ZÁÉÍÓÚÑ. ]{3,}$/.test(s) ? s : null;
}
// A failed XLOOKUP in the source workbook can leave a literal 0 in REFERENCIA
// cells; that is not a real reference code.
function normRef(v) {
  const s = norm(v);
  return (s === null || s === '0') ? null : s;
}
function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function toNumOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function bucketCausa(cUpper) {
  if (!cUpper) return 'SIN_CAUSA';
  if (cUpper.includes('FIN DE VIDA')) return 'FIN_VIDA_UTIL';
  if (cUpper.includes('DETERMIN')) return 'OTRA';
  return 'CONDICION_OPERATIVA';
}

class Dict_ {
  constructor() { this.items = []; this.index = new Map(); }
  get(val) {
    if (val === null || val === undefined) return null;
    if (!this.index.has(val)) { this.index.set(val, this.items.length); this.items.push(val); }
    return this.index.get(val);
  }
}

const PROD_SHEET_ALIASES = ['AMS_DIARIO', 'NUEVO AMS BD RENDIMIENTOS'];
const LIFE_SHEET_ALIASES = ['BD_ACEROS', 'BD CONSECUTIVOS ACEROS'];
const REF_SHEET_ALIASES = ['REFERENCIA', 'RENDIMIENTOS'];

const PROD_COLS = {
  cm: ['CODIGO MARCADO'],
  fecha: ['FECHA'],
  mina: ['MINA'],
  tipo: ['TIPO PERFORACION'],
  equipo: ['CODIGO DEL EQUIPO', 'CODIGO DE EQUIPO', 'EQUIPO'],
  refcode: ['CODIGO MIN', 'CODIGO MIN.'],
  herr: ['DESCRIPCION'],
  metros: ['MP TOTAL'],
};
const LIFE_COLS = {
  cm: ['COD MARCADO'],
  refcode: ['COD', 'CODIGO MIN'],
  herr: ['DESCRIPCION'],
  mina: ['MINA'],
  tipobda: ['TIPO'],
  mp: ['METROS PERFORADOS'],
  estado: ['ESTADO'],
  fechafinal: ['FECHA FINAL'],
  equipo: ['EQUIPO JUMBO'],
  mg: ['METROS GARANTIZADOS'],
  falla: ['TIPO DE FALLA'],
  causa: ['CAUSA PROBABLE'],
  usd: ['USD VALOR'],
  fechainicio: ['FECHA DE INICIO'],
};
const REF_COLS = {
  code: ['REFERENCIA'],
  desc: ['DESCRIPCION'],
  precio: ['PRECIO- USD', 'PRECIO USD', 'PRECIO'],
  mg: ['METRO GARANTIZADO'],
};

const WIDE_SHEET_ALIASES = ['BASE DE DATOS', 'BASE DE DATOS CONSOLIDADA'];
const WIDE_TOOL_COLS = [
  ['SHANK', ['SHANK'], ['DESCRIP SHANK']],
  ['ACOPLE', ['ACOPLE'], ['DESCRIP ACOPLE']],
  ['BARRENA', ['BARRENA'], ['DESCRIP BARRENA']],
  ['BROCA', ['BROCA'], ['DESCRIP BROCA']],
];
const WIDE_COLS = {
  fecha: ['FECHA DE REPORTE'],
  mina: ['MNA', 'MINA'],
  tipo: ['TIPO DE PERFORACION'],
  equipo: ['EQUIPO'],
  metros: ['TOTAL METROS'],
  estado: ['ESTADO'],
  modo: ['MODO DE DESCARTE'],
  causa: ['CAUSA DE DESCARTE'],
  fechadescarte: ['FECHA DE DESCARTE'],
};

// One report row can carry up to 4 tools (shank/acople/barrena/broca) sharing a
// single TOTAL METROS value — a full string drilling one hole together. This
// reconstructs both a melted production log and a per-piece lifecycle summary
// from that single sheet, bridging metro garantizado / precio via description
// against a fallback catalog (the previously known reference table) since this
// format doesn't carry its own catalog sheet.
function buildBundleFromWideFormat(workbook, sheetName, sourceName, fallbackCatalog) {
  const EPOCH = '2020-01-01';
  const D_mina = new Dict_(), D_tipo = new Dict_(), D_equipo = new Dict_(), D_ref = new Dict_(),
        D_herr = new Dict_(), D_estado = new Dict_(), D_causa = new Dict_(), D_falla = new Dict_();

  const descToCode = new Map();
  const catalog = fallbackCatalog || {};
  for (const [code, entry] of Object.entries(catalog)) {
    if (entry && entry.d) descToCode.set(normUpper(entry.d), code);
  }

  const { headers, data } = sheetToRows(workbook, sheetName);
  const c = {};
  for (const k in WIDE_COLS) c[k] = colIndex(headers, WIDE_COLS[k]);
  if (c.fecha < 0 || c.metros < 0) {
    throw new Error('La hoja "' + sheetName + '" no tiene las columnas mínimas (FECHA DE REPORTE, TOTAL METROS).');
  }
  const toolCols = WIDE_TOOL_COLS.map(([cat, codeAliases, descAliases]) => ([
    cat, colIndex(headers, codeAliases), colIndex(headers, descAliases),
  ]));

  const prod = [];
  const pieceRows = new Map(); // composite -> array of {fecha, metros, estado, mina, equipo, refcode, desc, modo, causa, fechaDescarte}

  for (const row of data) {
    const fecha = excelDateToDayNum(row[c.fecha], EPOCH);
    if (fecha === null) continue;
    const mina = c.mina >= 0 ? cleanMina(row[c.mina]) : null;
    const tipo = c.tipo >= 0 ? normUpper(row[c.tipo]) : null;
    const equipo = c.equipo >= 0 ? normUpper(row[c.equipo]) : null;
    const metros = toNum(row[c.metros]);
    const estado = c.estado >= 0 ? normUpper(row[c.estado]) : null;
    const modo = c.modo >= 0 ? normUpper(row[c.modo]) : null;
    const causa = c.causa >= 0 ? normUpper(row[c.causa]) : null;
    const fechaDescarte = c.fechadescarte >= 0 ? excelDateToDayNum(row[c.fechadescarte], EPOCH) : null;

    let primaryAssigned = false;
    for (const [cat, codeIdx, descIdx] of toolCols) {
      if (codeIdx < 0) continue;
      const code = norm(row[codeIdx]);
      if (!code) continue;
      const desc = descIdx >= 0 ? norm(row[descIdx]) : null;
      const refcode = desc ? descToCode.get(normUpper(desc)) || null : null;
      const composite = cat + ':' + code;
      const isPrimary = primaryAssigned ? 0 : 1;
      primaryAssigned = true;

      prod.push([
        fecha, D_mina.get(mina), D_tipo.get(tipo), D_equipo.get(equipo),
        D_ref.get(refcode), D_herr.get(desc), composite, Math.round(metros * 1000) / 1000, isPrimary,
      ]);

      if (!pieceRows.has(composite)) pieceRows.set(composite, []);
      pieceRows.get(composite).push({ fecha, metros, estado, mina, equipo, refcode, desc, modo, causa, fechaDescarte });
    }
  }

  const life = [];
  for (const [composite, rows] of pieceRows.entries()) {
    rows.sort((a, b) => a.fecha - b.fecha);
    const last = rows[rows.length - 1];
    const metrosSum = rows.reduce((a, r) => a + r.metros, 0);
    const fechaInicio = rows[0].fecha;
    let fechaDescarte = null;
    for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].fechaDescarte !== null) { fechaDescarte = rows[i].fechaDescarte; break; } }
    if (fechaDescarte === null && last.estado !== 'ACTIVA') fechaDescarte = last.fecha;

    let refcode = last.refcode; let desc = last.desc;
    if (!refcode) { for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].refcode) { refcode = rows[i].refcode; break; } } }
    if (!desc) { for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].desc) { desc = rows[i].desc; break; } } }

    let modo = null; for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].modo) { modo = rows[i].modo; break; } }
    let causa = null; for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].causa) { causa = rows[i].causa; break; } }

    const cat = refcode ? catalog[refcode] : null;
    const mg = cat ? cat.g : null;
    const usd = cat ? cat.p : null;

    life.push([
      composite, D_ref.get(refcode), D_herr.get(desc), Math.round(metrosSum * 1000) / 1000, mg,
      D_estado.get(last.estado), bucketCausa(causa), D_causa.get(causa), D_falla.get(modo),
      D_mina.get(last.mina), D_equipo.get(last.equipo), fechaDescarte, usd, fechaInicio,
    ]);
  }

  return {
    meta: { epoch: EPOCH, generated: new Date().toISOString().slice(0, 16).replace('T', ' '), source: sourceName },
    dict: { mina: D_mina.items, tipo: D_tipo.items, equipo: D_equipo.items, ref: D_ref.items, herr: D_herr.items, estado: D_estado.items, causa: D_causa.items, falla: D_falla.items },
    catalog, prod, life,
  };
}

function buildBundleFromLongFormat(workbook, sourceName) {
  const prodSheetName = findSheet(workbook, PROD_SHEET_ALIASES);
  const lifeSheetName = findSheet(workbook, LIFE_SHEET_ALIASES);
  const refSheetName = findSheet(workbook, REF_SHEET_ALIASES);

  if (!prodSheetName || !lifeSheetName) {
    throw new Error('No se encontraron las hojas esperadas. Se buscó "AMS_Diario" / "NUEVO AMS BD RENDIMIENTOS" y "BD_Aceros" / "BD CONSECUTIVOS ACEROS".');
  }

  const EPOCH = '2020-01-01';
  const D_mina = new Dict_(), D_tipo = new Dict_(), D_equipo = new Dict_(), D_ref = new Dict_(),
        D_herr = new Dict_(), D_estado = new Dict_(), D_causa = new Dict_(), D_falla = new Dict_();

  // ---- production sheet ----
  const { headers: ph, data: pdata } = sheetToRows(workbook, prodSheetName);
  const pc = {};
  for (const k in PROD_COLS) pc[k] = colIndex(ph, PROD_COLS[k]);
  if (pc.cm < 0 || pc.metros < 0 || pc.fecha < 0) {
    throw new Error('La hoja de producción no tiene las columnas mínimas (CODIGO MARCADO, FECHA, MP TOTAL).');
  }
  const prod = [];
  for (const row of pdata) {
    const fecha = excelDateToDayNum(row[pc.fecha], EPOCH);
    if (fecha === null) continue;
    const mina = pc.mina >= 0 ? cleanMina(row[pc.mina]) : null;
    const tipo = pc.tipo >= 0 ? normUpper(row[pc.tipo]) : null;
    const equipo = pc.equipo >= 0 ? normUpper(row[pc.equipo]) : null;
    const refcode = pc.refcode >= 0 ? norm(row[pc.refcode]) : null;
    const herr = pc.herr >= 0 ? norm(row[pc.herr]) : null;
    const cm = norm(row[pc.cm]);
    const metros = toNum(row[pc.metros]);
    prod.push([
      fecha, D_mina.get(mina), D_tipo.get(tipo), D_equipo.get(equipo),
      D_ref.get(refcode), D_herr.get(herr), cm, Math.round(metros * 1000) / 1000, 1,
    ]);
  }

  // ---- lifecycle sheet ----
  const { headers: lh, data: ldata } = sheetToRows(workbook, lifeSheetName);
  const lc = {};
  for (const k in LIFE_COLS) lc[k] = colIndex(lh, LIFE_COLS[k]);
  if (lc.cm < 0 || lc.mp < 0) {
    throw new Error('La hoja de ciclo de vida no tiene las columnas mínimas (COD MARCADO, METROS PERFORADOS).');
  }
  const life = [];
  for (const row of ldata) {
    const cm = norm(row[lc.cm]);
    if (!cm) continue;
    const refcode = lc.refcode >= 0 ? norm(row[lc.refcode]) : null;
    const herr = lc.herr >= 0 ? norm(row[lc.herr]) : null;
    const mp = toNum(row[lc.mp]);
    const mg = lc.mg >= 0 ? toNumOrNull(row[lc.mg]) : null;
    const estado = lc.estado >= 0 ? normUpper(row[lc.estado]) : null;
    const causaRaw = lc.causa >= 0 ? normUpper(row[lc.causa]) : null;
    const fallaRaw = lc.falla >= 0 ? normUpper(row[lc.falla]) : null;
    const mina = lc.mina >= 0 ? cleanMina(row[lc.mina]) : null;
    const equipo = lc.equipo >= 0 ? normUpper(row[lc.equipo]) : null;
    const fechafinal = lc.fechafinal >= 0 ? excelDateToDayNum(row[lc.fechafinal], EPOCH) : null;
    const usd = lc.usd >= 0 ? toNumOrNull(row[lc.usd]) : null;
    const fechainicio = lc.fechainicio >= 0 ? excelDateToDayNum(row[lc.fechainicio], EPOCH) : null;
    life.push([
      cm, D_ref.get(refcode), D_herr.get(herr), Math.round(mp * 1000) / 1000, mg,
      D_estado.get(estado), bucketCausa(causaRaw), D_causa.get(causaRaw), D_falla.get(fallaRaw),
      D_mina.get(mina), D_equipo.get(equipo), fechafinal, usd, fechainicio,
    ]);
  }

  // ---- reference catalog ----
  const catalog = {};
  if (refSheetName) {
    const { headers: rh, data: rdata } = sheetToRows(workbook, refSheetName);
    const rc = {};
    for (const k in REF_COLS) rc[k] = colIndex(rh, REF_COLS[k]);
    if (rc.code >= 0) {
      for (const row of rdata) {
        const code = norm(row[rc.code]);
        if (!code) continue;
        catalog[code] = {
          d: rc.desc >= 0 ? norm(row[rc.desc]) : null,
          p: rc.precio >= 0 ? toNumOrNull(row[rc.precio]) : null,
          g: rc.mg >= 0 ? toNumOrNull(row[rc.mg]) : null,
        };
      }
    }
  }

  return {
    meta: { epoch: EPOCH, generated: new Date().toISOString().slice(0, 16).replace('T', ' '), source: sourceName },
    dict: { mina: D_mina.items, tipo: D_tipo.items, equipo: D_equipo.items, ref: D_ref.items, herr: D_herr.items, estado: D_estado.items, causa: D_causa.items, falla: D_falla.items },
    catalog, prod, life,
  };
}

// ---------- "Marmato" workbook: MGAR / CONTADOR DE METROS / CODIGOS ALFA NUMERICOS / SARTAS ----------
// CONTADOR DE METROS is the source of truth (BD is just an automatic melt of
// it in this workbook and has a REFERENCIA lookup gap, so it's bypassed
// entirely). Pieces are reconstructed by aggregating each code's rows;
// ESTADO comes from that piece's most recent report (ACTIVA/INACTIVA/NO
// PERTENECE, whatever literally appears — no reclassification). RESERVA is
// added as an available filter value but deliberately left unassigned.
// SARTAS maps a sarta name to its component referencias (by description,
// resolved through CODIGOS ALFA NUMERICOS / MGAR).
const MGAR_SHEET_ALIASES = ['MGAR'];
const CONTADOR_SHEET_ALIASES = ['CONTADOR DE METROS'];
const CODIGOS_ALFA_SHEET_ALIASES = ['CODIGOS ALFA NUMERICOS', 'CODIGOS ALFANUMERICOS'];
const SARTAS_SHEET_ALIASES = ['SARTAS'];
const DATOS_KPIS_SHEET_ALIASES = ['DATOS KPIS'];
const DATOS_KPIS_COLS = {
  sarta: ['CMP', 'SARTA'], refcode: ['REFERENCIA'], cpmIdeal: ['TOTAL CPM'],
};

const MARMATO_TOOL_COLS = [
  ['SHANK', ['SHANK'], ['DESCRIP SHANK']],
  ['ACOPLE', ['ACOPLE'], ['DESCRIP ACOPLE']],
  ['BARRENA', ['BARRENA'], ['DESCRIP BARRENA']],
  ['BROCA', ['BROCA'], ['DESCRIP BROCA']],
];
const CONTADOR_COLS = {
  fecha: ['FECHA DE REPORTE'], mina: ['MNA', 'MINA'], tipo: ['TIPO DE PERFORACION'],
  equipo: ['EQUIPO'], estado: ['ESTADO'], metros: ['TOTAL METROS'],
  operador: ['OPERADOR DE EQUIPO', 'OPERADOR'],
};
const CODIGOS_ALFA_COLS = {
  cod: ['COD MARCADO'], refcode: ['REFERENCIA'], desc: ['DESCRIPCION'], fechaentrega: ['FECHA DE ENTREGA'],
};

function buildBundleFromMarmatoFormat(workbook, sourceName) {
  const EPOCH = '2020-01-01';
  const D_mina = new Dict_(), D_tipo = new Dict_(), D_equipo = new Dict_(), D_ref = new Dict_(),
        D_herr = new Dict_(), D_estado = new Dict_(), D_causa = new Dict_(), D_falla = new Dict_(),
        D_operador = new Dict_();

  const mgarSheet = findSheet(workbook, MGAR_SHEET_ALIASES);
  const contadorSheet = findSheet(workbook, CONTADOR_SHEET_ALIASES);
  const codigosSheet = findSheet(workbook, CODIGOS_ALFA_SHEET_ALIASES);
  const sartasSheet = findSheet(workbook, SARTAS_SHEET_ALIASES);
  const datosKpisSheet = findSheet(workbook, DATOS_KPIS_SHEET_ALIASES);
  if (!mgarSheet || !contadorSheet || !codigosSheet) {
    throw new Error('No se encontraron las hojas esperadas: "MGAR", "CONTADOR DE METROS" y "CODIGOS ALFA NUMERICOS".');
  }

  // 1. Catalog from MGAR
  const catalog = {};
  const descToCode = new Map();
  {
    const { headers, data } = sheetToRows(workbook, mgarSheet);
    const c = { ref: colIndex(headers, ['REFERENCIA']), desc: colIndex(headers, ['DESCRIPCION']), precio: colIndex(headers, ['PRECIO- USD', 'PRECIO USD', 'PRECIO']), g: colIndex(headers, ['METRO GARANTIZADO']) };
    for (const row of data) {
      const code = normRef(row[c.ref]);
      if (!code) continue;
      const g = c.g >= 0 ? toNumOrNull(row[c.g]) : null;
      const desc = c.desc >= 0 ? norm(row[c.desc]) : null;
      catalog[code] = { d: desc, p: c.precio >= 0 ? toNumOrNull(row[c.precio]) : null, g, a: g !== null ? Math.round(g * 0.85 * 1000) / 1000 : null };
      if (desc) descToCode.set(desc.toUpperCase(), code);
    }
  }

  // 2. Código -> referencia/descripcion/fecha entrega (CODIGOS ALFA NUMERICOS), plus a
  //    canonical description per referencia (this sheet's wording wins over MGAR's).
  const codeMap = new Map();
  const refDescVotes = new Map();
  {
    const { headers, data } = sheetToRows(workbook, codigosSheet);
    const c = {}; for (const k in CODIGOS_ALFA_COLS) c[k] = colIndex(headers, CODIGOS_ALFA_COLS[k]);
    for (const row of data) {
      const code = norm(row[c.cod]);
      if (!code) continue;
      const refcode = normRef(row[c.refcode]);
      const desc = c.desc >= 0 ? norm(row[c.desc]) : null;
      const fentrega = c.fechaentrega >= 0 ? excelDateToDayNum(row[c.fechaentrega], EPOCH) : null;
      if (!codeMap.has(code)) codeMap.set(code, { refcode, desc, fechaEntrega: fentrega });
      if (refcode && desc) {
        if (!refDescVotes.has(refcode)) refDescVotes.set(refcode, new Map());
        const votes = refDescVotes.get(refcode);
        votes.set(desc, (votes.get(desc) || 0) + 1);
        descToCode.set(desc.toUpperCase(), refcode);
      }
    }
  }
  for (const [refcode, votes] of refDescVotes.entries()) {
    let best = null, bestN = -1;
    for (const [desc, n] of votes.entries()) { if (n > bestN) { best = desc; bestN = n; } }
    if (catalog[refcode]) catalog[refcode].d = best;
  }

  // 3. SARTAS: sarta name -> component referencias (by description lookup)
  const sartas = {};
  if (sartasSheet) {
    const { headers, data } = sheetToRows(workbook, sartasSheet);
    const c = { nombre: colIndex(headers, ['NOMBRE']), clave: colIndex(headers, ['CLAVE']) };
    for (const row of data) {
      const nombre = norm(row[c.nombre]);
      const clave = c.clave >= 0 ? row[c.clave] : null;
      if (!nombre || clave === null || clave === undefined) continue;
      const refs = [];
      for (const descRaw of String(clave).split('|')) {
        const desc = norm(descRaw);
        if (!desc) continue;
        const code = descToCode.get(desc.toUpperCase());
        if (code && !refs.includes(code)) refs.push(code);
      }
      sartas[nombre] = refs;
    }
  }

  // 3.5 DATOS KPIs: el CPM ideal de cada referencia es el que trae la columna
  // "Total CPM" (columna E) — no se recalcula como precio/garantizado. El CPM
  // ideal de una sarta es la suma de esos valores para sus referencias.
  const cpmIdealPorSarta = {};
  const cpmIdealPorRef = {};
  if (datosKpisSheet) {
    const { headers, data } = sheetToRows(workbook, datosKpisSheet);
    const c = {}; for (const k in DATOS_KPIS_COLS) c[k] = colIndex(headers, DATOS_KPIS_COLS[k]);
    for (const row of data) {
      const sarta = c.sarta >= 0 ? norm(row[c.sarta]) : null;
      const refcode = c.refcode >= 0 ? normRef(row[c.refcode]) : null;
      const cpm = c.cpmIdeal >= 0 ? toNumOrNull(row[c.cpmIdeal]) : null;
      if (cpm === null) continue;
      if (sarta) cpmIdealPorSarta[sarta] = (cpmIdealPorSarta[sarta] || 0) + cpm;
      if (refcode && !(refcode in cpmIdealPorRef)) cpmIdealPorRef[refcode] = cpm;
    }
    for (const [refcode, cpm] of Object.entries(cpmIdealPorRef)) {
      if (catalog[refcode]) catalog[refcode].cpmIdeal = cpm;
    }
  }

  // 4. CONTADOR DE METROS -> melted production log
  const prod = [];
  const pieceMeta = new Map(); // composite -> latest {fecha, equipo, estado, mina, operador}
  {
    const { headers, data } = sheetToRows(workbook, contadorSheet);
    const c = {}; for (const k in CONTADOR_COLS) c[k] = colIndex(headers, CONTADOR_COLS[k]);
    const toolCols = MARMATO_TOOL_COLS.map(([cat, codeA, descA]) => [cat, colIndex(headers, codeA), colIndex(headers, descA)]);
    if (c.fecha < 0 || c.metros < 0) {
      throw new Error('La hoja "' + contadorSheet + '" no tiene las columnas mínimas (FECHA DE REPORTE, TOTAL METROS).');
    }
    for (const row of data) {
      const fecha = excelDateToDayNum(row[c.fecha], EPOCH);
      if (fecha === null) continue;
      const mina = c.mina >= 0 ? cleanMina(row[c.mina]) : null;
      const tipo = c.tipo >= 0 ? normUpper(row[c.tipo]) : null;
      const equipo = c.equipo >= 0 ? normUpper(row[c.equipo]) : null;
      const estado = c.estado >= 0 ? normUpper(row[c.estado]) : null;
      const operador = c.operador >= 0 ? normUpper(row[c.operador]) : null;
      const metros = toNum(row[c.metros]);

      let primaryAssigned = false;
      for (const [cat, codeIdx, descIdx] of toolCols) {
        if (codeIdx < 0) continue;
        const code = norm(row[codeIdx]);
        if (!code) continue;
        const meta = codeMap.get(code);
        const refcode = meta ? meta.refcode : null;
        const desc = meta ? meta.desc : null;
        const composite = cat + ':' + code;
        const isPrimary = primaryAssigned ? 0 : 1;
        primaryAssigned = true;

        prod.push([fecha, D_mina.get(mina), D_tipo.get(tipo), D_equipo.get(equipo), D_ref.get(refcode), D_herr.get(desc), composite, Math.round(metros * 1000) / 1000, isPrimary, D_operador.get(operador)]);

        const prev = pieceMeta.get(composite);
        if (!prev || fecha >= prev.fecha) pieceMeta.set(composite, { fecha, equipo, estado, mina, operador });
      }
    }
  }

  // 5. Life records: one per piece, aggregated from its own prod rows
  const pieceAgg = new Map(); // composite -> {refIdx, herrIdx, metrosSum}
  for (const p of prod) {
    const [, , , , refIdx, herrIdx, composite, metros] = p;
    if (!pieceAgg.has(composite)) pieceAgg.set(composite, { refIdx, herrIdx, metrosSum: 0 });
    const e = pieceAgg.get(composite);
    e.metrosSum += metros;
    if (e.refIdx === null || e.refIdx === undefined) e.refIdx = refIdx;
  }
  D_estado.get('RESERVA'); // available as a filter value; deliberately left unassigned

  const life = [];
  for (const [composite, agg] of pieceAgg.entries()) {
    const meta = pieceMeta.get(composite) || {};
    const refcode = agg.refIdx !== null && agg.refIdx !== undefined ? D_ref.items[agg.refIdx] : null;
    const cat = refcode ? catalog[refcode] : null;
    const mg = cat ? cat.g : null;
    const usd = cat ? cat.p : null;
    const code = composite.split(':').slice(1).join(':');
    const delivery = codeMap.get(code);
    const fechaInicio = delivery ? delivery.fechaEntrega : null;

    life.push([
      composite, agg.refIdx, agg.herrIdx, Math.round(agg.metrosSum * 1000) / 1000, mg,
      D_estado.get(meta.estado || null), 'SIN_CAUSA', null, null,
      D_mina.get(meta.mina || null), D_equipo.get(meta.equipo || null), null, usd, fechaInicio,
      D_operador.get(meta.operador || null),
    ]);
  }

  return {
    meta: { epoch: EPOCH, generated: new Date().toISOString().slice(0, 16).replace('T', ' '), source: sourceName },
    dict: { mina: D_mina.items, tipo: D_tipo.items, equipo: D_equipo.items, ref: D_ref.items, herr: D_herr.items, estado: D_estado.items, causa: D_causa.items, falla: D_falla.items, operador: D_operador.items },
    catalog, prod, life, sartas, cpmIdealPorSarta,
  };
}

// Detects which of the known formats a workbook is in and dispatches to the
// matching builder. `fallbackCatalog` (an existing bundle's catalog, e.g. from
// the currently loaded default dataset) backfills precio/metro garantizado
// when the imported file doesn't carry its own catalog sheet.
function buildBundleFromWorkbook(workbook, sourceName, fallbackCatalog) {
  if (findSheet(workbook, MGAR_SHEET_ALIASES) && findSheet(workbook, CONTADOR_SHEET_ALIASES) && findSheet(workbook, CODIGOS_ALFA_SHEET_ALIASES)) {
    return buildBundleFromMarmatoFormat(workbook, sourceName);
  }
  const wideSheetName = findSheet(workbook, WIDE_SHEET_ALIASES);
  if (wideSheetName) {
    return buildBundleFromWideFormat(workbook, wideSheetName, sourceName, fallbackCatalog);
  }
  return buildBundleFromLongFormat(workbook, sourceName);
}

if (typeof module !== 'undefined') {
  module.exports = { buildBundleFromWorkbook, buildBundleFromWideFormat, buildBundleFromLongFormat, findSheet, normHeader, Dict_ };
}
