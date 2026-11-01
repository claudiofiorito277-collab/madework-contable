// Compras y pagos: comprobantes de proveedores, pagos, vencimientos, cuenta corriente
// del proveedor y órdenes de compra.
import { h, vaciar, pantalla, campo, select, etiqueta, fechaAR, pesos, cent, hoyISO, cargando, modal, aviso, error, leerPesos } from './dom.js';
import { encabezado } from './layout.js';
import { compras, proveedores, contratos, tesoreria } from '../data/repos.js';
import { aCentavos } from '../core/redondeo.js';
import { cuentaCorrienteProveedor, agruparVencimientos } from '../core/compras.js';
import { formatearCuit } from '../core/cuit.js';

export const nombreCompra = (c) => `${c.tipo_descripcion ?? ''} ${c.numero_formateado ?? ''}`.trim();

export function etiquetaCompra(c) {
  if (c.estado === 'anulado') return etiqueta('Anulado', 'neutra');
  if (c.clase === 'nota_credito') return etiqueta('Emitida', 'ok');
  if (aCentavos(c.saldo) <= 0) return etiqueta('Pagada', 'ok');
  if (c.vencimiento && c.vencimiento < hoyISO()) return etiqueta('Vencida', 'peligro');
  return aCentavos(c.pagado) > 0 ? etiqueta('Pago parcial', 'alerta') : etiqueta('A pagar', 'alerta');
}

const PESTAÑAS = [['comprobantes', 'Comprobantes'], ['vencimientos', 'Vencimientos'], ['pagos', 'Pagos'], ['cuenta', 'Cuenta corriente'], ['ordenes', 'Órdenes de compra']];
const consulta = () => new URLSearchParams(location.hash.split('?')[1] ?? '');

const tabla = (cabeceras, filas, vacio, pie) => h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
  h('thead', {}, h('tr', {}, cabeceras.map((t) => (Array.isArray(t) ? h('th', { class: t[1] }, t[0]) : h('th', {}, t))))),
  h('tbody', {}, filas.length ? filas : h('tr', {}, h('td', { colspan: cabeceras.length, class: 'texto-suave' }, vacio))),
  pie ?? null));

export async function pantallaCompras(cont, ctx, tabInicial) {
  const rol = ctx.perfil.rol;
  const puede = ['administrador', 'contador'].includes(rol);
  const carga = puede || rol === 'operador';
  const actual = PESTAÑAS.some(([id]) => id === tabInicial) ? tabInicial : 'comprobantes';
  const cuerpo = h('div');
  const dibujar = (id) => pantalla(cuerpo, () => VISTAS[id](cuerpo, { puede, carga }));
  let sel = actual;
  const barra = h('div', { class: 'pestañas', role: 'tablist' });
  const pintarBarra = () => vaciar(barra, PESTAÑAS.map(([id, t]) => h('button', {
    type: 'button', role: 'tab', class: `pestaña${sel === id ? ' activa' : ''}`, 'aria-selected': String(sel === id),
    onclick: () => { sel = id; history.replaceState(null, '', `#/compras/${id}`); pintarBarra(); dibujar(id); },
  }, t)));
  pintarBarra();
  vaciar(cont,
    encabezado('Compras y pagos', 'Facturas de proveedores imputadas a cada obra, pagos y vencimientos.',
      carga ? h('a', { class: 'btn btn-primario', href: '#/nueva-compra' }, '+ Cargar factura') : null,
      puede ? h('a', { class: 'btn', href: '#/nuevo-pago' }, '+ Registrar pago') : null),
    barra, cuerpo);
  await dibujar(actual);
}

