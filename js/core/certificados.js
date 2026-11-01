// Lógica de contratos y certificados. Pura: sin pantalla ni base de datos.
// Importes en centavos enteros. Cantidades con hasta 3 decimales (se calculan en milésimas).
//
// Reglas (todas configurables por contrato, ver tabla contratos):
// - Importe de cada ítem = cantidad del período × precio vigente a la fecha del certificado.
// - Precio vigente = precio de oferta, o el de la última redeterminación APROBADA con
//   vigencia ≤ fecha (precio explícito del ítem, o precio de oferta × factor).
// - Fondo de reparo = % sobre el bruto del certificado.
// - Descuento de anticipo = % sobre el bruto, sin superar el saldo de anticipo pendiente.
// - Multas = suma de las multas asignadas al certificado.
// - Cada descuento puede restarse en la factura o aplicarse aparte (retención en el pago o
//   nota de crédito). A CONFIRMAR CON CONTADOR para cada contrato.

import { aCentavos, dividirRedondeando } from './redondeo.js';
import { ivaDeNeto } from './iva.js';

const ESTADOS_VALIDOS_PREVIOS = new Set(['presentado', 'observado', 'aprobado', 'facturado', 'cobrado']);

/** Cantidad (número o texto) -> milésimas enteras. 1,5 -> 1500 */
export function aMilesimas(cantidad) {
  if (cantidad === null || cantidad === undefined || cantidad === '') return 0;
  const n = typeof cantidad === 'string' ? Number(cantidad.replace(',', '.')) : Number(cantidad);
  if (!Number.isFinite(n)) throw new Error(`Cantidad inválida: ${cantidad}`);
  return Math.round(n * 1000);
}
const deMilesimas = (m) => m / 1000;

/** Importe = cantidad × precio, redondeado a centavos. */
export function importeLinea(cantidad, precioCent) {
  return dividirRedondeando(BigInt(aMilesimas(cantidad)) * BigInt(precioCent), 1000);
}

/** Porcentaje (21, '20', '2,5') -> puntos básicos (2100). */
function pctABp(pct) {
  if (pct === null || pct === undefined || pct === '') return 0;
  const n = Number(String(pct).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`Porcentaje inválido: ${pct}`);
  return Math.round(n * 100);
}
const porcentaje = (importe, bp) => dividirRedondeando(BigInt(importe) * BigInt(bp), 10000);

/** Precio vigente de un ítem a una fecha, considerando redeterminaciones aprobadas. */
export function precioVigente(item, redeterminaciones = [], fecha) {
  const base = aCentavos(item.precio_unitario);
  const aplicables = redeterminaciones
    .filter((r) => r.estado === 'aprobada' && r.fecha_vigencia <= fecha)
    .sort((a, b) => (a.fecha_vigencia < b.fecha_vigencia ? -1 : a.fecha_vigencia > b.fecha_vigencia ? 1 : (a.numero ?? 0) - (b.numero ?? 0)));
  const ultima = aplicables[aplicables.length - 1];
  if (!ultima) return base;
  const explicito = ultima.precios?.[item.id];
  if (explicito !== undefined && explicito !== null && explicito !== '') return aCentavos(explicito);
  if (ultima.factor === null || ultima.factor === undefined || ultima.factor === '') return base;
  const factorMillon = Math.round(Number(String(ultima.factor).replace(',', '.')) * 1_000_000);
  return dividirRedondeando(BigInt(base) * BigInt(factorMillon), 1_000_000);
}

/** Cantidades ya certificadas por ítem (certificados válidos, excluye el actual y los anulados/borradores). */
export function acumuladoAnterior(previos = [], excluirId = null) {
  const acum = {};
  for (const c of previos) {
    if (c.id && c.id === excluirId) continue;
    if (!ESTADOS_VALIDOS_PREVIOS.has(c.estado)) continue;
    for (const l of c.items ?? []) acum[l.item_id] = (acum[l.item_id] ?? 0) + aMilesimas(l.cantidad);
  }
  return acum; // en milésimas
}

/** Anticipo ya descontado en certificados válidos (centavos). */
export function anticipoDescontado(previos = [], excluirId = null) {
  return previos
    .filter((c) => !(c.id && c.id === excluirId) && ESTADOS_VALIDOS_PREVIOS.has(c.estado))
    .reduce((s, c) => s + aCentavos(c.descuento_anticipo ?? 0), 0);
}

