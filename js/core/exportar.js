// Exportación de reportes a Excel (.xlsx) y PDF, sin librerías externas.
// Un reporte es: { titulo, filtros: [[etiqueta, valor]], generado: { usuario, fecha }, notas: [texto],
//   secciones: [{ titulo, columnas: [{ titulo, tipo: 'texto'|'pesos'|'numero'|'fecha', ancho }], filas: [[...]], totales: [...] }] }
// Los importes 'pesos' van en CENTAVOS enteros. Se prueba con node --test (tests/exportar.test.js).

// ---------------------------------------------------------------- Formatos

const miles = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Centavos -> "1.234,56" (con signo menos si corresponde). */
export function textoPesos(c) {
  if (c === null || c === undefined || c === '') return '';
  const neg = c < 0; const a = Math.abs(Math.round(c));
  return `${neg ? '-' : ''}${miles(String(Math.floor(a / 100)))},${String(a % 100).padStart(2, '0')}`;
}
export function textoNumero(n) {
  if (n === null || n === undefined || n === '') return '';
  const [e, d] = Number(n).toFixed(3).replace(/\.?0+$/, '').split('.');
  return `${e.startsWith('-') ? '-' : ''}${miles(e.replace('-', ''))}${d ? `,${d}` : ''}`;
}
export const textoFecha = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
export function textoCelda(v, tipo) {
  if (v === null || v === undefined) return '';
  if (tipo === 'pesos') return typeof v === 'number' ? textoPesos(v) : String(v);
  if (tipo === 'numero') return typeof v === 'number' ? textoNumero(v) : String(v);
  if (tipo === 'fecha') return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? textoFecha(v) : String(v);
  return String(v);
}
const lineaGenerado = (g) => `Generado el ${g?.fecha ?? ''}${g?.usuario ? ` por ${g.usuario}` : ''}`;

// ---------------------------------------------------------------- ZIP (sin compresión)

