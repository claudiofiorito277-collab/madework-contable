// Lógica pura de reportes: IVA Ventas y Compras, Libro IVA Digital (borrador), retenciones y percepciones,
// saldos y vencimientos, y rentabilidad por contrato e ítem.
// Importes en CENTAVOS enteros; cantidades en milésimas. Se prueba con node --test (tests/reportes.test.js).

import { dividirRedondeando } from './redondeo.js';

const signo = (c) => (c.clase === 'nota_credito' ? -1 : 1);
const pct = (p) => Math.round(Number(p) * 100) / 100;
export const TEXTO_ALICUOTA = (p) => `${String(pct(p)).replace('.', ',')} %`;

// ---------------------------------------------------------------- IVA Ventas

/**
 * comprobantes: [{ id, fecha, clase, tipo_codigo, tipo_descripcion, numero_formateado, cliente, cliente_cuit, neto_gravado, exento, no_gravado, iva, otros_tributos, total, estado }]
 * alicuotas: [{ comprobante_id, porcentaje, neto, iva }]
 * Solo comprobantes emitidos; las notas de crédito restan.
 */
export function ivaVentas(comprobantes, alicuotas) {
  const vivos = comprobantes.filter((c) => c.estado === 'emitido').sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero_formateado.localeCompare(b.numero_formateado));
  const filas = vivos.map((c) => { const s = signo(c); return { ...c, neto_gravado: s * c.neto_gravado, exento: s * c.exento, no_gravado: s * c.no_gravado, iva: s * c.iva, otros_tributos: s * c.otros_tributos, total: s * c.total }; });
  const porAlicuota = {};
  const ids = new Map(vivos.map((c) => [c.id, c]));
  for (const a of alicuotas) {
    const c = ids.get(a.comprobante_id); if (!c) continue;
    const k = pct(a.porcentaje); const r = (porAlicuota[k] ??= { porcentaje: k, neto: 0, iva: 0 });
    r.neto += signo(c) * a.neto; r.iva += signo(c) * a.iva;
  }
  const totales = sumar(filas, ['neto_gravado', 'exento', 'no_gravado', 'iva', 'otros_tributos', 'total']);
  return { filas, porAlicuota: Object.values(porAlicuota).sort((a, b) => b.porcentaje - a.porcentaje), totales,
    tratamiento: [['Gravado', totales.neto_gravado], ['Exento', totales.exento], ['No gravado', totales.no_gravado]], debitoFiscal: totales.iva };
}

// ---------------------------------------------------------------- IVA Compras

/**
 * comprobantes: [{ id, fecha, clase, tipo_codigo, numero_formateado, proveedor, proveedor_cuit, neto_gravado, exento, no_gravado, sin_discriminar,
 *   iva, credito_fiscal, percepciones, otros_tributos, total, estado }]
 * alicuotas: [{ comprobante_id, porcentaje, neto, iva }]; percepciones: [{ comprobante_id, tipo, importe }]
 */
export function ivaCompras(comprobantes, alicuotas, percepciones) {
  const vivos = comprobantes.filter((c) => c.estado === 'emitido').sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.proveedor).localeCompare(String(b.proveedor)));
  const perc = {};
  for (const p of percepciones) {
    const k = p.tipo === 'PERC_IVA' ? 'perc_iva' : ['PERC_IIBB_CBA', 'PERC_IIBB_OTRAS'].includes(p.tipo) ? 'perc_iibb' : 'perc_otras';
    (perc[p.comprobante_id] ??= { perc_iva: 0, perc_iibb: 0, perc_otras: 0 })[k] += p.importe;
  }
  const filas = vivos.map((c) => {
    const s = signo(c); const p = perc[c.id] ?? { perc_iva: 0, perc_iibb: 0, perc_otras: 0 };
    return { ...c, neto_gravado: s * c.neto_gravado, iva: s * c.iva, credito_fiscal: s * c.credito_fiscal, iva_no_computable: s * (c.iva - c.credito_fiscal),
      exento_no_gravado: s * (c.exento + c.no_gravado), sin_discriminar: s * c.sin_discriminar,
      perc_iva: s * p.perc_iva, perc_iibb: s * p.perc_iibb, perc_otras: s * p.perc_otras, otros_tributos: s * c.otros_tributos, total: s * c.total };
  });
  const porAlicuota = {}; const ids = new Map(vivos.map((c) => [c.id, c]));
  for (const a of alicuotas) {
    const c = ids.get(a.comprobante_id); if (!c) continue;
    const k = pct(a.porcentaje); const r = (porAlicuota[k] ??= { porcentaje: k, neto: 0, iva: 0, computable: 0 });
    r.neto += signo(c) * a.neto; r.iva += signo(c) * a.iva;
    if (c.credito_fiscal > 0) r.computable += signo(c) * a.iva;
  }
  const totales = sumar(filas, ['neto_gravado', 'iva', 'credito_fiscal', 'iva_no_computable', 'exento_no_gravado', 'sin_discriminar', 'perc_iva', 'perc_iibb', 'perc_otras', 'otros_tributos', 'total']);
  return { filas, porAlicuota: Object.values(porAlicuota).sort((a, b) => b.porcentaje - a.porcentaje), totales, creditoFiscal: totales.credito_fiscal };
}

