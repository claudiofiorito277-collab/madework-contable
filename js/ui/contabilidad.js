// Contabilidad: contabilizar pendientes, libro diario, mayor, sumas y saldos,
// estado de resultados, situación patrimonial, períodos y configuración de imputaciones.
import { h, vaciar, pantalla, campo, select, modal, aviso, error, etiqueta, fechaAR, pesos, cent, hoyISO, cargando } from './dom.js';
import { encabezado } from './layout.js';
import { contabilidad, contratos as repoContratos } from '../data/repos.js';
import { contabilizarPendientes, regenerar, armarAsiento, configuracion } from '../data/contabilizar.js';
import { aCentavos } from '../core/redondeo.js';
import { CLAVES, sumasYSaldos, mayor, estadoResultados, situacionPatrimonial, compararCodigo } from '../core/asientos.js';

const PESTAÑAS = [['pendientes', 'Contabilizar'], ['diario', 'Libro diario'], ['mayor', 'Mayor'], ['sumas', 'Sumas y saldos'],
  ['resultados', 'Resultados'], ['patrimonio', 'Patrimonio'], ['periodos', 'Cierre de meses'], ['config', 'Configuración']];
export const ORIGENES = {
  comprobantes_venta: ['Venta', (id) => `#/comprobante/${id}`], cobranzas: ['Cobranza', (id) => `#/cobranza/${id}`],
  comprobantes_compra: ['Compra', (id) => `#/compra/${id}`], pagos: ['Pago', (id) => `#/pago/${id}`],
  movimientos_tesoreria: ['Tesorería', () => '#/tesoreria/movimientos'], cheques: ['Cheque', () => '#/tesoreria/cheques'], certificados: ['Certificado', (id) => `#/certificado/${id}`],
};
const TIPOS = { automatico: 'Automático', manual: 'Manual', anulacion: 'Anulación', refundicion: 'Refundición', cierre: 'Cierre', apertura: 'Apertura' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const primeroMes = () => `${hoyISO().slice(0, 7)}-01`;
const lin = (l) => ({ ...l, debe: aCentavos(l.debe), haber: aCentavos(l.haber) });
const tabla = (cab, filas, vacio, pie) => h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
  h('thead', {}, h('tr', {}, cab.map((t) => (Array.isArray(t) ? h('th', { class: t[1] }, t[0]) : h('th', {}, t))))),
  h('tbody', {}, filas.length ? filas : h('tr', {}, h('td', { colspan: cab.length, class: 'texto-suave' }, vacio))), pie ?? null));
const filtroFechas = (desde = primeroMes(), hasta = hoyISO()) => ({ d: h('input', { type: 'date', value: desde, 'aria-label': 'Desde' }), h: h('input', { type: 'date', value: hasta, 'aria-label': 'Hasta' }) });

export async function pantallaContabilidad(cont, ctx, tabInicial) {
  const puede = ['administrador', 'contador'].includes(ctx.perfil.rol);
  let sel = PESTAÑAS.some(([id]) => id === tabInicial) ? tabInicial : 'pendientes';
  const cuerpo = h('div');
  const barra = h('div', { class: 'pestañas', role: 'tablist' });
  const dibujar = () => pantalla(cuerpo, () => VISTAS[sel](cuerpo, { puede, recargar: dibujar }));
  const pintarBarra = () => vaciar(barra, PESTAÑAS.map(([id, t]) => h('button', {
    type: 'button', role: 'tab', class: `pestaña${sel === id ? ' activa' : ''}`, 'aria-selected': String(sel === id),
    onclick: () => { sel = id; history.replaceState(null, '', `#/contabilidad/${id}`); pintarBarra(); dibujar(); },
  }, t)));
  pintarBarra();
  vaciar(cont, encabezado('Contabilidad', 'Asientos automáticos desde cada comprobante, libros y cierre de meses.',
    puede ? h('a', { class: 'btn', href: '#/nuevo-asiento' }, '+ Asiento manual') : null), barra, cuerpo);
  await dibujar();
}

