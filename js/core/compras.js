// Lógica pura de compras y pagos. Importes en CENTAVOS enteros.
// Se prueba con node --test (tests/compras.test.js).
//
// Modelo:
// - Una factura de compra es deuda con el proveedor. El motor de IVA (iva.js) decide si
//   el IVA es crédito fiscal (factura A o M de un Responsable Inscripto) o costo (B, C, ticket).
// - Las percepciones sufridas (IVA, IIBB) son un crédito impositivo: no son costo de obra.
// - El costo de la compra (neto + IVA no computable + otros) se imputa a contratos, ítems
//   y centros de costo, en porcentajes que suman 100.
// - Un pago (orden de pago) junta medios de pago + retenciones practicadas, y se aplica a facturas.

import { calcularComprobante } from './iva.js';
import { limpiarCuit } from './cuit.js';

export const CATEGORIAS_PROVEEDOR = {
  pinturas: 'Pinturas', materiales: 'Materiales', combustible: 'Combustible', alquiler_equipos: 'Alquiler de equipos',
  subcontratistas: 'Subcontratistas', seguridad: 'Seguridad e higiene', transporte: 'Transporte', seguros: 'Seguros',
  servicios: 'Servicios', otros: 'Otros',
};

// Mismas categorías que el costo presupuestado de los ítems del contrato
export const CATEGORIAS_COSTO = {
  materiales: 'Materiales', mano_obra: 'Mano de obra', equipos: 'Equipos', subcontratos: 'Subcontratos', otros: 'Otros',
};

export const TIPOS_PERCEPCION = {
  PERC_IVA: 'Percepción de IVA', PERC_IIBB_CBA: 'Percepción IIBB Córdoba', PERC_IIBB_OTRAS: 'Percepción IIBB otras jurisdicciones',
  PERC_GANANCIAS: 'Percepción de Ganancias', OTRA: 'Otra',
};

export const MEDIOS_PAGO = {
  transferencia: 'Transferencia', echeq: 'Echeq', cheque: 'Cheque', efectivo: 'Efectivo', otro: 'Otro',
};

const entero = (x) => Number.isSafeInteger(x);

// ---------------------------------------------------------------- Duplicados

/** Clave de un comprobante de compra: CUIT del proveedor + tipo + punto de venta + número. */
export function claveComprobante({ cuit, tipo_codigo, punto_venta, numero }) {
  return `${limpiarCuit(cuit ?? '')}|${String(tipo_codigo)}|${Number(punto_venta)}|${Number(numero)}`;
}

/** Devuelve el comprobante vigente con la misma clave, o null. */
export function buscarDuplicado(nuevo, existentes = []) {
  const k = claveComprobante(nuevo);
  return existentes.find((e) => e.estado !== 'anulado' && e.id !== nuevo.id && claveComprobante(e) === k) ?? null;
}

// ---------------------------------------------------------------- Imputación

/** Porcentaje (hasta 2 decimales) a centésimos de punto entero: 60 -> 6000; 33,33 -> 3333. */
export function pctACentesimos(pct) {
  const n = typeof pct === 'string' ? Number(pct.replace(',', '.')) : Number(pct);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/**
 * Controla una imputación: [{ contrato_id, item_id, centro_costo_id, categoria, porcentaje }]
 * Cada línea va a un contrato o a un centro de costo; un ítem exige su contrato; suma 100 %.
 */
export function validarImputacion(lineas = []) {
  const errores = [];
  if (!lineas.length) { errores.push('Falta imputar la compra a un contrato o centro de costo.'); return errores; }
  let suma = 0;
  lineas.forEach((l, i) => {
    const c = pctACentesimos(l.porcentaje);
    if (!Number.isInteger(c) || c <= 0) errores.push(`Imputación ${i + 1}: el porcentaje tiene que ser mayor a cero.`);
    else suma += c;
    if (!l.contrato_id && !l.centro_costo_id) errores.push(`Imputación ${i + 1}: elegí un contrato o un centro de costo.`);
    if (l.item_id && !l.contrato_id) errores.push(`Imputación ${i + 1}: un ítem tiene que ir con su contrato.`);
    if (l.categoria && !CATEGORIAS_COSTO[l.categoria]) errores.push(`Imputación ${i + 1}: categoría de costo inválida.`);
  });
  if (suma !== 10000) errores.push(`La imputación tiene que sumar 100 % (suma ${(suma / 100).toLocaleString('es-AR')} %).`);
  return errores;
}

/**
 * Reparte un importe según los porcentajes. Los importes suman exactamente el total:
 * los centavos que sobran del redondeo van a las líneas con mayor resto (y si empatan, a la primera).
 */
export function repartirImputacion(totalCent, lineas = []) {
  if (!entero(totalCent)) throw new Error('Importe inválido');
  const pcts = lineas.map((l) => pctACentesimos(l.porcentaje));
  const base = pcts.map((p) => Math.floor((Math.abs(totalCent) * p) / 10000));
  const restos = pcts.map((p, i) => ({ i, r: (Math.abs(totalCent) * p) % 10000 }));
  let faltan = Math.abs(totalCent) - base.reduce((s, x) => s + x, 0);
  restos.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of restos) { if (faltan <= 0) break; base[i] += 1; faltan -= 1; }
  const signo = totalCent < 0 ? -1 : 1;
  return lineas.map((l, i) => ({ ...l, importe: base[i] * signo }));
}