const sumar = (filas, ks) => Object.fromEntries(ks.map((k) => [k, filas.reduce((s, f) => s + (f[k] ?? 0), 0)]));

// ---------------------------------------------------------------- Libro IVA Digital (borrador)

const CODIGO_ALICUOTA = { 0: '0003', 10.5: '0004', 21: '0005', 27: '0006', 5: '0008', 2.5: '0009' };
const num = (c, n = 15) => String(Math.abs(Math.round(c ?? 0))).padStart(n, '0').slice(-n);
const txt = (s, n) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ').toUpperCase().padEnd(n, ' ').slice(0, n);
const fec = (iso) => (iso ? iso.slice(0, 10).replace(/-/g, '') : '00000000');
const doc = (cuit) => { const d = String(cuit ?? '').replace(/\D/g, ''); return d.length === 11 ? ['80', d.padStart(20, '0')] : ['99', '0'.padStart(20, '0')]; };
const tipoArca = (t) => (/^\d{1,3}$/.test(String(t)) ? String(t).padStart(3, '0') : null);

/**
 * Archivos del Libro IVA Digital (régimen de información de compras y ventas) en formato de ancho fijo.
 * Devuelve { ventasCbte, ventasAlicuotas, comprasCbte, comprasAlicuotas, avisos }. Es un BORRADOR para revisar con el contador.
 * ventas/compras: los comprobantes del período con sus alícuotas ({ ...comprobante, alicuotas: [{ porcentaje, neto, iva }] }).
 */