const VISTAS = {
  // ---------------------------------------------------------------- Comprobantes
  async comprobantes(cuerpo, { puede }) {
    const [comps, provs] = await Promise.all([compras.comprobantes(), proveedores.listar()]);
    const fProv = select([['', 'Todos los proveedores'], ...provs.map((p) => [p.id, p.razon_social])], '', { 'aria-label': 'Proveedor' });
    const aRevisar = comps.filter((c) => c.estado === 'emitido' && !c.revisado).length;
    const fEst = select([['', 'Vigentes'], ['pendiente', 'Con saldo'], ['revisar', `A revisar (${aRevisar})`], ['anulado', 'Anulados']], puede && aRevisar ? 'revisar' : '', { 'aria-label': 'Mostrar' });
    const zona = h('div');
    const pintar = () => {
      const lista = comps.filter((c) => (!fProv.value || c.proveedor_id === fProv.value) && (
        !fEst.value ? c.estado === 'emitido' : fEst.value === 'pendiente' ? c.estado === 'emitido' && aCentavos(c.saldo) > 0
          : fEst.value === 'revisar' ? c.estado === 'emitido' && !c.revisado : c.estado === 'anulado'));
      const sum = (k) => lista.filter((c) => c.estado === 'emitido').reduce((s, c) => s + (c.clase === 'nota_credito' ? -1 : 1) * aCentavos(c[k] ?? 0), 0);
      vaciar(zona, tabla(['Fecha', 'Comprobante', 'Proveedor', ['Total', 'num'], ['Crédito fiscal', 'num'], ['Costo', 'num'], ['Saldo', 'num'], 'Vence', 'Estado'],
        lista.map((c) => h('tr', { class: c.estado === 'anulado' ? 'inactivo' : '' },
          h('td', {}, fechaAR(c.fecha)),
          h('td', {}, h('a', { href: `#/compra/${c.id}` }, h('strong', {}, nombreCompra(c))), !c.revisado && c.estado === 'emitido' ? h('span', {}, ' ', etiqueta('A revisar', 'alerta')) : null,
            c.duplicado_autorizado ? h('span', {}, ' ', etiqueta('Duplicado autorizado', 'peligro')) : null),
          h('td', {}, c.proveedor),
          h('td', { class: 'num' }, c.clase === 'nota_credito' ? `− ${pesos(c.total)}` : pesos(c.total)),
          h('td', { class: 'num' }, aCentavos(c.credito_fiscal) ? pesos(c.credito_fiscal) : '—'),
          h('td', { class: 'num' }, pesos(c.costo)),
          h('td', { class: 'num' }, c.saldo === null ? '—' : pesos(c.saldo)),
          h('td', {}, fechaAR(c.vencimiento)), h('td', {}, etiquetaCompra(c)))),
        'No hay comprobantes con ese filtro.',
        lista.length ? h('tfoot', {}, h('tr', {}, h('td', { colspan: 3 }, h('strong', {}, `${lista.length} comprobante(s)`)),
          h('td', { class: 'num' }, cent(sum('total'))), h('td', { class: 'num' }, cent(sum('credito_fiscal'))), h('td', { class: 'num' }, cent(sum('costo'))),
          h('td', { class: 'num' }, h('strong', {}, cent(lista.reduce((s, c) => s + aCentavos(c.saldo ?? 0), 0)))), h('td', { colspan: 2 }))) : null));
    };
    fProv.onchange = pintar; fEst.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Proveedor', fProv), campo('Mostrar', fEst)), zona));
    pintar();
  },

  // ---------------------------------------------------------------- Vencimientos
  async vencimientos(cuerpo, { puede }) {
    const comps = (await compras.comprobantes()).filter((c) => c.estado === 'emitido' && c.clase !== 'nota_credito' && aCentavos(c.saldo) > 0);
    const g = agruparVencimientos(comps.map((c) => ({ ...c, saldo: aCentavos(c.saldo) })), hoyISO());
    const bloque = (titulo, lista, tipo) => (lista.length ? h('section', { class: `tarjeta${tipo === 'peligro' ? ' tarjeta-alerta' : ''}` }, h('h2', {}, titulo),
      tabla(['Vence', 'Proveedor', 'Comprobante', ['Saldo', 'num'], ''], lista.map((c) => h('tr', {},
        h('td', {}, fechaAR(c.vencimiento ?? c.fecha), h('small', { class: 'texto-suave' }, c.dias < 0 ? ` (hace ${-c.dias} días)` : c.dias === 0 ? ' (hoy)' : ` (en ${c.dias} días)`)),
        h('td', {}, c.proveedor), h('td', {}, h('a', { href: `#/compra/${c.id}` }, nombreCompra(c))), h('td', { class: 'num' }, cent(c.saldo)),
        h('td', {}, puede ? h('a', { class: 'btn btn-chico', href: `#/nuevo-pago/${c.proveedor_id}` }, 'Pagar') : null))), '')) : null);
    const d = (t, v, tipo) => h('div', { class: `dato${v && tipo ? ' dato-' + tipo : ''}` }, h('div', { class: 'dato-titulo' }, t), h('div', { class: 'dato-valor' }, cent(v)));
    vaciar(cuerpo,
      h('div', { class: 'datos' }, d('Vencido', g.totales.vencido, 'peligro'), d('Vence en 7 días', g.totales.semana, 'alerta'), d('Vence en 30 días', g.totales.mes), d('Total a pagar', g.totales.total)),
      bloque('Vencido', g.vencido, 'peligro'), bloque('Próximos 7 días', g.semana), bloque('Próximos 30 días', g.mes), bloque('Más adelante', g.despues),
      g.totales.total ? null : h('div', { class: 'tarjeta' }, 'No hay deudas pendientes con proveedores.'));
  },

  // ---------------------------------------------------------------- Pagos
  async pagos(cuerpo) {
    const lista = await compras.pagos();
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, tabla(['Orden de pago', 'Fecha', 'Proveedor', ['Medios', 'num'], ['Retenciones', 'num'], ['Total', 'num'], ['A cuenta', 'num'], 'Estado'],
      lista.map((p) => h('tr', { class: p.estado === 'anulado' ? 'inactivo' : '' },
        h('td', {}, h('a', { href: `#/pago/${p.id}` }, h('strong', {}, `N° ${p.numero}`))), h('td', {}, fechaAR(p.fecha)), h('td', {}, p.proveedor),
        h('td', { class: 'num' }, pesos(p.importe_medios)), h('td', { class: 'num' }, aCentavos(p.importe_retenciones) ? pesos(p.importe_retenciones) : '—'),
        h('td', { class: 'num' }, h('strong', {}, pesos(p.total))), h('td', { class: 'num' }, aCentavos(p.a_cuenta) ? pesos(p.a_cuenta) : '—'),
        h('td', {}, p.estado === 'anulado' ? etiqueta('Anulado', 'neutra') : etiqueta('Registrado', 'ok')))),
      'Todavía no hay pagos registrados.')));
  },

  // ---------------------------------------------------------------- Cuenta corriente
  async cuenta(cuerpo) {
    const provs = await proveedores.listar();
    if (!provs.length) { vaciar(cuerpo, h('div', { class: 'tarjeta' }, 'Todavía no hay proveedores.')); return; }
    const pedido = consulta().get('proveedor');
    const sel = select(provs.map((p) => [p.id, p.razon_social]), provs.some((p) => p.id === pedido) ? pedido : provs[0].id, { 'aria-label': 'Proveedor' });
    const zona = h('div');
    const pintar = async () => {
      vaciar(zona, cargando());
      const [comps, pags, chs] = await Promise.all([compras.comprobantes({ proveedorId: sel.value }), compras.pagos({ proveedorId: sel.value }), tesoreria.cheques({ tipo: 'emitido', estados: ['rechazado'] })]);
      const rechazos = chs.filter((x) => x.proveedor_id === sel.value).map((x) => ({ id: `chq:${x.id}`, fecha: x.fecha_estado, clase: 'nota_debito', estado: 'emitido',
        total: aCentavos(x.importe), descripcion: `Cheque propio rechazado N° ${x.numero} (${x.motivo})` }));
      const p = provs.find((x) => x.id === sel.value);
      const cc = cuentaCorrienteProveedor({
        comprobantes: comps.map((c) => ({ id: c.id, fecha: c.fecha, clase: c.clase, estado: c.estado, total: aCentavos(c.total), descripcion: nombreCompra(c) })).concat(rechazos),
        pagos: pags.map((x) => ({ id: x.id, fecha: x.fecha, numero: x.numero, estado: x.estado, total: aCentavos(x.total),
          descripcion: `Orden de pago N° ${x.numero}${aCentavos(x.importe_retenciones) ? ' (incluye retenciones)' : ''}` })),
      });
      const link = (m) => (String(m.id).startsWith('chq:') ? '#/tesoreria/cheques' : m.tipo === 'comprobante' ? `#/compra/${m.id}` : `#/pago/${m.id}`);
      vaciar(zona,
        h('div', { class: 'datos' },
          h('div', { class: `dato${cc.saldo > 0 ? ' dato-alerta' : ''}` }, h('div', { class: 'dato-titulo' }, 'Le debemos'), h('div', { class: 'dato-valor' }, cent(Math.max(cc.saldo, 0))),
            h('div', { class: 'dato-detalle' }, cc.saldo === 0 ? 'Cuenta en cero' : cc.saldo < 0 ? `Anticipo a favor nuestro: ${cent(-cc.saldo)}` : '')),
          h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Datos para pagar'),
            h('div', { class: 'dato-detalle' }, [p.cuit ? `CUIT ${formatearCuit(p.cuit)}` : null, p.banco, p.cbu ? `CBU ${p.cbu}` : null, p.alias_cbu ? `Alias ${p.alias_cbu}` : null].filter(Boolean).join(' · ') || 'Sin datos bancarios'))),
        h('section', { class: 'tarjeta' }, tabla(['Fecha', 'Movimiento', ['Debe (pagos / NC)', 'num'], ['Haber (facturas)', 'num'], ['Saldo', 'num']],
          cc.movimientos.map((m) => h('tr', {}, h('td', {}, fechaAR(m.fecha)), h('td', {}, h('a', { href: link(m) }, m.descripcion)),
            h('td', { class: 'num' }, m.debe ? cent(m.debe) : ''), h('td', { class: 'num' }, m.haber ? cent(m.haber) : ''), h('td', { class: 'num' }, h('strong', {}, cent(m.saldo))))),
          'Sin movimientos.')));
    };
    sel.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Proveedor', sel), h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir'))), zona);
    await pintar();
  },

  // ---------------------------------------------------------------- Órdenes de compra
  async ordenes(cuerpo, { puede, carga }) {
    const [ocs, provs, ctrs] = await Promise.all([compras.ordenes(), proveedores.listar(), contratos.listar()]);
    const ESTADOS = { abierta: ['Abierta', 'alerta'], cumplida: ['Cumplida', 'ok'], anulada: ['Anulada', 'neutra'] };
    const nueva = async () => {
      const ok = await modal({ titulo: 'Nueva orden de compra', contenido: h('div', { class: 'form-grilla' },
        campo('Proveedor', select([['', 'Elegí'], ...provs.filter((p) => p.activo).map((p) => [p.id, p.razon_social])], '', { name: 'proveedor_id', required: true })),
        campo('Contrato', select([['', 'Sin contrato'], ...ctrs.map((c) => [c.id, c.codigo])], ctrs.length === 1 ? ctrs[0].id : '', { name: 'contrato_id' })),
        campo('Fecha', h('input', { type: 'date', name: 'fecha', value: hoyISO(), required: true })),
        campo('Importe estimado', h('input', { name: 'importe', inputmode: 'decimal' })),
        campo('Qué se pide', h('textarea', { name: 'descripcion', rows: 3, required: true }))),
      alAceptar: async (f) => {
        const e = f.elements;
        await compras.crearOrden({ proveedor_id: e.proveedor_id.value, contrato_id: e.contrato_id.value || null, fecha: e.fecha.value,
          descripcion: e.descripcion.value.trim(), importe_estimado: leerPesos(e.importe.value) });
      } });
      if (ok) { aviso('Orden de compra creada.'); await VISTAS.ordenes(cuerpo, { puede, carga }); }
    };
    const cambiar = async (o, estado) => {
      let motivo = null;
      if (estado === 'anulada') {
        motivo = await modal({ titulo: `Anular OC N° ${o.numero}`, peligro: true, aceptar: 'Anular', contenido: campo('Motivo', h('input', { name: 'm', required: true })), alAceptar: (f) => f.elements.m.value.trim() });
        if (!motivo) return;
      }
      try { await compras.actualizarOrden(o.id, motivo ? { estado, motivo } : { estado }); aviso('Orden de compra actualizada.'); await VISTAS.ordenes(cuerpo, { puede, carga }); } catch (e) { error(e.message); }
    };
    vaciar(cuerpo, h('section', { class: 'tarjeta' },
      carga ? h('div', { class: 'acciones' }, h('button', { class: 'btn', type: 'button', onclick: nueva }, '+ Nueva orden de compra')) : null,
      tabla(['N°', 'Fecha', 'Proveedor', 'Contrato', 'Qué se pide', ['Estimado', 'num'], 'Estado', ''],
        ocs.map((o) => h('tr', { class: o.estado === 'anulada' ? 'inactivo' : '' }, h('td', {}, h('strong', {}, o.numero)), h('td', {}, fechaAR(o.fecha)),
          h('td', {}, o.proveedores?.razon_social ?? ''), h('td', {}, o.contratos?.codigo ?? '—'), h('td', {}, o.descripcion),
          h('td', { class: 'num' }, pesos(o.importe_estimado)), h('td', {}, etiqueta(...ESTADOS[o.estado])),
          h('td', {}, puede && o.estado === 'abierta' ? [h('button', { class: 'btn btn-chico', type: 'button', onclick: () => cambiar(o, 'cumplida') }, 'Cumplida'),
            h('button', { class: 'btn btn-chico', type: 'button', onclick: () => cambiar(o, 'anulada') }, 'Anular')] : null))),
        'Todavía no hay órdenes de compra. Son opcionales: sirven para dejar registrado qué se pidió antes de que llegue la factura.')));
  },
};
