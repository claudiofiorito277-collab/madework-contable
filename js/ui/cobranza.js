// Cobranzas (recibos): alta con medios de cobro, retenciones sufridas, fondo de reparo
// retenido, aplicación a facturas y devolución de fondo de reparo; y detalle del recibo.
import { h, vaciar, pantalla, campo, select, modal, aviso, error, etiqueta, fechaAR, pesos, cent, hoyISO, leerPesos, cargando } from './dom.js';
import { ventas, clientes, fiscal, empresa, certificados } from '../data/repos.js';
import { panelAdjuntos } from './adjuntos.js';
import { nombreComprobante } from './ventas.js';
import { aCentavos } from '../core/redondeo.js';
import { porcentajeABp } from '../core/iva.js';
import { buscarVigente } from '../core/vigencia.js';
import { calcularCobranza, controlRetencion, sugerirAplicacion, MEDIOS, TIPOS_RETENCION } from '../core/ventas.js';
import { cuitValido, formatearCuit } from '../core/cuit.js';

const aTxt = (c) => (c / 100).toFixed(2);
const leerCent = (v) => { try { return aCentavos(leerPesos(v) ?? 0); } catch { return NaN; } };
const mostrar = (c) => (c ? cent(c).replace('$ ', '') : '');

// =====================================================================
// Alta
// =====================================================================
export async function pantallaNuevaCobranza(cont, ctx, clienteParam) {
  if (!['administrador', 'contador'].includes(ctx.perfil.rol)) {
    vaciar(cont, h('div', { class: 'tarjeta tarjeta-error' }, 'Solo el administrador o el contador registran cobranzas.'));
    return;
  }
  await pantalla(cont, async () => {
    const [clis, catalogo] = await Promise.all([clientes.listar(), fiscal.catalogo()]);
    const activos = clis.filter((c) => c.activo);
    const est = {
      cliente_id: clienteParam && clis.some((c) => c.id === clienteParam) ? clienteParam : (activos.length === 1 ? activos[0].id : ''),
      fecha: hoyISO(),
      medios: [{ medio: 'transferencia', importe: 0 }],
      retenciones: [],
      fondoReparo: [],
      aplic: {},          // comprobante_id -> centavos
      devol: {},          // contrato_id -> centavos
      pendientes: [],     // comprobantes con saldo
      fr: [],             // contratos con fondo de reparo
      certs: {},          // certificado_id -> certificado (para sugerir fondo de reparo)
    };

    const zonaPend = h('div');
    const zonaMedios = h('div');
    const zonaRet = h('div');
    const zonaFR = h('div');
    const zonaDev = h('div');
    const zonaResumen = h('div');
    const fFecha = h('input', { type: 'date', value: est.fecha, required: true, onchange: (e) => { est.fecha = e.target.value; pintarRet(); } });
    const fObs = h('textarea', { rows: 2 });
    const fCliente = select([['', 'Elegí un cliente'], ...activos.map((c) => [c.id, c.razon_social])], est.cliente_id,
      { required: true, onchange: (e) => { est.cliente_id = e.target.value; cargarCliente(); } });

    const parametroBp = (tipo) => {
      try {
        const r = buscarVigente(catalogo.parametros, { tipo: 'RETENCION_SUFRIDA', codigo: tipo, fecha: est.fecha });
        return r && r.valor !== null ? porcentajeABp(r.valor) : null;
      } catch { return null; }
    };

    // ---------- Pendientes del cliente
    const cargarCliente = async () => {
      est.aplic = {}; est.devol = {}; est.fondoReparo = [];
      if (!est.cliente_id) { est.pendientes = []; est.fr = []; pintarTodo(); return; }
      vaciar(zonaPend, cargando());
      const [comps, fr] = await Promise.all([ventas.comprobantes({ clienteId: est.cliente_id }), ventas.fondoReparo()]);
      est.pendientes = comps.filter((c) => c.estado === 'emitido' && c.clase !== 'nota_credito' && aCentavos(c.saldo) > 0)
        .sort((a, b) => (a.vencimiento ?? a.fecha).localeCompare(b.vencimiento ?? b.fecha));
      est.fr = fr.filter((x) => x.cliente_id === est.cliente_id);
      const ids = [...new Set(est.pendientes.map((c) => c.certificado_id).filter(Boolean))];
      const certs = await Promise.all(ids.map((id) => certificados.obtener(id)));
      est.certs = Object.fromEntries(certs.filter(Boolean).map((c) => [c.id, c]));
      pintarTodo();
    };

    const filaInput = (valor, alCambiar, props = {}) => h('input', { class: 'input-num', inputmode: 'decimal', value: mostrar(valor), ...props,
      onchange: (e) => { const v = leerCent(e.target.value); if (Number.isNaN(v)) { error(`Importe inválido: ${e.target.value}`); return; } alCambiar(v); } });

    // ---------- Aplicación a facturas
    const pintarPend = () => {
      if (!est.cliente_id) { vaciar(zonaPend, h('p', { class: 'texto-suave' }, 'Elegí el cliente para ver sus facturas pendientes.')); return; }
      if (!est.pendientes.length) { vaciar(zonaPend, h('p', { class: 'texto-suave' }, 'El cliente no tiene facturas pendientes. Lo que cobres queda a cuenta (o como devolución de fondo de reparo).')); return; }
      vaciar(zonaPend, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['', 'Comprobante', 'Fecha', 'Vence', 'Origen', 'Saldo', 'Se aplica'].map((t, i) => h('th', { class: i >= 5 ? 'num' : null }, t)))),
        h('tbody', {}, est.pendientes.map((c) => {
          const saldo = aCentavos(c.saldo);
          const cert = c.certificado_id ? est.certs[c.certificado_id] : null;
          return h('tr', {},
            h('td', {}, h('input', { type: 'checkbox', checked: !!est.aplic[c.id], 'aria-label': `Aplicar a ${nombreComprobante(c)}`,
              onchange: (e) => {
                if (e.target.checked) { est.aplic[c.id] = saldo; sugerirFR(c); } else delete est.aplic[c.id];
                pintarTodo();
              } })),
            h('td', {}, h('a', { href: `#/comprobante/${c.id}`, target: '_blank' }, nombreComprobante(c))),
            h('td', {}, fechaAR(c.fecha)), h('td', {}, c.vencimiento && c.vencimiento < hoyISO() ? etiqueta(fechaAR(c.vencimiento), 'peligro') : fechaAR(c.vencimiento)),
            h('td', {}, cert ? `${c.contrato_codigo} · Cert. ${cert.numero}` : (c.contrato_codigo ?? '—')),
            h('td', { class: 'num' }, cent(saldo)),
            h('td', { class: 'num' }, filaInput(est.aplic[c.id] ?? 0, (v) => { if (v) est.aplic[c.id] = v; else delete est.aplic[c.id]; pintarResumen(); }, { 'aria-label': `Importe aplicado a ${nombreComprobante(c)}` })));
        }))),
        h('button', { class: 'btn btn-chico', type: 'button', onclick: autoAplicar }, 'Repartir lo cobrado de la factura más vieja a la más nueva')));
    };
    const sugerirFR = (c) => {
      const cert = c.certificado_id ? est.certs[c.certificado_id] : null;
      // Solo en el primer cobro de la factura (en los siguientes el fondo de reparo ya se retuvo)
      if (!cert || !aCentavos(cert.fondo_reparo) || aCentavos(c.cobrado) > 0 || est.fondoReparo.some((x) => x.comprobante_venta_id === c.id)) return;
      const contr = est.fr.find((x) => x.contrato_id === c.contrato_id);
      // Si el fondo de reparo no fue en la factura, el cliente lo retiene al pagar
      est.fondoReparo.push({ contrato_id: c.contrato_id, comprobante_venta_id: c.id, importe: aCentavos(cert.fondo_reparo), sugerido: true, codigo: contr?.codigo ?? c.contrato_codigo });
      aviso(`Se propone el fondo de reparo del certificado N° ${cert.numero} (${pesos(cert.fondo_reparo)}). Si el cliente no lo retuvo, quitalo.`);
    };
    const autoAplicar = () => {
      const r = resumen();
      const disponible = r.total - r.totalDevolucionFR;
      const { aplicaciones } = sugerirAplicacion(disponible, est.pendientes.map((c) => ({ id: c.id, saldo: aCentavos(c.saldo), vencimiento: c.vencimiento, fecha: c.fecha })));
      est.aplic = Object.fromEntries(aplicaciones.map((a) => [a.comprobante_id, a.importe]));
      pintarTodo();
    };

    // ---------- Medios de cobro
    const pintarMedios = () => vaciar(zonaMedios, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, ['Medio', 'Importe', 'Banco', 'N° operación / cheque', 'Fecha de pago', 'Librador', 'CUIT librador', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, est.medios.map((m, i) => {
        const cheque = ['echeq', 'cheque'].includes(m.medio);
        const inp = (k, props = {}) => h('input', { value: m[k] ?? '', ...props, onchange: (e) => { m[k] = e.target.value.trim(); } });
        return h('tr', {},
          h('td', {}, select(Object.entries(MEDIOS), m.medio, { 'aria-label': `Medio ${i + 1}`, onchange: (e) => { m.medio = e.target.value; pintarMedios(); } })),
          h('td', {}, filaInput(m.importe, (v) => { m.importe = v; pintarResumen(); }, { 'aria-label': `Importe medio ${i + 1}` })),
          h('td', {}, m.medio === 'efectivo' ? '—' : inp('banco', { 'aria-label': 'Banco', size: 12 })),
          h('td', {}, m.medio === 'efectivo' ? '—' : inp('numero', { 'aria-label': 'Número', size: 12 })),
          h('td', {}, inp('fecha_pago', { type: 'date', 'aria-label': 'Fecha de pago' })),
          h('td', {}, cheque ? inp('librador', { 'aria-label': 'Librador', size: 14 }) : '—'),
          h('td', {}, cheque ? inp('cuit_librador', { 'aria-label': 'CUIT librador', size: 13, placeholder: '30-...' }) : '—'),
          h('td', {}, est.medios.length > 1 ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.medios.splice(i, 1); pintarMedios(); pintarResumen(); } }, 'Quitar') : null));
      }))),
      h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.medios.push({ medio: 'echeq', importe: 0 }); pintarMedios(); } }, '+ Otro medio')));

    // ---------- Retenciones
    const pintarRet = () => vaciar(zonaRet,
      est.retenciones.length ? h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['Impuesto', 'N° certificado', 'Fecha', 'Base', 'Alícuota %', 'Importe', 'Factura', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, est.retenciones.map((r, i) => {
          const ctl = controlRetencion({ base: r.base || null, importe: r.importe, alicuotaBp: r.alicuota ? porcentajeABp(r.alicuota) : null }, parametroBp(r.tipo));
          return [h('tr', {},
            h('td', {}, select(Object.entries(TIPOS_RETENCION), r.tipo, { 'aria-label': `Impuesto retención ${i + 1}`, onchange: (e) => { r.tipo = e.target.value; pintarRet(); } }),
              r.tipo === 'OTRA' ? h('input', { placeholder: 'Cuál', value: r.descripcion ?? '', size: 10, onchange: (e) => { r.descripcion = e.target.value; } }) : null),
            h('td', {}, h('input', { value: r.numero_certificado ?? '', size: 12, required: true, 'aria-label': `Número de certificado ${i + 1}`, onchange: (e) => { r.numero_certificado = e.target.value.trim(); } })),
            h('td', {}, h('input', { type: 'date', value: r.fecha ?? est.fecha, 'aria-label': 'Fecha de la retención', onchange: (e) => { r.fecha = e.target.value; } })),
            h('td', {}, filaInput(r.base, (v) => { r.base = v; pintarRet(); }, { 'aria-label': `Base retención ${i + 1}` })),
            h('td', {}, h('input', { class: 'input-num', inputmode: 'decimal', size: 6, value: r.alicuota ?? '', 'aria-label': `Alícuota retención ${i + 1}`,
              onchange: (e) => { const v = e.target.value.trim().replace(',', '.'); r.alicuota = v === '' ? null : Number(v); pintarRet(); } })),
            h('td', {}, filaInput(r.importe, (v) => { r.importe = v; pintarRet(); pintarResumen(); }, { 'aria-label': `Importe retención ${i + 1}` })),
            h('td', {}, select([['', '—'], ...est.pendientes.map((c) => [c.id, c.numero_formateado])], r.comprobante_venta_id ?? '',
              { 'aria-label': 'Factura de la retención', onchange: (e) => { r.comprobante_venta_id = e.target.value || null; } })),
            h('td', {}, h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.retenciones.splice(i, 1); pintarRet(); pintarResumen(); } }, 'Quitar'))),
          ctl.controlado && !ctl.coincide ? h('tr', {}, h('td', { colspan: 8 }, h('small', { class: 'texto-alerta' }, `⚠ Control: ${ctl.aviso} Se guarda igual lo que dice el certificado.`))) : null];
        })))) : h('p', { class: 'texto-suave' }, 'Sin retenciones. Cargá una por cada certificado de retención que te entregó el cliente.'),
      h('div', { class: 'botones-agregar' }, ['RET_GANANCIAS', 'RET_IVA', 'RET_IIBB_CBA', 'RET_SUSS', 'OTRA'].map((t) => h('button', { class: 'btn btn-chico', type: 'button',
        onclick: () => { est.retenciones.push({ tipo: t, importe: 0, base: 0, fecha: est.fecha, comprobante_venta_id: Object.keys(est.aplic)[0] ?? null }); pintarRet(); } }, `+ ${TIPOS_RETENCION[t]}`))));

    // ---------- Fondo de reparo retenido
    const contratosCliente = () => est.fr.map((x) => [x.contrato_id, x.codigo]);
    const pintarFR = () => vaciar(zonaFR,
      est.fondoReparo.length ? h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['Contrato', 'Factura', 'Importe retenido', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, est.fondoReparo.map((x, i) => h('tr', {},
          h('td', {}, select(contratosCliente(), x.contrato_id, { 'aria-label': 'Contrato', onchange: (e) => { x.contrato_id = e.target.value; } })),
          h('td', {}, select([['', '—'], ...est.pendientes.map((c) => [c.id, c.numero_formateado])], x.comprobante_venta_id ?? '', { 'aria-label': 'Factura', onchange: (e) => { x.comprobante_venta_id = e.target.value || null; } })),
          h('td', {}, filaInput(x.importe, (v) => { x.importe = v; pintarResumen(); }, { 'aria-label': 'Fondo de reparo retenido' }), x.sugerido ? h('small', { class: 'texto-suave' }, ' según certificado') : null),
          h('td', {}, h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.fondoReparo.splice(i, 1); pintarFR(); pintarResumen(); } }, 'Quitar'))))))
        : h('p', { class: 'texto-suave' }, 'El cliente no retuvo fondo de reparo en este pago.'),
      contratosCliente().length ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.fondoReparo.push({ contrato_id: contratosCliente()[0][0], importe: 0 }); pintarFR(); } }, '+ Fondo de reparo retenido') : null);

    // ---------- Devolución de fondo de reparo
    const pintarDev = () => {
      const conSaldo = est.fr.filter((x) => aCentavos(x.saldo) > 0);
      vaciar(zonaDev, conSaldo.length ? h('table', { class: 'tabla' }, h('tbody', {}, conSaldo.map((x) => h('tr', {},
        h('td', {}, x.codigo), h('td', { class: 'texto-suave' }, `Retenido pendiente: ${pesos(x.saldo)}`),
        h('td', {}, filaInput(est.devol[x.contrato_id] ?? 0, (v) => { if (v) est.devol[x.contrato_id] = v; else delete est.devol[x.contrato_id]; pintarResumen(); }, { 'aria-label': `Devolución de fondo de reparo ${x.codigo}` }))))))
        : h('p', { class: 'texto-suave' }, 'El cliente no tiene fondo de reparo retenido para devolver.'));
    };

    // ---------- Resumen
    const datosCobranza = () => ({
      medios: est.medios.filter((m) => m.importe),
      retenciones: est.retenciones,
      fondoReparo: est.fondoReparo.filter((x) => x.importe),
      aplicaciones: Object.entries(est.aplic).map(([comprobante_id, importe]) => ({ comprobante_id, importe })),
      devolucionesFR: Object.entries(est.devol).map(([contrato_id, importe]) => ({ contrato_id, importe })),
    });
    const resumen = () => calcularCobranza(datosCobranza(), {
      saldos: Object.fromEntries(est.pendientes.map((c) => [c.id, aCentavos(c.saldo)])),
      saldosFR: Object.fromEntries(est.fr.map((x) => [x.contrato_id, aCentavos(x.saldo)])),
    });
    const pintarResumen = () => {
      const r = resumen();
      const fila = (k, v, fuerte) => h('tr', {}, h('td', {}, fuerte ? h('strong', {}, k) : k), h('td', { class: 'num' }, fuerte ? h('strong', {}, v) : v));
      vaciar(zonaResumen,
        h('table', { class: 'tabla tabla-totales' }, h('tbody', {},
          fila('Medios de cobro', cent(r.totalMedios)), fila('Retenciones', cent(r.totalRetenciones)), fila('Fondo de reparo retenido', cent(r.totalFondoReparo)),
          fila('Total del recibo', cent(r.total), true),
          fila('Aplicado a facturas', cent(r.totalAplicado)),
          r.totalDevolucionFR ? fila('Devolución de fondo de reparo', cent(r.totalDevolucionFR)) : null,
          fila('Queda a cuenta', cent(r.sinAplicar), r.sinAplicar !== 0))),
        r.errores.length && r.total ? h('div', { class: 'tarjeta tarjeta-error' }, h('ul', {}, r.errores.map((x) => h('li', {}, x)))) : null,
        r.advertencias.length ? h('ul', { class: 'advertencias tarjeta' }, r.advertencias.map((x) => h('li', {}, x))) : null);
    };
    const pintarTodo = () => { pintarPend(); pintarMedios(); pintarRet(); pintarFR(); pintarDev(); pintarResumen(); };

    // ---------- Guardar
    const guardar = async (e) => {
      e.preventDefault();
      const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        if (!est.cliente_id) throw new Error('Elegí el cliente.');
        if (!est.fecha) throw new Error('Falta la fecha.');
        const errs = [];
        for (const m of est.medios) if (m.cuit_librador && !cuitValido(m.cuit_librador)) errs.push(`El CUIT del librador ${m.cuit_librador} no es válido.`);
        for (const r of est.retenciones) if (r.tipo === 'OTRA' && !String(r.descripcion ?? '').trim()) errs.push('Indicá qué retención es la "Otra".');
        const r = resumen();
        if (!r.ok) errs.push(...r.errores);
        if (errs.length) throw new Error(errs.join(' '));
        const d = datosCobranza();
        const id = await ventas.registrarCobranza({
          cliente_id: est.cliente_id, fecha: est.fecha, observacion: fObs.value,
          medios: d.medios.map((m) => ({ medio: m.medio, importe: aTxt(m.importe), banco: m.banco, numero: m.numero, fecha_pago: m.fecha_pago || null,
            librador: m.librador, cuit_librador: m.cuit_librador, referencia: m.referencia })),
          retenciones: d.retenciones.map((x) => ({ tipo: x.tipo, descripcion: x.descripcion, numero_certificado: x.numero_certificado, fecha: x.fecha || est.fecha,
            base: x.base ? aTxt(x.base) : null, alicuota: x.alicuota ?? null, importe: aTxt(x.importe), comprobante_venta_id: x.comprobante_venta_id || null })),
          fondo_reparo: d.fondoReparo.map((x) => ({ contrato_id: x.contrato_id, comprobante_venta_id: x.comprobante_venta_id || null, importe: aTxt(x.importe) })),
          aplicaciones: d.aplicaciones.map((x) => ({ comprobante_id: x.comprobante_id, importe: aTxt(x.importe) })),
          devoluciones_fr: d.devolucionesFR.map((x) => ({ contrato_id: x.contrato_id, importe: aTxt(x.importe) })),
        });
        aviso('Cobranza registrada.');
        location.hash = `#/cobranza/${id}`;
      } catch (err) { error(err.message); } finally { if (btn) btn.disabled = false; }
    };

    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/ventas/cobranzas' }, 'Ventas y cobranzas'), ' › Registrar cobranza'),
      h('div', { class: 'encabezado' }, h('div', {}, h('h1', {}, 'Registrar cobranza'),
        h('p', { class: 'descripcion' }, 'Lo que entró (transferencia, echeq…) más las retenciones y el fondo de reparo que se quedó el cliente cancelan la factura.'))),
      h('form', { onsubmit: guardar },
        h('section', { class: 'tarjeta' }, h('div', { class: 'form-grilla' }, campo('Cliente', fCliente), campo('Fecha de cobro', fFecha))),
        h('section', { class: 'tarjeta' }, h('h2', {}, '1. Facturas que se cobran'), zonaPend),
        h('section', { class: 'tarjeta' }, h('h2', {}, '2. Medios de cobro'), zonaMedios),
        h('section', { class: 'tarjeta' }, h('h2', {}, '3. Retenciones sufridas'),
          h('p', { class: 'campo-ayuda' }, 'Se carga lo que dice cada certificado. El sistema solo avisa si base × alícuota no da el importe. Después adjuntás el certificado escaneado en el recibo.'), zonaRet),
        h('section', { class: 'tarjeta' }, h('h2', {}, '4. Fondo de reparo retenido por el cliente'), zonaFR),
        h('details', { class: 'tarjeta' }, h('summary', {}, h('strong', {}, '5. Devolución de fondo de reparo (solo si el cliente lo está devolviendo)')), zonaDev),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Resumen'), zonaResumen, campo('Observación', fObs),
          h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/ventas/cobranzas' }, 'Cancelar'), h('button', { class: 'btn btn-primario', type: 'submit' }, 'Registrar cobranza')))));
    await cargarCliente();
  });
}

