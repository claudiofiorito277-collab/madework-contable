import { h, vaciar, pantalla, campo, select, leerForm, modal, aviso, etiqueta } from './dom.js';
import { encabezado } from './layout.js';
import { centrosCosto } from '../data/repos.js';

const TIPOS = [['contrato', 'Contrato'], ['item', 'Ítem de contrato'], ['administracion', 'Administración'], ['equipo', 'Equipo / vehículo'], ['otro', 'Otro']];
const NOMBRE_TIPO = Object.fromEntries(TIPOS);

export async function pantallaCentros(cont, ctx) {
  const puedeEditar = ['administrador', 'contador', 'operador'].includes(ctx.perfil.rol);
  const cuerpo = h('div');

  const cargar = async () => {
    const lista = await centrosCosto.listar();
    vaciar(cuerpo, h('div', { class: 'tarjeta' }, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, ['Código', 'Nombre', 'Tipo', 'Estado', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, lista.map((c) => h('tr', { class: c.activo ? '' : 'inactivo' },
        h('td', { class: 'mono' }, c.codigo), h('td', {}, c.nombre), h('td', {}, NOMBRE_TIPO[c.tipo]),
        h('td', {}, c.activo ? etiqueta('Activo', 'ok') : etiqueta('Inactivo')),
        h('td', {}, puedeEditar ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => editar(c) }, 'Editar') : null))))))));
  };

  const editar = async (c) => {
    const nuevo = !c;
    const ok = await modal({
      titulo: nuevo ? 'Nuevo centro de costo' : `Editar ${c.codigo}`,
      contenido: [
        campo('Código', h('input', { name: 'codigo', required: true, value: c?.codigo ?? '', placeholder: 'Ej.: E55' })),
        campo('Nombre', h('input', { name: 'nombre', required: true, value: c?.nombre ?? '' })),
        campo('Tipo', select(TIPOS, c?.tipo ?? 'contrato', { name: 'tipo' })),
        nuevo ? null : h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'activo', checked: c.activo }), ' Activo'),
        campo('Observación', h('input', { name: 'observacion', value: c?.observacion ?? '' })),
      ],
      alAceptar: async (form) => {
        const d = leerForm(form);
        const datos = { codigo: d.codigo.toUpperCase(), nombre: d.nombre, tipo: d.tipo, observacion: d.observacion || null };
        if (nuevo) await centrosCosto.crear(datos);
        else await centrosCosto.actualizar(c.id, { ...datos, activo: d.activo });
      },
    });
    if (ok) { aviso(nuevo ? 'Centro de costo creado.' : 'Centro de costo actualizado.'); await cargar(); }
  };

  vaciar(cont,
    encabezado('Centros de costo', 'Sirven para imputar ingresos y gastos. En la Etapa 2 se crean solos al cargar contratos e ítems.',
      puedeEditar ? h('button', { class: 'btn btn-primario', type: 'button', onclick: () => editar(null) }, '+ Nuevo centro') : null),
    cuerpo);
  await pantalla(cuerpo, cargar);
}