export function libroIvaDigital(ventas, compras) {
  const avisos = []; const v1 = []; const v2 = []; const c1 = []; const c2 = [];
  for (const c of ventas.filter((x) => x.estado === 'emitido')) {
    const tipo = tipoArca(c.tipo_codigo); if (!tipo) { avisos.push(`Venta ${c.numero_formateado}: el tipo "${c.tipo_codigo}" no es un código de ARCA`); continue; }
    const [td, nd] = doc(c.cliente_cuit);
    let als = (c.alicuotas ?? []).filter((a) => a.neto > 0);
    const op = als.length ? ' ' : c.exento > 0 ? 'E' : 'N';
    if (!als.length) als = [{ porcentaje: 0, neto: 0, iva: 0 }];
    const linea = fec(c.fecha) + tipo + num(c.punto_venta, 5) + num(c.numero, 20) + num(c.numero, 20) + td + nd + txt(c.cliente, 30)
      + num(c.total) + num(c.no_gravado) + num(0) + num(c.exento) + num(0) + num(0) + num(0) + num(0)
      + 'PES' + '0001000000' + String(als.length) + op + num(c.otros_tributos) + (c.vencimiento ? fec(c.vencimiento) : '00000000');
    v1.push(linea);
    for (const a of als) {
      const cod = CODIGO_ALICUOTA[pct(a.porcentaje)]; if (!cod) avisos.push(`Venta ${c.numero_formateado}: alícuota ${a.porcentaje} % sin código`);
      v2.push(tipo + num(c.punto_venta, 5) + num(c.numero, 20) + num(a.neto) + (cod ?? '0000') + num(a.iva));
    }
  }
  for (const c of compras.filter((x) => x.estado === 'emitido')) {
    const tipo = tipoArca(c.tipo_codigo); if (!tipo) { avisos.push(`Compra ${c.numero_formateado} de ${c.proveedor}: el tipo "${c.tipo_codigo}" no es un código de ARCA`); continue; }
    const [td, nd] = doc(c.proveedor_cuit);
    const als = (c.alicuotas ?? []).filter((a) => a.neto > 0);
    const p = c.perc ?? { perc_iva: 0, perc_iibb: 0, perc_otras: 0 };
    const op = als.length || c.sin_discriminar > 0 ? ' ' : c.exento > 0 ? 'E' : 'N';
    c1.push(fec(c.fecha) + tipo + num(c.punto_venta, 5) + num(c.numero, 20) + ' '.repeat(16) + td + nd + txt(c.proveedor, 30)
      + num(c.total) + num(c.no_gravado + (als.length ? 0 : c.sin_discriminar)) + num(c.exento) + num(p.perc_iva) + num(p.perc_otras) + num(p.perc_iibb) + num(0) + num(0)
      + 'PES' + '0001000000' + String(als.length) + op + num(c.credito_fiscal) + num(c.otros_tributos) + '0'.repeat(11) + ' '.repeat(30) + num(0));
    for (const a of als) {
      const cod = CODIGO_ALICUOTA[pct(a.porcentaje)]; if (!cod) avisos.push(`Compra ${c.numero_formateado}: alícuota ${a.porcentaje} % sin código`);
      c2.push(tipo + num(c.punto_venta, 5) + num(c.numero, 20) + td + nd + num(a.neto) + (cod ?? '0000') + num(a.iva));
    }
  }
  const unir = (l) => (l.length ? `${l.join('\r\n')}\r\n` : '');
  return { ventasCbte: unir(v1), ventasAlicuotas: unir(v2), comprasCbte: unir(c1), comprasAlicuotas: unir(c2), avisos };
}
export const LARGOS_LID = { ventasCbte: 266, ventasAlicuotas: 62, comprasCbte: 325, comprasAlicuotas: 84 };

// ---------------------------------------------------------------- Retenciones y percepciones

export const NOMBRES_RET = { RET_GANANCIAS: 'Retención de Ganancias', RET_IVA: 'Retención de IVA', RET_IIBB_CBA: 'Retención de IIBB Córdoba', RET_SUSS: 'Retención de SUSS', OTRA: 'Otra retención' };
export const NOMBRES_PERC = { PERC_IVA: 'Percepción de IVA', PERC_IIBB_CBA: 'Percepción de IIBB Córdoba', PERC_IIBB_OTRAS: 'Percepción de IIBB otras jurisdicciones', PERC_GANANCIAS: 'Percepción de Ganancias', OTRA: 'Otra percepción' };

/**
 * retenciones: [{ fecha, tipo, numero_certificado, cliente, cliente_cuit, comprobante_numero, base, alicuota, importe, estado_cobranza }]
 * percepciones: [{ fecha, tipo, proveedor, proveedor_cuit, numero_formateado, clase, importe }]
 */
export function retencionesYPercepciones(retenciones, percepciones) {
  const ret = retenciones.filter((r) => r.estado_cobranza === 'registrada').sort((a, b) => a.fecha.localeCompare(b.fecha));
  const per = percepciones.map((p) => ({ ...p, importe: signo(p) * p.importe })).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const resumen = {};
  for (const r of ret) { const k = NOMBRES_RET[r.tipo] ?? r.tipo; resumen[k] = (resumen[k] ?? 0) + r.importe; }
  for (const p of per) { const k = NOMBRES_PERC[p.tipo] ?? p.tipo; resumen[k] = (resumen[k] ?? 0) + p.importe; }
  return { retenciones: ret, percepciones: per, resumen: Object.entries(resumen).sort(), total: Object.values(resumen).reduce((s, v) => s + v, 0) };
}

// ---------------------------------------------------------------- Saldos y vencimientos

