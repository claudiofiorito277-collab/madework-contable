import { h, vaciar, pantalla, campo, select, leerForm, aviso, error } from './dom.js';
import { encabezado } from './layout.js';
import { empresa } from '../data/repos.js';
import { cuitValido, limpiarCuit, formatearCuit } from '../core/cuit.js';

const IIBB = [['local_cordoba', 'Contribuyente local Córdoba'], ['convenio_multilateral', 'Convenio Multilateral'], ['exento', 'Exento'], ['no_inscripto', 'No inscripto']];

export async function pantallaEmpresa(cont, ctx) {
  await pantalla(cont, async () => {
    const e = await empresa.obtener();
    const editable = ctx.perfil.rol === 'administrador';
    const inp = (name, props = {}) => h('input', { name, value: e[name] ?? '', disabled: !editable, ...props });

    const form = h('form', {
      class: 'tarjeta form-grilla',
      onsubmit: async (ev) => {
        ev.preventDefault();
        const d = leerForm(form);
        if (d.cuit && !cuitValido(d.cuit)) return error('El CUIT no es válido: revisá el dígito verificador.');
        if (!d.razon_social) return error('La razón social es obligatoria.');
        try {
          await empresa.actualizar({
            razon_social: d.razon_social, nombre_fantasia: d.nombre_fantasia || 'MADEWORK',
            cuit: d.cuit ? limpiarCuit(d.cuit) : null, iibb_condicion: d.iibb_condicion,
            iibb_numero: d.iibb_numero || null, domicilio: d.domicilio || null, localidad: d.localidad || null,
            provincia: d.provincia || null, codigo_postal: d.codigo_postal || null, email: d.email || null,
            telefono: d.telefono || null, inicio_actividades: d.inicio_actividades || null,
            cierre_ejercicio_mes: Number(d.cierre_ejercicio_mes), cierre_ejercicio_dia: Number(d.cierre_ejercicio_dia),
            observaciones: d.observaciones || null,
          });
          aviso('Datos de la empresa guardados.');
        } catch (err) { error(err.message); }
      },
    },
      campo('Razón social / titular', inp('razon_social', { required: true })),
      campo('Nombre de fantasía', inp('nombre_fantasia')),
      campo('CUIT', inp('cuit', { value: e.cuit ? formatearCuit(e.cuit) : '', placeholder: '20-12345678-9', inputmode: 'numeric' }), 'Se valida el dígito verificador.'),
      campo('Condición frente al IVA', h('input', { value: 'Responsable Inscripto', disabled: true })),
      campo('Ingresos Brutos', select(IIBB, e.iibb_condicion, { name: 'iibb_condicion', disabled: !editable })),
      campo('N° de Ingresos Brutos', inp('iibb_numero')),
      campo('Domicilio fiscal', inp('domicilio')),
      campo('Localidad', inp('localidad')),
      campo('Provincia', inp('provincia')),
      campo('Código postal', inp('codigo_postal')),
      campo('Correo', inp('email', { type: 'email' })),
      campo('Teléfono', inp('telefono')),
      campo('Inicio de actividades', inp('inicio_actividades', { type: 'date' })),
      campo('Inicio del sistema', h('input', { value: (e.fecha_inicio_sistema ?? '').split('-').reverse().join('/'), disabled: true }), 'Fecha desde la que se registran operaciones.'),
      campo('Cierre de ejercicio: mes', inp('cierre_ejercicio_mes', { type: 'number', min: 1, max: 12 })),
      campo('Cierre de ejercicio: día', inp('cierre_ejercicio_dia', { type: 'number', min: 1, max: 31 }), 'A CONFIRMAR CON CONTADOR'),
      h('label', { class: 'campo campo-ancho' }, h('span', { class: 'campo-etiqueta' }, 'Observaciones'),
        h('textarea', { name: 'observaciones', rows: 3, disabled: !editable, text: e.observaciones ?? '' })),
      editable ? h('div', { class: 'campo-ancho' }, h('button', { class: 'btn btn-primario', type: 'submit' }, 'Guardar cambios')) : null,
    );

    vaciar(cont,
      encabezado('Empresa', editable ? 'Datos fiscales de MADEWORK. Los cambios quedan en la auditoría.' : 'Solo el administrador puede modificar estos datos.'),
      form);
  });
}
