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
    const [emp, params, perfs] = await Promise.all([
      empresa.obtener(),
      q(sb.from('parametros_fiscales').select('codigo, descripcion').eq('a_confirmar', true).is('vigente_hasta', null)),
      q(sb.from('perfiles').select('email, activo')),
    ]);
    return { empresa: emp, parametrosAConfirmar: params, usuariosInactivos: perfs.filter((p) => !p.activo) };
  },
};
