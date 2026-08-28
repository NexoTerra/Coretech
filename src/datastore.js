// ---------- Bundle <-> base de datos compartida (Supabase) ----------
// Convierte entre el "bundle" compacto (diccionarios indexados, ver agg.js)
// que usa el motor de agregación y las filas planas (con texto y fechas
// reales) que se guardan en Supabase. Se guarda desnormalizado a propósito:
// así la base de datos es legible/consultable por sí sola, y el bundle
// indexado se reconstruye en el navegador con la misma lógica de Dict_ que
// ya usa importer.js al leer un Excel.

function dateStrToDay(dateStr, epoch) {
  if (!dateStr) return null;
  const epochMs = new Date(epoch + 'T00:00:00Z').getTime();
  const dMs = new Date(dateStr + 'T00:00:00Z').getTime();
  return Math.round((dMs - epochMs) / 86400000);
}
function numOrNull(v) {
  return (v === null || v === undefined || v === '') ? null : Number(v);
}

function bundleToRows(bundle) {
  const d = bundle.dict;
  const catalogRows = Object.entries(bundle.catalog || {}).map(([ref_code, c]) => ({
    ref_code, descripcion: c.d ?? null, precio: c.p ?? null, metro_garantizado: c.g ?? null, metro_aceptable: c.a ?? null,
  }));
  const prodRows = bundle.prod.map(p => {
    const [fecha, minaIdx, tipoIdx, equipoIdx, refIdx, herrIdx, codigo_marcado, metros, esPrimario, operadorIdx] = p;
    return {
      fecha: dayToDateStr(fecha, bundle.meta.epoch),
      mina: d.mina[minaIdx] ?? null, tipo: d.tipo[tipoIdx] ?? null, equipo: d.equipo[equipoIdx] ?? null,
      ref_code: d.ref[refIdx] ?? null, herramienta: d.herr[herrIdx] ?? null,
      codigo_marcado, metros, es_primario: !!esPrimario,
      operador: (d.operador && operadorIdx !== null && operadorIdx !== undefined) ? d.operador[operadorIdx] : null,
    };
  });
  const piezaRows = bundle.life.map(l => {
    const [codigo_marcado, refIdx, herrIdx, mp, mg, estadoIdx, bucket, causaIdx, fallaIdx, minaIdx, equipoIdx, fechaFinal, usd, fechaInicio, operadorIdx] = l;
    return {
      codigo_marcado, ref_code: d.ref[refIdx] ?? null, herramienta: d.herr[herrIdx] ?? null,
      metros_perforados: mp, metro_garantizado: mg ?? null,
      estado: (estadoIdx !== null && estadoIdx !== undefined) ? d.estado[estadoIdx] : null,
      motivo_bucket: bucket ?? null,
      causa: (causaIdx !== null && causaIdx !== undefined) ? d.causa[causaIdx] : null,
      falla: (fallaIdx !== null && fallaIdx !== undefined) ? d.falla[fallaIdx] : null,
      mina: (minaIdx !== null && minaIdx !== undefined) ? d.mina[minaIdx] : null,
      equipo: (equipoIdx !== null && equipoIdx !== undefined) ? d.equipo[equipoIdx] : null,
      operador: (d.operador && operadorIdx !== null && operadorIdx !== undefined) ? d.operador[operadorIdx] : null,
      fecha_inicio: (fechaInicio !== null && fechaInicio !== undefined) ? dayToDateStr(fechaInicio, bundle.meta.epoch) : null,
      fecha_final: (fechaFinal !== null && fechaFinal !== undefined) ? dayToDateStr(fechaFinal, bundle.meta.epoch) : null,
      precio_usd: usd ?? null,
    };
  });
  const sartaRows = [];
  Object.entries(bundle.sartas || {}).forEach(([nombre_sarta, refs]) => {
    (refs || []).forEach(ref_code => sartaRows.push({ nombre_sarta, ref_code }));
  });
  return { catalogRows, prodRows, piezaRows, sartaRows };
}

