// Tesorería: cajas y cuentas bancarias, movimientos, cartera de cheques,
// conciliación bancaria con extractos y flujo de fondos.
import { h, vaciar, pantalla, campo, select, modal, aviso, error, etiqueta, fechaAR, pesos, cent, hoyISO, leerPesos, cargando } from './dom.js';
import { encabezado } from './layout.js';
import { tesoreria, ventas, compras } from '../data/repos.js';
import { aCentavos } from '../core/redondeo.js';
import {
  TIPOS_CUENTA, CATEGORIAS_MOVIMIENTO, ESTADOS_CHEQUE, accionesCheque, alertasCheques, validarTransferencia,
  partirCSV, detectarSeparador, leerExtracto, sugerirConciliacion, resumenConciliacion, flujoFondos, sumarDias, inicioSemana,
} from '../core/tesoreria.js';

const PESTAÑAS = [['cuentas', 'Cuentas y saldos'], ['movimientos', 'Movimientos'], ['cheques', 'Cheques'], ['conciliacion', 'Conciliación'], ['flujo', 'Flujo de fondos']];
const MANUALES = ['gasto_bancario', 'impuesto_bancario', 'imp_deb_cred', 'aporte', 'retiro', 'ajuste', 'otro'];
const leerCent = (v) => aCentavos(leerPesos(v, { obligatorio: true }));
const tabla = (cab, filas, vacio, pie) => h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
  h('thead', {}, h('tr', {}, cab.map((t) => (Array.isArray(t) ? h('th', { class: t[1] }, t[0]) : h('th', {}, t))))),
  h('tbody', {}, filas.length ? filas : h('tr', {}, h('td', { colspan: cab.length, class: 'texto-suave' }, vacio))), pie ?? null));

export async function pantallaTesoreria(cont, ctx, tabInicial) {
  const puede = ['administrador', 'contador'].includes(ctx.perfil.rol);
  let sel = PESTAÑAS.some(([id]) => id === tabInicial) ? tabInicial : 'cuentas';
  const cuerpo = h('div');
  const barra = h('div', { class: 'pestañas', role: 'tablist' });
  const dibujar = () => pantalla(cuerpo, () => VISTAS[sel](cuerpo, { puede, recargar: dibujar }));
  const pintarBarra = () => vaciar(barra, PESTAÑAS.map(([id, t]) => h('button', {
    type: 'button', role: 'tab', class: `pestaña${sel === id ? ' activa' : ''}`, 'aria-selected': String(sel === id),
    onclick: () => { sel = id; history.replaceState(null, '', `#/tesoreria/${id}`); pintarBarra(); dibujar(); },
  }, t)));
  pintarBarra();
  vaciar(cont, encabezado('Tesorería', 'Cajas, bancos, cheques, conciliación bancaria y flujo de fondos.'), barra, cuerpo);
  await dibujar();
}

// ---------------------------------------------------------------- Ventanas
async function editarCuenta(c) {
  const nueva = !c;
  return modal({
    titulo: nueva ? 'Nueva caja o cuenta bancaria' : `Editar ${c.nombre}`,
    contenido: h('div', { class: 'form-grilla' },
      campo('Nombre', h('input', { name: 'nombre', required: true, value: c?.nombre ?? '', placeholder: 'Ej. Galicia cta. cte. / Caja obra' })),
      campo('Tipo', select(Object.entries(TIPOS_CUENTA), c?.tipo ?? 'banco', { name: 'tipo', disabled: !nueva })),
      campo('Banco', h('input', { name: 'banco', value: c?.banco ?? '' })),
      campo('N° de cuenta', h('input', { name: 'numero_cuenta', value: c?.numero_cuenta ?? '' })),
      campo('CBU', h('input', { name: 'cbu', value: c?.cbu ?? '', inputmode: 'numeric', maxlength: 22 })),
      campo('Alias', h('input', { name: 'alias_cbu', value: c?.alias_cbu ?? '' })),
      campo('Saldo inicial', h('input', { name: 'saldo', value: c ? cent(aCentavos(c.saldo_inicial)).replace('$ ', '') : '0', inputmode: 'decimal', disabled: !nueva && c.ultimo_movimiento })),
      campo('Fecha del saldo inicial', h('input', { name: 'fecha', type: 'date', value: c?.fecha_saldo_inicial ?? '2026-11-01', disabled: !nueva && c.ultimo_movimiento })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'imp', checked: !!c?.aplica_imp_deb_cred }), ' Calcular impuesto a los débitos y créditos (solo bancos)'),
      nueva ? null : h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'activo', checked: c.activo }), ' Activa')),
    alAceptar: async (f) => {
      const e = f.elements;
      const tipo = nueva ? e.tipo.value : c.tipo;
      const cbu = e.cbu.value.replace(/\D/g, '');
      if (tipo === 'caja' && cbu) throw new Error('Una caja no lleva CBU.');
      if (cbu && cbu.length !== 22) throw new Error('El CBU tiene que tener 22 dígitos.');
      const d = { nombre: e.nombre.value.trim(), banco: e.banco.value.trim() || null, numero_cuenta: e.numero_cuenta.value.trim() || null, cbu: cbu || null,
        alias_cbu: e.alias_cbu.value.trim() || null, aplica_imp_deb_cred: tipo === 'banco' && e.imp.checked };
      if (!e.saldo.disabled) { d.saldo_inicial = leerPesos(e.saldo.value) ?? '0'; d.fecha_saldo_inicial = e.fecha.value; }
      if (nueva) await tesoreria.crearCuenta({ ...d, tipo }); else await tesoreria.actualizarCuenta(c.id, { ...d, activo: e.activo.checked });
    },
  });
}