const TABLA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xFFFFFFFF; for (const b of bytes) c = TABLA_CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/** archivos: [{ nombre, datos: Uint8Array }] -> Uint8Array (zip "stored"). */
export function zip(archivos) {
  const enc = new TextEncoder(); const partes = []; const central = []; let pos = 0;
  const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF]; const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  const FECHA = [0x00, 0x00, 0x21, 0x5D];  // 01/11/2026 00:00 en formato DOS
  for (const a of archivos) {
    const nombre = enc.encode(a.nombre); const crc = crc32(a.datos); const n = a.datos.length;
    const local = new Uint8Array([...u32(0x04034B50), ...u16(20), ...u16(0x0800), ...u16(0), ...FECHA, ...u32(crc), ...u32(n), ...u32(n), ...u16(nombre.length), ...u16(0), ...nombre]);
    central.push(new Uint8Array([...u32(0x02014B50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...FECHA, ...u32(crc), ...u32(n), ...u32(n), ...u16(nombre.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(pos), ...nombre]));
    partes.push(local, a.datos); pos += local.length + n;
  }
  const tamCentral = central.reduce((s, c) => s + c.length, 0);
  const fin = new Uint8Array([...u32(0x06054B50), ...u16(0), ...u16(0), ...u16(archivos.length), ...u16(archivos.length), ...u32(tamCentral), ...u32(pos), ...u16(0)]);
  return concatenar([...partes, ...central, fin]);
}
function concatenar(lista) {
  const out = new Uint8Array(lista.reduce((s, x) => s + x.length, 0)); let i = 0;
  for (const x of lista) { out.set(x, i); i += x.length; }
  return out;
}

// ---------------------------------------------------------------- Excel

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colLetra = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const nombreHoja = (s, usados) => {
  let n = String(s || 'Hoja').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Hoja'; let k = 2;
  while (usados.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${k++}`;
  usados.add(n.toLowerCase()); return n;
};

/**
 * Arma el .xlsx de un reporte: una hoja por sección, con título, filtros, fecha de generación y usuario arriba.
 * Los importes quedan como números (con formato de miles y 2 decimales), así se pueden sumar en Excel.
 */
export function reporteXLSX(rep) {
  const usados = new Set(); const hojas = [];
  for (const sec of rep.secciones ?? []) {
    const filas = []; let r = 0;
    const fila = (celdas) => { r += 1; filas.push(`<row r="${r}">${celdas.map((c, i) => c === null ? '' : celda(`${colLetra(i)}${r}`, c)).join('')}</row>`); };
    fila([{ t: rep.titulo, s: 1 }]);
    if (sec.titulo) fila([{ t: sec.titulo, s: 1 }]);
    for (const [k, v] of rep.filtros ?? []) fila([{ t: `${k}: ${v}` }]);
    fila([{ t: lineaGenerado(rep.generado) }]);
    for (const n of rep.notas ?? []) fila([{ t: n }]);
    r += 1;
    fila(sec.columnas.map((c) => ({ t: c.titulo, s: 1 })));
    const valor = (v, tipo, negrita) => {
      if (v === null || v === undefined || v === '') return null;
      if (tipo === 'pesos' && typeof v === 'number') return { n: v / 100, s: negrita ? 3 : 2 };
      if (tipo === 'numero' && typeof v === 'number') return { n: v, s: negrita ? 5 : 4 };
      return { t: textoCelda(v, tipo), s: negrita ? 1 : 0 };
    };
    for (const f of sec.filas) fila(f.map((v, i) => valor(v, sec.columnas[i]?.tipo)));
    if (sec.totales) fila(sec.totales.map((v, i) => valor(v, sec.columnas[i]?.tipo, true)));
    const anchos = sec.columnas.map((c, i) => Math.min(60, Math.max(10, c.titulo.length + 2,
      ...sec.filas.slice(0, 300).map((f) => textoCelda(f[i], c.tipo).length + 2))));
    hojas.push({ nombre: nombreHoja(sec.titulo || rep.titulo, usados),
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
        + `<cols>${anchos.map((a, i) => `<col min="${i + 1}" max="${i + 1}" width="${a}" customWidth="1"/>`).join('')}</cols>`
        + `<sheetData>${filas.join('')}</sheetData></worksheet>` });
  }
  if (!hojas.length) hojas.push({ nombre: 'Hoja1', xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>' });
  const enc = new TextEncoder();
  const archivos = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${hojas.map((h, i) => `<sheet name="${xml(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.###"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ...hojas.map((h, i) => [`xl/worksheets/sheet${i + 1}.xml`, h.xml]),
  ];
  return zip(archivos.map(([nombre, s]) => ({ nombre, datos: enc.encode(s) })));
}
function celda(ref, c) {
  const s = c.s ? ` s="${c.s}"` : '';
  if (c.n !== undefined) return `<c r="${ref}"${s}><v>${Number.isFinite(c.n) ? Number(c.n.toFixed(6)) : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(c.t ?? '')}</t></is></c>`;
}

// ---------------------------------------------------------------- PDF

const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const ESPECIALES = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '•': 0x95, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '™': 0x99, '→': 0x3E, '−': 0x2D, '✓': 0x76, ' ': 0x20 };
/** Texto -> bytes WinAnsi (lo que no existe se reemplaza). */
export function winAnsi(s) {
  const out = [];
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ESPECIALES[ch] !== undefined) out.push(ESPECIALES[ch]);
    else if (c >= 32 && c < 127) out.push(c);
    else if (c >= 0xA0 && c <= 0xFF) out.push(c);
    else out.push(0x3F);
  }
  return out;
}
const BASE = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n', 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ñ': 'N', 'ü': 'u', 'Ü': 'U', '°': 'o', 'º': 'o', 'ª': 'a', '·': '.' };
/** Ancho de un texto en puntos (Helvetica). */
export function anchoTexto(s, tam, negrita = false) {
  const w = negrita ? W_BOLD : W_REG; let t = 0;
  for (const ch of String(s)) { const b = BASE[ch] ?? ch; const c = b.codePointAt(0); t += c >= 32 && c <= 126 ? w[c - 32] : 556; }
  return (t * tam) / 1000;
}
const escPDF = (bytes) => bytes.map((b) => (b === 0x28 || b === 0x29 || b === 0x5C ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('');
const recortar = (s, ancho, tam, neg) => {
  if (anchoTexto(s, tam, neg) <= ancho) return s;
  let t = s; while (t.length > 1 && anchoTexto(`${t}…`, tam, neg) > ancho) t = t.slice(0, -1);
  return `${t}…`;
};

/**
 * Arma el PDF de un reporte (A4; apaisado si hay muchas columnas): título, filtros, fecha de generación y usuario,
 * cada sección como tabla con encabezado repetido en cada página, totales en negrita y "Página x de y".
 */
export function reportePDF(rep) {
  const totalCols = Math.max(0, ...(rep.secciones ?? []).map((s) => s.columnas.length));
  const apaisado = rep.apaisado ?? totalCols > 6;
  const [PW, PH] = apaisado ? [842, 595] : [595, 842]; const M = 36; const ANCHO = PW - 2 * M;
  const paginas = []; let ops = null; let y = 0;
  const nueva = () => { ops = []; paginas.push(ops); y = PH - M; };
  const texto = (s, x, yy, tam, neg = false) => ops.push(`BT /${neg ? 'F2' : 'F1'} ${tam} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${escPDF(winAnsi(s))}) Tj ET`);
  const linea = (x1, y1, x2, y2, g = 0.75) => ops.push(`${g} G 0.5 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S 0 G`);
  const espacio = (h) => { if (y - h < M + 18) { nueva(); return true; } return false; };
  nueva();
  texto(rep.titulo, M, y - 14, 15, true); y -= 24;
  for (const [k, v] of rep.filtros ?? []) { texto(recortar(`${k}: ${v}`, ANCHO, 9), M, y - 9, 9); y -= 12; }
  texto(lineaGenerado(rep.generado), M, y - 9, 8); y -= 14;
  for (const n of rep.notas ?? []) { texto(recortar(n, ANCHO, 8), M, y - 8, 8); y -= 11; }
  for (const sec of rep.secciones ?? []) {
    const cols = sec.columnas; const TAM = cols.length > 9 ? 6.5 : cols.length > 6 ? 7.5 : 8.5;
    const pesos = cols.map((c, i) => c.ancho ?? Math.min(40, Math.max(c.tipo === 'texto' ? 10 : 8, c.titulo.length,
      ...sec.filas.slice(0, 200).map((f) => textoCelda(f[i], c.tipo).length), sec.totales ? textoCelda(sec.totales[i], c.tipo).length : 0)));
    const suma = pesos.reduce((a, b) => a + b, 0); const anchos = pesos.map((p) => (p / suma) * ANCHO);
    const xs = anchos.reduce((a, w, i) => [...a, a[i] + w], [M]);
    const ALTO = TAM + 5;
    const cabecera = () => {
      for (let i = 0; i < cols.length; i++) {
        const t = recortar(cols[i].titulo, anchos[i] - 4, TAM, true);
        const der = cols[i].tipo === 'pesos' || cols[i].tipo === 'numero';
        texto(t, der ? xs[i + 1] - 2 - anchoTexto(t, TAM, true) : xs[i] + 2, y - TAM, TAM, true);
      }
      y -= ALTO; linea(M, y + 1.5, M + ANCHO, y + 1.5, 0.3);
    };
    const filaPDF = (f, neg) => {
      if (espacio(ALTO)) cabecera();
      for (let i = 0; i < cols.length; i++) {
        const t = recortar(textoCelda(f[i], cols[i].tipo), anchos[i] - 4, TAM, neg);
        const der = cols[i].tipo === 'pesos' || cols[i].tipo === 'numero';
        texto(t, der ? xs[i + 1] - 2 - anchoTexto(t, TAM, neg) : xs[i] + 2, y - TAM, TAM, neg);
      }
      y -= ALTO;
    };
    espacio(ALTO * 4);
    if (sec.titulo) { y -= 6; texto(sec.titulo, M, y - 11, 11, true); y -= 17; }
    cabecera();
    if (!sec.filas.length) filaPDF(['(sin datos)'], false);
    sec.filas.forEach((f, k) => { filaPDF(f, false); if (k % 2 === 1) { /* cebra liviana */ } linea(M, y + 1.5, M + ANCHO, y + 1.5, 0.9); });
    if (sec.totales) { linea(M, y + 1.5, M + ANCHO, y + 1.5, 0.3); filaPDF(sec.totales, true); }
    y -= 8;
  }
  // Pie de página
  paginas.forEach((p, i) => {
    ops = p;
    texto(`MADEWORK · ${rep.titulo}`, M, M - 14, 7);
    const pie = `Página ${i + 1} de ${paginas.length}`;
    texto(pie, PW - M - anchoTexto(pie, 7), M - 14, 7);
  });
  // Objetos PDF
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalogo = add(null); const arbol = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const p of paginas) {
    const cont = p.join('\n');
    const c = add(`<< /Length ${cont.length} >>\nstream\n${cont}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${arbol} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalogo - 1] = `<< /Type /Catalog /Pages ${arbol} 0 R >>`;
  objs[arbol - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${escPDF(winAnsi(rep.titulo))}) /Producer (MADEWORK sistema contable) >>`);
  let s = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
  return out;
}

/** Nombre de archivo prolijo: "IVA Compras 11-2026.xlsx" -> "IVA_Compras_11-2026.xlsx". */
export const nombreArchivo = (s, ext) => `${String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\-.]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}.${ext}`;
