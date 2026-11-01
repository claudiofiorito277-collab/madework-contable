// Lógica pura de costos de obra: tarifas con vigencia, costo de partes diarios,
// stock y valorización de materiales (costo promedio ponderado), prorrateo de
// costos indirectos y costo real por ítem y por unidad producida.
// Importes en CENTAVOS enteros; cantidades en MILÉSIMAS enteras (1,5 h = 1500).
// Se prueba con node --test (tests/costos.test.js).

import { dividirRedondeando } from './redondeo.js';

export const MODALIDADES = { dependencia: 'Relación de dependencia', monotributista: 'Monotributista', subcontratista: 'Subcontratista' };
export const TIPOS_MOV_MATERIAL = { ingreso: 'Ingreso', consumo: 'Consumo en obra', transferencia: 'Transferencia', ajuste: 'Ajuste de inventario' };
export const CATEGORIAS_INDIRECTO = { seguros: 'Seguros', polizas: 'Pólizas y cauciones', administracion: 'Administración', otros: 'Otros' };
export const REGLAS_PRORRATEO = {
  costo_directo: 'Proporcional al costo directo del mes',
  monto_contractual: 'Proporcional al monto de cada contrato',
  partes_iguales: 'En partes iguales entre los contratos activos',
  porcentajes: 'Porcentajes fijos por contrato',
};

/** Cantidad (número o texto "1,5" / "1.5") -> milésimas enteras. */
export function aMilesimas(x) {
  if (x === null || x === undefined || x === '') return 0;
  const s = String(x).trim().replace(/\s/g, '');
  const n = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  if (!/^-?\d*(\.\d*)?$/.test(n) || n === '' || n === '-' || n === '.') throw new Error(`Cantidad inválida: "${x}"`);
  return Math.round(Number(n) * 1000);
}
/** importe (cent) × cantidad (milésimas), redondeado al centavo. */
export const porCantidad = (centavos, milesimas) => dividirRedondeando(BigInt(centavos) * BigInt(milesimas), 1000);

// ---------------------------------------------------------------- Tarifas

/**
 * Tarifa vigente a una fecha: la de vigente_desde más reciente que no sea posterior a la fecha.
 * tarifas: [{ vigente_desde, ...}] de UNA persona o equipo. Devuelve null si no hay.
 */
export function tarifaVigente(tarifas, fecha) {
  let mejor = null;
  for (const t of tarifas ?? []) if (t.vigente_desde <= fecha && (!mejor || t.vigente_desde > mejor.vigente_desde)) mejor = t;
  return mejor;
}

// ---------------------------------------------------------------- Partes diarios

/**
 * Costo de un parte diario.
 * parte: { fecha, personal: [{ personal_id, horas, jornales }], equipos: [{ equipo_id, horas, dias }], cantidad_producida }
 *   (horas, jornales, dias y cantidad en milésimas)
 * tarifas: { personal: { [personal_id]: [{ vigente_desde, costo_hora, costo_jornal }] }, equipos: { [equipo_id]: [{ vigente_desde, costo_hora, costo_dia }] } } (cent)
 * Devuelve { mano_obra, equipos, total, lineas: [...], faltantes: ['sin tarifa ...'] }
 */
