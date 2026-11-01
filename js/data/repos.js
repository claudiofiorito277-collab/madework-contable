// Consultas por módulo. Toda la seguridad real está en la base (RLS y funciones):
// acá solo se piden y se guardan datos.
import { sb, q, qActualizar } from './supabase.js';

// ---------- Sesión ----------
export const sesion = {
  async actual() { return (await sb.auth.getSession()).data.session; },
  async entrar(email, password) { return q(sb.auth.signInWithPassword({ email, password })); },
  async salir() { await sb.auth.signOut(); },
  async cambiarClave(password) { return q(sb.auth.updateUser({ password })); },
  alCambiar(fn) { return sb.auth.onAuthStateChange((_ev, s) => fn(s)); },
};

// ---------- Perfiles ----------
export const perfiles = {
  async mio(userId) { return q(sb.from('perfiles').select('*').eq('id', userId).maybeSingle()); },
  async listar() { return q(sb.from('perfiles').select('*').order('email')); },
  async actualizar(id, cambios) {
    return qActualizar(sb.from('perfiles').update(cambios).eq('id', id).select());
  },
};

// ---------- Empresa ----------
export const empresa = {
  async obtener() { return q(sb.from('empresa').select('*').eq('id', 1).maybeSingle()); },
  async actualizar(cambios) { return qActualizar(sb.from('empresa').update(cambios).eq('id', 1).select()); },
};

// ---------- Configuración fiscal ----------
export const fiscal = {
  async parametros() {
    return q(sb.from('parametros_fiscales').select('*').order('tipo').order('codigo').order('vigente_desde'));
  },
  async tiposComprobante() { return q(sb.from('tipos_comprobante').select('*').order('letra').order('codigo')); },
  async condicionesIva() { return q(sb.from('condiciones_iva').select('*').order('codigo')); },
  async nuevaVigencia({ tipo, codigo, valor, desde, observacion, aConfirmar }) {
    return q(sb.rpc('fn_nueva_vigencia', {
      p_tipo: tipo, p_codigo: codigo, p_valor: valor, p_desde: desde,
      p_observacion: observacion || null, p_a_confirmar: !!aConfirmar,
    }));
  },
  async completarValor(id, { valor, observacion, aConfirmar }) {
    return qActualizar(sb.from('parametros_fiscales')
      .update({ valor, observacion: observacion || null, a_confirmar: !!aConfirmar }).eq('id', id).select());
  },
  async actualizarTipo(codigo, cambios) {
    return qActualizar(sb.from('tipos_comprobante').update(cambios).eq('codigo', codigo).select());
  },
  /** Catálogo en el formato que usa el motor de IVA (js/core/iva.js). */
  async catalogo() {
    const [parametros, tiposComprobante] = await Promise.all([this.parametros(), this.tiposComprobante()]);
    return { parametros, tiposComprobante };
  },
};

// ---------- Plan de cuentas ----------
export const planCuentas = {
  async listar() { return q(sb.from('plan_cuentas').select('*').order('codigo')); },
  async crear(c) { return q(sb.from('plan_cuentas').insert(c).select()); },
  async actualizar(id, cambios) { return qActualizar(sb.from('plan_cuentas').update(cambios).eq('id', id).select()); },
};

// ---------- Centros de costo ----------
export const centrosCosto = {
  async listar() { return q(sb.from('centros_costo').select('*').order('codigo')); },
  async crear(c) { return q(sb.from('centros_costo').insert(c).select()); },
  async actualizar(id, cambios) { return qActualizar(sb.from('centros_costo').update(cambios).eq('id', id).select()); },
};

