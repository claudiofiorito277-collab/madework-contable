// Motor de IVA. Lógica pura: no usa pantalla ni base de datos.
// Recibe los catálogos (alícuotas con vigencia, tipos de comprobante, tolerancia)
// tal como vienen de Supabase, así las reglas se cambian desde la configuración
// y no desde el código.
//
// Importes: centavos enteros. Alícuotas: puntos básicos (21% = 2100).

import { dividirRedondeando } from './redondeo.js';
import { buscarVigente, validarFecha } from './vigencia.js';

export const TRATAMIENTOS = ['gravado', 'exento', 'no_gravado'];
export const MODOS = ['desde_neto', 'desde_total', 'manual'];

/** 21 -> 2100 ; 10.5 -> 1050 ; '10,5' -> 1050 */
export function porcentajeABp(porcentaje) {
  const n = typeof porcentaje === 'string' ? Number(porcentaje.replace(',', '.')) : Number(porcentaje);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`Alícuota inválida: ${porcentaje}`);
  return Math.round(n * 100);
}

/** IVA de un neto: neto × alícuota, redondeado a centavos. */
export function ivaDeNeto(netoCent, bp) {
  return dividirRedondeando(BigInt(netoCent) * BigInt(bp), 10000);
}

/** Separa un total con IVA incluido: neto redondeado, IVA = total − neto (siempre cuadra). */
export function separarTotal(totalCent, bp) {
  const neto = dividirRedondeando(BigInt(totalCent) * 10000n, 10000 + bp);
  return { neto, iva: totalCent - neto };
}

/** Alícuota vigente (en puntos básicos) para un código y fecha. */
export function alicuotaVigente(catalogo, codigo, fecha) {
  const reg = buscarVigente(catalogo.parametros, { tipo: 'ALICUOTA_IVA', codigo, fecha });
  if (!reg) return null;
  if (reg.valor === null || reg.valor === undefined) return null;
  return porcentajeABp(reg.valor);
}

function toleranciaVigente(catalogo, fecha) {
  const reg = buscarVigente(catalogo.parametros, { tipo: 'TOLERANCIA', codigo: 'CUADRE_IVA_CENTAVOS', fecha });
  return reg && reg.valor !== null ? Number(reg.valor) : 1;
}

/**
 * ¿El comprobante permite computar crédito fiscal?
 * Regla: el tipo debe discriminar IVA y estar marcado como generador de crédito
 * en la configuración, el emisor debe ser Responsable Inscripto y el receptor también.
 * Un monotributista (factura C) o un comprobante sin IVA discriminado nunca genera crédito.
 */
export function evaluarCreditoFiscal({ tipo, condicionEmisor, condicionReceptor }) {
  if (!tipo) return { genera: false, motivo: 'Tipo de comprobante desconocido' };
  if (!tipo.discrimina_iva) return { genera: false, motivo: `El comprobante ${tipo.descripcion ?? tipo.codigo} no discrimina IVA` };
  if (condicionEmisor !== 'RI') return { genera: false, motivo: 'El emisor no es Responsable Inscripto' };
  if (condicionReceptor !== 'RI') return { genera: false, motivo: 'El receptor no es Responsable Inscripto' };
  if (!tipo.genera_credito_fiscal) return { genera: false, motivo: `El tipo ${tipo.codigo} está configurado sin crédito fiscal` };
  return { genera: true, motivo: 'Comprobante con IVA discriminado entre Responsables Inscriptos' };
}

/**
 * Calcula un comprobante completo.
 * @param {object} datos
 *   tipoCodigo, condicionEmisor ('RI'|'MT'|'EX'|'CF'), condicionReceptor, fecha 'AAAA-MM-DD',
 *   modo ('desde_neto'|'desde_total'|'manual'),
 *   lineas: [{ tratamiento, alicuota (código, ej 'IVA_21'), neto?, total?, iva? }]  (centavos)
 * @param {object} catalogo  { parametros:[...], tiposComprobante:[...] }
 */