export function costoParte(parte, tarifas) {
  const r = { mano_obra: 0, equipos: 0, total: 0, lineas: [], faltantes: [] };
  const calc = (tipo, id, uso, porHora, porDia, nombre) => {
    const t = tarifaVigente(tarifas?.[tipo]?.[id], parte.fecha);
    const horas = uso.horas ?? 0; const dias = uso[tipo === 'personal' ? 'jornales' : 'dias'] ?? 0;
    if (!t) { r.faltantes.push(`${nombre ?? id}: sin tarifa vigente al ${parte.fecha}`); return 0; }
    let c = 0;
    if (horas) { if (!t[porHora]) r.faltantes.push(`${nombre ?? id}: la tarifa no tiene costo por hora`); else c += porCantidad(t[porHora], horas); }
    if (dias) { if (!t[porDia]) r.faltantes.push(`${nombre ?? id}: la tarifa no tiene costo por ${tipo === 'personal' ? 'jornal' : 'día'}`); else c += porCantidad(t[porDia], dias); }
    return c;
  };
  for (const p of parte.personal ?? []) {
    const c = calc('personal', p.personal_id, p, 'costo_hora', 'costo_jornal', p.nombre);
    r.mano_obra += c; r.lineas.push({ tipo: 'personal', id: p.personal_id, costo: c });
  }
  for (const e of parte.equipos ?? []) {
    const c = calc('equipos', e.equipo_id, e, 'costo_hora', 'costo_dia', e.nombre);
    r.equipos += c; r.lineas.push({ tipo: 'equipo', id: e.equipo_id, costo: c });
  }
  r.total = r.mano_obra + r.equipos;
  return r;
}

/** Valida un parte antes de registrarlo. */
export function validarParte(p) {
  const e = [];
  if (!p.fecha) e.push('Falta la fecha.');
  if (!p.contrato_id) e.push('Falta el contrato.');
  if (!(p.personal ?? []).length && !(p.equipos ?? []).length) e.push('Cargá al menos una persona o un equipo.');
  for (const x of p.personal ?? []) {
    if (!x.personal_id) e.push('Hay una línea sin persona.');
    else if ((x.horas > 0) === (x.jornales > 0)) e.push('Cada persona lleva horas o jornales (uno de los dos).');
    if (x.horas > 24000) e.push('Una persona no puede tener más de 24 horas en un día.');
  }
  for (const x of p.equipos ?? []) {
    if (!x.equipo_id) e.push('Hay una línea sin equipo.');
    else if ((x.horas > 0) === (x.dias > 0)) e.push('Cada equipo lleva horas o días (uno de los dos).');
  }
  const ids = (p.personal ?? []).map((x) => x.personal_id).filter(Boolean);
  if (new Set(ids).size !== ids.length) e.push('Una persona está repetida en el parte.');
  if ((p.cantidad_producida ?? 0) < 0) e.push('La cantidad producida no puede ser negativa.');
  return { ok: !e.length, errores: [...new Set(e)] };
}

// ---------------------------------------------------------------- Materiales

/**
 * Stock y valorización (costo promedio ponderado por material, para todos los depósitos).
 * movs: [{ id, fecha, material_id, tipo, deposito_origen_id, deposito_destino_id, cantidad (mil), costo_unitario (cent, en ingresos y ajustes positivos), estado }]
 * Devuelve { stock: { [material_id]: { [deposito_id]: mil } }, total: { [material_id]: mil }, promedio: { [material_id]: cent },
 *            valorizados: [{ ...mov, costo_unitario, costo_total }], errores: [...] }
 * Los consumos y transferencias toman el costo promedio del momento. Detecta stock negativo.
 */
export function valorizarMateriales(movs) {
  const orden = [...(movs ?? [])].filter((m) => m.estado !== 'anulado')
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (ORD[a.tipo] - ORD[b.tipo]) || String(a.creado_en ?? '').localeCompare(String(b.creado_en ?? ''))));
  const stock = {}; const total = {}; const valor = {}; const errores = []; const valorizados = [];
  const sumar = (mat, dep, q) => { (stock[mat] ??= {}); stock[mat][dep] = (stock[mat][dep] ?? 0) + q; total[mat] = (total[mat] ?? 0) + q; };
  const prom = (mat) => (total[mat] > 0 ? dividirRedondeando(BigInt(valor[mat] ?? 0) * 1000n, total[mat]) : 0);
  for (const m of orden) {
    const mat = m.material_id; const q = m.cantidad;
    let cu = 0; let ct = 0;
    if (m.tipo === 'ingreso' || (m.tipo === 'ajuste' && m.deposito_destino_id)) {
      cu = m.costo_unitario ?? prom(mat);
      ct = porCantidad(cu, q);
      sumar(mat, m.deposito_destino_id, q); valor[mat] = (valor[mat] ?? 0) + ct;
    } else {
      const dep = m.deposito_origen_id;
      const disp = stock[mat]?.[dep] ?? 0;
      if (q > disp) errores.push({ mov: m.id, error: `Stock insuficiente al ${m.fecha}: hay ${disp / 1000} y se sacan ${q / 1000}` });
      cu = prom(mat);
      ct = q >= total[mat] ? (valor[mat] ?? 0) : porCantidad(cu, q);   // el último retiro se lleva el valor que queda (sin centavos huérfanos)
      sumar(mat, dep, -q);
      if (m.tipo === 'transferencia') sumar(mat, m.deposito_destino_id, q);
      else valor[mat] = (valor[mat] ?? 0) - ct;
    }
    valorizados.push({ ...m, costo_unitario: cu, costo_total: ct });
  }
  const promedio = Object.fromEntries(Object.keys(total).map((k) => [k, prom(k)]));
  return { stock, total, promedio, valor, valorizados, errores };
}
const ORD = { ingreso: 0, ajuste: 1, transferencia: 2, consumo: 3 };