// ---------- Auditoría ----------
export const auditoria = {
  async listar({ tabla, accion, desde, hasta, pagina = 0, porPagina = 50 } = {}) {
    let c = sb.from('auditoria').select('*', { count: 'exact' }).order('fecha', { ascending: false });
    if (tabla) c = c.eq('tabla', tabla);
    if (accion) c = c.eq('accion', accion);
    if (desde) c = c.gte('fecha', `${desde}T00:00:00-03:00`);
    if (hasta) c = c.lte('fecha', `${hasta}T23:59:59-03:00`);
    const { data, error, count } = await c.range(pagina * porPagina, pagina * porPagina + porPagina - 1);
    if (error) throw new Error(error.message);
    return { filas: data, total: count };
  },
};

// ---------- Panel de inicio ----------
export const resumen = {
  async pendientes() {
    const [emp, params, perfs, contratosV, pols, porFacturar, comprobantes, compras] = await Promise.all([
      empresa.obtener(),
      q(sb.from('parametros_fiscales').select('codigo, descripcion').eq('a_confirmar', true).is('vigente_hasta', null)),
      q(sb.from('perfiles').select('email, activo')),
      q(sb.from('v_contratos').select('id, codigo, descripcion, estado, fecha_fin_prevista, unidades_por_certificar, monto_contractual, certificado_bruto').eq('activo', true)),
      q(sb.from('polizas').select('id, tipo, aseguradora, vigencia_hasta, contrato_id, estado').in('estado', ['vigente', 'solicitada'])),
      q(sb.from('certificados').select('id, numero, contrato_id').eq('estado', 'aprobado')),
      q(sb.from('v_comprobantes_venta').select('id, clase, cae, saldo, vencimiento, numero_formateado, cliente').eq('estado', 'emitido')),
      q(sb.from('v_comprobantes_compra').select('id, clase, revisado, saldo, vencimiento, numero_formateado, proveedor').eq('estado', 'emitido')),
    ]);
    return { empresa: emp, parametrosAConfirmar: params, usuariosInactivos: perfs.filter((p) => !p.activo), contratos: contratosV, polizas: pols,
      porFacturar, comprobantes, compras };
  },
};

// ---------- Clientes ----------
export const clientes = {
  async listar() { return q(sb.from('clientes').select('*').order('razon_social')); },
  async crear(c) { return q(sb.from('clientes').insert(c).select()); },
  async actualizar(id, cambios) { return qActualizar(sb.from('clientes').update(cambios).eq('id', id).select()); },
};

// ---------- Contratos ----------
export const contratos = {
  async listar() { return q(sb.from('v_contratos').select('*').order('creado_en', { ascending: false })); },
  async obtener(id) { return q(sb.from('v_contratos').select('*').eq('id', id).maybeSingle()); },
  async crear(c) { return q(sb.from('contratos').insert(c).select()); },
  async actualizar(id, cambios) { return qActualizar(sb.from('contratos').update(cambios).eq('id', id).select()); },
  async items(contratoId) { return q(sb.from('contrato_items').select('*').eq('contrato_id', contratoId).order('orden').order('codigo')); },
  async crearItem(i) { return q(sb.from('contrato_items').insert(i).select()); },
  async actualizarItem(id, cambios) { return qActualizar(sb.from('contrato_items').update(cambios).eq('id', id).select()); },
  async tramos(contratoId) { return q(sb.from('contrato_tramos').select('*').eq('contrato_id', contratoId).order('orden')); },
  async crearTramo(t) { return q(sb.from('contrato_tramos').insert(t).select()); },
  async actualizarTramo(id, cambios) { return qActualizar(sb.from('contrato_tramos').update(cambios).eq('id', id).select()); },
  async redeterminaciones(contratoId) {
    return q(sb.from('redeterminaciones').select('*, redeterminacion_precios(*)').eq('contrato_id', contratoId).order('numero'));
  },
  async crearRedeterminacion(r, precios = []) {
    const [nueva] = await q(sb.from('redeterminaciones').insert(r).select());
    if (precios.length) await q(sb.from('redeterminacion_precios').insert(precios.map((p) => ({ ...p, redeterminacion_id: nueva.id }))));
    return nueva;
  },
  async actualizarRedeterminacion(id, cambios) { return qActualizar(sb.from('redeterminaciones').update(cambios).eq('id', id).select()); },
};

