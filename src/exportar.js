// Exportación a Excel (.xlsx) sin librerías: arma el libro como un ZIP sin compresión.
// Uso: CTExport.xlsxBlob([{ name, rows: [[celda, ...], ...], widths?, headerRows?, freezeRows? }])
// Una celda es texto, número, null o { v, f } con f = 'int' | 'd1' | 'd3' | 'pct' | 'bold' | 'title'.
const CTExport = (function () {
  const enc = new TextEncoder();
  const xml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  // estilos: índices en cellXfs
  const ESTILO = { header: 1, int: 2, d1: 3, d3: 4, title: 5, bold: 6, pct: 7 };
  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.0"/><numFmt numFmtId="166" formatCode="#,##0.000"/><numFmt numFmtId="167" formatCode="0.0&quot; %&quot;"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF183058"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF183058"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function celda(c, ref, esHeader) {
    if (c === null || c === undefined || c === '') return '';
    let v = c, f = null;
    if (typeof c === 'object') { v = c.v; f = c.f; }
    if (v === null || v === undefined || v === '') return '';
    if (esHeader) return `<c r="${ref}" s="${ESTILO.header}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    if (typeof v === 'number' && isFinite(v)) {
      const s = f ? ESTILO[f] : (Number.isInteger(v) ? ESTILO.int : ESTILO.d1);
      return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    }
    const s = f && (f === 'bold' || f === 'title') ? ` s="${ESTILO[f]}"` : '';
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  }

  function hojaXml(sh) {
    const rows = sh.rows, hdr = sh.headerRows || 0, freeze = sh.freezeRows || 0;
    const ncols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const anchos = sh.widths || Array.from({ length: ncols }, (_, j) => {
      let w = 8;
      rows.slice(0, 400).forEach(r => { const c = r[j]; const v = c && typeof c === 'object' ? c.v : c; if (v !== null && v !== undefined) w = Math.max(w, Math.min(60, String(typeof v === 'number' ? v.toLocaleString('es-CO') : v).length + 2)); });
      return w;
    });
    let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`;
    if (freeze) x += `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
    x += `<sheetFormatPr defaultRowHeight="15"/><cols>${anchos.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>`;
    rows.forEach((r, i) => {
      x += `<row r="${i + 1}">${r.map((c, j) => celda(c, colName(j) + (i + 1), i < hdr)).join('')}</row>`;
    });
    x += '</sheetData>';
    if (hdr && rows.length > hdr) x += `<autoFilter ref="A${hdr}:${colName(Math.max(ncols - 1, 0))}${rows.length}"/>`;
    return x + '</worksheet>';
  }

  // ---- ZIP sin compresión ----
  let tablaCrc = null;
  function crc32(bytes) {
    if (!tablaCrc) { tablaCrc = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tablaCrc[n] = c >>> 0; } }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = tablaCrc[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(archivos) { // [{ name, data: Uint8Array }]
    const partes = [], central = [];
    let offset = 0;
    const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const f of archivos) {
      const nombre = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
      const cab = new Uint8Array([0x50, 0x4B, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(n), ...u32(n), ...u16(nombre.length), ...u16(0)]);
      partes.push(cab, nombre, f.data);
      central.push(new Uint8Array([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(n), ...u32(n), ...u16(nombre.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nombre);
      offset += cab.length + nombre.length + n;
    }
    const tamCentral = central.reduce((a, p) => a + p.length, 0);
    const fin = new Uint8Array([0x50, 0x4B, 5, 6, ...u16(0), ...u16(0), ...u16(archivos.length), ...u16(archivos.length), ...u32(tamCentral), ...u32(offset), ...u16(0)]);
    return new Blob([...partes, ...central, fin], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function xlsxBlob(hojas) {
    const nombres = hojas.map((h, i) => (String(h.name || 'Hoja' + (i + 1)).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31)) || 'Hoja' + (i + 1));
    const archivos = [
      { name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
      { name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
      { name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
      { name: 'xl/styles.xml', data: enc.encode(STYLES_XML) },
      ...hojas.map((h, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(hojaXml(h)) })),
    ];
    return zip(archivos);
  }

  function descargar(blob, nombre) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  return { xlsxBlob, descargar };
})();
if (typeof module !== 'undefined') module.exports = CTExport;