/**
 * Calcula un certificado.
 * @param {object} p
 *  contrato: { fondo_reparo_pct, anticipo_monto, anticipo_descuento_pct,
 *              fr_en_factura, anticipo_en_factura, multas_en_factura }
 *  items: [{ id, codigo, descripcion, unidad, cantidad, precio_unitario }]
 *  redeterminaciones: [{ numero, fecha_vigencia, estado, factor, precios: { [item_id]: precio } }]
 *  previos: [{ id, estado, descuento_anticipo, items: [{ item_id, cantidad }] }]
 *  certificadoId: id del certificado que se edita (para excluirlo de los previos)
 *  cantidades: { [item_id]: cantidad del período }
 *  fecha: 'AAAA-MM-DD' (fin del período)
 *  multas: [{ importe }]   (pesos)
 *  alicuotaIvaBp: 2100
 */
export function calcularCertificado(p) {
  const errores = [];
  const advertencias = [];
  const { contrato = {}, items = [], redeterminaciones = [], previos = [], certificadoId = null,
    cantidades = {}, fecha, multas = [], alicuotaIvaBp = 2100 } = p;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) return { ok: false, errores: ['Falta la fecha del certificado (AAAA-MM-DD)'], advertencias };
  const anteriores = acumuladoAnterior(previos, certificadoId);

  const lineas = [];
  for (const it of items) {
    const raw = cantidades[it.id];
    if (raw === undefined || raw === null || raw === '' || aMilesimas(raw) === 0) continue;
    let actualM;
    try { actualM = aMilesimas(raw); } catch (e) { errores.push(`Ítem ${it.codigo}: ${e.message}`); continue; }
    if (actualM < 0) { errores.push(`Ítem ${it.codigo}: la cantidad no puede ser negativa (para corregir, usá una nota de crédito)`); continue; }
    const contratadoM = aMilesimas(it.cantidad);
    const anteriorM = anteriores[it.id] ?? 0;
    const acumuladoM = anteriorM + actualM;
    const precio = precioVigente(it, redeterminaciones, fecha);
    const importe = importeLinea(deMilesimas(actualM), precio);
    const pct = contratadoM > 0 ? Math.round((acumuladoM / contratadoM) * 10000) / 100 : null;
    if (contratadoM > 0 && acumuladoM > contratadoM) {
      advertencias.push(`Ítem ${it.codigo}: el acumulado (${deMilesimas(acumuladoM)} ${it.unidad}) supera lo contratado (${deMilesimas(contratadoM)} ${it.unidad}), ${pct}%`);
    }
    if (precio !== aCentavos(it.precio_unitario)) advertencias.push(`Ítem ${it.codigo}: se usa el precio redeterminado vigente al ${fecha}`);
    lineas.push({
      item_id: it.id, codigo: it.codigo, descripcion: it.descripcion, unidad: it.unidad,
      contratado: deMilesimas(contratadoM), anterior: deMilesimas(anteriorM), actual: deMilesimas(actualM),
      acumulado: deMilesimas(acumuladoM), pctAcumulado: pct, precio, importe,
    });
  }
  for (const id of Object.keys(cantidades)) {
    if (!items.some((it) => String(it.id) === String(id)) && aMilesimas(cantidades[id]) !== 0) errores.push(`Ítem desconocido en el certificado: ${id}`);
  }
  if (errores.length) return { ok: false, errores, advertencias };
  if (!lineas.length) advertencias.push('El certificado no tiene cantidades');

  const bruto = lineas.reduce((s, l) => s + l.importe, 0);

  // Fondo de reparo
  const fondoReparo = porcentaje(bruto, pctABp(contrato.fondo_reparo_pct));

  // Anticipo
  const anticipoTotal = aCentavos(contrato.anticipo_monto ?? 0);
  const yaDescontado = anticipoDescontado(previos, certificadoId);
  const pendienteAntes = Math.max(0, anticipoTotal - yaDescontado);
  const descuentoAnticipo = Math.min(porcentaje(bruto, pctABp(contrato.anticipo_descuento_pct)), pendienteAntes);
  const pendienteDespues = pendienteAntes - descuentoAnticipo;
  const avanceTotalCompleto = items.length > 0 && items.every((it) => {
    const contratadoM = aMilesimas(it.cantidad);
    const l = lineas.find((x) => x.item_id === it.id);
    const acumM = (anteriores[it.id] ?? 0) + (l ? aMilesimas(l.actual) : 0);
    return contratadoM === 0 || acumM >= contratadoM;
  });
  if (avanceTotalCompleto && pendienteDespues > 0) {
    advertencias.push(`La obra queda certificada al 100% y todavía falta descontar ${pendienteDespues / 100} de anticipo`);
  }

  // Multas
  const totalMultas = multas.reduce((s, m) => s + aCentavos(m.importe ?? 0), 0);

  // Factura y cobro
  const enFactura = (flag) => flag === true || flag === 'true';
  let baseFactura = bruto;
  if (enFactura(contrato.fr_en_factura)) baseFactura -= fondoReparo;
  if (enFactura(contrato.anticipo_en_factura)) baseFactura -= descuentoAnticipo;
  if (enFactura(contrato.multas_en_factura)) baseFactura -= totalMultas;
  if (baseFactura < 0) advertencias.push('Los descuentos superan el bruto del certificado');
  const iva = ivaDeNeto(baseFactura, alicuotaIvaBp);
  const totalFactura = baseFactura + iva;
  const retenidoEnPago = enFactura(contrato.fr_en_factura) ? 0 : fondoReparo;
  const anticipoAparte = enFactura(contrato.anticipo_en_factura) ? 0 : descuentoAnticipo;
  const multasPorNC = enFactura(contrato.multas_en_factura) ? 0 : totalMultas;
  const netoACobrar = totalFactura - retenidoEnPago - anticipoAparte - multasPorNC;

  return {
    ok: true, errores: [], advertencias, lineas,
    bruto, fondoReparo, descuentoAnticipo, anticipoPendienteAntes: pendienteAntes,
    anticipoPendienteDespues: pendienteDespues, multas: totalMultas,
    descuentos: fondoReparo + descuentoAnticipo + totalMultas,
    baseFactura, iva, totalFactura, retenidoEnPago, anticipoAparte, multasPorNC, netoACobrar,
  };
}

