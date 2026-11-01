// Comprobantes de venta: detalle y alta (factura desde certificado, factura manual,
// nota de crédito y nota de débito). La factura se emite en ARCA; acá se registra
// con su número y CAE. Los importes los calcula el motor de IVA (js/core/iva.js).
import { h, vaciar, pantalla, campo, select, modal, aviso, error, etiqueta, fechaAR, pesos, cent, hoyISO, leerPesos, confirmar } from './dom.js';
import { ventas, clientes, contratos, certificados, multas, fiscal } from '../data/repos.js';
import { panelAdjuntos } from './adjuntos.js';
import { CLASE_TXT, nombreComprobante, etiquetaComprobante } from './ventas.js';
import { aCentavos } from '../core/redondeo.js';
import { calcularComprobante } from '../core/iva.js';
import { validarNumeracion, caeValido, formatoNumero } from '../core/ventas.js';
import { fechaPago, sumarDias } from '../core/certificados.js';
import { formatearCuit } from '../core/cuit.js';

const ORIGENES = { certificado: 'Certificado', anticipo: 'Anticipo financiero', fondo_reparo: 'Fondo de reparo', multas: 'Multas', manual: 'Manual' };
const aPesosTxt = (c) => (c / 100).toFixed(2);

// =====================================================================
// Detalle
// =====================================================================
export async function pantallaComprobante(cont, ctx, id) {
  const puede = ['administrador', 'contador'].includes(ctx.perfil.rol);
  await pantalla(cont, async () => {
    const c = await ventas.comprobante(id);
    if (!c) throw new Error('No se encontró el comprobante.');
    const [alics, asociados, apl] = await Promise.all([ventas.alicuotas(id), ventas.asociados(id), ventas.aplicacionesDe(id)]);
    const esDeuda = c.clase !== 'nota_credito';
    const vigente = c.estado === 'emitido';

    const completar = async () => {
      const ok = await modal({
        titulo: 'Completar datos del comprobante',
        contenido: [
          h('p', { class: 'texto-suave' }, 'Los importes, el número y el tipo no se modifican. Si están mal, anulá el comprobante y cargalo de nuevo.'),
          h('div', { class: 'form-grilla' },
            campo('CAE', h('input', { name: 'cae', value: c.cae ?? '', inputmode: 'numeric', maxlength: 14, placeholder: '14 dígitos' })),
            campo('Vencimiento del CAE', h('input', { name: 'cae_vencimiento', type: 'date', value: c.cae_vencimiento ?? '' })),
            campo('Vencimiento de pago', h('input', { name: 'vencimiento', type: 'date', value: c.vencimiento ?? '' }))),
          campo('Descripción', h('input', { name: 'descripcion', value: c.descripcion ?? '' })),
          campo('Observación', h('textarea', { name: 'observacion', rows: 2 }, c.observacion ?? '')),
        ],
        alAceptar: async (form) => {
          const e = form.elements;
          const cae = e.cae.value.trim();
          if (cae && !caeValido(cae)) throw new Error('El CAE tiene que tener 14 dígitos.');
          if (cae && !e.cae_vencimiento.value) throw new Error('Cargá el vencimiento del CAE.');
          await ventas.actualizarComprobante(id, { cae, cae_vencimiento: e.cae_vencimiento.value, vencimiento: e.vencimiento.value,
            descripcion: e.descripcion.value, observacion: e.observacion.value });
        },
      });
      if (ok) { aviso('Comprobante actualizado.'); await pantallaComprobante(cont, ctx, id); }
    };

    const anular = async () => {
      const motivo = await modal({
        titulo: `Anular ${nombreComprobante(c)}`, peligro: true, aceptar: 'Anular',
        contenido: [
          h('p', {}, 'Anular sirve para corregir un error de carga en este sistema. Si la factura ya se emitió en ARCA y hay que dejarla sin efecto, lo que corresponde es emitir una nota de crédito.'),
          campo('Motivo', h('input', { name: 'motivo', required: true })),
        ],
        alAceptar: (form) => form.elements.motivo.value.trim(),
      });
      if (!motivo) return;
      try { await ventas.anularComprobante(id, motivo); aviso('Comprobante anulado.'); await pantallaComprobante(cont, ctx, id); } catch (e) { error(e.message); }
    };

    const kv = (k, v) => (v === null || v === undefined || v === '' ? null : h('div', { class: 'kv' }, h('span', {}, k), h('strong', {}, v)));
    const acciones = [];
    if (puede && vigente) {
      acciones.push(h('button', { class: 'btn', type: 'button', onclick: completar }, c.cae ? 'Editar datos' : 'Cargar CAE'));
      if (esDeuda) {
        if (aCentavos(c.saldo) > 0) acciones.push(h('a', { class: 'btn btn-primario', href: `#/nueva-cobranza/${c.cliente_id}` }, 'Registrar cobranza'));
        acciones.push(h('a', { class: 'btn', href: `#/nuevo-comprobante/nc:${c.id}` }, 'Nota de crédito'));
        acciones.push(h('a', { class: 'btn', href: `#/nuevo-comprobante/nd:${c.id}` }, 'Nota de débito'));
      }
      acciones.push(h('button', { class: 'btn btn-peligro', type: 'button', onclick: anular }, 'Anular'));
    }

    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/ventas/comprobantes' }, 'Ventas y cobranzas'), ' › ', nombreComprobante(c)),
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, `${nombreComprobante(c)} `, etiquetaComprobante(c)),
          h('p', { class: 'descripcion' }, `${c.cliente}${c.cliente_cuit ? ` · CUIT ${formatearCuit(c.cliente_cuit)}` : ''} · ${fechaAR(c.fecha)}`),
          c.estado === 'anulado' ? h('p', { class: 'nota' }, h('strong', {}, 'Anulado: '), c.motivo ?? '') : null,
          vigente && !c.cae ? h('p', { class: 'nota' }, 'Falta cargar el CAE que dio ARCA al emitir el comprobante.') : null),
        h('div', { class: 'acciones acciones-envolver' }, acciones)),
      esDeuda && vigente ? h('div', { class: 'datos' },
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Total'), h('div', { class: 'dato-valor' }, pesos(c.total))),
        aCentavos(c.notas_credito) ? h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Notas de crédito'), h('div', { class: 'dato-valor' }, `− ${pesos(c.notas_credito)}`)) : null,
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Cobrado'), h('div', { class: 'dato-valor' }, pesos(c.cobrado)), h('div', { class: 'dato-detalle' }, 'Incluye retenciones y fondo de reparo')),
        h('div', { class: `dato${aCentavos(c.saldo) > 0 ? ' dato-alerta' : ''}` }, h('div', { class: 'dato-titulo' }, 'Saldo'), h('div', { class: 'dato-valor' }, pesos(c.saldo)),
          c.vencimiento ? h('div', { class: 'dato-detalle' }, `Vence ${fechaAR(c.vencimiento)}`) : null)) : null,
      h('div', { class: 'grilla-2' },
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Datos'),
          kv('Tipo', `${c.tipo_descripcion} (código ARCA ${c.tipo_codigo})`),
          kv('Punto de venta y número', c.numero_formateado),
          kv('Fecha', fechaAR(c.fecha)), kv('Vencimiento de pago', c.vencimiento ? fechaAR(c.vencimiento) : null),
          kv('CAE', c.cae), kv('Vencimiento CAE', c.cae_vencimiento ? fechaAR(c.cae_vencimiento) : null),
          kv('Origen', ORIGENES[c.origen]),
          c.contrato_id ? h('div', { class: 'kv' }, h('span', {}, 'Contrato'), h('a', { href: `#/contrato/${c.contrato_id}` }, c.contrato_codigo)) : null,
          c.certificado_id ? h('div', { class: 'kv' }, h('span', {}, 'Certificado'), h('a', { href: `#/certificado/${c.certificado_id}` }, `N° ${c.certificado_numero}`)) : null,
          c.periodo_desde ? kv('Período', `${fechaAR(c.periodo_desde)} al ${fechaAR(c.periodo_hasta)}`) : null,
          c.comprobante_asociado_id ? h('div', { class: 'kv' }, h('span', {}, 'Comprobante asociado'), h('a', { href: `#/comprobante/${c.comprobante_asociado_id}` }, c.asociado_numero)) : null,
          kv('Descripción', c.descripcion), kv('Observación', c.observacion)),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Importes'),
          h('table', { class: 'tabla tabla-totales' }, h('tbody', {},
            alics.map((a) => [
              h('tr', {}, h('td', {}, `Neto gravado ${Number(a.porcentaje).toLocaleString('es-AR')} %`), h('td', { class: 'num' }, pesos(a.neto))),
              h('tr', {}, h('td', {}, `IVA ${Number(a.porcentaje).toLocaleString('es-AR')} %`), h('td', { class: 'num' }, pesos(a.iva)))]),
            aCentavos(c.exento) ? h('tr', {}, h('td', {}, 'Exento'), h('td', { class: 'num' }, pesos(c.exento))) : null,
            aCentavos(c.no_gravado) ? h('tr', {}, h('td', {}, 'No gravado'), h('td', { class: 'num' }, pesos(c.no_gravado))) : null,
            aCentavos(c.otros_tributos) ? h('tr', {}, h('td', {}, `Otros tributos${c.otros_tributos_detalle ? ` (${c.otros_tributos_detalle})` : ''}`), h('td', { class: 'num' }, pesos(c.otros_tributos))) : null,
            h('tr', {}, h('td', {}, h('strong', {}, 'Total')), h('td', { class: 'num' }, h('strong', {}, pesos(c.total)))))))),
      asociados.length ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Notas de crédito y débito asociadas'),
        h('table', { class: 'tabla' }, h('tbody', {}, asociados.map((a) => h('tr', { class: a.estado === 'anulado' ? 'inactivo' : '' },
          h('td', {}, fechaAR(a.fecha)), h('td', {}, h('a', { href: `#/comprobante/${a.id}` }, nombreComprobante(a))), h('td', {}, a.descripcion ?? ''),
          h('td', { class: 'num' }, a.clase === 'nota_credito' ? `− ${pesos(a.total)}` : pesos(a.total)), h('td', {}, etiquetaComprobante(a))))))) : null,
      esDeuda ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Cobranzas aplicadas'),
        apl.length ? h('table', { class: 'tabla' }, h('tbody', {}, apl.map((a) => h('tr', {},
          h('td', {}, fechaAR(a.cobranzas.fecha)), h('td', {}, h('a', { href: `#/cobranza/${a.cobranza_id}` }, `Recibo N° ${a.cobranzas.numero}`)),
          h('td', { class: 'num' }, pesos(a.importe))))))
          : h('p', { class: 'texto-suave' }, 'Todavía no se registraron cobros de este comprobante.')) : null,
      panelAdjuntos('comprobantes_venta', id, puede));
  });
}