// ---------- Avance (planilla de columnas) ----------
export const avance = {
  async listar(contratoId) {
    return q(sb.from('avance_unidades').select('*').eq('contrato_id', contratoId).order('identificador'));
  },
  async crear(filas) { return q(sb.from('avance_unidades').insert(filas).select()); },
  async actualizar(id, cambios) { return qActualizar(sb.from('avance_unidades').update(cambios).eq('id', id).select()); },
  async actualizarVarios(ids, cambios) {
    if (!ids.length) return [];
    return q(sb.from('avance_unidades').update(cambios).in('id', ids).select());
  },
};

// ---------- Certificados ----------
export const certificados = {
  async listar(contratoId) {
    return q(sb.from('certificados').select('*, certificado_items(*)').eq('contrato_id', contratoId).order('numero', { ascending: false }));
  },
  async obtener(id) { return q(sb.from('certificados').select('*, certificado_items(*)').eq('id', id).maybeSingle()); },
  async crear(c) { return q(sb.from('certificados').insert(c).select()); },
  async actualizar(id, cambios) { return qActualizar(sb.from('certificados').update(cambios).eq('id', id).select()); },
  /** Reemplaza los ítems de un certificado en borrador y guarda los totales. */
  async guardarBorrador(id, items, totales) {
    await q(sb.from('certificado_items').delete().eq('certificado_id', id));
    if (items.length) await q(sb.from('certificado_items').insert(items.map((i) => ({ ...i, certificado_id: id }))));
    return qActualizar(sb.from('certificados').update(totales).eq('id', id).select());
  },
};

// ---------- Multas ----------
export const multas = {
  async listar(contratoId) { return q(sb.from('multas').select('*').eq('contrato_id', contratoId).order('fecha', { ascending: false })); },
  async crear(m) { return q(sb.from('multas').insert(m).select()); },
  async actualizar(id, cambios) { return qActualizar(sb.from('multas').update(cambios).eq('id', id).select()); },
};

// ---------- Pólizas ----------
export const polizas = {
  async listar(contratoId) {
    let c = sb.from('polizas').select('*').order('vigencia_hasta', { ascending: true });
    if (contratoId) c = c.or(`contrato_id.eq.${contratoId},contrato_id.is.null`);
    return q(c);
  },
  async crear(p) { return q(sb.from('polizas').insert(p).select()); },
  async actualizar(id, cambios) { return qActualizar(sb.from('polizas').update(cambios).eq('id', id).select()); },
};