const VISTAS = {
  // ---------------------------------------------------------------- Contabilizar
  async pendientes(cuerpo, { puede, recargar }) {
    const pend = await contabilidad.pendientes();
    const zona = h('div');
    const ver = async (p) => {
      try {
        const [cfg, plan] = await Promise.all([configuracion(), contabilidad.plan()]);
        const a = await armarAsiento(p.origen_tabla, p.origen_id, p.evento, cfg);
        const nombre = (id) => { const c = plan.find((x) => x.id === id); return c ? `${c.codigo} ${c.nombre}` : '(sin cuenta)'; };
        await modal({ titulo: `Asiento propuesto · ${p.descripcion}`, aceptar: 'Cerrar', contenido: a ? [
          a.ok ? null : h('div', { class: 'tarjeta tarjeta-error' }, a.errores.join(' ')),
          tabla(['Cuenta', ['Debe', 'num'], ['Haber', 'num']], a.lineas.map((l) => h('tr', {}, h('td', {}, nombre(l.cuenta_id)), h('td', { class: 'num' }, l.debe ? cent(l.debe) : ''), h('td', { class: 'num' }, l.haber ? cent(l.haber) : ''))), ''),
          h('p', { class: 'texto-suave' }, `Debe ${cent(a.debe)} · Haber ${cent(a.haber)}`)] : h('p', {}, 'Este movimiento no lleva asiento propio.') });
      } catch (e) { error(e.message); }
    };
    const todo = async (btn) => {
      btn.disabled = true;
      const prog = h('p', { class: 'texto-suave' }, 'Contabilizando…');
      vaciar(zona, prog);
      const r = await contabilizarPendientes(pend, (i, n) => { prog.textContent = `Contabilizando ${i} de ${n}…`; });
      aviso(`${r.registrados} asiento(s) registrados${r.anulados ? `, ${r.anulados} anulado(s)` : ''}${r.errores.length ? `, ${r.errores.length} con error` : ''}.`, r.errores.length ? 'error' : 'ok');
      await recargar();
      if (r.errores.length) cuerpo.prepend(h('div', { class: 'tarjeta tarjeta-error' }, h('strong', {}, 'No se pudieron contabilizar:'),
        h('ul', {}, r.errores.map((x) => h('li', {}, `${fechaAR(x.pendiente.fecha)} · ${x.pendiente.descripcion}: ${x.error}`)))));
    };
    const regen = async () => {
      const r = await modal({ titulo: 'Regenerar asientos de un período', contenido: [
        h('p', {}, 'Después de cambiar la configuración de imputaciones, vuelve a armar los asientos automáticos del período. Los que cambian se anulan con contraasiento y se registran de nuevo. Solo funciona en meses abiertos.'),
        h('div', { class: 'form-grilla' }, campo('Desde', h('input', { type: 'date', name: 'd', value: primeroMes(), required: true })), campo('Hasta', h('input', { type: 'date', name: 'h', value: hoyISO(), required: true })))],
      aceptar: 'Regenerar', alAceptar: (f) => ({ d: f.elements.d.value, h: f.elements.h.value }) });
      if (!r) return;
      const x = await regenerar(r.d, r.h);
      aviso(`${x.revisados} asiento(s) revisados, ${x.regenerados} regenerado(s)${x.errores.length ? `, ${x.errores.length} con error: ${x.errores[0].error}` : ''}.`, x.errores.length ? 'error' : 'ok');
      await recargar();
    };
    vaciar(cuerpo,
      h('section', { class: 'tarjeta' }, h('h2', {}, `Pendientes de contabilizar (${pend.length})`),
        h('p', { class: 'texto-suave' }, 'Cada factura, cobranza, compra, pago y movimiento de tesorería genera su asiento con la configuración de imputaciones. Un mes no se puede cerrar con pendientes.'),
        puede && pend.length ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: (e) => todo(e.currentTarget) }, `Contabilizar todo (${pend.length})`)) : null,
        zona,
        tabla(['Fecha', 'Origen', 'Comprobante', 'Acción', ''], pend.map((p) => h('tr', {},
          h('td', {}, fechaAR(p.fecha)), h('td', {}, ORIGENES[p.origen_tabla][0]),
          h('td', {}, h('a', { href: ORIGENES[p.origen_tabla][1](p.origen_id) }, p.descripcion)),
          h('td', {}, p.accion === 'anular' ? etiqueta('Anular su asiento (el comprobante se anuló)', 'alerta') : etiqueta('Registrar asiento')),
          h('td', {}, p.accion === 'contabilizar' ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => ver(p) }, 'Ver asiento') : null))),
        'No hay nada pendiente: todo está contabilizado.')),
      puede ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Regenerar asientos'),
        h('p', { class: 'texto-suave' }, 'Si cambiás la cuenta de algún concepto en "Configuración", podés rehacer los asientos de un período abierto.'),
        h('button', { class: 'btn', type: 'button', onclick: regen }, 'Regenerar asientos de un período')) : null);
  },

  // ---------------------------------------------------------------- Libro diario
  async diario(cuerpo) {
    const f = filtroFechas();
    const zona = h('div');
    const pintar = async () => {
      vaciar(zona, cargando());
      const [asientos, lineas] = await Promise.all([contabilidad.asientos({ desde: f.d.value, hasta: f.h.value }), contabilidad.lineas({ desde: f.d.value, hasta: f.h.value })]);
      const porAsiento = {};
      for (const l of lineas) (porAsiento[l.asiento_id] ??= []).push(l);
      const tD = lineas.reduce((s, l) => s + aCentavos(l.debe), 0); const tH = lineas.reduce((s, l) => s + aCentavos(l.haber), 0);
      vaciar(zona,
        h('p', { class: 'texto-suave' }, `${asientos.length} asiento(s) · Debe ${cent(tD)} · Haber ${cent(tH)} `, tD === tH ? etiqueta('Balancea', 'ok') : etiqueta('No balancea', 'peligro')),
        tabla(['N°', 'Fecha', 'Cuenta', 'Contrato', ['Debe', 'num'], ['Haber', 'num']], asientos.flatMap((a) => [
          h('tr', { class: `fila-asiento${a.estado === 'anulado' ? ' inactivo' : ''}` },
            h('td', {}, h('a', { href: `#/asiento/${a.id}` }, h('strong', {}, `${a.numero}`))), h('td', {}, fechaAR(a.fecha)),
            h('td', { colspan: 4 }, h('strong', {}, a.descripcion), ' ', etiqueta(TIPOS[a.tipo], a.tipo === 'anulacion' ? 'peligro' : 'neutra'),
              a.estado === 'anulado' ? h('span', {}, ' ', etiqueta(`Anulado por el N° ${a.anulado_por_numero}`, 'peligro')) : null,
              a.origen_tabla ? h('span', {}, ' · ', h('a', { href: ORIGENES[a.origen_tabla][1](a.origen_id) }, `ver ${ORIGENES[a.origen_tabla][0].toLowerCase()}`)) : null)),
          ...(porAsiento[a.id] ?? []).map((l) => h('tr', { class: a.estado === 'anulado' ? 'inactivo' : '' }, h('td'), h('td'),
            h('td', { style: { paddingLeft: aCentavos(l.haber) ? '2.2rem' : null } }, `${l.cuenta_codigo} ${l.cuenta_nombre}`),
            h('td', {}, l.contrato_codigo ?? ''), h('td', { class: 'num' }, aCentavos(l.debe) ? pesos(l.debe) : ''), h('td', { class: 'num' }, aCentavos(l.haber) ? pesos(l.haber) : '')))]),
        'No hay asientos en el período.'));
    };
    f.d.onchange = pintar; f.h.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Desde', f.d), campo('Hasta', f.h), h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir')), zona));
    await pintar();
  },

  // ---------------------------------------------------------------- Mayor
  async mayor(cuerpo) {
    const plan = (await contabilidad.plan()).filter((c) => c.imputable);
    const fC = select(plan.map((c) => [c.id, `${c.codigo} · ${c.nombre}`]), plan.find((c) => c.codigo === '1.1.1.02')?.id ?? plan[0]?.id, { 'aria-label': 'Cuenta' });
    const f = filtroFechas();
    const zona = h('div');
    const pintar = async () => {
      vaciar(zona, cargando());
      const c = plan.find((x) => x.id === fC.value);
      const movs = (await contabilidad.lineas({ cuentaId: fC.value, hasta: f.h.value })).map(lin);
      const m = mayor(movs, f.d.value, f.h.value, c.rubro);
      vaciar(zona, tabla(['Fecha', 'Asiento', 'Detalle', ['Debe', 'num'], ['Haber', 'num'], ['Saldo', 'num']], [
        h('tr', {}, h('td', {}, fechaAR(f.d.value)), h('td'), h('td', {}, h('em', {}, 'Saldo anterior')), h('td'), h('td'), h('td', { class: 'num' }, cent(m.anterior))),
        ...m.lineas.map((l) => h('tr', { class: l.estado === 'anulado' ? 'inactivo' : '' }, h('td', {}, fechaAR(l.fecha)), h('td', {}, h('a', { href: `#/asiento/${l.asiento_id}` }, `N° ${l.numero}`)),
          h('td', {}, l.asiento_descripcion, l.contrato_codigo ? h('small', { class: 'texto-suave' }, ` · ${l.contrato_codigo}`) : null),
          h('td', { class: 'num' }, l.debe ? cent(l.debe) : ''), h('td', { class: 'num' }, l.haber ? cent(l.haber) : ''), h('td', { class: 'num' }, h('strong', {}, cent(l.saldo)))))], '',
      h('tfoot', {}, h('tr', {}, h('td', { colspan: 3 }, h('strong', {}, 'Totales del período')), h('td', { class: 'num' }, cent(m.debe)), h('td', { class: 'num' }, cent(m.haber)), h('td', { class: 'num' }, h('strong', {}, cent(m.saldo)))))),
      h('p', { class: 'campo-ayuda' }, `Saldo en el sentido natural de la cuenta (${['activo', 'egreso'].includes(c.rubro) ? 'deudor' : 'acreedor'}).`));
    };
    fC.onchange = pintar; f.d.onchange = pintar; f.h.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Cuenta', fC), campo('Desde', f.d), campo('Hasta', f.h), h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir')), zona));
    await pintar();
  },

  // ---------------------------------------------------------------- Sumas y saldos
  async sumas(cuerpo) {
    const [plan, ctrs] = await Promise.all([contabilidad.plan(), repoContratos.listar()]);
    const f = filtroFechas('2026-01-01');
    const fK = select([['', 'Todos'], ...ctrs.map((c) => [c.id, c.codigo])], '', { 'aria-label': 'Contrato' });
    const fN = h('input', { type: 'checkbox', checked: true });
    const zona = h('div');
    const pintar = async () => {
      vaciar(zona, cargando());
      let ls = (await contabilidad.lineas({ desde: f.d.value, hasta: f.h.value })).map(lin);
      if (fK.value) ls = ls.filter((l) => l.contrato_id === fK.value);
      const b = sumasYSaldos(ls, plan);
      const filas = fN.checked ? b.filas : b.filas.filter((x) => x.imputable);
      vaciar(zona,
        h('p', {}, b.cuadra ? etiqueta('El balance cuadra', 'ok') : etiqueta('El balance NO cuadra', 'peligro'), fK.value ? h('span', { class: 'texto-suave' }, ' (filtrado por contrato: solo las líneas imputadas a ese contrato)') : null),
        tabla(['Cuenta', ['Debe', 'num'], ['Haber', 'num'], ['Saldo deudor', 'num'], ['Saldo acreedor', 'num']], filas.map((x) => h('tr', { class: x.imputable ? '' : 'fila-titulo-cuenta' },
          h('td', { style: { paddingLeft: `${(x.codigo.split('.').length - 1) * 0.9}rem` } }, x.imputable ? `${x.codigo} ${x.nombre}` : h('strong', {}, `${x.codigo} ${x.nombre}`)),
          h('td', { class: 'num' }, cent(x.debe)), h('td', { class: 'num' }, cent(x.haber)), h('td', { class: 'num' }, x.deudor ? cent(x.deudor) : ''), h('td', { class: 'num' }, x.acreedor ? cent(x.acreedor) : ''))),
        'No hay movimientos en el período.',
        h('tfoot', {}, h('tr', {}, h('td', {}, h('strong', {}, 'Totales')), ...['debe', 'haber', 'deudor', 'acreedor'].map((k) => h('td', { class: 'num' }, h('strong', {}, cent(b.totales[k]))))))));
    };
    for (const x of [f.d, f.h, fK, fN]) x.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Desde', f.d), campo('Hasta', f.h), campo('Contrato', fK),
      h('label', { class: 'check' }, fN, ' Mostrar cuentas madre'), h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir')), zona));
    await pintar();
  },

  // ---------------------------------------------------------------- Estado de resultados
  async resultados(cuerpo) {
    const [plan, ctrs] = await Promise.all([contabilidad.plan(), repoContratos.listar()]);
    const f = filtroFechas('2026-01-01');
    const fK = select([['', 'Toda la empresa'], ...ctrs.map((c) => [c.id, `${c.codigo} · ${c.descripcion}`])], '', { 'aria-label': 'Contrato' });
    const zona = h('div');
    const pintar = async () => {
      vaciar(zona, cargando());
      let ls = (await contabilidad.lineas({ desde: f.d.value, hasta: f.h.value })).map(lin).filter((l) => !['refundicion', 'cierre'].includes(l.tipo));
      if (fK.value) ls = ls.filter((l) => l.contrato_id === fK.value);
      const r = estadoResultados(ls, plan, 3);
      const bloque = (titulo, grupos, total) => [h('tr', {}, h('td', { colspan: 2 }, h('strong', {}, titulo))),
        ...grupos.flatMap((g) => [h('tr', {}, h('td', { style: { paddingLeft: '1rem' } }, `${g.codigo} ${g.nombre}`), h('td', { class: 'num' }, cent(g.total))),
          ...g.cuentas.map((c) => h('tr', { class: 'texto-suave' }, h('td', { style: { paddingLeft: '2.2rem' } }, `${c.codigo} ${c.nombre}`), h('td', { class: 'num' }, h('small', {}, cent(c.saldo)))))]),
        h('tr', {}, h('td', {}, h('strong', {}, `Total ${titulo.toLowerCase()}`)), h('td', { class: 'num' }, h('strong', {}, cent(total))))];
      vaciar(zona, h('table', { class: 'tabla tabla-totales' }, h('tbody', {},
        bloque('Ingresos', r.ingresos, r.totalIngresos), bloque('Costos y gastos', r.egresos, r.totalEgresos),
        h('tr', {}, h('td', {}, h('strong', {}, r.resultado >= 0 ? 'Ganancia del período' : 'Pérdida del período')), h('td', { class: 'num' }, h('strong', { class: r.resultado < 0 ? 'texto-alerta' : '' }, cent(r.resultado)))))),
        fK.value ? h('p', { class: 'campo-ayuda' }, 'Por contrato se ven los ingresos y costos imputados a esa obra (los gastos generales sin contrato no se incluyen).') : null,
        h('p', { class: 'campo-ayuda' }, 'Ajuste por inflación: no se calcula. A CONFIRMAR CON CONTADOR.'));
    };
    for (const x of [f.d, f.h, fK]) x.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Desde', f.d), campo('Hasta', f.h), campo('Contrato', fK), h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir')), zona));
    await pintar();
  },

  // ---------------------------------------------------------------- Situación patrimonial
  async patrimonio(cuerpo) {
    const plan = await contabilidad.plan();
    const fH = h('input', { type: 'date', value: hoyISO(), 'aria-label': 'Al' });
    const zona = h('div');
    const pintar = async () => {
      vaciar(zona, cargando());
      const ejs = await contabilidad.ejercicios();
      const ej = ejs.find((e) => e.desde <= fH.value && e.hasta >= fH.value);
      // Todo lo del ejercicio en curso (incluida su apertura) hasta la fecha
      const ls = (await contabilidad.lineas({ desde: ej?.desde, hasta: fH.value })).map(lin).filter((l) => !['refundicion', 'cierre'].includes(l.tipo));
      const s = situacionPatrimonial(ls, plan, 3);
      const col = (titulo, grupos, extra, total) => h('section', { class: 'tarjeta' }, h('h2', {}, titulo),
        h('table', { class: 'tabla tabla-totales' }, h('tbody', {},
          grupos.map((g) => h('tr', {}, h('td', {}, `${g.codigo} ${g.nombre}`), h('td', { class: 'num' }, cent(g.total)))),
          extra, h('tr', {}, h('td', {}, h('strong', {}, `Total ${titulo.toLowerCase()}`)), h('td', { class: 'num' }, h('strong', {}, cent(total)))))));
      vaciar(zona,
        h('p', {}, s.cuadra ? etiqueta('Activo = Pasivo + Patrimonio neto', 'ok') : etiqueta('No cuadra', 'peligro')),
        h('div', { class: 'grilla-2' }, col('Activo', s.activo, null, s.totalActivo),
          h('div', {}, col('Pasivo', s.pasivo, null, s.totalPasivo),
            col('Patrimonio neto', s.patrimonio, h('tr', {}, h('td', {}, 'Resultado del período (no cerrado)'), h('td', { class: 'num' }, cent(s.resultadoPeriodo))), s.totalPatrimonio))),
        h('p', { class: 'campo-ayuda' }, `Ejercicio ${ej?.anio ?? '—'}. Ajuste por inflación: no se calcula. A CONFIRMAR CON CONTADOR.`));
    };
    fH.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Al', fH), h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir')), zona));
    await pintar();
  },

  // ---------------------------------------------------------------- Meses y ejercicios
  async periodos(cuerpo, { puede, recargar }) {
    const [pers, ejs, pend] = await Promise.all([contabilidad.periodos(), contabilidad.ejercicios(), contabilidad.pendientes()]);
    // Meses desde el inicio del sistema hasta el mes siguiente al actual
    const meses = [];
    for (let d = new Date(Date.UTC(2026, 10, 1)); d <= new Date(`${hoyISO().slice(0, 7)}-01T00:00:00Z`) || meses.length < 2; d.setUTCMonth(d.getUTCMonth() + 1)) {
      meses.push({ anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 });
      if (meses.length > 40) break;
    }
    const accion = async (fn, msg) => { try { await fn(); aviso(msg); await recargar(); } catch (e) { error(e.message); } };
    const reabrir = async (m) => {
      const motivo = await modal({ titulo: `Reabrir ${MESES[m.mes - 1]} ${m.anio}`, peligro: true, aceptar: 'Reabrir',
        contenido: [h('p', {}, 'Queda registrado quién lo reabrió y por qué.'), campo('Motivo', h('input', { name: 'm', required: true }))], alAceptar: (f) => f.elements.m.value.trim() });
      if (motivo) await accion(() => contabilidad.reabrirPeriodo(m.anio, m.mes, motivo), 'Mes reabierto.');
    };
    const cerrarEj = async (e) => {
      const ok = await modal({ titulo: `Cerrar el ejercicio ${e.anio}`, peligro: true, aceptar: 'Cerrar ejercicio', contenido: [
        h('p', {}, `Se registran la refundición de resultados y el asiento de cierre al ${fechaAR(e.hasta)}, y la apertura del ejercicio ${e.anio + 1}. Todos los meses del ejercicio quedan cerrados y ya no se pueden reabrir.`),
        h('p', {}, h('strong', {}, 'Ajuste por inflación: no se calcula (A CONFIRMAR CON CONTADOR). Hacelo junto con el contador.'))] });
      if (ok) await accion(() => contabilidad.cerrarEjercicio(e.anio), `Ejercicio ${e.anio} cerrado.`);
    };
    vaciar(cuerpo,
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Meses'),
        h('p', { class: 'texto-suave' }, 'Un mes cerrado bloquea la carga y la anulación de comprobantes, cobranzas, pagos, movimientos y asientos con fecha de ese mes. Para cerrarlo no tiene que haber nada pendiente de contabilizar.'),
        tabla(['Mes', 'Estado', 'Pendientes', 'Detalle', ''], meses.map((m) => {
          const p = pers.find((x) => x.anio === m.anio && x.mes === m.mes);
          const cerrado = p?.estado === 'cerrado';
          const np = pend.filter((x) => Number(x.fecha.slice(0, 4)) === m.anio && Number(x.fecha.slice(5, 7)) === m.mes).length;
          return h('tr', {}, h('td', {}, h('strong', {}, `${MESES[m.mes - 1]} ${m.anio}`)),
            h('td', {}, cerrado ? etiqueta('Cerrado', 'neutra') : etiqueta('Abierto', 'ok')),
            h('td', {}, np ? etiqueta(`${np} sin contabilizar`, 'alerta') : '—'),
            h('td', { class: 'texto-suave' }, cerrado ? `Cerrado el ${new Date(p.cerrado_en).toLocaleDateString('es-AR')}` : p?.motivo ? `Reabierto: ${p.motivo}` : ''),
            h('td', {}, puede ? (cerrado ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => reabrir(m) }, 'Reabrir')
              : h('button', { class: 'btn btn-chico btn-primario', type: 'button', onclick: () => accion(() => contabilidad.cerrarPeriodo(m.anio, m.mes), `${MESES[m.mes - 1]} ${m.anio} cerrado.`) }, 'Cerrar mes')) : null));
        }), '')),
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Ejercicios'),
        tabla(['Ejercicio', 'Desde', 'Hasta', 'Estado', 'Ajuste por inflación', ''], ejs.map((e) => h('tr', {}, h('td', {}, h('strong', {}, String(e.anio))), h('td', {}, fechaAR(e.desde)), h('td', {}, fechaAR(e.hasta)),
          h('td', {}, e.estado === 'cerrado' ? etiqueta('Cerrado', 'neutra') : etiqueta('Abierto', 'ok')), h('td', { class: 'texto-suave' }, e.ajuste_inflacion),
          h('td', {}, puede && e.estado === 'abierto' ? h('button', { class: 'btn btn-chico btn-peligro', type: 'button', onclick: () => cerrarEj(e) }, 'Cerrar ejercicio') : null))),
        'El ejercicio se crea solo con el primer asiento.')));
  },

  // ---------------------------------------------------------------- Configuración de imputaciones
  async config(cuerpo, { puede, recargar }) {
    const [imps, plan, tes] = await Promise.all([contabilidad.imputaciones(), contabilidad.plan(), contabilidad.cuentasTesoreria()]);
    const opciones = [['', '— sin cuenta —'], ...plan.filter((c) => c.imputable && c.activo).sort((a, b) => compararCodigo(a.codigo, b.codigo)).map((c) => [c.id, `${c.codigo} · ${c.nombre}`])];
    const guardar = async (fn) => { try { await fn(); aviso('Guardado. Los asientos nuevos usan esta cuenta; para los ya registrados del período abierto usá "Regenerar".'); } catch (e) { error(e.message); await recargar(); } };
    const grupos = [...new Set(imps.map((i) => i.grupo))];
    vaciar(cuerpo,
      h('div', { class: 'tarjeta tarjeta-info' }, 'Acá se define a qué cuenta va cada concepto. El sistema no tiene cuentas fijas: si el contador cambia el plan, se ajusta acá. Las marcadas A CONFIRMAR conviene revisarlas con él.'),
      grupos.map((g) => h('section', { class: 'tarjeta' }, h('h2', {}, g),
        tabla(['Concepto', 'Cuenta', ''], imps.filter((i) => i.grupo === g).map((i) => h('tr', {},
          h('td', {}, i.descripcion ?? CLAVES[i.clave], i.observacion ? h('small', { class: 'texto-alerta' }, h('br'), i.observacion) : null),
          h('td', {}, select(opciones, i.cuenta_id ?? '', { disabled: !puede, 'aria-label': `Cuenta para ${i.descripcion}`, onchange: (e) => guardar(() => contabilidad.actualizarImputacion(i.clave, e.target.value)) })),
          h('td', {}, i.cuenta_id ? '' : etiqueta('Falta', 'peligro')))), ''))),
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Cajas y bancos'),
        h('p', { class: 'texto-suave' }, 'Cada caja o cuenta bancaria puede tener su propia cuenta contable (por ejemplo una subcuenta por banco). Si no, usa "Caja" o "Bancos" de arriba.'),
        tabla(['Cuenta de tesorería', 'Cuenta contable'], tes.map((t) => h('tr', {}, h('td', {}, t.nombre, h('small', { class: 'texto-suave' }, ` (${t.tipo})`)),
          h('td', {}, select([['', `— usar "${t.tipo === 'caja' ? 'Caja' : 'Bancos'}" —`], ...opciones.slice(1)], t.cuenta_contable_id ?? '', { disabled: !puede, 'aria-label': `Cuenta contable de ${t.nombre}`,
            onchange: (e) => guardar(() => contabilidad.asignarCuentaTesoreria(t.id, e.target.value)) })))), 'Todavía no hay cajas ni bancos cargados.')));
  },
};
