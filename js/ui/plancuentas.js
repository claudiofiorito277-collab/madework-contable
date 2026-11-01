import { h, vaciar, pantalla, campo, select, leerForm, modal, aviso, etiqueta } from './dom.js';
import { encabezado } from './layout.js';
import { planCuentas } from '../data/repos.js';

const RUBROS = [['activo', 'Activo'], ['pasivo', 'Pasivo'], ['patrimonio_neto', 'Patrimonio neto'], ['ingreso', 'Ingreso'], ['egreso', 'Costo / Gasto']];
const NOMBRE_RUBRO = Object.fromEntries(RUBROS);

export async function pantallaPlan(cont, ctx) {
  const puedeEditar = ['administrador', 'contador'].includes(ctx.perfil.rol);
  let filtro = '';
  let verInactivas = false;
  let cuentas = [];
  const cuerpo = h('div');

  const dibujar = () => {
    const f = filtro.toLowerCase();
    const visibles = cuentas.filter((c) => (verInactivas || c.activo) && (!f || c.codigo.startsWith(f) || c.nombre.toLowerCase().includes(f)));
    vaciar(cuerpo, h('div', { class: 'tarjeta' }, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla tabla-plan' },
      h('thead', {}, h('tr', {}, ['Código', 'Cuenta', 'Rubro', 'Tipo', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, visibles.map((c) => h('tr', { class: `${c.imputable ? '' : 'cuenta-madre'} ${c.activo ? '' : 'inactivo'}` },
        h('td', { class: 'mono' }, c.codigo),
        h('td', { style: { paddingLeft: `${(c.nivel - 1) * 18 + 8}px` } }, c.nombre, c.activo ? null : h('span', {}, ' ', etiqueta('Inactiva'))),
        h('td', {}, NOMBRE_RUBRO[c.rubro]),
        h('td', {}, c.imputable ? etiqueta('Imputable', 'ok') : etiqueta('Agrupa')),
        h('td', {}, puedeEditar ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => editar(c) }, 'Editar') : null))))))),
      h('p', { class: 'texto-suave' }, `${visibles.length} cuentas`));
  };

  const cargar = async () => { cuentas = await planCuentas.listar(); dibujar(); };

  const editar = async (c) => {
    const nueva = !c;
    const ok = await modal({
      titulo: nueva ? 'Nueva cuenta' : `Editar ${c.codigo} ${c.nombre}`,
      contenido: [
        campo('Código', h('input', { name: 'codigo', required: true, value: c?.codigo ?? '', pattern: '\\d+(\\.\\d+)*', placeholder: 'Ej.: 5.1.12' }),
          'La cuenta madre se toma del código (5.1.12 cuelga de 5.1).'),
        campo('Nombre', h('input', { name: 'nombre', required: true, value: c?.nombre ?? '' })),
        campo('Rubro', select(RUBROS, c?.rubro ?? 'egreso', { name: 'rubro' }), 'Debe coincidir con el de la cuenta madre.'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'imputable', checked: c ? c.imputable : true }), ' Imputable (recibe asientos)'),
        nueva ? null : h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'activo', checked: c.activo }), ' Activa'),
        campo('Observación', h('input', { name: 'observacion', value: c?.observacion ?? '' })),
      ],
      alAceptar: async (form) => {
        const d = leerForm(form);
        const datos = { codigo: d.codigo, nombre: d.nombre, rubro: d.rubro, imputable: d.imputable, observacion: d.observacion || null };
        if (nueva) await planCuentas.crear(datos);
        else await planCuentas.actualizar(c.id, { ...datos, activo: d.activo });
      },
    });
    if (ok) { aviso(nueva ? 'Cuenta creada.' : 'Cuenta actualizada.'); await cargar(); }
  };

  vaciar(cont,
    encabezado('Plan de cuentas', 'Borrador para una unipersonal Responsable Inscripta de servicios viales. A CONFIRMAR CON CONTADOR.',
      puedeEditar ? h('button', { class: 'btn btn-primario', type: 'button', onclick: () => editar(null) }, '+ Nueva cuenta') : null),
    h('div', { class: 'filtros' },
      h('input', { type: 'search', placeholder: 'Buscar por código o nombre', 'aria-label': 'Buscar cuenta', oninput: (e) => { filtro = e.target.value.trim(); dibujar(); } }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { verInactivas = e.target.checked; dibujar(); } }), ' Ver inactivas')),
    cuerpo);
  await pantalla(cuerpo, cargar);
}