// ---------------------------------------------------------------- Comprobante de compra

/**
 * Calcula un comprobante de compra.
 * @param d { tipoCodigo, condicionProveedor, fecha, modo, lineas (como iva.js), percepciones: [{ tipo, importe }],
 *            otrosTributos (cent), imputacion: [{ ...porcentaje }] }
 * @param catalogo { parametros, tiposComprobante }
 * @returns { ok, errores, advertencias, iva (resultado de iva.js), percepciones, otrosTributos, total,
 *            creditoFiscal, costo, imputacion (con importes) }
 */
export function calcularCompra(d, catalogo) {
  const errores = [];
  const advertencias = [];
  // Coherencia letra / condición del proveedor (antes del cálculo, para dar el error correcto)
  const tipoCat = catalogo.tiposComprobante.find((t) => String(t.codigo) === String(d.tipoCodigo));
  if (tipoCat && d.condicionProveedor === 'MT' && !['C', 'X'].includes(tipoCat.letra)) errores.push('Un monotributista emite comprobantes C.');
  if (tipoCat && d.condicionProveedor === 'RI' && tipoCat.letra === 'C') errores.push('Un Responsable Inscripto no emite comprobantes C.');
  if (errores.length) return { ok: false, errores, advertencias };
  const iva = calcularComprobante({
    tipoCodigo: d.tipoCodigo, condicionEmisor: d.condicionProveedor, condicionReceptor: 'RI', fecha: d.fecha,
    modo: d.modo ?? 'desde_neto', lineas: d.lineas ?? [],
  }, catalogo);
  if (!iva.ok) return { ok: false, errores: iva.errores, advertencias: iva.advertencias };
  advertencias.push(...iva.advertencias);

  const letra = iva.tipo.letra;
  if (letra === 'B' && d.condicionProveedor === 'RI') advertencias.push('Factura B de un Responsable Inscripto a MADEWORK (RI): lo normal es Factura A. El IVA no se computa como crédito.');

  const percepciones = (d.percepciones ?? []).filter((p) => p.importe);
  percepciones.forEach((p, i) => {
    if (!entero(p.importe) || p.importe < 0) errores.push(`Percepción ${i + 1}: importe inválido.`);
    if (!TIPOS_PERCEPCION[p.tipo]) errores.push(`Percepción ${i + 1}: tipo inválido.`);
  });
  if (percepciones.length && !iva.discriminaIva) advertencias.push('Un comprobante sin IVA discriminado no suele traer percepciones: revisalo.');
  const totalPercepciones = percepciones.reduce((s, p) => s + (entero(p.importe) ? p.importe : 0), 0);
  const otros = d.otrosTributos ?? 0;
  if (!entero(otros) || otros < 0) errores.push('Otros tributos: importe inválido.');

  const t = iva.totales;
  const total = t.total + totalPercepciones + otros;
  const creditoFiscal = iva.generaCreditoFiscal ? t.iva : 0;
  // Costo: todo lo que no es crédito impositivo
  const costo = t.total - creditoFiscal + otros;

  let imputacion = [];
  if (d.imputacion) {
    errores.push(...validarImputacion(d.imputacion));
    if (!errores.length) imputacion = repartirImputacion(costo, d.imputacion);
  }
  if (total <= 0) errores.push('El comprobante no tiene importe.');

  return {
    ok: errores.length === 0, errores, advertencias, iva, tipo: iva.tipo, signo: iva.signo,
    netoGravado: t.netoGravado, exento: t.exento, noGravado: t.noGravado + t.sinDiscriminar, ivaTotal: t.iva, porAlicuota: t.porAlicuota,
    percepciones, totalPercepciones, otrosTributos: otros, total,
    generaCreditoFiscal: iva.generaCreditoFiscal, motivoCreditoFiscal: iva.motivoCreditoFiscal, creditoFiscal, costo, imputacion,
  };
}

// ---------------------------------------------------------------- Pagos

/**
 * Valida y totaliza un pago (orden de pago).
 * @param p { medios: [{ medio, importe }], retenciones: [{ tipo, importe }], aplicaciones: [{ comprobante_id, importe }] }
 * @param ctx { saldos: { id: cent }, agenteRetencion: boolean }
 */