function rowsToBundle(rows, metaInfo) {
  const EPOCH = '2020-01-01';
  const D_mina = new Dict_(), D_tipo = new Dict_(), D_equipo = new Dict_(), D_ref = new Dict_(),
        D_herr = new Dict_(), D_estado = new Dict_(), D_causa = new Dict_(), D_falla = new Dict_(),
        D_operador = new Dict_();
  D_estado.get('RESERVA'); // disponible como filtro aunque nadie la tenga asignada

  const catalog = {};
  rows.catalogRows.forEach(r => {
    catalog[r.ref_code] = { d: r.descripcion, p: numOrNull(r.precio), g: numOrNull(r.metro_garantizado), a: numOrNull(r.metro_aceptable) };
  });

  const prod = rows.prodRows.map(r => [
    dateStrToDay(r.fecha, EPOCH), D_mina.get(r.mina), D_tipo.get(r.tipo), D_equipo.get(r.equipo),
    D_ref.get(r.ref_code), D_herr.get(r.herramienta), r.codigo_marcado, Number(r.metros), r.es_primario ? 1 : 0,
    D_operador.get(r.operador),
  ]);

  const life = rows.piezaRows.map(r => [
    r.codigo_marcado, D_ref.get(r.ref_code), D_herr.get(r.herramienta),
    numOrNull(r.metros_perforados), numOrNull(r.metro_garantizado),
    D_estado.get(r.estado), r.motivo_bucket || 'SIN_CAUSA',
    r.causa ? D_causa.get(r.causa) : null, r.falla ? D_falla.get(r.falla) : null,
    D_mina.get(r.mina), D_equipo.get(r.equipo),
    dateStrToDay(r.fecha_final, EPOCH), numOrNull(r.precio_usd), dateStrToDay(r.fecha_inicio, EPOCH),
    D_operador.get(r.operador),
  ]);

  const sartas = {};
  rows.sartaRows.forEach(r => {
    if (!sartas[r.nombre_sarta]) sartas[r.nombre_sarta] = [];
    sartas[r.nombre_sarta].push(r.ref_code);
  });

  return {
    meta: { epoch: EPOCH, generated: metaInfo.generated, source: metaInfo.source },
    dict: { mina: D_mina.items, tipo: D_tipo.items, equipo: D_equipo.items, ref: D_ref.items, herr: D_herr.items, estado: D_estado.items, causa: D_causa.items, falla: D_falla.items, operador: D_operador.items },
    catalog, prod, life, sartas,
  };
}

// Trae el dataset activo desde Supabase, o null si nadie ha importado nada
// todavía (en ese caso el dashboard sigue mostrando el bundle embebido).
async function loadSharedBundle() {
  const [catalogRows, prodRows, piezaRows, sartaRows, meta] = await Promise.all([
    CTAuth.fetchTable('catalog_refs'),
    CTAuth.fetchTable('produccion'),
    CTAuth.fetchTable('piezas'),
    CTAuth.fetchTable('sartas'),
    CTAuth.getDatasetMeta(),
  ]);
  if (!meta || !prodRows.length) return null;
  return rowsToBundle({ catalogRows, prodRows, piezaRows, sartaRows }, {
    generated: meta.imported_at ? new Date(meta.imported_at).toISOString().slice(0, 16).replace('T', ' ') : '',
    source: meta.source_filename || '',
  });
}

// Publica un bundle recién importado como el dataset compartido (requiere rol
// de Administrador — lo hace cumplir el RLS de cada tabla, no este código).
async function publishSharedBundle(bundle, sourceFilename) {
  const rows = bundleToRows(bundle);
  await CTAuth.replaceTable('catalog_refs', 'ref_code', rows.catalogRows);
  await CTAuth.replaceTable('sartas', 'id', rows.sartaRows);
  await CTAuth.replaceTable('piezas', 'codigo_marcado', rows.piezaRows);
  await CTAuth.replaceTable('produccion', 'id', rows.prodRows);
  await CTAuth.setDatasetMeta(sourceFilename);
}

if (typeof module !== 'undefined') {
  module.exports = { bundleToRows, rowsToBundle, dateStrToDay };
}