async function nuevoMovimiento(cuentas) {
  return modal({
    titulo: 'Movimiento manual',
    contenido: [h('p', { class: 'texto-suave' }, 'Gastos e impuestos bancarios, aportes o retiros de los socios, ajustes. Las cobranzas, pagos y cheques se registran solos desde sus pantallas.'),
      h('div', { class: 'form-grilla' },
        campo('Cuenta', select(cuentas.filter((c) => c.activo).map((c) => [c.id, c.nombre]), '', { name: 'cuenta' })),
        campo('Fecha', h('input', { type: 'date', name: 'fecha', value: hoyISO(), required: true })),
        campo('Entra o sale', select([['egreso', 'Sale (egreso)'], ['ingreso', 'Entra (ingreso)']], 'egreso', { name: 'tipo' })),
        campo('Concepto', select(MANUALES.map((k) => [k, CATEGORIAS_MOVIMIENTO[k]]), 'gasto_bancario', { name: 'categoria' })),
        campo('Importe', h('input', { name: 'importe', inputmode: 'decimal', required: true })),
        campo('Descripción', h('input', { name: 'descripcion', required: true })))],
    alAceptar: async (f) => {
      const e = f.elements;
      await tesoreria.crearMovimiento({ cuenta_id: e.cuenta.value, fecha: e.fecha.value, tipo: e.tipo.value, categoria: e.categoria.value,
        importe: leerPesos(e.importe.value, { obligatorio: true }), descripcion: e.descripcion.value.trim() });
    },
  });
}

async function nuevaTransferencia(cuentas) {
  const act = cuentas.filter((c) => c.activo);
  return modal({
    titulo: 'Transferencia entre cuentas propias',
    contenido: h('div', { class: 'form-grilla' },
      campo('Desde', select(act.map((c) => [c.id, `${c.nombre} (${pesos(c.saldo)})`]), act[0]?.id, { name: 'origen' })),
      campo('Hacia', select(act.map((c) => [c.id, c.nombre]), act[1]?.id ?? act[0]?.id, { name: 'destino' })),
      campo('Fecha', h('input', { type: 'date', name: 'fecha', value: hoyISO(), required: true })),
      campo('Importe', h('input', { name: 'importe', inputmode: 'decimal', required: true })),
      campo('Descripción', h('input', { name: 'descripcion', placeholder: 'Ej. Extracción para la caja de obra' }))),
    alAceptar: async (f) => {
      const e = f.elements;
      const importe = leerCent(e.importe.value);
      const v = validarTransferencia({ origen: e.origen.value, destino: e.destino.value, importe, fecha: e.fecha.value },
        aCentavos(act.find((c) => c.id === e.origen.value)?.saldo ?? 0));
      if (!v.ok) throw new Error(v.errores.join(' '));
      if (v.advertencias.length) aviso(v.advertencias.join(' '), 'error');
      await tesoreria.transferir({ origen: e.origen.value, destino: e.destino.value, fecha: e.fecha.value, importe: (importe / 100).toFixed(2), descripcion: e.descripcion.value });
    },
  });
}

