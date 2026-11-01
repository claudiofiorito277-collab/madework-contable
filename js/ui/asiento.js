// Detalle de un asiento (con acceso a su comprobante) y carga de asientos manuales.
import { h, vaciar, pantalla, campo, select, modal, aviso, error, etiqueta, fechaAR, pesos, cent, hoyISO, leerPesos } from './dom.js';
import { contabilidad, contratos as repoContratos } from '../data/repos.js';
import { ORIGENES } from './contabilidad.js';
import { aCentavos } from '../core/redondeo.js';
import { validarAsiento, compararCodigo } from '../core/asientos.js';

const TIPOS = { automatico: 'Automático', manual: 'Manual', anulacion: 'Anulación', refundicion: 'Refundición', cierre: 'Cierre', apertura: 'Apertura' };

export async function pantallaAsiento(cont, ctx, id) {
  const puede = ['administrador', 'contador'].includes(ctx.perfil.rol);
  await pantalla(cont, async () => {
    const a = await contabilidad.asiento(id);
    if (!a) throw new Error('No se encontró el asiento.');
    const anular = async () => {
      const r = await modal({ titulo: `Anular el asiento N° ${a.numero}`, peligro: true, aceptar: 'Anular con contraasiento', contenido: [
        h('p', {}, 'Un asiento no se modifica: se registra un contraasiento con las mismas cuentas invertidas.'),
        a.tipo === 'automatico' ? h('p', { class: 'nota' }, 'Es un asiento automático: si el comprobante sigue vigente, volverá a aparecer como pendiente de contabilizar.') : null,
        h('div', { class: 'form-grilla' }, campo('Motivo', h('input', { name: 'm', required: true })),
          campo('Fecha del contraasiento', h('input', { name: 'f', type: 'date', value: a.fecha }), 'Si el mes del asiento está cerrado, poné una fecha de un mes abierto.'))],
      alAceptar: (f) => ({ m: f.elements.m.value.trim(), f: f.elements.f.value }) });
      if (!r) return;
      try { const nuevo = await contabilidad.anular(id, r.m, r.f); aviso('Asiento anulado.'); location.hash = `#/asiento/${nuevo}`; } catch (e) { error(e.message); }
    };
    const origen = a.origen_tabla ? ORIGENES[a.origen_tabla] : null;
    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/contabilidad/diario' }, 'Contabilidad'), ' › ', `Asiento N° ${a.numero}`),
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, `Asiento N° ${a.numero} `, a.estado === 'anulado' ? etiqueta('Anulado', 'peligro') : etiqueta('Contabilizado', 'ok')),
          h('p', { class: 'descripcion' }, `${a.descripcion} · ${fechaAR(a.fecha)} · Ejercicio ${a.ejercicio} · ${TIPOS[a.tipo]}`),
          a.estado === 'anulado' ? h('p', { class: 'nota' }, 'Anulado por el ', h('a', { href: `#/asiento/${a.anulado_por_id}` }, `asiento N° ${a.anulado_por_numero}`), `: ${a.motivo}`) : null,
          a.anula_a_id ? h('p', { class: 'nota' }, 'Anula al ', h('a', { href: `#/asiento/${a.anula_a_id}` }, `asiento N° ${a.anula_a_numero}`)) : null),
        h('div', { class: 'acciones acciones-envolver' },
          origen ? h('a', { class: 'btn btn-primario', href: origen[1](a.origen_id) }, `Ver ${origen[0].toLowerCase()} de origen`) : null,
          puede && a.estado === 'contabilizado' && ['automatico', 'manual'].includes(a.tipo) ? h('button', { class: 'btn btn-peligro', type: 'button', onclick: anular }, 'Anular') : null)),
      h('section', { class: 'tarjeta' }, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['Cuenta', 'Contrato / centro', 'Detalle', 'Debe', 'Haber'].map((t, i) => h('th', { class: i > 2 ? 'num' : null }, t)))),
        h('tbody', {}, a.lineas.map((l) => h('tr', {}, h('td', {}, `${l.cuenta_codigo} ${l.cuenta_nombre}`), h('td', {}, [l.contrato_codigo, l.centro_codigo].filter(Boolean).join(' · ')),
          h('td', {}, l.detalle ?? ''), h('td', { class: 'num' }, aCentavos(l.debe) ? pesos(l.debe) : ''), h('td', { class: 'num' }, aCentavos(l.haber) ? pesos(l.haber) : '')))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 3 }, h('strong', {}, 'Totales')), h('td', { class: 'num' }, h('strong', {}, pesos(a.total))), h('td', { class: 'num' }, h('strong', {}, pesos(a.total)))))))));
  });
}

