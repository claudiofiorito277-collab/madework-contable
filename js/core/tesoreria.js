// Lógica pura de tesorería: saldos, cheques, impuesto a los débitos y créditos,
// lectura de extractos bancarios, conciliación sugerida y flujo de fondos.
// Importes en CENTAVOS enteros. Se prueba con node --test (tests/tesoreria.test.js).

import { aCentavos, dividirRedondeando } from './redondeo.js';

export const TIPOS_CUENTA = { caja: 'Caja', banco: 'Cuenta bancaria' };

export const CATEGORIAS_MOVIMIENTO = {
  cobranza: 'Cobranza', pago: 'Pago a proveedor', transferencia: 'Transferencia entre cuentas', cheque: 'Cheque',
  gasto_bancario: 'Gasto / comisión bancaria', impuesto_bancario: 'Impuesto bancario', imp_deb_cred: 'Impuesto a los débitos y créditos',
  aporte: 'Aporte de los socios', retiro: 'Retiro de los socios', ajuste: 'Ajuste', otro: 'Otro',
};

export const ESTADOS_CHEQUE = {
  en_cartera: ['En cartera', 'alerta'], depositado: ['Depositado', 'alerta'], cobrado: ['Acreditado', 'ok'], endosado: ['Endosado', 'neutra'],
  emitido: ['Emitido (a debitar)', 'alerta'], debitado: ['Debitado', 'ok'], rechazado: ['Rechazado', 'peligro'], anulado: ['Anulado', 'neutra'],
};

const DIA = 86400000;
const t = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const sumarDias = (iso, n) => new Date(t(iso) + n * DIA).toISOString().slice(0, 10);
export const diasEntre = (a, b) => Math.round((t(b) - t(a)) / DIA);

// ---------------------------------------------------------------- Saldos

/**
 * Saldo de cada cuenta.
 * cuentas: [{ id, saldo_inicial (cent) }]; movimientos: [{ cuenta_id, tipo: 'ingreso'|'egreso', importe (cent), estado, fecha, conciliado }]
 * hasta (opcional): solo movimientos hasta esa fecha.
 */
export function saldosCuentas(cuentas = [], movimientos = [], hasta = null) {
  const r = {};
  for (const c of cuentas) r[c.id] = { saldo: c.saldo_inicial ?? 0, ingresos: 0, egresos: 0, conciliado: c.saldo_inicial ?? 0 };
  for (const m of movimientos) {
    if (m.estado === 'anulado' || !r[m.cuenta_id]) continue;
    if (hasta && m.fecha > hasta) continue;
    const s = m.tipo === 'ingreso' ? m.importe : -m.importe;
    r[m.cuenta_id].saldo += s;
    r[m.cuenta_id][m.tipo === 'ingreso' ? 'ingresos' : 'egresos'] += m.importe;
    if (m.conciliado) r[m.cuenta_id].conciliado += s;
  }
  return r;
}

/** Controla una transferencia entre cuentas propias. */
export function validarTransferencia({ origen, destino, importe, fecha }, saldoOrigen = null) {
  const errores = [];
  const advertencias = [];
  if (!origen || !destino) errores.push('Elegí la cuenta de origen y la de destino.');
  if (origen && origen === destino) errores.push('La cuenta de origen y la de destino tienen que ser distintas.');
  if (!Number.isSafeInteger(importe) || importe <= 0) errores.push('El importe tiene que ser mayor a cero.');
  if (!fecha) errores.push('Falta la fecha.');
  if (saldoOrigen !== null && Number.isSafeInteger(importe) && importe > saldoOrigen) advertencias.push('La cuenta de origen queda en negativo (descubierto).');
  return { ok: errores.length === 0, errores, advertencias };
}

/**
 * Impuesto a los débitos y créditos bancarios de un movimiento.
 * bp = alícuota en centésimos de punto (0,6 % = 60). Sin alícuota definida devuelve null.
 * No se aplica a transferencias entre cuentas propias ni al propio impuesto.
 */
export function impuestoDebCred(importe, bp, categoria) {
  if (bp === null || bp === undefined) return null;
  if (['transferencia', 'imp_deb_cred'].includes(categoria)) return 0;
  return dividirRedondeando(BigInt(importe) * BigInt(bp), 10000);
}

// ---------------------------------------------------------------- Cheques