const VISTAS = {
  // ---------------------------------------------------------------- Cuentas
  async cuentas(cuerpo, { puede, recargar }) {
    const cuentas = await tesoreria.cuentas();
    const act = cuentas.filter((c) => c.activo);
    const total = act.reduce((s, c) => s + aCentavos(c.saldo), 0);
    const accion = (fn, msg) => async () => { if (await fn()) { aviso(msg); await recargar(); } };
    vaciar(cuerpo,
      puede ? h('div', { class: 'acciones', style: { marginBottom: '1rem' } },
        h('button', { class: 'btn', type: 'button', onclick: accion(() => editarCuenta(null), 'Cuenta creada.') }, '+ Nueva caja o cuenta'),
        act.length ? h('button', { class: 'btn', type: 'button', onclick: accion(() => nuevoMovimiento(cuentas), 'Movimiento registrado.') }, '+ Movimiento manual') : null,
        act.length > 1 ? h('button', { class: 'btn btn-primario', type: 'button', onclick: accion(() => nuevaTransferencia(cuentas), 'Transferencia registrada.') }, '+ Transferencia entre cuentas') : null) : null,
      cuentas.length ? null : h('div', { class: 'tarjeta tarjeta-info' }, 'Cargá tus cuentas bancarias y cajas con el saldo al 01/11/2026. Desde ahí las cobranzas y pagos mueven los saldos solos.'),
      cuentas.length ? h('div', { class: 'datos' }, h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Disponible total'), h('div', { class: 'dato-valor' }, cent(total)),
        h('div', { class: 'dato-detalle' }, 'Cajas y bancos, sin cheques en cartera'))) : null,
      h('div', { class: 'grilla-2' }, cuentas.map((c) => h('section', { class: `tarjeta${c.activo ? '' : ' inactivo'}` },
        h('div', { class: 'fila-titulo' }, h('h2', {}, c.nombre), etiqueta(TIPOS_CUENTA[c.tipo], c.tipo === 'banco' ? 'ok' : 'neutra'), c.activo ? null : etiqueta('Inactiva')),
        h('p', { class: 'texto-suave' }, [c.banco, c.numero_cuenta ? `Cta. ${c.numero_cuenta}` : null, c.cbu ? `CBU ${c.cbu}` : null, c.alias_cbu].filter(Boolean).join(' · ') || ' '),
        h('div', { class: 'datos-fila' },
          h('div', {}, h('small', {}, 'Saldo'), h('strong', { class: aCentavos(c.saldo) < 0 ? 'texto-alerta' : '' }, pesos(c.saldo))),
          c.tipo === 'banco' ? h('div', {}, h('small', {}, 'Conciliado con el banco'), h('strong', {}, pesos(c.saldo_conciliado))) : null,
          c.tipo === 'banco' ? h('div', {}, h('small', {}, 'Sin conciliar'), h('strong', {}, String(c.sin_conciliar))) : null),
        h('p', { class: 'texto-suave' }, `Saldo inicial ${pesos(c.saldo_inicial)} al ${fechaAR(c.fecha_saldo_inicial)}${c.aplica_imp_deb_cred ? ' · calcula imp. déb./créd.' : ''}`),
        h('div', { class: 'acciones' },
          h('a', { class: 'btn btn-chico', href: `#/tesoreria/movimientos?cuenta=${c.id}` }, 'Movimientos'),
          puede ? h('button', { class: 'btn btn-chico', type: 'button', onclick: accion(() => editarCuenta(c), 'Cuenta actualizada.') }, 'Editar') : null)))));
  },

  // ---------------------------------------------------------------- Movimientos
  async movimientos(cuerpo, { puede }) {
    const cuentas = await tesoreria.cuentas();
    const pedida = new URLSearchParams(location.hash.split('?')[1] ?? '').get('cuenta');
    const fC = select([['', 'Todas las cuentas'], ...cuentas.map((c) => [c.id, c.nombre])], cuentas.some((c) => c.id === pedida) ? pedida : '', { 'aria-label': 'Cuenta' });
    const fD = h('input', { type: 'date', 'aria-label': 'Desde', value: `${hoyISO().slice(0, 7)}-01` });
    const fH = h('input', { type: 'date', 'aria-label': 'Hasta', value: hoyISO() });
    const fA = h('input', { type: 'checkbox' });
    const zona = h('div');
    const pintar = async () => {
      vaciar(zona, cargando());
      const todos = await tesoreria.movimientos({ cuentaId: fC.value || null });
      const vista = todos.filter((m) => (!fD.value || m.fecha >= fD.value) && (!fH.value || m.fecha <= fH.value) && (fA.checked || m.estado === 'vigente'));
      // Saldo corrido (solo con una cuenta elegida)
      let saldos = null;
      if (fC.value) {
        const c = cuentas.find((x) => x.id === fC.value);
        const orden = todos.filter((m) => m.estado === 'vigente').sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creado_en.localeCompare(b.creado_en));
        let s = aCentavos(c.saldo_inicial);
        saldos = {};
        for (const m of orden) { s += aCentavos(m.importe_con_signo); saldos[m.id] = s; }
      }
      const ing = vista.filter((m) => m.estado === 'vigente' && m.tipo === 'ingreso').reduce((s, m) => s + aCentavos(m.importe), 0);
      const egr = vista.filter((m) => m.estado === 'vigente' && m.tipo === 'egreso').reduce((s, m) => s + aCentavos(m.importe), 0);
      const anular = async (m) => {
        const motivo = await modal({ titulo: 'Anular movimiento', peligro: true, aceptar: 'Anular', contenido: [
          h('p', {}, m.transferencia_id ? 'Se anulan las dos patas de la transferencia.' : `${m.descripcion ?? ''} · ${pesos(m.importe)}`),
          campo('Motivo', h('input', { name: 'm', required: true }))], alAceptar: (f) => f.elements.m.value.trim() });
        if (!motivo) return;
        try { await tesoreria.anularMovimiento(m.id, motivo); aviso('Movimiento anulado.'); await pintar(); } catch (e) { error(e.message); }
      };
      const origen = (m) => (m.recibo ? h('a', { href: `#/cobranza/${m.cobranza_id}` }, `Recibo N° ${m.recibo}`)
        : m.orden_pago ? h('a', { href: `#/pago/${m.pago_id}` }, `OP N° ${m.orden_pago}`) : m.cheque_numero ? `Cheque ${m.cheque_numero}` : '');
      vaciar(zona,
        h('div', { class: 'datos' },
          h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Ingresos'), h('div', { class: 'dato-valor' }, cent(ing))),
          h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Egresos'), h('div', { class: 'dato-valor' }, cent(egr))),
          h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Neto del período'), h('div', { class: 'dato-valor' }, cent(ing - egr)))),
        tabla(['Fecha', !fC.value ? 'Cuenta' : null, 'Concepto', 'Tercero', 'Origen', ['Ingreso', 'num'], ['Egreso', 'num'], saldos ? ['Saldo', 'num'] : null, 'Banco', ''].filter(Boolean),
          vista.map((m) => h('tr', { class: m.estado === 'anulado' ? 'inactivo' : '' },
            h('td', {}, fechaAR(m.fecha)), !fC.value ? h('td', {}, m.cuenta) : null,
            h('td', {}, m.descripcion ?? '', h('br'), h('small', { class: 'texto-suave' }, CATEGORIAS_MOVIMIENTO[m.categoria], m.automatico ? ' · automático' : '', m.estado === 'anulado' ? ` · anulado: ${m.motivo}` : '')),
            h('td', {}, m.tercero ?? ''), h('td', {}, origen(m)),
            h('td', { class: 'num' }, m.tipo === 'ingreso' ? pesos(m.importe) : ''), h('td', { class: 'num' }, m.tipo === 'egreso' ? pesos(m.importe) : ''),
            saldos ? h('td', { class: 'num' }, m.estado === 'vigente' ? h('strong', {}, cent(saldos[m.id])) : '') : null,
            h('td', {}, m.cuenta_tipo === 'banco' ? (m.conciliado ? etiqueta('Conciliado', 'ok') : etiqueta('Pendiente', 'alerta')) : '—'),
            h('td', {}, puede && m.estado === 'vigente' && !m.conciliado && (!m.automatico || m.transferencia_id)
              ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => anular(m) }, 'Anular') : null))),
          'No hay movimientos en ese período.'));
    };
    fC.onchange = pintar; fD.onchange = pintar; fH.onchange = pintar; fA.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Cuenta', fC), campo('Desde', fD), campo('Hasta', fH),
      h('label', { class: 'check' }, fA, ' Ver anulados'), h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir')), zona));
    await pintar();
  },

  // ---------------------------------------------------------------- Cheques
  async cheques(cuerpo, { puede, recargar }) {
    const [todos, cuentas] = await Promise.all([tesoreria.cheques(), tesoreria.cuentas()]);
    const bancos = cuentas.filter((c) => c.tipo === 'banco' && c.activo);
    const hoy = hoyISO();
    const alertas = alertasCheques(todos, hoy);
    const fV = select([['cartera', 'Recibidos en cartera'], ['emitidos', 'Propios a debitar'], ['recibidos', 'Recibidos (todos)'], ['todos', 'Todos']], 'cartera', { 'aria-label': 'Ver' });
    const zona = h('div');
    const fechaYCuenta = (titulo, conCuenta, defCuenta) => modal({ titulo, contenido: h('div', { class: 'form-grilla' },
      campo('Fecha', h('input', { type: 'date', name: 'fecha', value: hoy, required: true })),
      conCuenta ? campo('Cuenta bancaria', select(bancos.map((c) => [c.id, c.nombre]), defCuenta, { name: 'cuenta' })) : null),
    alAceptar: (f) => ({ fecha: f.elements.fecha.value, cuenta: f.elements.cuenta?.value }) });
    const hacer = async (ch, accionC) => {
      try {
        if (accionC === 'depositar') { const r = await fechaYCuenta(`Depositar cheque N° ${ch.numero}`, true); if (!r) return; await tesoreria.depositar(ch.id, r.cuenta, r.fecha); }
        if (accionC === 'acreditar') { const r = await fechaYCuenta(`Acreditación del cheque N° ${ch.numero}`, !ch.cuenta_id, ch.cuenta_id); if (!r) return; await tesoreria.acreditar(ch.id, r.fecha, r.cuenta); }
        if (accionC === 'debitar') { const r = await fechaYCuenta(`Débito del cheque propio N° ${ch.numero}`, false); if (!r) return; await tesoreria.debitar(ch.id, r.fecha); }
        if (accionC === 'rechazar') {
          const r = await modal({ titulo: `Rechazo del cheque N° ${ch.numero}`, peligro: true, aceptar: 'Registrar rechazo', contenido: [
            h('p', {}, ch.tipo === 'recibido'
              ? `La deuda de ${ch.cliente ?? 'el cliente'} se reabre por ${pesos(ch.importe)} en las facturas que había cancelado.${ch.estado === 'cobrado' ? ' Como ya estaba acreditado, se registra el débito en la cuenta.' : ''}`
              : `La deuda con ${ch.proveedor ?? 'el proveedor'} se reabre por ${pesos(ch.importe)}.${ch.estado === 'debitado' ? ' Como ya se había debitado, vuelve la plata a la cuenta.' : ''}`),
            h('div', { class: 'form-grilla' }, campo('Fecha', h('input', { type: 'date', name: 'fecha', value: hoy, required: true })), campo('Motivo', h('input', { name: 'motivo', required: true, placeholder: 'Ej. Sin fondos' })))],
          alAceptar: (f) => ({ fecha: f.elements.fecha.value, motivo: f.elements.motivo.value.trim() }) });
          if (!r) return;
          await tesoreria.rechazar(ch.id, r.fecha, r.motivo);
        }
        aviso('Cheque actualizado.');
        await recargar();
      } catch (e) { error(e.message); }
    };
    const NOMBRE = { depositar: 'Depositar', acreditar: 'Acreditado', debitar: 'Debitado', rechazar: 'Rechazado' };
    const pintar = () => {
      const lista = todos.filter((c) => ({ cartera: c.tipo === 'recibido' && c.estado === 'en_cartera', emitidos: c.tipo === 'emitido' && c.estado === 'emitido',
        recibidos: c.tipo === 'recibido', todos: true })[fV.value]);
      const total = lista.filter((c) => !['anulado', 'rechazado'].includes(c.estado)).reduce((s, c) => s + aCentavos(c.importe), 0);
      vaciar(zona, tabla(['N°', 'Tipo', 'Banco', 'De / para', 'Fecha de pago', ['Importe', 'num'], 'Estado', 'Origen', ''],
        lista.map((c) => {
          const [et, tp] = ESTADOS_CHEQUE[c.estado];
          return h('tr', { class: ['anulado'].includes(c.estado) ? 'inactivo' : '' },
            h('td', { class: 'mono' }, c.numero), h('td', {}, `${c.tipo === 'recibido' ? 'De terceros' : 'Propio'} · ${c.formato === 'echeq' ? 'echeq' : 'físico'}`),
            h('td', {}, c.banco ?? '', c.cuenta ? h('small', { class: 'texto-suave' }, h('br'), c.cuenta) : null),
            h('td', {}, c.tipo === 'recibido' ? [c.librador ?? c.cliente ?? '', c.endosado_a ? h('small', { class: 'texto-suave' }, h('br'), `Endosado a ${c.endosado_a}`) : null] : c.proveedor ?? ''),
            h('td', {}, fechaAR(c.fecha_pago), c.tipo === 'recibido' && c.estado === 'en_cartera' ? h('small', { class: 'texto-suave' }, h('br'), `depositar antes del ${fechaAR(c.vence_para_depositar)}`) : null),
            h('td', { class: 'num' }, pesos(c.importe)), h('td', {}, etiqueta(et, tp), c.estado === 'rechazado' ? h('small', { class: 'texto-suave' }, h('br'), c.motivo) : null),
            h('td', {}, c.recibo ? h('a', { href: `#/cobranza/${c.cobranza_id}` }, `Recibo N° ${c.recibo}`) : c.orden_pago ? h('a', { href: `#/pago/${c.pago_id}` }, `OP N° ${c.orden_pago}`) : ''),
            h('td', {}, puede ? accionesCheque(c).map((a) => h('button', { class: `btn btn-chico${a === 'rechazar' ? ' btn-peligro' : ''}`, type: 'button', onclick: () => hacer(c, a) }, NOMBRE[a])) : null));
        }), 'No hay cheques en esta vista.',
        lista.length ? h('tfoot', {}, h('tr', {}, h('td', { colspan: 5 }, h('strong', {}, `${lista.length} cheque(s)`)), h('td', { class: 'num' }, h('strong', {}, cent(total))), h('td', { colspan: 3 }))) : null));
    };
    fV.onchange = pintar;
    const cartera = todos.filter((c) => c.tipo === 'recibido' && c.estado === 'en_cartera').reduce((s, c) => s + aCentavos(c.importe), 0);
    const aDebitar = todos.filter((c) => c.tipo === 'emitido' && c.estado === 'emitido').reduce((s, c) => s + aCentavos(c.importe), 0);
    vaciar(cuerpo,
      h('div', { class: 'datos' },
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Cheques de terceros en cartera'), h('div', { class: 'dato-valor' }, cent(cartera))),
        h('div', { class: `dato${aDebitar ? ' dato-alerta' : ''}` }, h('div', { class: 'dato-titulo' }, 'Cheques propios a debitar'), h('div', { class: 'dato-valor' }, cent(aDebitar)))),
      alertas.length ? h('section', { class: 'tarjeta tarjeta-alerta' }, h('h2', {}, 'Atención'), h('ul', { class: 'lista-tareas' }, alertas.map((a) =>
        h('li', {}, etiqueta(a.tipo === 'peligro' ? 'Urgente' : 'Aviso', a.tipo), ` Cheque ${a.cheque.tipo === 'recibido' ? 'de terceros' : 'propio'} N° ${a.cheque.numero} (${pesos(a.cheque.importe)}): ${a.texto.replace(/\d{4}-\d{2}-\d{2}/g, (x) => fechaAR(x))}`)))) : null,
      h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Ver', fV)), zona,
        h('p', { class: 'campo-ayuda' }, 'Los cheques se cargan solos desde las cobranzas (recibidos) y los pagos (propios o endosados). Un cheque de terceros vence para depositar a los 30 días de su fecha de pago.')));
    pintar();
  },

  // ---------------------------------------------------------------- Conciliación
  async conciliacion(cuerpo, { puede }) {
    let cuentas = (await tesoreria.cuentas()).filter((c) => c.tipo === 'banco');
    if (!cuentas.length) { vaciar(cuerpo, h('div', { class: 'tarjeta' }, 'Primero cargá una cuenta bancaria en "Cuentas y saldos".')); return; }
    const fC = select(cuentas.map((c) => [c.id, c.nombre]), cuentas[0].id, { 'aria-label': 'Cuenta bancaria' });
    const zImport = h('div'); const zConc = h('div');
    const cuenta = () => cuentas.find((c) => c.id === fC.value);

    // ---- Importar extracto
    const pintarImport = async () => {
      const mapeos = await tesoreria.mapeos();
      const guardado = mapeos.find((m) => m.banco.toLowerCase() === (cuenta().banco ?? cuenta().nombre).toLowerCase())?.config;
      let filas = [];
      let nombreArchivo = '';
      const m = { fila_encabezado: 1, col_fecha: '', col_descripcion: '', col_referencia: '', col_importe: '', col_debito: '', col_credito: '', formato_fecha: 'dmy', decimal: ',', ...(guardado ?? {}) };
      const zPrev = h('div');
      const zMapeo = h('div');
      const inputArchivo = h('input', { type: 'file', accept: '.csv,.txt,.xlsx,.xls', 'aria-label': 'Archivo del extracto' });
      const adivinar = () => {
        const enc = (filas[m.fila_encabezado - 1] ?? []).map((x) => String(x ?? '').toLowerCase());
        const buscar = (...pal) => { const i = enc.findIndex((e) => pal.some((p) => e.includes(p))); return i >= 0 ? filas[m.fila_encabezado - 1][i] : ''; };
        if (!m.col_fecha) m.col_fecha = buscar('fecha');
        if (!m.col_descripcion) m.col_descripcion = buscar('concepto', 'descrip', 'detalle', 'movimiento');
        if (!m.col_referencia) m.col_referencia = buscar('referencia', 'comprobante', 'nro', 'número');
        if (!m.col_debito && !m.col_importe) m.col_debito = buscar('débito', 'debito', 'debe');
        if (!m.col_credito && !m.col_importe) m.col_credito = buscar('crédito', 'credito', 'haber');
        if (!m.col_importe && !m.col_debito) m.col_importe = buscar('importe', 'monto');
      };
      const pintarMapeo = () => {
        if (!filas.length) { vaciar(zMapeo); vaciar(zPrev); return; }
        const enc = filas[m.fila_encabezado - 1] ?? [];
        const opciones = [['', '—'], ...enc.map((x, i) => [String(x || i + 1), `${i + 1}: ${String(x ?? '').slice(0, 30) || '(sin título)'}`])];
        const sel = (k, et) => campo(et, select(opciones, m[k], { 'aria-label': et, onchange: (e) => { m[k] = e.target.value; pintarMapeo(); } }));
        const r = leerExtracto(filas, m);
        vaciar(zMapeo, h('div', { class: 'form-grilla' },
          campo('Fila de títulos', h('input', { type: 'number', min: 1, value: m.fila_encabezado, 'aria-label': 'Fila de títulos', onchange: (e) => { m.fila_encabezado = Number(e.target.value) || 1; pintarMapeo(); } })),
          sel('col_fecha', 'Columna fecha'), sel('col_descripcion', 'Columna descripción'), sel('col_referencia', 'Columna referencia'),
          sel('col_importe', 'Columna importe (con signo)'), sel('col_debito', 'o columna débito'), sel('col_credito', 'y columna crédito'),
          campo('Formato de fecha', select([['dmy', 'día/mes/año'], ['mdy', 'mes/día/año']], m.formato_fecha, { onchange: (e) => { m.formato_fecha = e.target.value; pintarMapeo(); } })),
          campo('Decimales con', select([[',', 'coma (1.234,56)'], ['.', 'punto (1,234.56)']], m.decimal, { onchange: (e) => { m.decimal = e.target.value; pintarMapeo(); } }))));
        const sum = (f) => r.lineas.filter(f).reduce((s, l) => s + l.importe, 0);
        vaciar(zPrev,
          r.errores.length ? h('ul', { class: 'advertencias tarjeta' }, r.errores.slice(0, 6).map((x) => h('li', {}, x)), r.errores.length > 6 ? h('li', {}, `… y ${r.errores.length - 6} más`) : null) : null,
          r.lineas.length ? [h('p', {}, h('strong', {}, `${r.lineas.length} línea(s) leídas`), ` · créditos ${cent(sum((l) => l.importe > 0))} · débitos ${cent(-sum((l) => l.importe < 0))}`),
            tabla(['Fecha', 'Descripción', 'Referencia', ['Importe', 'num']], r.lineas.slice(0, 8).map((l) => h('tr', {}, h('td', {}, fechaAR(l.fecha)), h('td', {}, l.descripcion), h('td', {}, l.referencia), h('td', { class: 'num' }, cent(l.importe)))), ''),
            puede ? h('button', { class: 'btn btn-primario', type: 'button', onclick: async () => {
              try {
                await tesoreria.guardarMapeo(cuenta().banco ?? cuenta().nombre, m);
                const id = await tesoreria.importarExtracto({ cuenta_id: fC.value, archivo: nombreArchivo, lineas: r.lineas.map((l) => ({ ...l, importe: (l.importe / 100).toFixed(2) })) });
                const ex = (await tesoreria.extractos(fC.value)).find((x) => x.id === id);
                aviso(`Extracto importado: ${ex?.lineas ?? r.lineas.length} línea(s)${ex?.repetidas ? `, ${ex.repetidas} repetida(s) salteadas` : ''}. Columnas guardadas para ${cuenta().banco ?? cuenta().nombre}.`);
                filas = []; inputArchivo.value = ''; pintarMapeo(); await pintarConc();
              } catch (e) { error(e.message); }
            } }, `Importar ${r.lineas.length} línea(s)`) : null] : h('p', { class: 'texto-suave' }, 'Indicá qué columna es cada cosa.'));
      };
      inputArchivo.addEventListener('change', async () => {
        const f = inputArchivo.files[0];
        if (!f) return;
        nombreArchivo = f.name;
        try {
          if (/\.xlsx?$/i.test(f.name)) {
            const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
            const libro = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
            filas = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { header: 1, raw: true, defval: '' });
          } else {
            let texto = await f.text();
            if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(await f.arrayBuffer());
            const sep = detectarSeparador(texto);
            filas = texto.split(/\r?\n/).map((l) => partirCSV(l, sep));
          }
          adivinar(); pintarMapeo();
        } catch (e) { error(`No se pudo leer el archivo: ${e.message}`); }
      });
      vaciar(zImport, h('details', { class: 'tarjeta', open: true },
        h('summary', {}, h('strong', {}, 'Importar extracto del banco (CSV o Excel)')),
        h('p', { class: 'texto-suave' }, guardado ? `Se usan las columnas guardadas para ${cuenta().banco ?? cuenta().nombre}.` : 'La primera vez indicás qué columna es cada cosa; queda guardado para este banco.'),
        campo('Archivo', inputArchivo), zMapeo, zPrev));
    };

    // ---- Conciliar
    const pintarConc = async () => {
      vaciar(zConc, cargando());
      const [lineas, movs, ctas] = await Promise.all([tesoreria.lineas(fC.value), tesoreria.movimientos({ cuentaId: fC.value }), tesoreria.cuentas()]);
      cuentas = ctas.filter((c) => c.tipo === 'banco');
      const vig = movs.filter((x) => x.estado === 'vigente');
      const movC = vig.map((x) => ({ ...x, importe: aCentavos(x.importe) }));
      const linC = lineas.map((l) => ({ ...l, importe: aCentavos(l.importe) }));
      const sug = sugerirConciliacion(linC.filter((l) => l.estado === 'pendiente'), movC);
      const movPorId = Object.fromEntries(movC.map((x) => [x.id, x]));
      const linPorId = Object.fromEntries(linC.map((l) => [l.id, l]));
      const saldoSistema = aCentavos(cuenta().saldo_inicial) + movC.reduce((s, x) => s + (x.tipo === 'ingreso' ? x.importe : -x.importe), 0);
      const fSaldo = h('input', { inputmode: 'decimal', placeholder: 'Saldo final del extracto', 'aria-label': 'Saldo según el banco' });
      const zRes = h('div');
      const pintarRes = () => {
        let sb; try { sb = fSaldo.value ? aCentavos(leerPesos(fSaldo.value)) : null; } catch { sb = null; }
        if (sb === null) { vaciar(zRes, h('p', { class: 'texto-suave' }, 'Escribí el saldo final del extracto para ver si la diferencia queda explicada.')); return; }
        const r = resumenConciliacion({ saldoBanco: sb, saldoSistema, lineasPendientes: linC.filter((l) => l.estado === 'pendiente'), movimientosPendientes: movC.filter((x) => !x.conciliado) });
        vaciar(zRes, h('table', { class: 'tabla tabla-totales' }, h('tbody', {},
          h('tr', {}, h('td', {}, 'Saldo según el banco'), h('td', { class: 'num' }, cent(sb))),
          h('tr', {}, h('td', {}, 'Saldo según el sistema'), h('td', { class: 'num' }, cent(saldoSistema))),
          h('tr', {}, h('td', {}, 'Diferencia'), h('td', { class: 'num' }, cent(r.diferencia))),
          h('tr', {}, h('td', {}, 'En el banco y no en el sistema (líneas pendientes)'), h('td', { class: 'num' }, cent(r.enBancoNoEnSistema))),
          h('tr', {}, h('td', {}, 'En el sistema y no en el banco (movimientos sin conciliar)'), h('td', { class: 'num' }, cent(-r.enSistemaNoEnBanco))),
          h('tr', {}, h('td', {}, h('strong', {}, 'Sin explicar')), h('td', { class: 'num' }, h('strong', { class: r.cuadra ? '' : 'texto-alerta' }, r.cuadra ? 'Cuadra ✓' : cent(r.sinExplicar)))))));
      };
      fSaldo.addEventListener('input', pintarRes);
      const ejecutar = async (fn, msg) => { try { await fn(); if (msg) aviso(msg); await pintarConc(); } catch (e) { error(e.message); } };
      const conciliarTodas = () => ejecutar(async () => { for (const p of sug.pares) await tesoreria.conciliar(p.linea_id, p.movimiento_id); }, `${sug.pares.length} movimiento(s) conciliados.`);
      const elegir = async (l) => {
        const cand = movC.filter((x) => !x.conciliado && (x.tipo === 'ingreso' ? x.importe : -x.importe) === l.importe);
        const r = await modal({ titulo: 'Elegir movimiento del sistema', contenido: cand.length
          ? campo('Movimiento', select(cand.map((x) => [x.id, `${fechaAR(x.fecha)} · ${x.descripcion ?? ''} · ${cent(x.importe)}`]), cand[0].id, { name: 'm' }))
          : h('p', {}, 'No hay movimientos sin conciliar por el mismo importe. Si es un gasto o impuesto del banco, cargalo desde la línea.'),
        aceptar: cand.length ? 'Conciliar' : 'Cerrar', alAceptar: (f) => f.elements.m?.value ?? null });
        if (r && r !== true) await ejecutar(() => tesoreria.conciliar(l.id, r), 'Conciliado.');
      };
      const cargar = async (l) => {
        const r = await modal({ titulo: 'Cargar en el sistema desde el extracto', contenido: [
          h('p', {}, `${fechaAR(l.fecha)} · ${l.descripcion ?? ''} · ${cent(l.importe)}`),
          h('div', { class: 'form-grilla' }, campo('Concepto', select(MANUALES.map((k) => [k, CATEGORIAS_MOVIMIENTO[k]]), l.importe < 0 ? 'gasto_bancario' : 'otro', { name: 'c' })),
            campo('Descripción', h('input', { name: 'd', value: l.descripcion ?? '' })))],
        aceptar: 'Cargar y conciliar', alAceptar: (f) => ({ c: f.elements.c.value, d: f.elements.d.value }) });
        if (r) await ejecutar(() => tesoreria.desdeLinea(l.id, r.c, r.d), 'Movimiento cargado y conciliado.');
      };
      const ignorar = async (l) => {
        const motivo = await modal({ titulo: 'Ignorar línea', contenido: campo('Motivo', h('input', { name: 'm', required: true, placeholder: 'Ej. Línea informativa del banco' })), alAceptar: (f) => f.elements.m.value.trim() });
        if (motivo) await ejecutar(() => tesoreria.ignorar(l.id, motivo), 'Línea ignorada.');
      };
      const parDe = Object.fromEntries(sug.pares.map((p) => [p.linea_id, p]));
      const pendientes = linC.filter((l) => l.estado === 'pendiente').sort((a, b) => a.fecha.localeCompare(b.fecha));
      const hechas = linC.filter((l) => l.estado !== 'pendiente');
      const b = (t, fn, cl = 'btn btn-chico') => h('button', { class: cl, type: 'button', onclick: fn }, t);
      vaciar(zConc,
        h('div', { class: 'datos' },
          h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Saldo según el sistema'), h('div', { class: 'dato-valor' }, cent(saldoSistema))),
          h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Conciliado'), h('div', { class: 'dato-valor' }, pesos(cuenta().saldo_conciliado))),
          h('div', { class: `dato${pendientes.length ? ' dato-alerta' : ''}` }, h('div', { class: 'dato-titulo' }, 'Líneas del banco pendientes'), h('div', { class: 'dato-valor' }, String(pendientes.length)))),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Líneas del extracto pendientes'),
          sug.pares.length && puede ? h('div', { class: 'acciones' }, b(`Conciliar las ${sug.pares.length} coincidencias sugeridas`, conciliarTodas, 'btn btn-primario')) : null,
          tabla(['Fecha', 'Descripción', ['Importe', 'num'], 'Coincide con', ''], pendientes.map((l) => {
            const p = parDe[l.id]; const mv = p ? movPorId[p.movimiento_id] : null;
            return h('tr', {}, h('td', {}, fechaAR(l.fecha)), h('td', {}, l.descripcion ?? '', l.referencia ? h('small', { class: 'texto-suave' }, ` · ${l.referencia}`) : null),
              h('td', { class: 'num' }, cent(l.importe)),
              h('td', {}, mv ? [etiqueta('Sugerido', 'ok'), ` ${fechaAR(mv.fecha)} · ${mv.descripcion ?? ''}${p.dias ? ` (${Math.abs(p.dias)} día(s) de diferencia)` : ''}`] : h('span', { class: 'texto-alerta' }, 'Sin coincidencia en el sistema')),
              h('td', {}, puede ? [mv ? b('Conciliar', () => ejecutar(() => tesoreria.conciliar(l.id, mv.id), 'Conciliado.'), 'btn btn-chico btn-primario') : b('Elegir', () => elegir(l)),
                mv ? null : b('Cargar', () => cargar(l)), b('Ignorar', () => ignorar(l))] : null));
          }), 'No hay líneas pendientes. Importá el extracto del banco para conciliar.')),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Movimientos del sistema que el banco todavía no muestra'),
          tabla(['Fecha', 'Descripción', ['Importe', 'num']], sug.movimientosSinPar.sort((a, b2) => a.fecha.localeCompare(b2.fecha)).map((x) => h('tr', {},
            h('td', {}, fechaAR(x.fecha)), h('td', {}, x.descripcion ?? ''), h('td', { class: 'num' }, cent(x.tipo === 'ingreso' ? x.importe : -x.importe)))), 'Todo lo del sistema figura en el banco.'),
          h('p', { class: 'campo-ayuda' }, 'Suelen ser cheques propios todavía no presentados o depósitos en tránsito.')),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Control de saldos'), campo('Saldo final según el extracto', fSaldo), zRes),
        hechas.length ? h('details', { class: 'tarjeta' }, h('summary', {}, h('strong', {}, `Conciliadas e ignoradas (${hechas.length})`)),
          tabla(['Fecha', 'Descripción', ['Importe', 'num'], 'Estado', ''], hechas.map((l) => h('tr', {}, h('td', {}, fechaAR(l.fecha)), h('td', {}, l.descripcion ?? ''),
            h('td', { class: 'num' }, cent(l.importe)), h('td', {}, l.estado === 'conciliado' ? etiqueta('Conciliada', 'ok') : [etiqueta('Ignorada'), ` ${l.motivo}`]),
            h('td', {}, puede ? b('Deshacer', () => ejecutar(() => tesoreria.desconciliar(l.id), 'Listo.')) : null))), '')) : null);
      pintarRes();
    };
    fC.onchange = async () => { await pintarImport(); await pintarConc(); };
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Cuenta bancaria', fC))), puede ? zImport : null, zConc);
    if (puede) await pintarImport();
    await pintarConc();
  },

  // ---------------------------------------------------------------- Flujo de fondos
  async flujo(cuerpo) {
    const hoy = hoyISO();
    const fAg = select([['semana', 'Por semana'], ['mes', 'Por mes']], 'semana', { 'aria-label': 'Agrupar' });
    const fD = h('input', { type: 'date', value: inicioSemana(sumarDias(hoy, -14)), 'aria-label': 'Desde' });
    const fH = h('input', { type: 'date', value: sumarDias(hoy, 70), 'aria-label': 'Hasta' });
    const zona = h('div');
    const [cuentas, movs, cvs, ccs, chs] = await Promise.all([tesoreria.cuentas(), tesoreria.movimientos(), ventas.comprobantes(), compras.comprobantes(), tesoreria.cheques()]);
    const pintar = () => {
      const cobrar = [
        ...cvs.filter((c) => c.estado === 'emitido' && c.clase !== 'nota_credito' && aCentavos(c.saldo) > 0).map((c) => ({ fecha: c.vencimiento ?? c.fecha, importe: aCentavos(c.saldo), origen: 'Facturas a cobrar' })),
        ...chs.filter((c) => c.tipo === 'recibido' && ['en_cartera', 'depositado'].includes(c.estado)).map((c) => ({ fecha: c.fecha_pago, importe: aCentavos(c.importe), origen: 'Cheques en cartera' })),
      ];
      const pagar = [
        ...ccs.filter((c) => c.estado === 'emitido' && c.clase !== 'nota_credito' && aCentavos(c.saldo) > 0).map((c) => ({ fecha: c.vencimiento ?? c.fecha, importe: aCentavos(c.saldo) })),
        ...chs.filter((c) => c.tipo === 'emitido' && c.estado === 'emitido').map((c) => ({ fecha: c.fecha_pago, importe: aCentavos(c.importe) })),
      ];
      const f = flujoFondos({ movimientos: movs.map((m) => ({ ...m, importe: aCentavos(m.importe) })), cobrar, pagar,
        saldoInicial: cuentas.reduce((s, c) => s + aCentavos(c.saldo_inicial), 0) }, { desde: fD.value, hasta: fH.value, hoy, agrupar: fAg.value });
      const etq = (k) => (fAg.value === 'mes' ? new Date(`${k}-01T12:00:00Z`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : `Semana del ${fechaAR(k)}`);
      const max = Math.max(1, ...f.periodos.map((p) => Math.abs(p.saldoProyectado)));
      vaciar(zona,
        h('p', { class: 'texto-suave' }, `Saldo al inicio del período: ${cent(f.saldoInicial)}. Lo real son los movimientos de caja y bancos; lo proyectado suma facturas y cheques por cobrar y resta facturas y cheques propios por pagar, según su vencimiento. Lo atrasado se cuenta en la semana de hoy.`),
        tabla(['Período', ['Ingresos', 'num'], ['Egresos', 'num'], ['Saldo real', 'num'], ['A cobrar', 'num'], ['A pagar', 'num'], ['Saldo proyectado', 'num'], ''],
          f.periodos.map((p) => {
            const pasado = p.clave <= (fAg.value === 'mes' ? hoy.slice(0, 7) : inicioSemana(hoy));
            return h('tr', {}, h('td', {}, etq(p.clave)), h('td', { class: 'num' }, p.ingresos ? cent(p.ingresos) : ''), h('td', { class: 'num' }, p.egresos ? cent(p.egresos) : ''),
              h('td', { class: 'num' }, pasado ? cent(p.saldo) : ''), h('td', { class: 'num' }, p.cobrar ? cent(p.cobrar) : ''), h('td', { class: 'num' }, p.pagar ? cent(p.pagar) : ''),
              h('td', { class: 'num' }, h('strong', { class: p.saldoProyectado < 0 ? 'texto-alerta' : '' }, cent(p.saldoProyectado))),
              h('td', { style: { width: '22%' } }, h('div', { class: 'barra' }, h('div', { class: 'barra-relleno', style: { width: `${Math.round(Math.abs(p.saldoProyectado) / max * 100)}%`, background: p.saldoProyectado < 0 ? '#c0392b' : undefined } }))));
          }), 'Sin datos en el período.'));
    };
    fAg.onchange = pintar; fD.onchange = pintar; fH.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Agrupar', fAg), campo('Desde', fD), campo('Hasta', fH),
      h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir')), zona));
    pintar();
  },
};