/** Resumen de avance del contrato a partir de sus ítems y certificados válidos. */
export function resumenContrato(items = [], certificados = []) {
  const montoContractual = items.reduce((s, it) => s + importeLinea(it.cantidad, aCentavos(it.precio_unitario)), 0);
  const validos = certificados.filter((c) => ESTADOS_VALIDOS_PREVIOS.has(c.estado));
  const certificado = validos.reduce((s, c) => s + aCentavos(c.bruto ?? 0), 0);
  const cantidadContratada = items.reduce((s, it) => s + aMilesimas(it.cantidad), 0);
  const acum = acumuladoAnterior(validos);
  const cantidadCertificada = Object.values(acum).reduce((s, m) => s + m, 0);
  return {
    montoContractual, certificado, saldo: montoContractual - certificado,
    avanceMontoPct: montoContractual ? Math.round((certificado / montoContractual) * 10000) / 100 : 0,
    avanceCantidadPct: cantidadContratada ? Math.round((cantidadCertificada / cantidadContratada) * 10000) / 100 : 0,
  };
}

// ---------------------------------------------------------------- Fechas
const sumarDias = (iso, dias) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
export { sumarDias };

/**
 * Fecha de pago según pliego: el primer [día de la semana] a partir de
 * (fecha de presentación de la factura + N días corridos).
 * diaSemana: 0 = domingo … 5 = viernes. Si ese día ya es viernes, se toma ese mismo día.
 * A CONFIRMAR: interpretación de "primer viernes siguiente".
 */
export function fechaPago(fechaPresentacion, dias = 15, diaSemana = 5) {
  const base = sumarDias(fechaPresentacion, dias);
  const d = new Date(`${base}T12:00:00Z`);
  const falta = (diaSemana - d.getUTCDay() + 7) % 7;
  return sumarDias(base, falta);
}

/** Fin de plazo: fecha del acta + días corridos. */
export function fechaFinPlazo(fechaActa, plazoDias) {
  if (!fechaActa || !plazoDias) return null;
  return sumarDias(fechaActa, Number(plazoDias));
}

/** Días entre dos fechas ISO (b − a). */
export function diasEntre(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

/** Multa en litros de combustible × precio por litro (centavos). */
export function importeMulta(litros, precioLitro) {
  return importeLinea(litros, aCentavos(precioLitro));
}

/**
 * Cantidades a certificar desde el registro de avance (columnas):
 * unidades APROBADAS, sin certificado asignado, con fecha de aprobación ≤ hasta.
 */
export function cantidadesDesdeAvance(avances = [], hasta) {
  const porItem = {};
  const ids = [];
  for (const a of avances) {
    if (a.estado !== 'aprobada' || a.certificado_id) continue;
    if (hasta && a.fecha_aprobacion && a.fecha_aprobacion > hasta) continue;
    porItem[a.item_id] = (porItem[a.item_id] ?? 0) + aMilesimas(a.cantidad ?? 1);
    ids.push(a.id);
  }
  return { cantidades: Object.fromEntries(Object.entries(porItem).map(([k, v]) => [k, deMilesimas(v)])), ids };
}