// ---------- Adjuntos (Supabase Storage) ----------
export const adjuntos = {
  async listar(tabla, registroId) {
    return q(sb.from('adjuntos').select('*').eq('tabla', tabla).eq('registro_id', registroId).order('creado_en', { ascending: false }));
  },
  async subir(tabla, registroId, archivo, descripcion) {
    if (archivo.size > 20 * 1024 * 1024) throw new Error('El archivo supera los 20 MB.');
    const limpio = archivo.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_');
    const ruta = `${tabla}/${registroId}/${Date.now()}_${limpio}`;
    const { error } = await sb.storage.from('adjuntos').upload(ruta, archivo, { contentType: archivo.type || undefined });
    if (error) throw new Error(error.message);
    return q(sb.from('adjuntos').insert({ tabla, registro_id: registroId, nombre: archivo.name, ruta, tipo_mime: archivo.type, tamano: archivo.size, descripcion: descripcion || null }).select());
  },
  async urlTemporal(ruta) {
    const { data, error } = await sb.storage.from('adjuntos').createSignedUrl(ruta, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
};

// ---------- Ventas y cobranzas (Etapa 3) ----------
// Altas, anulaciones y cambios pasan por funciones de la base: cada operación se
// guarda completa o no se guarda.
export const ventas = {
  async comprobantes({ clienteId, contratoId, desde, hasta } = {}) {
    let c = sb.from('v_comprobantes_venta').select('*').order('fecha', { ascending: false }).order('numero', { ascending: false });
    if (clienteId) c = c.eq('cliente_id', clienteId);
    if (contratoId) c = c.eq('contrato_id', contratoId);
    if (desde) c = c.gte('fecha', desde);
    if (hasta) c = c.lte('fecha', hasta);
    return q(c);
  },
  async comprobante(id) { return q(sb.from('v_comprobantes_venta').select('*').eq('id', id).maybeSingle()); },
  async alicuotas(id) { return q(sb.from('comprobante_venta_alicuotas').select('*').eq('comprobante_id', id).order('alicuota')); },
  async asociados(id) { return q(sb.from('v_comprobantes_venta').select('*').eq('comprobante_asociado_id', id).order('fecha')); },
  async registrarComprobante(datos) { return q(sb.rpc('fn_registrar_comprobante_venta', { p: datos })); },
  async actualizarComprobante(id, cambios) { return q(sb.rpc('fn_actualizar_comprobante_venta', { p_id: id, p: cambios })); },
  async anularComprobante(id, motivo) { return q(sb.rpc('fn_anular_comprobante_venta', { p_id: id, p_motivo: motivo })); },

  /** Certificados aprobados que todavía no tienen factura. */
  async certificadosPorFacturar() {
    return q(sb.from('certificados').select('*, contratos(id, codigo, descripcion, cliente_id, alicuota_iva, clientes(razon_social))')
      .eq('estado', 'aprobado').order('fecha_aprobacion', { ascending: true }));
  },

  async cobranzas({ clienteId } = {}) {
    let c = sb.from('v_cobranzas').select('*').order('numero', { ascending: false });
    if (clienteId) c = c.eq('cliente_id', clienteId);
    return q(c);
  },
  async cobranza(id) {
    const [cab, medios, rets, apl, fr] = await Promise.all([
      q(sb.from('v_cobranzas').select('*').eq('id', id).maybeSingle()),
      q(sb.from('cobranza_medios').select('*').eq('cobranza_id', id)),
      q(sb.from('v_retenciones_sufridas').select('*').eq('cobranza_id', id)),
      q(sb.from('aplicaciones_cobro').select('*, comprobantes_venta(id, tipo_codigo, punto_venta, numero, fecha, total, letra, clase)').eq('cobranza_id', id)),
      q(sb.from('fondo_reparo_movimientos').select('*, contratos(codigo, descripcion)').eq('cobranza_id', id)),
    ]);
    return cab ? { ...cab, medios, retenciones: rets, aplicaciones: apl, fondoReparo: fr } : null;
  },
  /** Aplicaciones de cobranzas vigentes a un comprobante. */
  async aplicacionesDe(comprobanteId) {
    return q(sb.from('aplicaciones_cobro').select('*, cobranzas!inner(id, numero, fecha, estado)')
      .eq('comprobante_id', comprobanteId).eq('cobranzas.estado', 'registrada'));
  },
  async registrarCobranza(datos) { return q(sb.rpc('fn_registrar_cobranza', { p: datos })); },
  async anularCobranza(id, motivo) { return q(sb.rpc('fn_anular_cobranza', { p_id: id, p_motivo: motivo })); },
  async actualizarCobranza(id, observacion) { return q(sb.rpc('fn_actualizar_cobranza', { p_id: id, p_observacion: observacion })); },

  async fondoReparo() { return q(sb.from('v_fondo_reparo').select('*').order('codigo')); },
  async movimientosFondoReparo(contratoId) {
    return q(sb.from('fondo_reparo_movimientos').select('*, cobranzas!inner(numero, fecha, estado)')
      .eq('contrato_id', contratoId).eq('cobranzas.estado', 'registrada'));
  },
  async retenciones({ desde, hasta, tipo } = {}) {
    let c = sb.from('v_retenciones_sufridas').select('*').eq('estado_cobranza', 'registrada').order('fecha', { ascending: false });
    if (desde) c = c.gte('fecha', desde);
    if (hasta) c = c.lte('fecha', hasta);
    if (tipo) c = c.eq('tipo', tipo);
    return q(c);
  },
};

// ---------- Compras y pagos (Etapa 4) ----------
export const proveedores = {
  async listar() { return q(sb.from('proveedores').select('*').order('razon_social')); },
  async crear(p) { return q(sb.from('proveedores').insert(p).select()); },
  async actualizar(id, cambios) { return qActualizar(sb.from('proveedores').update(cambios).eq('id', id).select()); },
};

export const compras = {
  async comprobantes({ proveedorId } = {}) {
    let c = sb.from('v_comprobantes_compra').select('*').order('fecha', { ascending: false }).order('numero', { ascending: false });
    if (proveedorId) c = c.eq('proveedor_id', proveedorId);
    return q(c);
  },
  async comprobante(id) { return q(sb.from('v_comprobantes_compra').select('*').eq('id', id).maybeSingle()); },
  async detalle(id) {
    const [alicuotas, percepciones, imputaciones, asociados, pagos] = await Promise.all([
      q(sb.from('comprobante_compra_alicuotas').select('*').eq('comprobante_id', id)),
      q(sb.from('comprobante_compra_percepciones').select('*').eq('comprobante_id', id)),
      q(sb.from('v_costos_imputados').select('*').eq('comprobante_id', id)),
      q(sb.from('v_comprobantes_compra').select('*').eq('comprobante_asociado_id', id).order('fecha')),
      q(sb.from('pago_aplicaciones').select('*, pagos!inner(id, numero, fecha, estado)').eq('comprobante_id', id).eq('pagos.estado', 'registrado')),
    ]);
    return { alicuotas, percepciones, imputaciones, asociados, pagos };
  },
  async registrar(datos) { return q(sb.rpc('fn_registrar_comprobante_compra', { p: datos })); },
  async actualizar(id, cambios) { return q(sb.rpc('fn_actualizar_comprobante_compra', { p_id: id, p: cambios })); },
  async anular(id, motivo) { return q(sb.rpc('fn_anular_comprobante_compra', { p_id: id, p_motivo: motivo })); },

  async pagos({ proveedorId } = {}) {
    let c = sb.from('v_pagos').select('*').order('numero', { ascending: false });
    if (proveedorId) c = c.eq('proveedor_id', proveedorId);
    return q(c);
  },
  async pago(id) {
    const [cab, medios, retenciones, aplicaciones] = await Promise.all([
      q(sb.from('v_pagos').select('*').eq('id', id).maybeSingle()),
      q(sb.from('pago_medios').select('*').eq('pago_id', id)),
      q(sb.from('retenciones_practicadas').select('*').eq('pago_id', id)),
      q(sb.from('pago_aplicaciones').select('*, comprobantes_compra(id, tipo_codigo, letra, punto_venta, numero, fecha, total)').eq('pago_id', id)),
    ]);
    return cab ? { ...cab, medios, retenciones, aplicaciones } : null;
  },
  async registrarPago(datos) { return q(sb.rpc('fn_registrar_pago', { p: datos })); },
  async anularPago(id, motivo) { return q(sb.rpc('fn_anular_pago', { p_id: id, p_motivo: motivo })); },
  async actualizarPago(id, observacion) { return q(sb.rpc('fn_actualizar_pago', { p_id: id, p_observacion: observacion })); },

  async ordenes() { return q(sb.from('ordenes_compra').select('*, proveedores(razon_social), contratos(codigo)').order('numero', { ascending: false })); },
  async crearOrden(o) { return q(sb.from('ordenes_compra').insert(o).select()); },
  async actualizarOrden(id, cambios) { return qActualizar(sb.from('ordenes_compra').update(cambios).eq('id', id).select()); },
};