/** Qué se puede hacer con un cheque según su tipo y estado. */
export function accionesCheque(ch) {
  if (ch.tipo === 'recibido') {
    return { en_cartera: ['depositar', 'acreditar', 'rechazar'], depositado: ['acreditar', 'rechazar'], cobrado: ['rechazar'] }[ch.estado] ?? [];
  }
  return { emitido: ['debitar', 'rechazar'] }[ch.estado] ?? [];
}

/**
 * Alertas de cheques: los de terceros vencen para depositar 30 días después de la fecha de pago;
 * los propios emitidos se debitan en su fecha de pago (hay que tener fondos).
 */
export function alertasCheques(cheques = [], hoy, diasAviso = 3) {
  const alertas = [];
  for (const ch of cheques) {
    if (ch.tipo === 'recibido' && ch.estado === 'en_cartera') {
      const limite = sumarDias(ch.fecha_pago, 30);
      const d = diasEntre(hoy, ch.fecha_pago);
      if (diasEntre(hoy, limite) < 0) alertas.push({ cheque: ch, tipo: 'peligro', texto: `vencido para depositar desde el ${limite}` });
      else if (d <= 0) alertas.push({ cheque: ch, tipo: 'alerta', texto: `ya se puede depositar (vence para depositar el ${limite})` });
      else if (d <= diasAviso) alertas.push({ cheque: ch, tipo: 'alerta', texto: `se puede depositar en ${d} día(s)` });
    }
    if (ch.tipo === 'emitido' && ch.estado === 'emitido') {
      const d = diasEntre(hoy, ch.fecha_pago);
      if (d <= diasAviso) alertas.push({ cheque: ch, tipo: d < 0 ? 'peligro' : 'alerta', texto: d < 0 ? 'fecha de pago pasada: confirmá si ya se debitó' : `se debita en ${d} día(s): verificá fondos` });
    }
  }
  return alertas;
}

/**
 * Cómo se revierte un cheque rechazado: se reabre la deuda en los comprobantes que pagó,
 * del último aplicado al primero. Lo que no alcanza a cubrir aplicaciones era "a cuenta".
 * aplicaciones: [{ comprobante_id, importe }] (en el orden en que se aplicaron)
 */
export function repartirRechazo(importe, aplicaciones = [], aCuenta = 0) {
  let resto = importe;
  const deCuenta = Math.min(resto, Math.max(aCuenta, 0));
  resto -= deCuenta;
  const reversiones = [];
  for (const a of [...aplicaciones].reverse()) {
    if (resto <= 0) break;
    const x = Math.min(resto, a.importe);
    reversiones.push({ comprobante_id: a.comprobante_id, importe: x });
    resto -= x;
  }
  return { reversiones, deCuenta, sinCubrir: resto };
}

// ---------------------------------------------------------------- Extractos bancarios