/** Materiales por debajo del stock mínimo: [{ material, stock }]. */
export function bajoMinimo(materiales, total) {
  return (materiales ?? []).filter((m) => m.activo !== false && m.stock_minimo > 0 && (total[m.id] ?? 0) < m.stock_minimo)
    .map((m) => ({ material: m, stock: total[m.id] ?? 0 }));
}

// ---------------------------------------------------------------- Indirectos

/**
 * Reparte un importe entre contratos según pesos, en centavos, sin perder ni agregar centavos
 * (método del mayor resto). pesos: [{ id, peso }] (peso >= 0). Devuelve { [id]: cent }.
 */
export function repartir(importe, pesos) {
  const ps = (pesos ?? []).filter((p) => p.peso > 0);
  const suma = ps.reduce((s, p) => s + BigInt(Math.round(p.peso)), 0n);
  if (!ps.length || suma === 0n) return {};
  const signo = importe < 0 ? -1n : 1n; const abs = BigInt(Math.abs(importe));
  const base = ps.map((p) => { const n = abs * BigInt(Math.round(p.peso)); return { id: p.id, q: n / suma, r: n % suma }; });
  let resto = abs - base.reduce((s, b) => s + b.q, 0n);
  [...base].sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : 0)).forEach((b) => { if (resto > 0n) { b.q += 1n; resto -= 1n; } });
  return Object.fromEntries(base.map((b) => [b.id, Number(b.q * signo)]));
}

/**
 * Prorratea un costo indirecto entre contratos según su regla.
 * ind: { importe (cent), regla, porcentajes: [{ contrato_id, porcentaje }] }
 * ctx: { contratos: [{ id, monto (cent), activo }], costoDirecto: { [contrato_id]: cent } }
 * Devuelve { reparto: { [contrato_id]: cent }, error }
 */
export function prorratearIndirecto(ind, ctx) {
  const activos = (ctx.contratos ?? []).filter((c) => c.activo !== false);
  let pesos;
  if (ind.regla === 'porcentajes') {
    const suma = (ind.porcentajes ?? []).reduce((s, p) => s + Math.round(Number(p.porcentaje) * 100), 0);
    if (suma !== 10000) return { reparto: {}, error: `Los porcentajes suman ${suma / 100} % (tienen que sumar 100 %)` };
    pesos = ind.porcentajes.map((p) => ({ id: p.contrato_id, peso: Math.round(Number(p.porcentaje) * 100) }));
  } else if (ind.regla === 'monto_contractual') pesos = activos.map((c) => ({ id: c.id, peso: c.monto ?? 0 }));
  else if (ind.regla === 'costo_directo') {
    pesos = Object.entries(ctx.costoDirecto ?? {}).map(([id, v]) => ({ id, peso: v }));
    if (!pesos.some((p) => p.peso > 0)) pesos = activos.map((c) => ({ id: c.id, peso: 1 }));   // sin costos directos: partes iguales
  } else pesos = activos.map((c) => ({ id: c.id, peso: 1 }));
  const reparto = repartir(ind.importe, pesos);
  if (!Object.keys(reparto).length) return { reparto, error: 'No hay contratos entre los que repartir' };
  return { reparto, error: null };
}

