// Ventas y cobranzas: certificados por facturar, comprobantes, cobranzas,
// cuenta corriente del cliente, fondo de reparo y retenciones sufridas.
import { h, vaciar, pantalla, campo, select, etiqueta, fechaAR, pesos, cent, hoyISO, cargando } from './dom.js';
import { encabezado } from './layout.js';
import { ventas, clientes } from '../data/repos.js';
import { aCentavos } from '../core/redondeo.js';
import { cuentaCorriente, antiguedad, MEDIOS, TIPOS_RETENCION } from '../core/ventas.js';
import { sumarDias } from '../core/certificados.js';

export const CLASE_TXT = { factura: 'Factura', nota_debito: 'Nota de débito', nota_credito: 'Nota de crédito' };
export const nombreComprobante = (c) => `${c.tipo_descripcion ?? CLASE_TXT[c.clase] ?? ''} ${c.numero_formateado ?? ''}`.trim();

export function etiquetaComprobante(c) {
  if (c.estado === 'anulado') return etiqueta('Anulado', 'neutra');
  if (c.clase === 'nota_credito') return etiqueta('Emitida', 'ok');
  const saldo = aCentavos(c.saldo);
  if (saldo <= 0) return etiqueta('Cobrada', 'ok');
  if (c.vencimiento && c.vencimiento < hoyISO()) return etiqueta('Vencida', 'peligro');
  return aCentavos(c.cobrado) > 0 ? etiqueta('Cobro parcial', 'alerta') : etiqueta('A cobrar', 'alerta');
}

const incluye = (r) => {
  const x = [aCentavos(r.importe_retenciones) ? 'retenciones' : null, aCentavos(r.importe_fondo_reparo) ? 'fondo de reparo' : null,
    aCentavos(r.importe_devolucion_fr) ? 'devolución de fondo de reparo' : null].filter(Boolean);
  return x.length ? ` (incluye ${x.join(' y ')})` : '';
};

const PESTAÑAS = [['facturar', 'Por facturar'], ['comprobantes', 'Comprobantes'], ['cobranzas', 'Cobranzas'],
  ['cuenta', 'Cuenta corriente'], ['fondo', 'Fondo de reparo'], ['retenciones', 'Retenciones']];

export async function pantallaVentas(cont, ctx, tabInicial) {
  const puede = ['administrador', 'contador'].includes(ctx.perfil.rol);
  const actual = PESTAÑAS.some(([id]) => id === tabInicial) ? tabInicial : 'facturar';
  const cuerpo = h('div');
  const ir = (id) => { history.replaceState(null, '', `#/ventas/${id}`); dibujar(id); };
  const dibujar = (id) => pantalla(cuerpo, () => VISTAS[id](cuerpo, { puede }));

  vaciar(cont,
    encabezado('Ventas y cobranzas', 'Facturas registradas desde ARCA, cobros con sus retenciones, fondo de reparo y cuenta corriente.',
      puede ? h('a', { class: 'btn', href: '#/nuevo-comprobante/manual' }, '+ Factura manual') : null,
      puede ? h('a', { class: 'btn btn-primario', href: '#/nueva-cobranza' }, '+ Registrar cobranza') : null),
    pestañasBarra(actual, ir),
    cuerpo);
  await dibujar(actual);
}

function pestañasBarra(inicial, alCambiar) {
  let actual = inicial;
  const barra = h('div', { class: 'pestañas', role: 'tablist' });
  const pintar = () => vaciar(barra, PESTAÑAS.map(([id, t]) => h('button', {
    type: 'button', role: 'tab', class: `pestaña${actual === id ? ' activa' : ''}`, 'aria-selected': String(actual === id),
    onclick: () => { actual = id; pintar(); alCambiar(id); },
  }, t)));
  pintar();
  return barra;
}

const tabla = (cabeceras, filas, vacio, pie) => h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
  h('thead', {}, h('tr', {}, cabeceras.map((t) => (Array.isArray(t) ? h('th', { class: t[1] }, t[0]) : h('th', {}, t))))),
  h('tbody', {}, filas.length ? filas : h('tr', {}, h('td', { colspan: cabeceras.length, class: 'texto-suave' }, vacio))),
  pie ?? null));

