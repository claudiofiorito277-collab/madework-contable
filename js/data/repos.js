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
    const [emp, params, perfs, contratosV, pols] = await Promise.all([
      empresa.obtener(),
      q(sb.from('parametros_fiscales').select('codigo, descripcion').eq('a_confirmar', true).is('vigente_hasta', null)),
      q(sb.from('perfiles').select('email, activo')),
      q(sb.from('v_contratos').select('id, codigo, descripcion, estado, fecha_fin_prevista, unidades_por_certificar, monto_contractual, certificado_bruto').eq('activo', true)),
      q(sb.from('polizas').select('id, tipo, aseguradora, vigencia_hasta, contrato_id, estado').in('estado', ['vigente', 'solicitada'])),
    ]);
    return { empresa: emp, parametrosAConfirmar: params, usuariosInactivos: perfs.filter((p) => !p.activo), contratos: contratosV, polizas: pols };
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