// ---------------------------------------------------------------- Costo por ítem

/**
 * Costo real de un contrato por ítem.
 * datos: {
 *   items: [{ id, codigo, descripcion, unidad, precio_unitario (cent), costo_previsto (cent por unidad, opcional) }],
 *   partes: [{ item_id, mano_obra, equipos, cantidad_producida (mil) }]   (costos ya calculados con costoParte)
 *   consumos: [{ item_id, costo_total }]                                   (consumos valorizados del contrato)
 *   compras: [{ item_id, categoria, importe }]                              (imputaciones directas de compras, sin las que entraron a stock)
 *   indirecto: cent                                                         (indirectos prorrateados al contrato)
 * }
 * Lo que no tiene ítem va a una fila "Sin ítem". Los indirectos se reparten entre los ítems según su costo directo.
 * Devuelve { filas: [{ item, mano_obra, equipos, materiales, compras, directo, indirectos, total, producido, costo_unitario, precio_unitario, margen_unitario }], totales }
 */
export function costoPorItem(datos) {
  const filas = {};
  const fila = (id) => (filas[id ?? ''] ??= { item_id: id ?? null, mano_obra: 0, equipos: 0, materiales: 0, compras: 0, indirectos: 0, producido: 0 });
  for (const p of datos.partes ?? []) { const f = fila(p.item_id); f.mano_obra += p.mano_obra ?? 0; f.equipos += p.equipos ?? 0; f.producido += p.cantidad_producida ?? 0; }
  for (const c of datos.consumos ?? []) fila(c.item_id).materiales += c.costo_total ?? 0;
  for (const c of datos.compras ?? []) fila(c.item_id).compras += c.importe ?? 0;
  for (const it of datos.items ?? []) fila(it.id);
  const lista = Object.values(filas).map((f) => ({ ...f, directo: f.mano_obra + f.equipos + f.materiales + f.compras }));
  const ind = repartir(datos.indirecto ?? 0, lista.map((f) => ({ id: f.item_id ?? '', peso: f.directo })));
  if (datos.indirecto && !Object.keys(ind).length && lista.length) ind[lista[0].item_id ?? ''] = datos.indirecto;
  const items = Object.fromEntries((datos.items ?? []).map((i) => [i.id, i]));
  const out = lista.map((f) => {
    const item = items[f.item_id] ?? null;
    const indirectos = ind[f.item_id ?? ''] ?? 0;
    const total = f.directo + indirectos;
    const costo_unitario = f.producido > 0 ? dividirRedondeando(BigInt(total) * 1000n, f.producido) : null;
    const precio_unitario = item?.precio_unitario ?? null;
    return { ...f, item, indirectos, total, costo_unitario, precio_unitario,
      margen_unitario: costo_unitario !== null && precio_unitario !== null ? precio_unitario - costo_unitario : null,
      ingreso_producido: precio_unitario !== null ? porCantidad(precio_unitario, f.producido) : null };
  }).sort((a, b) => (a.item ? 0 : 1) - (b.item ? 0 : 1) || String(a.item?.codigo ?? '').localeCompare(String(b.item?.codigo ?? ''), 'es', { numeric: true }));
  const totales = out.reduce((s, f) => {
    for (const k of ['mano_obra', 'equipos', 'materiales', 'compras', 'directo', 'indirectos', 'total']) s[k] += f[k];
    s.ingreso_producido += f.ingreso_producido ?? 0;
    return s;
  }, { mano_obra: 0, equipos: 0, materiales: 0, compras: 0, directo: 0, indirectos: 0, total: 0, ingreso_producido: 0 });
  return { filas: out, totales };
}

/** Lunes de la semana de una fecha ISO (para agrupar partes por semana). */
export function lunes(iso) {
  const d = new Date(`${iso}T00:00:00Z`); const w = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10);
}