// =====================================================================
// Alta: "cert:<id>" | "nc:<id>" | "nd:<id>" | "manual" | "manual:<clienteId>"
// =====================================================================
export async function pantallaNuevoComprobante(cont, ctx, param) {
  if (!['administrador', 'contador'].includes(ctx.perfil.rol)) {
    vaciar(cont, h('div', { class: 'tarjeta tarjeta-error' }, 'Solo el administrador o el contador registran comprobantes de venta.'));
    return;
  }
  const [modo, ref] = String(param ?? 'manual').split(':');
  await pantalla(cont, async () => {
    const [catalogo, clis, todos] = await Promise.all([fiscal.catalogo(), clientes.listar(), ventas.comprobantes()]);
    const hoy = hoyISO();

    // ---- Contexto según el modo
    let cert = null; let contrato = null; let asociado = null; let alicsAsociado = []; let multasPend = [];
    let clase = 'factura';
    if (modo === 'cert') {
      cert = await certificados.obtener(ref);
      if (!cert) throw new Error('No se encontró el certificado.');
      if (cert.estado !== 'aprobado') throw new Error(`El certificado N° ${cert.numero} está "${cert.estado}": solo se factura un certificado aprobado.`);
      contrato = await contratos.obtener(cert.contrato_id);
    } else if (modo === 'nc' || modo === 'nd') {
      clase = modo === 'nc' ? 'nota_credito' : 'nota_debito';
      asociado = await ventas.comprobante(ref);
      if (!asociado) throw new Error('No se encontró el comprobante asociado.');
      alicsAsociado = await ventas.alicuotas(ref);
      if (asociado.contrato_id) {
        contrato = await contratos.obtener(asociado.contrato_id);
        if (modo === 'nc') multasPend = (await multas.listar(asociado.contrato_id)).filter((m) => m.estado === 'aplicada');
      }
    }
    const clienteFijo = cert ? contrato.cliente_id : asociado ? asociado.cliente_id : (ref || null);

    // ---- Opciones
    const tipos = catalogo.tiposComprobante.filter((t) => t.activo !== false && t.clase === clase && ['A', 'B', 'M'].includes(t.letra)
      && (!asociado || t.letra === asociado.letra));
    const alicuotas = [...new Map(catalogo.parametros.filter((p) => p.tipo === 'ALICUOTA_IVA' && p.valor !== null)
      .map((p) => [p.codigo, p.descripcion ?? p.codigo])).entries()];
    const ultimoPV = (() => { try { return localStorage.getItem('mw_pv') ?? ''; } catch { return ''; } })();

    // ---- Estado
    const est = {
      cliente_id: clienteFijo ?? '',
      contrato_id: contrato?.id ?? '',
      tipo_codigo: '',
      lineas: [],
      multasSel: new Set(),
    };
    const cliente = () => clis.find((x) => x.id === est.cliente_id);
    const tipoPorDefecto = () => {
      if (asociado) return tipos[0]?.codigo ?? '';
      const ri = (cliente()?.condicion_iva ?? 'RI') === 'RI';
      return (tipos.find((t) => t.letra === (ri ? 'A' : 'B')) ?? tipos[0])?.codigo ?? '';
    };
    est.tipo_codigo = tipoPorDefecto();
    const alicDefecto = contrato?.alicuota_iva ?? alicsAsociado[0]?.alicuota ?? 'IVA_21';
    if (cert) {
      est.lineas = [{ tratamiento: 'gravado', alicuota: contrato.alicuota_iva ?? 'IVA_21', importe: aCentavos(cert.base_factura) }];
    } else {
      est.lineas = [{ tratamiento: 'gravado', alicuota: alicDefecto, importe: 0 }];
    }
    const bloqueado = !!cert; // los importes del certificado no se tocan acá

    // ---- Controles
    const f = {
      tipo: select(tipos.map((t) => [t.codigo, `${t.descripcion} (${t.codigo})`]), est.tipo_codigo, { name: 'tipo_codigo', required: true }),
      pv: h('input', { name: 'punto_venta', inputmode: 'numeric', required: true, value: ultimoPV, placeholder: 'Ej. 3' }),
      numero: h('input', { name: 'numero', inputmode: 'numeric', required: true }),
      fecha: h('input', { name: 'fecha', type: 'date', required: true, value: [hoy, cert?.fecha_aprobacion, asociado?.fecha].filter(Boolean).sort().pop() }),
      venc: h('input', { name: 'vencimiento', type: 'date' }),
      cae: h('input', { name: 'cae', inputmode: 'numeric', maxlength: 14, placeholder: '14 dígitos' }),
      caeVto: h('input', { name: 'cae_vencimiento', type: 'date' }),
      desde: h('input', { name: 'periodo_desde', type: 'date', value: cert?.periodo_desde ?? '' }),
      hasta: h('input', { name: 'periodo_hasta', type: 'date', value: cert?.periodo_hasta ?? '' }),
      desc: h('input', { name: 'descripcion', value: cert ? `Certificado N° ${cert.numero} · ${contrato.codigo} · período ${fechaAR(cert.periodo_desde)} al ${fechaAR(cert.periodo_hasta)}` : '' }),
      origen: select(Object.entries(ORIGENES).filter(([k]) => k !== 'certificado'), clase === 'nota_credito' ? 'multas' : 'manual', { name: 'origen' }),
      otros: h('input', { name: 'otros_tributos', inputmode: 'decimal', placeholder: '0' }),
      otrosDet: h('input', { name: 'otros_tributos_detalle', placeholder: 'Ej. percepción' }),
      obs: h('textarea', { name: 'observacion', rows: 2 }),
      cliente: select([['', 'Elegí un cliente'], ...clis.filter((x) => x.activo).map((x) => [x.id, x.razon_social])], est.cliente_id, { name: 'cliente_id', required: true, disabled: !!clienteFijo }),
      contrato: select([['', 'Sin contrato']], est.contrato_id, { name: 'contrato_id', disabled: !!cert || !!asociado }),
    };

    const sugerirNumero = () => {
      const pv = Number(f.pv.value);
      if (!pv) return;
      const usados = todos.filter((x) => x.tipo_codigo === f.tipo.value && Number(x.punto_venta) === pv && x.estado === 'emitido').map((x) => Number(x.numero));
      f.numero.placeholder = usados.length ? `Siguiente: ${Math.max(...usados) + 1}` : 'Número de ARCA';
    };
    const sugerirVencimiento = () => {
      if (f.venc.value && f.venc.dataset.manual) return;
      if (contrato && f.fecha.value) f.venc.value = fechaPago(f.fecha.value, contrato.pago_dias ?? 15, contrato.pago_dia_semana ?? 5);
      else if (f.fecha.value && clase !== 'nota_credito') f.venc.value = sumarDias(f.fecha.value, 15);
    };
    f.venc.addEventListener('change', () => { f.venc.dataset.manual = '1'; });
    f.pv.addEventListener('input', sugerirNumero);
    f.tipo.addEventListener('change', () => { est.tipo_codigo = f.tipo.value; sugerirNumero(); recalcular(); });
    f.fecha.addEventListener('change', () => { sugerirVencimiento(); recalcular(); });
    f.cliente.addEventListener('change', async () => {
      est.cliente_id = f.cliente.value;
      const cs = est.cliente_id ? (await contratos.listar()).filter((x) => x.cliente_id === est.cliente_id) : [];
      vaciar(f.contrato, [['', 'Sin contrato'], ...cs.map((x) => [x.id, `${x.codigo} · ${x.descripcion}`])].map(([v, t]) => h('option', { value: v }, t)));
      f.tipo.value = tipoPorDefecto(); est.tipo_codigo = f.tipo.value;
      recalcular();
    });
    if (contrato) vaciar(f.contrato, h('option', { value: contrato.id, selected: true }, `${contrato.codigo} · ${contrato.descripcion}`));
    f.contrato.addEventListener('change', async () => {
      est.contrato_id = f.contrato.value;
      contrato = est.contrato_id ? await contratos.obtener(est.contrato_id) : null;
      sugerirVencimiento();
    });

    // ---- Líneas e importes
    const zonaLineas = h('div');
    const zonaTotales = h('div');
    let calculo = null;
    const tipoActual = () => catalogo.tiposComprobante.find((t) => t.codigo === f.tipo.value);
    const recalcular = () => {
      const tipo = tipoActual();
      const discrimina = tipo?.discrimina_iva !== false;
      calculo = calcularComprobante({
        tipoCodigo: f.tipo.value, condicionEmisor: 'RI', condicionReceptor: cliente()?.condicion_iva ?? 'RI', fecha: f.fecha.value || hoy,
        modo: discrimina ? 'desde_neto' : 'desde_total',
        lineas: est.lineas.map((l) => ({ tratamiento: l.tratamiento, alicuota: l.alicuota, neto: l.importe, total: l.importe })),
      }, catalogo);
      vaciar(zonaLineas, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Tratamiento'), h('th', {}, 'Alícuota'), h('th', { class: 'num' }, discrimina ? 'Neto' : 'Importe (IVA incluido)'), h('th'))),
        h('tbody', {}, est.lineas.map((l, i) => h('tr', {},
          h('td', {}, select([['gravado', 'Gravado'], ['exento', 'Exento'], ['no_gravado', 'No gravado']], l.tratamiento,
            { disabled: bloqueado, 'aria-label': `Tratamiento línea ${i + 1}`, onchange: (e) => { l.tratamiento = e.target.value; recalcular(); } })),
          h('td', {}, l.tratamiento === 'gravado' ? select(alicuotas, l.alicuota, { disabled: bloqueado, 'aria-label': `Alícuota línea ${i + 1}`, onchange: (e) => { l.alicuota = e.target.value; recalcular(); } }) : '—'),
          h('td', { class: 'num' }, h('input', { class: 'input-num', inputmode: 'decimal', value: l.importe ? cent(l.importe).replace('$ ', '') : '', readOnly: bloqueado,
            'aria-label': `Importe línea ${i + 1}`,
            onchange: (e) => { try { l.importe = aCentavos(leerPesos(e.target.value) ?? 0); recalcular(); } catch (err) { error(err.message); } } })),
          h('td', {}, !bloqueado && est.lineas.length > 1 ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.lineas.splice(i, 1); recalcular(); } }, 'Quitar') : null))))),
        !bloqueado ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.lineas.push({ tratamiento: 'gravado', alicuota: alicDefecto, importe: 0 }); recalcular(); } }, '+ Agregar línea') : null);
      const otros = (() => { try { return aCentavos(leerPesos(f.otros.value) ?? 0); } catch { return 0; } })();
      if (!calculo.ok) { vaciar(zonaTotales, h('div', { class: 'tarjeta tarjeta-error' }, h('ul', {}, calculo.errores.map((x) => h('li', {}, x))))); return; }
      const t = calculo.totales;
      const fila = (k, v, fuerte) => h('tr', {}, h('td', {}, fuerte ? h('strong', {}, k) : k), h('td', { class: 'num' }, fuerte ? h('strong', {}, v) : v));
      const avisos = [...calculo.advertencias];
      if (cert && t.iva !== aCentavos(cert.iva)) avisos.push(`El IVA calculado (${cent(t.iva)}) difiere del certificado (${pesos(cert.iva)}). Revisá la alícuota.`);
      if (asociado && clase === 'nota_credito' && t.total + otros > aCentavos(asociado.total) - aCentavos(asociado.notas_credito)) {
        avisos.push(`La nota de crédito supera lo que queda del comprobante (${cent(aCentavos(asociado.total) - aCentavos(asociado.notas_credito))}).`);
      }
      vaciar(zonaTotales,
        avisos.length ? h('ul', { class: 'advertencias tarjeta' }, avisos.map((a) => h('li', {}, a))) : null,
        h('table', { class: 'tabla tabla-totales' }, h('tbody', {},
          Object.entries(t.porAlicuota).map(([cod, a]) => [
            fila(`Neto gravado ${(a.bp / 100).toLocaleString('es-AR')} %`, cent(a.neto)),
            fila(`IVA ${(a.bp / 100).toLocaleString('es-AR')} %${calculo.ivaContenido ? ' (contenido)' : ''}`, cent(a.iva))]),
          t.exento ? fila('Exento', cent(t.exento)) : null,
          t.noGravado ? fila('No gravado', cent(t.noGravado)) : null,
          otros ? fila('Otros tributos', cent(otros)) : null,
          fila('Total', cent(t.total + otros), true))));
    };

    // ---- Multas (solo NC)
    const zonaMultas = multasPend.length ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Multas que descuenta esta nota de crédito'),
      h('p', { class: 'texto-suave' }, 'Al marcarlas se propone el importe como neto. Si la multa lleva IVA o no: A CONFIRMAR CON CONTADOR.'),
      multasPend.map((m) => h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => {
        e.target.checked ? est.multasSel.add(m.id) : est.multasSel.delete(m.id);
        const suma = multasPend.filter((x) => est.multasSel.has(x.id)).reduce((s, x) => s + aCentavos(x.importe), 0);
        est.lineas = [{ tratamiento: 'gravado', alicuota: alicDefecto, importe: suma }];
        f.origen.value = 'multas';
        if (!f.desc.value) f.desc.value = 'Descuento de multas';
        recalcular();
      } }), ` ${fechaAR(m.fecha)} · ${m.referencia ?? m.motivo} · ${pesos(m.importe)}`))) : null;

    // ---- Guardar
    const guardar = async (e) => {
      e.preventDefault();
      const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        const errs = validarNumeracion(f.pv.value, f.numero.value);
        if (!est.cliente_id) errs.push('Elegí el cliente.');
        if (!f.fecha.value) errs.push('Falta la fecha.');
        const cae = f.cae.value.trim();
        if (cae && !caeValido(cae)) errs.push('El CAE tiene que tener 14 dígitos.');
        if (cae && !f.caeVto.value) errs.push('Cargá el vencimiento del CAE.');
        recalcular();
        if (!calculo.ok) errs.push(...calculo.errores);
        else if (calculo.totales.total <= 0) errs.push('El comprobante no tiene importe.');
        const tipo = tipoActual();
        if (['A', 'M'].includes(tipo?.letra) && !cliente()?.cuit) errs.push(`Para un comprobante ${tipo.letra} el cliente tiene que tener CUIT. Cargalo en Clientes > Editar.`);
        if (errs.length) throw new Error(errs.join(' '));
        const t = calculo.totales;
        const otros = aCentavos(leerPesos(f.otros.value) ?? 0);
        const datos = {
          cliente_id: est.cliente_id, contrato_id: (cert ? contrato.id : asociado ? asociado.contrato_id : f.contrato.value) || null,
          certificado_id: cert?.id ?? null, origen: cert ? 'certificado' : f.origen.value,
          tipo_codigo: f.tipo.value, punto_venta: Number(f.pv.value), numero: Number(f.numero.value), fecha: f.fecha.value,
          vencimiento: f.venc.value || null, cae: cae || null, cae_vencimiento: f.caeVto.value || null,
          periodo_desde: f.desde.value || null, periodo_hasta: f.hasta.value || null,
          comprobante_asociado_id: asociado?.id ?? null, descripcion: f.desc.value, observacion: f.obs.value,
          alicuotas: Object.entries(t.porAlicuota).map(([alicuota, a]) => ({ alicuota, neto: aPesosTxt(a.neto), iva: aPesosTxt(a.iva) })),
          exento: aPesosTxt(t.exento + (t.sinDiscriminar ?? 0)), no_gravado: aPesosTxt(t.noGravado),
          otros_tributos: aPesosTxt(otros), otros_tributos_detalle: f.otrosDet.value,
          multas_ids: [...est.multasSel],
        };
        const nuevoId = await ventas.registrarComprobante(datos);
        try { localStorage.setItem('mw_pv', f.pv.value); } catch { /* sin almacenamiento */ }
        aviso(`${CLASE_TXT[clase]} ${formatoNumero(datos.punto_venta, datos.numero)} registrada.`);
        location.hash = `#/comprobante/${nuevoId}`;
      } catch (err) { error(err.message); } finally { if (btn) btn.disabled = false; }
    };

    const titulo = cert ? `Registrar factura del certificado N° ${cert.numero}` : asociado ? `${CLASE_TXT[clase]} sobre ${nombreComprobante(asociado)}` : 'Registrar factura manual';
    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/ventas/comprobantes' }, 'Ventas y cobranzas'), ' › ', titulo),
      h('div', { class: 'encabezado' }, h('div', {}, h('h1', {}, titulo),
        h('p', { class: 'descripcion' }, 'Primero emitís el comprobante en ARCA. Acá cargás el mismo tipo, punto de venta, número y CAE.'))),
      cert ? h('div', { class: 'tarjeta tarjeta-info' }, `${contrato.codigo} · ${contrato.cliente} · Certificado N° ${cert.numero}: neto ${pesos(cert.base_factura)} + IVA ${pesos(cert.iva)} = ${pesos(cert.total_factura)}`,
        aCentavos(cert.fondo_reparo) && !contrato.fr_en_factura ? h('span', {}, ` · El fondo de reparo (${pesos(cert.fondo_reparo)}) no va en la factura: lo retiene el cliente al pagar.`) : null) : null,
      asociado ? h('div', { class: 'tarjeta tarjeta-info' }, `${asociado.cliente} · ${nombreComprobante(asociado)} del ${fechaAR(asociado.fecha)} · Total ${pesos(asociado.total)} · Saldo ${pesos(asociado.saldo)}`) : null,
      h('form', { onsubmit: guardar },
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Comprobante'),
          h('div', { class: 'form-grilla' },
            campo('Cliente', f.cliente, cliente() && !cliente().cuit ? 'Este cliente no tiene CUIT: hace falta para factura A.' : null),
            campo('Contrato', f.contrato),
            campo('Tipo', f.tipo), campo('Punto de venta', f.pv), campo('Número', f.numero),
            campo('Fecha', f.fecha), campo('Vencimiento de pago', f.venc, contrato ? `Según el contrato: ${contrato.pago_dias ?? 15} días, primer viernes.` : null),
            campo('CAE', f.cae, 'Lo podés cargar después.'), campo('Vencimiento del CAE', f.caeVto),
            !cert && !asociado ? campo('Origen', f.origen) : null,
            asociado && clase === 'nota_credito' ? campo('Origen', f.origen) : null,
            campo('Período desde', f.desde), campo('Período hasta', f.hasta)),
          campo('Descripción', f.desc)),
        zonaMultas,
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Importes'),
          bloqueado ? h('p', { class: 'texto-suave' }, 'Los importes vienen del certificado aprobado. Si no coinciden con lo que emitiste en ARCA, revisá el certificado.') : null,
          zonaLineas,
          h('div', { class: 'form-grilla' }, campo('Otros tributos', f.otros), campo('Detalle de otros tributos', f.otrosDet)),
          zonaTotales),
        h('section', { class: 'tarjeta' }, campo('Observación', f.obs),
          h('div', { class: 'acciones' }, h('a', { class: 'btn', href: asociado ? `#/comprobante/${asociado.id}` : '#/ventas/facturar' }, 'Cancelar'),
            h('button', { class: 'btn btn-primario', type: 'submit' }, 'Registrar')))));
    f.otros.addEventListener('change', recalcular);
    if (!clienteFijo && !est.cliente_id) f.cliente.dispatchEvent(new Event('change'));
    sugerirNumero();
    sugerirVencimiento();
    recalcular();
  });
}