export async function pantallaNuevoAsiento(cont, ctx) {
  if (!['administrador', 'contador'].includes(ctx.perfil.rol)) {
    vaciar(cont, h('div', { class: 'tarjeta tarjeta-error' }, 'Solo el administrador o el contador registran asientos.'));
    return;
  }
  await pantalla(cont, async () => {
    const [plan, ctrs] = await Promise.all([contabilidad.plan(), repoContratos.listar()]);
    const opciones = [['', 'Elegí la cuenta'], ...plan.filter((c) => c.imputable && c.activo).sort((a, b) => compararCodigo(a.codigo, b.codigo)).map((c) => [c.id, `${c.codigo} · ${c.nombre}`])];
    const lineas = [{ cuenta_id: '', debe: 0, haber: 0, contrato_id: '' }, { cuenta_id: '', debe: 0, haber: 0, contrato_id: '' }];
    const fFecha = h('input', { type: 'date', value: hoyISO(), required: true, 'aria-label': 'Fecha' });
    const fDesc = h('input', { required: true, placeholder: 'Ej. Aporte inicial de capital', 'aria-label': 'Descripción' });
    const zona = h('div'); const zTot = h('div');
    const leer = (v) => { try { return aCentavos(leerPesos(v) ?? 0); } catch { return NaN; } };
    const total = () => {
      const v = validarAsiento(lineas.filter((l) => l.cuenta_id || l.debe || l.haber));
      vaciar(zTot, h('p', {}, `Debe ${cent(v.debe)} · Haber ${cent(v.haber)} `, v.debe === v.haber && v.debe ? etiqueta('Balancea', 'ok') : etiqueta(`Diferencia ${cent(v.debe - v.haber)}`, 'alerta')));
      return v;
    };
    const pintar = () => {
      vaciar(zona, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['Cuenta', 'Debe', 'Haber', 'Contrato', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, lineas.map((l, i) => h('tr', {},
          h('td', {}, select(opciones, l.cuenta_id, { 'aria-label': `Cuenta línea ${i + 1}`, onchange: (e) => { l.cuenta_id = e.target.value; total(); } })),
          h('td', {}, h('input', { class: 'input-num', inputmode: 'decimal', value: l.debe ? (l.debe / 100).toFixed(2).replace('.', ',') : '', 'aria-label': `Debe línea ${i + 1}`,
            onchange: (e) => { l.debe = leer(e.target.value); if (l.debe) l.haber = 0; pintar(); } })),
          h('td', {}, h('input', { class: 'input-num', inputmode: 'decimal', value: l.haber ? (l.haber / 100).toFixed(2).replace('.', ',') : '', 'aria-label': `Haber línea ${i + 1}`,
            onchange: (e) => { l.haber = leer(e.target.value); if (l.haber) l.debe = 0; pintar(); } })),
          h('td', {}, select([['', '—'], ...ctrs.map((c) => [c.id, c.codigo])], l.contrato_id, { 'aria-label': `Contrato línea ${i + 1}`, onchange: (e) => { l.contrato_id = e.target.value; } })),
          h('td', {}, lineas.length > 2 ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { lineas.splice(i, 1); pintar(); } }, 'Quitar') : null)))))),
        h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { lineas.push({ cuenta_id: '', debe: 0, haber: 0, contrato_id: '' }); pintar(); } }, '+ Línea'));
      total();
    };
    const guardar = async (e) => {
      e.preventDefault();
      const usadas = lineas.filter((l) => l.cuenta_id || l.debe || l.haber);
      const v = validarAsiento(usadas);
      if (!fDesc.value.trim()) { error('Falta la descripción.'); return; }
      if (!v.ok) { error(v.errores.join(' ')); return; }
      try {
        const id = await contabilidad.registrar({ fecha: fFecha.value, tipo: 'manual', descripcion: fDesc.value.trim(),
          lineas: usadas.map((l) => ({ cuenta_id: l.cuenta_id, debe: (l.debe / 100).toFixed(2), haber: (l.haber / 100).toFixed(2), contrato_id: l.contrato_id || null })) });
        aviso('Asiento registrado.');
        location.hash = `#/asiento/${id}`;
      } catch (err) { error(err.message); }
    };
    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/contabilidad/diario' }, 'Contabilidad'), ' › Asiento manual'),
      h('div', { class: 'encabezado' }, h('div', {}, h('h1', {}, 'Asiento manual'),
        h('p', { class: 'descripcion' }, 'Para lo que no viene de un comprobante: aportes de capital, saldos iniciales, amortizaciones, ajustes que indique el contador.'))),
      h('form', { onsubmit: guardar },
        h('section', { class: 'tarjeta' }, h('div', { class: 'form-grilla' }, campo('Fecha', fFecha), campo('Descripción', fDesc))),
        h('section', { class: 'tarjeta' }, zona, zTot,
          h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/contabilidad/diario' }, 'Cancelar'), h('button', { class: 'btn btn-primario', type: 'submit' }, 'Registrar asiento')))));
    pintar();
  });
}
