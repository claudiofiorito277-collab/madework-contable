import { h, vaciar, pantalla, campo, select, leerForm, modal, aviso, etiqueta } from './dom.js';
import { encabezado } from './layout.js';
import { clientes, fiscal } from '../data/repos.js';
import { cuitValido, limpiarCuit, formatearCuit } from '../core/cuit.js';

export async function pantallaClientes(cont, ctx) {
  const puedeEditar = ['administrador', 'contador'].includes(ctx.perfil.rol);
  const cuerpo = h('div');
  let condiciones = [];

  const cargar = async () => {
    const lista = await clientes.listar();
    vaciar(cuerpo, h('div', { class: 'tarjeta' }, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, ['Razón social', 'CUIT', 'Condición IVA', 'Contacto', 'Estado', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, lista.length ? lista.map((c) => h('tr', { class: c.activo ? '' : 'inactivo' },
        h('td', {}, h('strong', {}, c.razon_social)), h('td', { class: 'mono' }, c.cuit ? formatearCuit(c.cuit) : etiqueta('Falta CUIT', 'alerta')),
        h('td', {}, condiciones.find((x) => x.codigo === c.condicion_iva)?.descripcion ?? c.condicion_iva),
        h('td', {}, [c.contacto, c.email, c.telefono].filter(Boolean).join(' · ')),
        h('td', {}, c.activo ? etiqueta('Activo', 'ok') : etiqueta('Inactivo')),
        h('td', {}, puedeEditar ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => editar(c) }, 'Editar') : null)))
        : h('tr', {}, h('td', { colspan: 6 }, 'Todavía no hay clientes.')))))));
  };

  const editar = async (c) => {
    const nuevo = !c;
    const ok = await modal({
      titulo: nuevo ? 'Nuevo cliente' : `Editar ${c.razon_social}`,
      contenido: [
        campo('Razón social', h('input', { name: 'razon_social', required: true, value: c?.razon_social ?? '' })),
        campo('CUIT', h('input', { name: 'cuit', value: c?.cuit ? formatearCuit(c.cuit) : '', placeholder: '30-12345678-9', inputmode: 'numeric' }), 'Se valida el dígito verificador.'),
        campo('Condición frente al IVA', select(condiciones.map((x) => [x.codigo, x.descripcion]), c?.condicion_iva ?? 'RI', { name: 'condicion_iva' })),
        campo('Domicilio', h('input', { name: 'domicilio', value: c?.domicilio ?? '' })),
        campo('Localidad', h('input', { name: 'localidad', value: c?.localidad ?? '' })),
        campo('Contacto', h('input', { name: 'contacto', value: c?.contacto ?? '' })),
        campo('Correo', h('input', { name: 'email', type: 'email', value: c?.email ?? '' })),
        campo('Teléfono', h('input', { name: 'telefono', value: c?.telefono ?? '' })),
        nuevo ? null : h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'activo', checked: c.activo }), ' Activo'),
      ],
      alAceptar: async (form) => {
        const d = leerForm(form);
        if (d.cuit && !cuitValido(d.cuit)) throw new Error('El CUIT no es válido: revisá el dígito verificador.');
        const datos = { razon_social: d.razon_social, cuit: d.cuit ? limpiarCuit(d.cuit) : null, condicion_iva: d.condicion_iva,
          domicilio: d.domicilio || null, localidad: d.localidad || null, contacto: d.contacto || null, email: d.email || null, telefono: d.telefono || null };
        if (nuevo) await clientes.crear(datos); else await clientes.actualizar(c.id, { ...datos, activo: d.activo });
      },
    });
    if (ok) { aviso(nuevo ? 'Cliente creado.' : 'Cliente actualizado.'); await cargar(); }
  };

  vaciar(cont,
    encabezado('Clientes', 'Organismos, concesionarias y empresas a las que se factura.',
      puedeEditar ? h('button', { class: 'btn btn-primario', type: 'button', onclick: () => editar(null) }, '+ Nuevo cliente') : null),
    cuerpo);
  await pantalla(cuerpo, async () => { condiciones = await fiscal.condicionesIva(); await cargar(); });
}