const VISTAS = {
  // ---------------------------------------------------------------- Por facturar
  async facturar(cuerpo, { puede }) {
    const [certs, comps] = await Promise.all([ventas.certificadosPorFacturar(), ventas.comprobantes()]);
    const sinCae = comps.filter((c) => c.estado === 'emitido' && !c.cae);
    vaciar(cuerpo,
      sinCae.length ? h('div', { class: 'tarjeta tarjeta-alerta' },
        h('strong', {}, `${sinCae.length} comprobante(s) sin CAE cargado: `),
        sinCae.slice(0, 5).map((c, i) => [i ? ', ' : '', h('a', { href: `#/comprobante/${c.id}` }, nombreComprobante(c))])) : null,
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Certificados aprobados sin factura'),
        h('p', { class: 'texto-suave' }, 'La factura se emite en ARCA. Después la registrás acá con el mismo número y el CAE: el sistema propone los importes del certificado.'),
        tabla(['Contrato', 'Certificado', 'Período', 'Aprobado', ['Neto', 'num'], ['IVA', 'num'], ['Total factura', 'num'], ''],
          certs.map((c) => h('tr', {},
            h('td', {}, h('strong', {}, c.contratos?.codigo ?? ''), h('br'), h('small', { class: 'texto-suave' }, c.contratos?.clientes?.razon_social ?? '')),
            h('td', {}, h('a', { href: `#/certificado/${c.id}` }, `N° ${c.numero}`)),
            h('td', {}, `${fechaAR(c.periodo_desde)} al ${fechaAR(c.periodo_hasta)}`),
            h('td', {}, fechaAR(c.fecha_aprobacion)),
            h('td', { class: 'num' }, pesos(c.base_factura)), h('td', { class: 'num' }, pesos(c.iva)),
            h('td', { class: 'num' }, h('strong', {}, pesos(c.total_factura))),
            h('td', {}, puede ? h('a', { class: 'btn btn-chico btn-primario', href: `#/nuevo-comprobante/cert:${c.id}` }, 'Registrar factura') : null))),
          'No hay certificados aprobados pendientes de facturar.')));
  },

  // ---------------------------------------------------------------- Comprobantes
  async comprobantes(cuerpo) {
    const [comps, clis] = await Promise.all([ventas.comprobantes(), clientes.listar()]);
    const filtroCli = select([['', 'Todos los clientes'], ...clis.map((c) => [c.id, c.razon_social])], '', { 'aria-label': 'Cliente' });
    const filtroEst = select([['', 'Todos'], ['pendiente', 'Con saldo'], ['sin_cae', 'Sin CAE'], ['anulado', 'Anulados']], '', { 'aria-label': 'Estado' });
    const zona = h('div');
    const pintar = () => {
      const lista = comps.filter((c) => (!filtroCli.value || c.cliente_id === filtroCli.value) && (
        !filtroEst.value ? c.estado === 'emitido' :
          filtroEst.value === 'pendiente' ? c.estado === 'emitido' && aCentavos(c.saldo) > 0 :
            filtroEst.value === 'sin_cae' ? c.estado === 'emitido' && !c.cae : c.estado === 'anulado'));
      const total = lista.reduce((s, c) => s + aCentavos(c.saldo ?? 0), 0);
      vaciar(zona, tabla(['Fecha', 'Comprobante', 'Cliente', 'Origen', ['Total', 'num'], ['Saldo', 'num'], 'Vence', 'CAE', 'Estado'],
        lista.map((c) => h('tr', { class: c.estado === 'anulado' ? 'inactivo' : '' },
          h('td', {}, fechaAR(c.fecha)),
          h('td', {}, h('a', { href: `#/comprobante/${c.id}` }, h('strong', {}, nombreComprobante(c))),
            c.asociado_numero && c.clase !== 'factura' ? h('small', { class: 'texto-suave' }, h('br'), `sobre ${c.asociado_numero}`) : null),
          h('td', {}, c.cliente),
          h('td', {}, c.certificado_numero ? `${c.contrato_codigo} · Cert. ${c.certificado_numero}` : (c.contrato_codigo ?? '—')),
          h('td', { class: 'num' }, c.clase === 'nota_credito' ? `− ${pesos(c.total)}` : pesos(c.total)),
          h('td', { class: 'num' }, c.saldo === null ? '—' : pesos(c.saldo)),
          h('td', {}, fechaAR(c.vencimiento)),
          h('td', {}, c.cae ? h('span', { class: 'mono' }, c.cae) : (c.estado === 'emitido' ? etiqueta('Falta', 'alerta') : '—')),
          h('td', {}, etiquetaComprobante(c)))),
        'No hay comprobantes con ese filtro.',
        lista.length ? h('tfoot', {}, h('tr', {}, h('td', { colspan: 5 }, h('strong', {}, `${lista.length} comprobante(s) · Saldo`)),
          h('td', { class: 'num' }, h('strong', {}, cent(total))), h('td', { colspan: 3 }))) : null));
    };
    filtroCli.onchange = pintar; filtroEst.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Cliente', filtroCli), campo('Mostrar', filtroEst)), zona));
    pintar();
  },

  // ---------------------------------------------------------------- Cobranzas
  async cobranzas(cuerpo) {
    const lista = await ventas.cobranzas();
    vaciar(cuerpo, h('section', { class: 'tarjeta' },
      tabla(['Recibo', 'Fecha', 'Cliente', ['Medios', 'num'], ['Retenciones', 'num'], ['Fondo de reparo', 'num'], ['Total', 'num'], ['A cuenta', 'num'], 'Estado'],
        lista.map((r) => h('tr', { class: r.estado === 'anulada' ? 'inactivo' : '' },
          h('td', {}, h('a', { href: `#/cobranza/${r.id}` }, h('strong', {}, `N° ${r.numero}`))),
          h('td', {}, fechaAR(r.fecha)), h('td', {}, r.cliente),
          h('td', { class: 'num' }, pesos(r.importe_medios)), h('td', { class: 'num' }, pesos(r.importe_retenciones)),
          h('td', { class: 'num' }, pesos(r.importe_fondo_reparo)), h('td', { class: 'num' }, h('strong', {}, pesos(r.total))),
          h('td', { class: 'num' }, aCentavos(r.a_cuenta) ? pesos(r.a_cuenta) : '—'),
          h('td', {}, r.estado === 'anulada' ? etiqueta('Anulada', 'neutra') : etiqueta('Registrada', 'ok')))),
        'Todavía no hay cobranzas registradas.')));
  },

  // ---------------------------------------------------------------- Cuenta corriente
  async cuenta(cuerpo) {
    const clis = await clientes.listar();
    if (!clis.length) { vaciar(cuerpo, h('div', { class: 'tarjeta' }, 'Todavía no hay clientes.')); return; }
    const sel = select(clis.map((c) => [c.id, c.razon_social]), clis[0].id, { 'aria-label': 'Cliente' });
    const desde = h('input', { type: 'date', 'aria-label': 'Desde' });
    const zona = h('div');
    const pintar = async () => {
      vaciar(zona, cargando());
      const [comps, cobs] = await Promise.all([ventas.comprobantes({ clienteId: sel.value }), ventas.cobranzas({ clienteId: sel.value })]);
      const cc = cuentaCorriente({
        comprobantes: comps.map((c) => ({ id: c.id, fecha: c.fecha, clase: c.clase, estado: c.estado === 'emitido' ? 'emitido' : 'anulado',
          descripcion: `${nombreComprobante(c)}${c.certificado_numero ? ` · Cert. ${c.certificado_numero}` : ''}`, total: aCentavos(c.total) })),
        cobranzas: cobs.map((r) => ({ id: r.id, fecha: r.fecha, numero: r.numero, estado: r.estado, total: aCentavos(r.total),
          devolucion_fr: aCentavos(r.importe_devolucion_fr),
          descripcion: `Recibo N° ${r.numero}${incluye(r)}` })),
      });
      const pend = comps.filter((c) => c.estado === 'emitido' && aCentavos(c.saldo) > 0)
        .map((c) => ({ saldo: aCentavos(c.saldo), vencimiento: c.vencimiento, fecha: c.fecha }));
      const ant = antiguedad(pend, hoyISO());
      const aCuenta = cobs.filter((r) => r.estado === 'registrada').reduce((s, r) => s + aCentavos(r.a_cuenta), 0);
      // Saldo anterior al "desde" y movimientos del período
      let movs = cc.movimientos;
      let saldoAnterior = null;
      if (desde.value) {
        const antes = movs.filter((m) => m.fecha < desde.value);
        saldoAnterior = antes.length ? antes[antes.length - 1].saldo : 0;
        movs = movs.filter((m) => m.fecha >= desde.value);
      }
      const link = (m) => (m.tipo === 'comprobante' ? `#/comprobante/${m.id}` : `#/cobranza/${m.id}`);
      vaciar(zona,
        h('div', { class: 'datos' },
          h('div', { class: `dato${cc.saldo > 0 ? ' dato-alerta' : ''}` }, h('div', { class: 'dato-titulo' }, 'Saldo deudor'), h('div', { class: 'dato-valor' }, cent(cc.saldo)),
            h('div', { class: 'dato-detalle' }, cc.saldo === 0 ? 'Cuenta en cero' : cc.saldo < 0 ? 'Saldo a favor del cliente' : 'Lo que el cliente debe hoy')),
          h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'No vencido'), h('div', { class: 'dato-valor' }, cent(ant.noVencido))),
          h('div', { class: `dato${ant.d1a30 ? ' dato-alerta' : ''}` }, h('div', { class: 'dato-titulo' }, 'Vencido 1 a 30 días'), h('div', { class: 'dato-valor' }, cent(ant.d1a30))),
          h('div', { class: `dato${ant.d31a60 + ant.d61a90 + ant.mas90 ? ' dato-peligro' : ''}` }, h('div', { class: 'dato-titulo' }, 'Vencido más de 30 días'),
            h('div', { class: 'dato-valor' }, cent(ant.d31a60 + ant.d61a90 + ant.mas90)),
            h('div', { class: 'dato-detalle' }, `31-60: ${cent(ant.d31a60)} · 61-90: ${cent(ant.d61a90)} · +90: ${cent(ant.mas90)}`))),
        aCuenta ? h('p', { class: 'nota' }, `Hay ${cent(aCuenta)} cobrados a cuenta sin aplicar a facturas (ya están restados del saldo).`) : null,
        h('section', { class: 'tarjeta' }, tabla(['Fecha', 'Movimiento', ['Debe', 'num'], ['Haber', 'num'], ['Saldo', 'num']], [
          saldoAnterior !== null ? h('tr', {}, h('td', {}, fechaAR(desde.value)), h('td', {}, h('em', {}, 'Saldo anterior')), h('td'), h('td'), h('td', { class: 'num' }, cent(saldoAnterior))) : null,
          ...movs.map((m) => h('tr', {}, h('td', {}, fechaAR(m.fecha)), h('td', {}, h('a', { href: link(m) }, m.descripcion)),
            h('td', { class: 'num' }, m.debe ? cent(m.debe) : ''), h('td', { class: 'num' }, m.haber ? cent(m.haber) : ''),
            h('td', { class: 'num' }, h('strong', {}, cent(m.saldo))))),
        ].filter(Boolean), 'Sin movimientos.',
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 2 }, h('strong', {}, 'Totales')), h('td', { class: 'num' }, cent(cc.debe)), h('td', { class: 'num' }, cent(cc.haber)),
          h('td', { class: 'num' }, h('strong', {}, cent(cc.saldo))))))),
        h('p', { class: 'campo-ayuda' }, 'Las retenciones y el fondo de reparo que retiene el cliente forman parte del recibo: cancelan la factura igual que el dinero. La devolución del fondo de reparo no cambia la cuenta corriente (va contra el fondo de reparo a cobrar).'));
    };
    sel.onchange = pintar; desde.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Cliente', sel), campo('Desde (opcional)', desde),
      h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir'))), zona);
    await pintar();
  },

  // ---------------------------------------------------------------- Fondo de reparo
  async fondo(cuerpo, { puede }) {
    const filas = (await ventas.fondoReparo()).filter((f) => aCentavos(f.retenido) > 0 || aCentavos(f.devuelto) > 0);
    const total = filas.reduce((s, f) => s + aCentavos(f.saldo), 0);
    vaciar(cuerpo,
      h('div', { class: 'datos' }, h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Fondo de reparo a cobrar'), h('div', { class: 'dato-valor' }, cent(total)),
        h('div', { class: 'dato-detalle' }, 'Retenido por los clientes y todavía no devuelto'))),
      h('section', { class: 'tarjeta' }, tabla(['Contrato', 'Cliente', ['Retenido', 'num'], ['Devuelto', 'num'], ['Saldo', 'num'], 'Devolución estimada', ''],
        filas.map((f) => {
          const base = f.fecha_recepcion_definitiva ?? (f.fecha_recepcion_provisoria && f.plazo_garantia_dias ? sumarDias(f.fecha_recepcion_provisoria, f.plazo_garantia_dias) : null);
          return h('tr', {},
            h('td', {}, h('a', { href: `#/contrato/${f.contrato_id}` }, h('strong', {}, f.codigo)), h('br'), h('small', { class: 'texto-suave' }, f.descripcion)),
            h('td', {}, f.cliente), h('td', { class: 'num' }, pesos(f.retenido)), h('td', { class: 'num' }, pesos(f.devuelto)),
            h('td', { class: 'num' }, h('strong', {}, pesos(f.saldo))),
            h('td', {}, base ? fechaAR(base) : h('span', { class: 'texto-suave' }, 'Con la recepción definitiva')),
            h('td', {}, puede && aCentavos(f.saldo) > 0 ? h('a', { class: 'btn btn-chico', href: `#/nueva-cobranza/${f.cliente_id}` }, 'Registrar devolución') : null));
        }), 'Todavía no hay fondo de reparo retenido.')),
      h('p', { class: 'campo-ayuda' }, 'El fondo de reparo se registra al cargar la cobranza (lo que el cliente retiene de cada pago). La devolución se registra como una cobranza con el importe en "Devolución de fondo de reparo".'));
  },

  // ---------------------------------------------------------------- Retenciones
  async retenciones(cuerpo) {
    const hoy = hoyISO();
    const desde = h('input', { type: 'date', value: `${hoy.slice(0, 7)}-01`, 'aria-label': 'Desde' });
    const hasta = h('input', { type: 'date', value: hoy, 'aria-label': 'Hasta' });
    const tipo = select([['', 'Todas'], ...Object.entries(TIPOS_RETENCION)], '', { 'aria-label': 'Tipo' });
    const zona = h('div');
    const pintar = async () => {
      vaciar(zona, cargando());
      const lista = await ventas.retenciones({ desde: desde.value || null, hasta: hasta.value || null, tipo: tipo.value || null });
      const porTipo = {};
      for (const r of lista) porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + aCentavos(r.importe);
      vaciar(zona,
        h('div', { class: 'datos' }, Object.entries(porTipo).map(([t, v]) => h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, TIPOS_RETENCION[t] ?? t), h('div', { class: 'dato-valor' }, cent(v))))),
        tabla(['Fecha', 'Tipo', 'Certificado N°', 'Cliente', 'Recibo', 'Factura', ['Base', 'num'], ['Alícuota', 'num'], ['Importe', 'num']],
          lista.map((r) => h('tr', {}, h('td', {}, fechaAR(r.fecha)), h('td', {}, TIPOS_RETENCION[r.tipo] ?? r.tipo, r.descripcion ? h('small', { class: 'texto-suave' }, ` (${r.descripcion})`) : null),
            h('td', { class: 'mono' }, r.numero_certificado), h('td', {}, r.cliente),
            h('td', {}, h('a', { href: `#/cobranza/${r.cobranza_id}` }, `N° ${r.recibo}`)), h('td', { class: 'mono' }, r.comprobante_numero ?? '—'),
            h('td', { class: 'num' }, pesos(r.base)), h('td', { class: 'num' }, r.alicuota === null ? '—' : `${Number(r.alicuota).toLocaleString('es-AR')} %`),
            h('td', { class: 'num' }, h('strong', {}, pesos(r.importe))))),
          'No hay retenciones en ese período.'),
        h('p', { class: 'campo-ayuda' }, 'Estas retenciones son pagos a cuenta de MADEWORK: el contador las computa en la declaración jurada de cada impuesto. Los certificados escaneados se adjuntan en cada cobranza.'));
    };
    desde.onchange = pintar; hasta.onchange = pintar; tipo.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Desde', desde), campo('Hasta', hasta), campo('Tipo', tipo)), zona));
    await pintar();
  },
};

export { MEDIOS, TIPOS_RETENCION };