// =====================================================================
// Detalle del recibo
// =====================================================================
export async function pantallaCobranza(cont, ctx, id) {
  const puede = ['administrador', 'contador'].includes(ctx.perfil.rol);
  const subir = puede || ctx.perfil.rol === 'operador';
  await pantalla(cont, async () => {
    const r = await ventas.cobranza(id);
    if (!r) throw new Error('No se encontró la cobranza.');
    const vigente = r.estado === 'registrada';

    const anular = async () => {
      const motivo = await modal({ titulo: `Anular recibo N° ${r.numero}`, peligro: true, aceptar: 'Anular',
        contenido: [h('p', {}, 'Las facturas vuelven a quedar con saldo. Si hubo un error, después la cargás de nuevo.'), campo('Motivo', h('input', { name: 'motivo', required: true }))],
        alAceptar: (form) => form.elements.motivo.value.trim() });
      if (!motivo) return;
      try { await ventas.anularCobranza(id, motivo); aviso('Cobranza anulada.'); await pantallaCobranza(cont, ctx, id); } catch (e) { error(e.message); }
    };
    const editarObs = async () => {
      const ok = await modal({ titulo: 'Observación', contenido: campo('Observación', h('textarea', { name: 'obs', rows: 3 }, r.observacion ?? '')),
        alAceptar: async (form) => { await ventas.actualizarCobranza(id, form.elements.obs.value); } });
      if (ok) { aviso('Guardado.'); await pantallaCobranza(cont, ctx, id); }
    };
    const imprimir = async () => {
      const emp = await empresa.obtener();
      const hoja = h('div', { class: 'solo-impresion' },
        h('div', { class: 'imp-cabecera' },
          h('div', {}, h('strong', {}, emp?.razon_social ?? ''), h('br'), `${emp?.nombre_fantasia ?? ''} · CUIT ${emp?.cuit ? formatearCuit(emp.cuit) : ''}`, h('br'), `${emp?.domicilio ?? ''} · ${emp?.localidad ?? ''}`),
          h('div', { class: 'imp-derecha' }, h('strong', {}, `RECIBO INTERNO N° ${r.numero}`), h('br'), `Fecha ${fechaAR(r.fecha)}`, h('br'), 'Documento no válido como factura')),
        h('p', {}, h('strong', {}, 'Recibimos de: '), r.cliente, r.cliente_cuit ? ` · CUIT ${formatearCuit(r.cliente_cuit)}` : ''),
        h('table', { class: 'tabla' }, h('tbody', {},
          r.medios.map((m) => h('tr', {}, h('td', {}, `${MEDIOS[m.medio]}${m.banco ? ' · ' + m.banco : ''}${m.numero ? ' N° ' + m.numero : ''}${m.fecha_pago ? ' · pago ' + fechaAR(m.fecha_pago) : ''}`), h('td', { class: 'num' }, pesos(m.importe)))),
          r.retenciones.map((x) => h('tr', {}, h('td', {}, `Retención ${TIPOS_RETENCION[x.tipo]} · certificado ${x.numero_certificado}`), h('td', { class: 'num' }, pesos(x.importe)))),
          r.fondoReparo.filter((x) => x.tipo === 'retencion').map((x) => h('tr', {}, h('td', {}, `Fondo de reparo retenido · ${x.contratos?.codigo ?? ''}`), h('td', { class: 'num' }, pesos(x.importe)))),
          h('tr', {}, h('td', {}, h('strong', {}, 'Total')), h('td', { class: 'num' }, h('strong', {}, pesos(r.total)))))),
        r.aplicaciones.length ? [h('h3', {}, 'Aplicado a'), h('table', { class: 'tabla' }, h('tbody', {}, r.aplicaciones.map((a) => h('tr', {},
          h('td', {}, `Comprobante ${a.comprobantes_venta.tipo_codigo} ${String(a.comprobantes_venta.punto_venta).padStart(5, '0')}-${String(a.comprobantes_venta.numero).padStart(8, '0')} del ${fechaAR(a.comprobantes_venta.fecha)}`),
          h('td', { class: 'num' }, pesos(a.importe))))))] : null,
        h('div', { class: 'imp-firmas' }, h('div', {}, h('span', {}, 'Firma y aclaración'))),
        h('p', { class: 'imp-pie' }, `Emitido con el sistema contable MADEWORK el ${new Date().toLocaleString('es-AR')}`));
      document.body.appendChild(hoja);
      document.body.classList.add('imprimiendo');
      const limpiar = () => { hoja.remove(); document.body.classList.remove('imprimiendo'); };
      window.addEventListener('afterprint', limpiar, { once: true });
      window.print();
      setTimeout(limpiar, 1000);
    };

    const tablaSimple = (cab, filas) => h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, cab.map((t) => h('th', {}, t)))), h('tbody', {}, filas)));
    const numComp = (c) => `${String(c.punto_venta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`;

    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/ventas/cobranzas' }, 'Ventas y cobranzas'), ' › ', `Recibo N° ${r.numero}`),
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, `Recibo N° ${r.numero} `, vigente ? etiqueta('Registrada', 'ok') : etiqueta('Anulada', 'neutra')),
          h('p', { class: 'descripcion' }, `${r.cliente} · ${fechaAR(r.fecha)}`),
          !vigente ? h('p', { class: 'nota' }, h('strong', {}, 'Anulada: '), r.motivo ?? '') : null,
          r.observacion ? h('p', { class: 'nota' }, r.observacion) : null),
        h('div', { class: 'acciones acciones-envolver' },
          h('button', { class: 'btn', type: 'button', onclick: imprimir }, 'Imprimir recibo'),
          puede && vigente ? h('button', { class: 'btn', type: 'button', onclick: editarObs }, 'Observación') : null,
          puede && vigente ? h('button', { class: 'btn btn-peligro', type: 'button', onclick: anular }, 'Anular') : null)),
      h('div', { class: 'datos' },
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Medios'), h('div', { class: 'dato-valor' }, pesos(r.importe_medios))),
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Retenciones'), h('div', { class: 'dato-valor' }, pesos(r.importe_retenciones))),
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Fondo de reparo retenido'), h('div', { class: 'dato-valor' }, pesos(r.importe_fondo_reparo))),
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Total del recibo'), h('div', { class: 'dato-valor' }, pesos(r.total)),
          aCentavos(r.a_cuenta) ? h('div', { class: 'dato-detalle' }, `${pesos(r.a_cuenta)} a cuenta`) : null)),
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Medios de cobro'),
        r.medios.length ? tablaSimple(['Medio', 'Banco', 'Número', 'Fecha de pago', 'Librador', 'Importe'], r.medios.map((m) => h('tr', {},
          h('td', {}, MEDIOS[m.medio]), h('td', {}, m.banco ?? ''), h('td', { class: 'mono' }, m.numero ?? ''), h('td', {}, fechaAR(m.fecha_pago)),
          h('td', {}, [m.librador, m.cuit_librador ? formatearCuit(m.cuit_librador) : null].filter(Boolean).join(' · ')), h('td', { class: 'num' }, pesos(m.importe)))))
          : h('p', { class: 'texto-suave' }, 'Sin medios (todo el recibo son retenciones o fondo de reparo).')),
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Retenciones sufridas'),
        r.retenciones.length ? [tablaSimple(['Impuesto', 'Certificado N°', 'Fecha', 'Base', 'Alícuota', 'Importe', 'Factura'], r.retenciones.map((x) => h('tr', {},
          h('td', {}, TIPOS_RETENCION[x.tipo], x.descripcion ? ` (${x.descripcion})` : ''), h('td', { class: 'mono' }, x.numero_certificado), h('td', {}, fechaAR(x.fecha)),
          h('td', { class: 'num' }, pesos(x.base)), h('td', { class: 'num' }, x.alicuota === null ? '—' : `${Number(x.alicuota).toLocaleString('es-AR')} %`),
          h('td', { class: 'num' }, pesos(x.importe)), h('td', { class: 'mono' }, x.comprobante_numero ?? '—')))),
          r.retenciones.map((x) => h('details', { class: 'detalle-adjunto' }, h('summary', {}, `Certificado de ${TIPOS_RETENCION[x.tipo]} N° ${x.numero_certificado}`),
            panelAdjuntos('retenciones_sufridas', x.id, subir)))]
          : h('p', { class: 'texto-suave' }, 'Sin retenciones.')),
      r.fondoReparo.length ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Fondo de reparo'),
        tablaSimple(['Movimiento', 'Contrato', 'Importe'], r.fondoReparo.map((x) => h('tr', {},
          h('td', {}, x.tipo === 'retencion' ? 'Retenido por el cliente' : 'Devuelto por el cliente'),
          h('td', {}, h('a', { href: `#/contrato/${x.contrato_id}` }, x.contratos?.codigo ?? '')), h('td', { class: 'num' }, pesos(x.importe)))))) : null,
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Aplicado a'),
        r.aplicaciones.length ? tablaSimple(['Comprobante', 'Fecha', 'Total', 'Aplicado'], r.aplicaciones.map((a) => h('tr', {},
          h('td', {}, h('a', { href: `#/comprobante/${a.comprobante_id}` }, `${a.comprobantes_venta.letra} ${numComp(a.comprobantes_venta)}`)),
          h('td', {}, fechaAR(a.comprobantes_venta.fecha)), h('td', { class: 'num' }, pesos(a.comprobantes_venta.total)), h('td', { class: 'num' }, pesos(a.importe)))))
          : h('p', { class: 'texto-suave' }, 'No se aplicó a ningún comprobante.')),
      panelAdjuntos('cobranzas', id, subir));
  });
}