export const TRAMOS_VENC = ['A vencer', '1 a 30 días', '31 a 60 días', '61 a 90 días', 'Más de 90 días'];
const dias = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
/**
 * Antigüedad de saldos por tercero a una fecha de corte.
 * docs: [{ tercero, fecha, vencimiento, numero, saldo (cent) }] (solo los que tienen saldo)
 */
export function antiguedadSaldos(docs, corte) {
  const por = {};
  for (const d of docs.filter((x) => x.saldo)) {
    const atraso = dias(d.vencimiento ?? d.fecha, corte);
    const i = atraso <= 0 ? 0 : atraso <= 30 ? 1 : atraso <= 60 ? 2 : atraso <= 90 ? 3 : 4;
    const t = (por[d.tercero] ??= { tercero: d.tercero, tramos: [0, 0, 0, 0, 0], total: 0, documentos: [] });
    t.tramos[i] += d.saldo; t.total += d.saldo; t.documentos.push({ ...d, atraso: Math.max(0, atraso), tramo: TRAMOS_VENC[i] });
  }
  const filas = Object.values(por).sort((a, b) => b.total - a.total);
  const totales = filas.reduce((s, f) => { f.tramos.forEach((v, i) => { s.tramos[i] += v; }); s.total += f.total; return s; }, { tramos: [0, 0, 0, 0, 0], total: 0 });
  return { filas, totales };
}

// ---------------------------------------------------------------- Rentabilidad

/**
 * Rentabilidad de un contrato por ítem.
 * items: [{ id, codigo, descripcion, unidad, precio_unitario, costo_previsto (cent por unidad) }]
 * certificado: [{ item_id, cantidad (mil), importe (cent) }]   (ítems de certificados aprobados, facturados o cobrados del período)
 * costo: resultado de costoPorItem (js/core/costos.js)
 * El costo presupuestado se calcula sobre lo producido según los partes (o lo certificado, si no hay partes).
 */
export function rentabilidad(items, certificado, costo) {
  const cert = {};
  for (const c of certificado) { const r = (cert[c.item_id] ??= { cantidad: 0, importe: 0 }); r.cantidad += c.cantidad; r.importe += c.importe; }
  const reales = Object.fromEntries(costo.filas.map((f) => [f.item_id ?? '', f]));
  const filas = items.map((it) => {
    const c = cert[it.id] ?? { cantidad: 0, importe: 0 }; const r = reales[it.id] ?? { total: 0, producido: 0, directo: 0, indirectos: 0 };
    const base = r.producido > 0 ? r.producido : c.cantidad;
    const presupuestado = dividirRedondeando(BigInt(it.costo_previsto ?? 0) * BigInt(base), 1000);
    const margen = c.importe - r.total;
    return { item: it, cantidad_certificada: c.cantidad, ingreso: c.importe, producido: r.producido, costo_presupuestado: presupuestado, costo_real: r.total,
      desvio: r.total - presupuestado, desvio_pct: presupuestado ? Math.round(((r.total - presupuestado) / presupuestado) * 1000) / 10 : null,
      margen, margen_pct: c.importe ? Math.round((margen / c.importe) * 1000) / 10 : null,
      costo_unitario: r.producido > 0 ? dividirRedondeando(BigInt(r.total) * 1000n, r.producido) : null };
  }).filter((f) => f.ingreso || f.costo_real || f.cantidad_certificada);
  const sinItem = reales[''];
  if (sinItem && sinItem.total) filas.push({ item: null, cantidad_certificada: 0, ingreso: 0, producido: 0, costo_presupuestado: 0, costo_real: sinItem.total,
    desvio: sinItem.total, desvio_pct: null, margen: -sinItem.total, margen_pct: null, costo_unitario: null });
  const tot = filas.reduce((s, f) => { for (const k of ['ingreso', 'costo_presupuestado', 'costo_real', 'desvio', 'margen']) s[k] += f[k]; return s; },
    { ingreso: 0, costo_presupuestado: 0, costo_real: 0, desvio: 0, margen: 0 });
  tot.margen_pct = tot.ingreso ? Math.round((tot.margen / tot.ingreso) * 1000) / 10 : null;
  return { filas, totales: tot };
}