/** Separa una línea CSV respetando comillas. */
export function partirCSV(linea, sep = ',') {
  const r = []; let cur = ''; let q = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (q) {
      if (c === '"' && linea[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { r.push(cur); cur = ''; } else cur += c;
  }
  r.push(cur);
  return r.map((x) => x.trim());
}

/** Detecta el separador más probable (; , o tabulación). */
export function detectarSeparador(texto) {
  const muestra = texto.split(/\r?\n/).slice(0, 10).join('\n');
  const cuenta = (s) => (muestra.match(new RegExp(s === '\t' ? '\\t' : `\\${s}`, 'g')) ?? []).length;
  return [';', ',', '\t'].sort((a, b) => cuenta(b) - cuenta(a))[0];
}

/** Lee una fecha en dd/mm/aaaa, dd-mm-aa, aaaa-mm-dd o número de serie de Excel. */
export function leerFecha(v, formato = 'dmy') {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v))) { // serie de Excel
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * DIA).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return null;
  let [, a, b, y] = m;
  if (y.length === 2) y = `20${y}`;
  const [d, mes] = formato === 'mdy' ? [b, a] : [a, b];
  if (Number(mes) < 1 || Number(mes) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Lee un importe del extracto: "1.234,56", "-1234.56", "(1.234,56)", "$ 1.234,56". */
export function leerImporte(v, decimal = ',') {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return aCentavos(v.toFixed(2));
  let s = String(v).trim().replace(/\$|\s/g, '');
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const c = aCentavos(s);
  return neg ? -Math.abs(c) : c;
}

/**
 * Convierte las filas del extracto en líneas normalizadas según el mapeo del banco.
 * mapeo: { fila_encabezado (n° de fila, 1 = primera), col_fecha, col_descripcion, col_referencia,
 *          col_importe | (col_debito y col_credito), formato_fecha, decimal }
 * Las columnas se indican por nombre de encabezado o por número (1 = primera).
 * Devuelve { lineas: [{ fecha, descripcion, referencia, importe (con signo: + crédito, − débito) }], errores }
 */
export function leerExtracto(filas, mapeo) {
  const errores = [];
  const fe = Math.max(1, Number(mapeo.fila_encabezado ?? 1));
  const enc = (filas[fe - 1] ?? []).map((x) => String(x ?? '').trim().toLowerCase());
  const col = (c) => {
    if (c === null || c === undefined || c === '') return -1;
    if (/^\d+$/.test(String(c))) return Number(c) - 1;
    return enc.indexOf(String(c).trim().toLowerCase());
  };
  const cf = col(mapeo.col_fecha); const cd = col(mapeo.col_descripcion); const cr = col(mapeo.col_referencia);
  const ci = col(mapeo.col_importe); const cdeb = col(mapeo.col_debito); const ccre = col(mapeo.col_credito);
  if (cf < 0) errores.push('No se encuentra la columna de fecha.');
  if (ci < 0 && (cdeb < 0 || ccre < 0)) errores.push('Indicá la columna de importe, o las de débito y crédito.');
  if (errores.length) return { lineas: [], errores };
  const lineas = [];
  filas.slice(fe).forEach((f, i) => {
    if (!f || f.every((x) => String(x ?? '').trim() === '')) return;
    const fecha = leerFecha(f[cf], mapeo.formato_fecha);
    if (!fecha) { errores.push(`Fila ${fe + i + 1}: fecha inválida "${f[cf]}" (se omite).`); return; }
    let importe;
    try {
      importe = ci >= 0 ? leerImporte(f[ci], mapeo.decimal) : Math.abs(leerImporte(f[ccre], mapeo.decimal)) - Math.abs(leerImporte(f[cdeb], mapeo.decimal));
    } catch { errores.push(`Fila ${fe + i + 1}: importe inválido (se omite).`); return; }
    if (importe === 0) return;
    lineas.push({ fecha, descripcion: cd >= 0 ? String(f[cd] ?? '').trim() : '', referencia: cr >= 0 ? String(f[cr] ?? '').trim() : '', importe });
  });
  return { lineas, errores };
}

// ---------------------------------------------------------------- Conciliación

/**
 * Sugiere qué movimiento del sistema corresponde a cada línea del extracto:
 * mismo importe exacto (con signo) y fecha dentro de la tolerancia; gana el de fecha más cercana.
 * lineas: [{ id, fecha, importe (con signo), movimiento_id? }]; movimientos: [{ id, fecha, tipo, importe, conciliado }]
 * @returns { pares: [{ linea_id, movimiento_id, dias }], lineasSinPar, movimientosSinPar }
 */
export function sugerirConciliacion(lineas = [], movimientos = [], toleranciaDias = 5) {
  const libres = movimientos.filter((m) => !m.conciliado && m.estado !== 'anulado')
    .map((m) => ({ ...m, firmado: m.tipo === 'ingreso' ? m.importe : -m.importe }));
  const usados = new Set();
  const pares = [];
  const pend = lineas.filter((l) => !l.movimiento_id && l.estado !== 'ignorado');
  // Primero las líneas con un solo candidato, después el resto (evita que una le "robe" a otra)
  const candidatos = pend.map((l) => ({ l, c: libres.filter((m) => m.firmado === l.importe && Math.abs(diasEntre(l.fecha, m.fecha)) <= toleranciaDias) }));
  candidatos.sort((a, b) => a.c.length - b.c.length);
  for (const { l, c } of candidatos) {
    const mejor = c.filter((m) => !usados.has(m.id)).sort((a, b) => Math.abs(diasEntre(l.fecha, a.fecha)) - Math.abs(diasEntre(l.fecha, b.fecha)))[0];
    if (mejor) { usados.add(mejor.id); pares.push({ linea_id: l.id, movimiento_id: mejor.id, dias: diasEntre(l.fecha, mejor.fecha) }); }
  }
  const conPar = new Set(pares.map((p) => p.linea_id));
  return {
    pares,
    lineasSinPar: pend.filter((l) => !conPar.has(l.id)),
    movimientosSinPar: libres.filter((m) => !usados.has(m.id)),
  };
}

/** Resumen de la conciliación: diferencia entre el saldo del banco y el del sistema, explicada. */
export function resumenConciliacion({ saldoBanco, saldoSistema, lineasPendientes = [], movimientosPendientes = [] }) {
  const enBancoNoEnSistema = lineasPendientes.reduce((s, l) => s + l.importe, 0);
  const enSistemaNoEnBanco = movimientosPendientes.reduce((s, m) => s + (m.tipo === 'ingreso' ? m.importe : -m.importe), 0);
  const diferencia = saldoBanco - saldoSistema;
  const explicada = enBancoNoEnSistema - enSistemaNoEnBanco;
  return { diferencia, enBancoNoEnSistema, enSistemaNoEnBanco, sinExplicar: diferencia - explicada, cuadra: diferencia === explicada };
}

// ---------------------------------------------------------------- Flujo de fondos

/** Lunes de la semana de una fecha. */
export function inicioSemana(iso) {
  const d = new Date(t(iso));
  const dow = (d.getUTCDay() + 6) % 7;
  return sumarDias(iso, -dow);
}
const clave = (iso, agrupar) => (agrupar === 'mes' ? iso.slice(0, 7) : inicioSemana(iso));

/**
 * Flujo de fondos real y proyectado.
 * real: movimientos [{ fecha, tipo, importe, estado, categoria }] (las transferencias entre cuentas propias no cuentan)
 * proyectado: cobrar [{ fecha, importe }], pagar [{ fecha, importe }] (facturas, cheques en cartera, cheques emitidos)
 * Lo proyectado con fecha pasada se suma al primer período ("atrasado").
 * @returns { periodos: [{ clave, ingresos, egresos, neto, saldo, cobrar, pagar, netoProyectado, saldoProyectado }], saldoInicial }
 */
export function flujoFondos({ movimientos = [], cobrar = [], pagar = [], saldoInicial = 0 }, { desde, hasta, hoy, agrupar = 'semana' }) {
  const p = {};
  const get = (k) => (p[k] ??= { clave: k, ingresos: 0, egresos: 0, cobrar: 0, pagar: 0 });
  // Saldo al inicio del período: saldo inicial + movimientos anteriores
  let saldo = saldoInicial;
  for (const m of movimientos) {
    if (m.estado === 'anulado' || m.categoria === 'transferencia') continue;
    const s = m.tipo === 'ingreso' ? m.importe : -m.importe;
    if (m.fecha < desde) { saldo += s; continue; }
    if (m.fecha > hasta) continue;
    const x = get(clave(m.fecha, agrupar));
    if (m.tipo === 'ingreso') x.ingresos += m.importe; else x.egresos += m.importe;
  }
  // Las transferencias no cambian el saldo total pero sí entran al saldo anterior
  for (const m of movimientos) {
    if (m.estado !== 'anulado' && m.categoria === 'transferencia' && m.fecha < desde) saldo += m.tipo === 'ingreso' ? m.importe : -m.importe;
  }
  const base = hoy && hoy > desde ? hoy : desde;
  for (const [lista, k] of [[cobrar, 'cobrar'], [pagar, 'pagar']]) {
    for (const x of lista) {
      if (!x.importe) continue;
      const f = x.fecha && x.fecha >= base ? x.fecha : base;
      if (f > hasta) continue;
      get(clave(f, agrupar))[k] += x.importe;
    }
  }
  // Completa los períodos vacíos
  for (let f = desde; f <= hasta; f = agrupar === 'mes' ? `${sumarDias(`${f.slice(0, 7)}-28`, 4).slice(0, 7)}-01` : sumarDias(inicioSemana(f), 7)) get(clave(f, agrupar));
  const saldoInicialPeriodo = saldo;
  let saldoP = saldo;
  const periodos = Object.values(p).sort((a, b) => a.clave.localeCompare(b.clave)).map((x) => {
    x.neto = x.ingresos - x.egresos;
    saldo += x.neto;
    x.saldo = saldo;
    x.netoProyectado = x.neto + x.cobrar - x.pagar;
    saldoP += x.netoProyectado;
    x.saldoProyectado = saldoP;
    return x;
  });
  return { periodos, saldoInicial: saldoInicialPeriodo };
}