export function calcularPago(p, { saldos = {}, agenteRetencion = false } = {}) {
  const errores = [];
  const advertencias = [];
  const medios = p.medios ?? [];
  const retenciones = p.retenciones ?? [];
  const aplicaciones = p.aplicaciones ?? [];
  const revisar = (l, n) => l.forEach((x, i) => { if (!entero(x.importe) || x.importe <= 0) errores.push(`${n} ${i + 1}: el importe tiene que ser mayor a cero.`); });
  revisar(medios, 'Medio de pago'); revisar(retenciones, 'Retención'); revisar(aplicaciones, 'Aplicación');
  medios.forEach((m, i) => { if (!MEDIOS_PAGO[m.medio]) errores.push(`Medio de pago ${i + 1}: medio inválido.`); });
  if (retenciones.length && !agenteRetencion) {
    errores.push('MADEWORK no está configurado como agente de retención (Parámetros fiscales). Confirmalo con el contador antes de practicar retenciones.');
  }
  const porComp = {};
  for (const a of aplicaciones) porComp[a.comprobante_id] = (porComp[a.comprobante_id] ?? 0) + a.importe;
  for (const [id, imp] of Object.entries(porComp)) {
    if (!(id in saldos)) errores.push('Hay una aplicación a un comprobante que no está pendiente.');
    else if (imp > saldos[id]) errores.push(`Se aplica ${imp / 100} a un comprobante con saldo ${saldos[id] / 100}.`);
  }
  const suma = (l) => l.reduce((s, x) => s + (entero(x.importe) ? x.importe : 0), 0);
  const totalMedios = suma(medios);
  const totalRetenciones = suma(retenciones);
  const total = totalMedios + totalRetenciones;
  const totalAplicado = suma(aplicaciones);
  const aCuenta = total - totalAplicado;
  if (total === 0) errores.push('El pago no tiene importes.');
  if (aCuenta < 0) errores.push(`Se aplica más (${totalAplicado / 100}) de lo que se paga (${total / 100}).`);
  if (aCuenta > 0 && total > 0) advertencias.push(`Quedan ${aCuenta / 100} sin aplicar: se registran como anticipo al proveedor.`);
  return { ok: errores.length === 0, errores, advertencias, totalMedios, totalRetenciones, total, totalAplicado, aCuenta };
}

// ---------------------------------------------------------------- Cuenta corriente y vencimientos

/**
 * Cuenta corriente con un proveedor. Saldo = lo que MADEWORK le debe.
 * comprobantes: [{ id, fecha, clase, total, estado, descripcion }]; pagos: [{ id, fecha, numero, total, estado }]
 */
export function cuentaCorrienteProveedor({ comprobantes = [], pagos = [] }, saldoInicial = 0) {
  const movs = [];
  for (const c of comprobantes) {
    if (c.estado === 'anulado') continue;
    const haber = c.clase === 'nota_credito' ? 0 : c.total;  // factura / ND: aumenta la deuda
    const debe = c.clase === 'nota_credito' ? c.total : 0;
    movs.push({ fecha: c.fecha, orden: 0, tipo: 'comprobante', id: c.id, descripcion: c.descripcion, debe, haber });
  }
  for (const p of pagos) {
    if (p.estado === 'anulado') continue;
    movs.push({ fecha: p.fecha, orden: 1, tipo: 'pago', id: p.id, descripcion: p.descripcion ?? `Orden de pago N° ${p.numero}`, debe: p.total, haber: 0 });
  }
  movs.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden - b.orden);
  let saldo = saldoInicial;
  for (const m of movs) { saldo += m.haber - m.debe; m.saldo = saldo; }
  return { movimientos: movs, saldo };
}

const dias = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * Agrupa lo pendiente de pago por vencimiento respecto de una fecha.
 * pendientes: [{ id, saldo, vencimiento, fecha }]
 */
export function agruparVencimientos(pendientes = [], hoy) {
  const g = { vencido: [], semana: [], mes: [], despues: [], totales: { vencido: 0, semana: 0, mes: 0, despues: 0, total: 0 } };
  for (const p of pendientes) {
    if (!p.saldo || p.saldo <= 0) continue;
    const d = dias(hoy, p.vencimiento ?? p.fecha);
    const k = d < 0 ? 'vencido' : d <= 7 ? 'semana' : d <= 30 ? 'mes' : 'despues';
    g[k].push({ ...p, dias: d });
    g.totales[k] += p.saldo;
    g.totales.total += p.saldo;
  }
  for (const k of ['vencido', 'semana', 'mes', 'despues']) g[k].sort((a, b) => a.dias - b.dias);
  return g;
}
