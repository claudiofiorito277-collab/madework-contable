import { h, vaciar, pantalla, campo, select, leerForm, modal, aviso, etiqueta } from './dom.js';
import { encabezado } from './layout.js';
import { proveedores, fiscal } from '../data/repos.js';
import { cuitValido, limpiarCuit, formatearCuit } from '../core/cuit.js';
import { CATEGORIAS_PROVEEDOR } from '../core/compras.js';

/**
 * Ventana de alta o edición de proveedor. Devuelve el proveedor guardado o null.
 * La usa también la carga de facturas ("+ Nuevo proveedor").
 */
export async function editarProveedor(p, condiciones) {
  const nuevo = !p;
  let guardado = null;
  const ok = await modal({
    titulo: nuevo ? 'Nuevo proveedor' : `Editar ${p.razon_social}`,
    contenido: h('div', { class: 'form-grilla' },
      campo('Razón social', h('input', { name: 'razon_social', required: true, value: p?.razon_social ?? '' })),
      campo('CUIT', h('input', { name: 'cuit', value: p?.cuit ? formatearCuit(p.cuit) : '', placeholder: '30-12345678-9', inputmode: 'numeric' }), 'Se valida el dígito verificador.'),
      campo('Condición frente al IVA', select(condiciones.map((x) => [x.codigo, x.descripcion]), p?.condicion_iva ?? 'RI', { name: 'condicion_iva' })),
      campo('Rubro', select(Object.entries(CATEGORIAS_PROVEEDOR), p?.categoria ?? 'materiales', { name: 'categoria' })),
      campo('Domicilio', h('input', { name: 'domicilio', value: p?.domicilio ?? '' })),
      campo('Localidad', h('input', { name: 'localidad', value: p?.localidad ?? '' })),
      campo('Contacto', h('input', { name: 'contacto', value: p?.contacto ?? '' })),
      campo('Teléfono', h('input', { name: 'telefono', value: p?.telefono ?? '' })),
      campo('Correo', h('input', { name: 'email', type: 'email', value: p?.email ?? '' })),
      campo('Banco', h('input', { name: 'banco', value: p?.banco ?? '' })),
      campo('CBU', h('input', { name: 'cbu', value: p?.cbu ?? '', inputmode: 'numeric', maxlength: 26, placeholder: '22 dígitos' })),
      campo('Alias', h('input', { name: 'alias_cbu', value: p?.alias_cbu ?? '' })),
      campo('Titular de la cuenta', h('input', { name: 'titular_cuenta', value: p?.titular_cuenta ?? '' })),
      nuevo ? null : h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'activo', checked: p.activo }), ' Activo')),
    alAceptar: async (form) => {
      const d = leerForm(form);
      if (d.cuit && !cuitValido(d.cuit)) throw new Error('El CUIT no es válido: revisá el dígito verificador.');
      const cbu = d.cbu.replace(/\D/g, '');
      if (cbu && cbu.length !== 22) throw new Error('El CBU tiene que tener 22 dígitos.');
      if (d.condicion_iva === 'RI' && !d.cuit) throw new Error('Un Responsable Inscripto tiene que tener CUIT.');
      const datos = { razon_social: d.razon_social, cuit: d.cuit ? limpiarCuit(d.cuit) : null, condicion_iva: d.condicion_iva, categoria: d.categoria,
        domicilio: d.domicilio || null, localidad: d.localidad || null, contacto: d.contacto || null, telefono: d.telefono || null, email: d.email || null,
        banco: d.banco || null, cbu: cbu || null, alias_cbu: d.alias_cbu || null, titular_cuenta: d.titular_cuenta || null };
      [guardado] = nuevo ? await proveedores.crear(datos) : await proveedores.actualizar(p.id, { ...datos, activo: d.activo });
    },
  });
  return ok ? guardado : null;
}

export async function pantallaProveedores(cont, ctx) {
  const puedeEditar = ['administrador', 'contador'].includes(ctx.perfil.rol);
  const puedeCrear = puedeEditar || ctx.perfil.rol === 'operador';
  const cuerpo = h('div');
  let condiciones = [];
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por nombre o CUIT', 'aria-label': 'Buscar proveedor' });
  let lista = [];

  const pintar = () => {
    const t = buscar.value.trim().toLowerCase();
    const filas = lista.filter((p) => !t || p.razon_social.toLowerCase().includes(t) || (p.cuit ?? '').includes(t.replace(/\D/g, '') || '~'));
    vaciar(cuerpo, h('div', { class: 'tarjeta' }, h('div', { class: 'filtros' }, buscar), h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, ['Razón social', 'CUIT', 'Condición IVA', 'Rubro', 'Banco / CBU', 'Contacto', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, filas.length ? filas.map((p) => h('tr', { class: p.activo ? '' : 'inactivo' },
        h('td', {}, h('strong', {}, p.razon_social), p.activo ? null : h('span', {}, ' ', etiqueta('Inactivo'))),
        h('td', { class: 'mono' }, p.cuit ? formatearCuit(p.cuit) : etiqueta('Sin CUIT', 'alerta')),
        h('td', {}, condiciones.find((x) => x.codigo === p.condicion_iva)?.descripcion ?? p.condicion_iva),
        h('td', {}, CATEGORIAS_PROVEEDOR[p.categoria] ?? p.categoria),
        h('td', {}, [p.banco, p.cbu ? h('span', { class: 'mono' }, p.cbu) : null, p.alias_cbu].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))),
        h('td', {}, [p.contacto, p.telefono].filter(Boolean).join(' · ')),
        h('td', {}, h('a', { class: 'btn btn-chico', href: `#/compras/cuenta?proveedor=${p.id}` }, 'Cuenta'),
          puedeEditar ? h('button', { class: 'btn btn-chico', type: 'button', onclick: async () => { if (await editarProveedor(p, condiciones)) { aviso('Proveedor actualizado.'); await cargar(); } } }, 'Editar') : null)))
        : h('tr', {}, h('td', { colspan: 7, class: 'texto-suave' }, lista.length ? 'Ningún proveedor coincide.' : 'Todavía no hay proveedores.')))))));
  };
  const cargar = async () => { lista = await proveedores.listar(); pintar(); };
  buscar.addEventListener('input', pintar);

  vaciar(cont,
    encabezado('Proveedores', 'Corralones, pinturerías, combustible, alquiler de equipos, subcontratistas y servicios.',
      puedeCrear ? h('button', { class: 'btn btn-primario', type: 'button', onclick: async () => { if (await editarProveedor(null, condiciones)) { aviso('Proveedor creado.'); await cargar(); } } }, '+ Nuevo proveedor') : null),
    cuerpo);
  await pantalla(cuerpo, async () => { condiciones = await fiscal.condicionesIva(); await cargar(); });
}