export function calcularComprobante(datos, catalogo) {
  const errores = [];
  const advertencias = [];
  const { tipoCodigo, condicionEmisor, condicionReceptor, fecha, modo = 'desde_neto', lineas = [] } = datos;

  try { validarFecha(fecha); } catch (e) { return fallo([e.message]); }
  if (!MODOS.includes(modo)) return fallo([`Modo de cálculo inválido: ${modo}`]);
  const tipo = catalogo.tiposComprobante.find((t) => String(t.codigo) === String(tipoCodigo));
  if (!tipo) return fallo([`Tipo de comprobante inexistente: ${tipoCodigo}`]);
  if (!lineas.length) return fallo(['El comprobante no tiene líneas']);

  const tolerancia = toleranciaVigente(catalogo, fecha);
  const sinDiscriminar = !tipo.discrimina_iva;
  // IVA contenido: comprobante B emitido por un RI. El IVA existe pero no está discriminado.
  const ivaContenido = sinDiscriminar && condicionEmisor === 'RI';
  if (sinDiscriminar && modo !== 'desde_total') {
    advertencias.push('El comprobante no discrimina IVA: se toma el importe de cada línea como total.');
  }

  const resultado = [];
  lineas.forEach((l, i) => {
    const n = i + 1;
    const tratamiento = l.tratamiento ?? 'gravado';
    if (!TRATAMIENTOS.includes(tratamiento)) { errores.push(`Línea ${n}: tratamiento inválido "${tratamiento}"`); return; }

    // Comprobante sin IVA discriminado (B o C)
    if (sinDiscriminar) {
      const total = Number(l.total ?? l.neto ?? 0);
      if (!Number.isSafeInteger(total)) { errores.push(`Línea ${n}: importe inválido`); return; }
      if (ivaContenido && tratamiento === 'gravado') {
        const bp = alicuotaVigente(catalogo, l.alicuota, fecha);
        if (bp === null) { errores.push(`Línea ${n}: alícuota "${l.alicuota}" sin valor vigente al ${fecha}`); return; }
        const { neto, iva } = separarTotal(total, bp);
        resultado.push({ n, tratamiento, alicuota: l.alicuota, bp, neto, iva, total, ivaDiscriminado: false });
      } else {
        resultado.push({ n, tratamiento: tratamiento === 'gravado' ? 'sin_discriminar' : tratamiento, alicuota: null, bp: 0, neto: total, iva: 0, total, ivaDiscriminado: false });
      }
      return;
    }

    // Exento / no gravado: sin IVA
    if (tratamiento !== 'gravado') {
      if (l.iva) { errores.push(`Línea ${n}: una operación ${tratamiento.replace('_', ' ')} no puede llevar IVA`); return; }
      const importe = Number(modo === 'desde_total' ? l.total : l.neto);
      if (!Number.isSafeInteger(importe)) { errores.push(`Línea ${n}: importe inválido`); return; }
      resultado.push({ n, tratamiento, alicuota: null, bp: 0, neto: importe, iva: 0, total: importe, ivaDiscriminado: true });
      return;
    }

    // Gravado
    const bp = alicuotaVigente(catalogo, l.alicuota, fecha);
    if (bp === null) { errores.push(`Línea ${n}: alícuota "${l.alicuota}" sin valor vigente al ${fecha}`); return; }

    if (modo === 'desde_neto') {
      const neto = Number(l.neto);
      if (!Number.isSafeInteger(neto)) { errores.push(`Línea ${n}: neto inválido`); return; }
      const iva = ivaDeNeto(neto, bp);
      resultado.push({ n, tratamiento, alicuota: l.alicuota, bp, neto, iva, total: neto + iva, ivaDiscriminado: true });
    } else if (modo === 'desde_total') {
      const total = Number(l.total);
      if (!Number.isSafeInteger(total)) { errores.push(`Línea ${n}: total inválido`); return; }
      const { neto, iva } = separarTotal(total, bp);
      resultado.push({ n, tratamiento, alicuota: l.alicuota, bp, neto, iva, total, ivaDiscriminado: true });
    } else {
      const neto = Number(l.neto);
      const iva = Number(l.iva);
      if (!Number.isSafeInteger(neto) || !Number.isSafeInteger(iva)) { errores.push(`Línea ${n}: neto e IVA son obligatorios en carga manual`); return; }
      const esperado = ivaDeNeto(neto, bp);
      const diferencia = iva - esperado;
      if (Math.abs(diferencia) > tolerancia) {
        errores.push(`Línea ${n}: el IVA cargado (${iva / 100}) no cuadra con el ${bp / 100}% del neto (esperado ${esperado / 100}, diferencia ${diferencia / 100})`);
        return;
      }
      if (diferencia !== 0) advertencias.push(`Línea ${n}: diferencia de redondeo de ${diferencia} centavo(s), dentro de la tolerancia`);
      resultado.push({ n, tratamiento, alicuota: l.alicuota, bp, neto, iva, total: neto + iva, ivaDiscriminado: true, diferencia });
    }
  });

  if (errores.length) return fallo(errores, advertencias);

  // Totales
  const totales = { netoGravado: 0, exento: 0, noGravado: 0, sinDiscriminar: 0, iva: 0, total: 0, porAlicuota: {} };
  for (const r of resultado) {
    if (r.tratamiento === 'gravado') {
      totales.netoGravado += r.neto;
      const a = (totales.porAlicuota[r.alicuota] ??= { bp: r.bp, neto: 0, iva: 0 });
      a.neto += r.neto; a.iva += r.iva;
    } else if (r.tratamiento === 'exento') totales.exento += r.neto;
    else if (r.tratamiento === 'no_gravado') totales.noGravado += r.neto;
    else totales.sinDiscriminar += r.neto;
    totales.iva += r.iva;
    totales.total += r.total;
  }
  if (totales.total === 0) advertencias.push('El total del comprobante es cero');

  const credito = evaluarCreditoFiscal({ tipo, condicionEmisor, condicionReceptor });
  const signo = tipo.clase === 'nota_credito' ? -1 : 1;

  return {
    ok: true,
    errores: [],
    advertencias,
    tipo: { codigo: tipo.codigo, letra: tipo.letra, clase: tipo.clase },
    signo,
    discriminaIva: !sinDiscriminar,
    ivaContenido,
    lineas: resultado,
    totales,
    totalConSigno: totales.total * signo,
    generaCreditoFiscal: credito.genera,
    motivoCreditoFiscal: credito.motivo,
    creditoFiscal: credito.genera ? totales.iva * signo : 0,
  };
}

function fallo(errores, advertencias = []) {
  return { ok: false, errores, advertencias };
}
