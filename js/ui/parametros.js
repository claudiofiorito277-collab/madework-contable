import { h, vaciar, pantalla, campo, select, leerForm, modal, aviso, error, etiqueta, fechaAR, numeroAR, hoyISO } from './dom.js';
import { encabezado } from './layout.js';
import { fiscal } from '../data/repos.js';
import { buscarVigente } from '../core/vigencia.js';
import { calcularComprobante } from '../core/iva.js';
import { aCentavos, formatear } from '../core/redondeo.js';

const NOMBRE_TIPO = {
  ALICUOTA_IVA: 'Alícuotas de IVA', TOLERANCIA: 'Tolerancias de cuadre', REDONDEO: 'Redondeo',
  IIBB: 'Ingresos Brutos', MUNICIPAL: 'Tasas municipales', BANCARIO: 'Impuestos bancarios',
  RETENCION_SUFRIDA: 'Retenciones sufridas (valores de control)',
};

export async function pantallaParametros(cont, ctx) {
  const puedeEditar = ['administrador', 'contador'].includes(ctx.perfil.rol);
  let pestaña = 'parametros';
  const cuerpo = h('div');
  const tabs = h('div', { class: 'pestañas', role: 'tablist' });

  const dibujarTabs = () => vaciar(tabs, [['parametros', 'Parámetros'], ['tipos', 'Tipos de comprobante'], ['calculadora', 'Calculadora de IVA']]
    .map(([id, t]) => h('button', {
      type: 'button', role: 'tab', class: `pestaña${pestaña === id ? ' activa' : ''}`, 'aria-selected': String(pestaña === id),
      onclick: () => { pestaña = id; dibujarTabs(); mostrar(); },
    }, t)));

  const mostrar = () => pantalla(cuerpo, async () => {
    if (pestaña === 'parametros') await vistaParametros(cuerpo, puedeEditar, mostrar);
    else if (pestaña === 'tipos') await vistaTipos(cuerpo, puedeEditar, mostrar);
    else await vistaCalculadora(cuerpo);
  });

  vaciar(cont,
    encabezado('Parámetros fiscales', puedeEditar
      ? 'Cada cambio crea una nueva vigencia con fecha. El historial no se borra y queda en la auditoría.'
      : 'Solo el administrador o el contador pueden modificar estos valores.'),
    tabs, cuerpo);
  dibujarTabs();
  await mostrar();
}

// ---------------------------------------------------------------- Parámetros
async function vistaParametros(cuerpo, puedeEditar, recargar) {
  const todos = await fiscal.parametros();
  const hoy = hoyISO();
  const grupos = {};
  for (const p of todos) ((grupos[p.tipo] ??= {})[p.codigo] ??= []).push(p);

  vaciar(cuerpo, Object.entries(grupos).map(([tipo, codigos]) => h('section', { class: 'tarjeta' },
    h('h2', {}, NOMBRE_TIPO[tipo] ?? tipo),
    h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, ['Parámetro', 'Valor vigente hoy', 'Desde', 'Hasta', 'Estado', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, Object.entries(codigos).map(([codigo, vigs]) => {
        let actual = null;
        try { actual = buscarVigente(vigs, { codigo, fecha: hoy }); } catch { /* superposición: no debería pasar */ }
        const abierta = vigs.find((v) => v.vigente_hasta === null);
        const ref = actual ?? abierta ?? vigs[vigs.length - 1];
        const historial = h('tr', { class: 'fila-historial', hidden: true }, h('td', { colspan: 6 },
          h('table', { class: 'tabla tabla-interna' },
            h('thead', {}, h('tr', {}, ['Valor', 'Desde', 'Hasta', 'Observación'].map((t) => h('th', {}, t)))),
            h('tbody', {}, vigs.map((v) => h('tr', {},
              h('td', {}, v.valor === null ? '— sin definir —' : `${numeroAR(v.valor)} ${v.unidad}`),
              h('td', {}, fechaAR(v.vigente_desde)), h('td', {}, v.vigente_hasta ? fechaAR(v.vigente_hasta) : 'sin fin'),
              h('td', {}, v.observacion ?? '')))))));
        return [
          h('tr', {},
            h('td', {}, h('strong', {}, ref.descripcion), h('br'), h('small', { class: 'texto-suave' }, codigo)),
            h('td', { class: 'num' }, ref.valor === null ? '—' : `${numeroAR(ref.valor)} ${ref.unidad}`),
            h('td', {}, fechaAR(ref.vigente_desde)),
            h('td', {}, ref.vigente_hasta ? fechaAR(ref.vigente_hasta) : 'sin fin'),
            h('td', {}, ref.a_confirmar ? etiqueta('A confirmar con contador', 'alerta') : etiqueta('Definido', 'ok'),
              vigs.length > 1 ? h('span', {}, ' ', etiqueta(`${vigs.length} vigencias`)) : null),
            h('td', { class: 'acciones-fila' },
              h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { historial.hidden = !historial.hidden; } }, 'Historial'),
              puedeEditar && abierta && abierta.valor === null
                ? h('button', { class: 'btn btn-chico btn-primario', type: 'button', onclick: () => completar(abierta, recargar) }, 'Cargar valor') : null,
              puedeEditar && abierta && abierta.valor !== null
                ? h('button', { class: 'btn btn-chico btn-primario', type: 'button', onclick: () => nuevaVigencia(abierta, recargar) }, 'Nueva vigencia') : null),
          ),
          historial,
        ];
      })),
    )),
  )));
}

async function completar(p, recargar) {
  const ok = await modal({
    titulo: `Cargar valor: ${p.descripcion}`,
    contenido: [
      h('p', {}, `Vigente desde el ${fechaAR(p.vigente_desde)}. Este valor todavía no estaba definido.`),
      campo(`Valor (${p.unidad})`, h('input', { name: 'valor', required: true, inputmode: 'decimal' })),
      campo('Observación', h('input', { name: 'observacion', value: p.observacion ?? '' })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'aConfirmar' }), ' Todavía falta confirmarlo con el contador'),
    ],
    alAceptar: async (form) => {
      const d = leerForm(form);
      const valor = Number(d.valor.replace(',', '.'));
      if (!Number.isFinite(valor) || valor < 0) throw new Error('Ingresá un número válido.');
      await fiscal.completarValor(p.id, { valor, observacion: d.observacion, aConfirmar: d.aConfirmar });
    },
  });
  if (ok) { aviso('Valor guardado.'); recargar(); }
}

async function nuevaVigencia(p, recargar) {
  const mañana = new Date(Date.parse(hoyISO()) + 86400000).toISOString().slice(0, 10);
  const ok = await modal({
    titulo: `Nueva vigencia: ${p.descripcion}`,
    contenido: [
      h('p', {}, `Valor actual: ${numeroAR(p.valor)} ${p.unidad}, desde el ${fechaAR(p.vigente_desde)}. La vigencia actual se cerrará el día anterior a la nueva fecha.`),
      campo(`Nuevo valor (${p.unidad})`, h('input', { name: 'valor', required: true, inputmode: 'decimal' })),
      campo('Vigente desde', h('input', { name: 'desde', type: 'date', required: true, value: mañana })),
      campo('Motivo u observación', h('input', { name: 'observacion', required: true, placeholder: 'Ej.: cambio normativo, indicación del contador' })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'aConfirmar' }), ' Falta confirmarlo con el contador'),
    ],
    alAceptar: async (form) => {
      const d = leerForm(form);
      const valor = Number(d.valor.replace(',', '.'));
      if (!Number.isFinite(valor) || valor < 0) throw new Error('Ingresá un número válido.');
      if (d.desde <= p.vigente_desde) throw new Error(`La fecha debe ser posterior al ${fechaAR(p.vigente_desde)}.`);
      await fiscal.nuevaVigencia({ tipo: p.tipo, codigo: p.codigo, valor, desde: d.desde, observacion: d.observacion, aConfirmar: d.aConfirmar });
    },
  });
  if (ok) { aviso('Nueva vigencia creada.'); recargar(); }
}

// ---------------------------------------------------------------- Tipos de comprobante
async function vistaTipos(cuerpo, puedeEditar, recargar) {
  const tipos = await fiscal.tiposComprobante();
  const si = (b) => (b ? etiqueta('Sí', 'ok') : etiqueta('No'));
  vaciar(cuerpo, h('section', { class: 'tarjeta' },
    h('p', { class: 'descripcion' }, 'Estas marcas deciden si un comprobante discrimina IVA y si genera crédito fiscal. Códigos ARCA de referencia: verificar con el contador.'),
    h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, ['Código', 'Comprobante', 'Discrimina IVA', 'Crédito fiscal', 'Observación', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, tipos.map((t) => h('tr', { class: t.activo ? '' : 'inactivo' },
        h('td', {}, t.codigo), h('td', {}, t.descripcion), h('td', {}, si(t.discrimina_iva)), h('td', {}, si(t.genera_credito_fiscal)),
        h('td', {}, t.observacion ?? ''),
        h('td', {}, puedeEditar ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => editarTipo(t, recargar) }, 'Editar') : null))))))));
}

async function editarTipo(t, recargar) {
  const ok = await modal({
    titulo: `Editar ${t.descripcion}`,
    contenido: [
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'discrimina_iva', checked: t.discrimina_iva }), ' Discrimina IVA'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'genera_credito_fiscal', checked: t.genera_credito_fiscal }), ' Genera crédito fiscal (requiere que discrimine IVA)'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'activo', checked: t.activo }), ' Activo'),
      campo('Observación', h('input', { name: 'observacion', value: t.observacion ?? '' })),
    ],
    alAceptar: async (form) => {
      const d = leerForm(form);
      if (d.genera_credito_fiscal && !d.discrimina_iva) throw new Error('Un comprobante que no discrimina IVA no puede generar crédito fiscal.');
      await fiscal.actualizarTipo(t.codigo, { discrimina_iva: d.discrimina_iva, genera_credito_fiscal: d.genera_credito_fiscal, activo: d.activo, observacion: d.observacion || null });
    },
  });
  if (ok) { aviso('Tipo de comprobante actualizado.'); recargar(); }
}

// ---------------------------------------------------------------- Calculadora
async function vistaCalculadora(cuerpo) {
  const catalogo = await fiscal.catalogo();
  const alicuotas = [...new Set(catalogo.parametros.filter((p) => p.tipo === 'ALICUOTA_IVA').map((p) => p.codigo))];
  const condiciones = [['RI', 'Responsable Inscripto'], ['MT', 'Monotributista'], ['EX', 'Exento'], ['CF', 'Consumidor Final']];
  const resultado = h('div', { class: 'resultado-calc' });
  const lineas = h('div', { class: 'lineas-calc' });
  const modoSel = select([['desde_neto', 'Cargo el neto'], ['desde_total', 'Cargo el total con IVA'], ['manual', 'Cargo neto e IVA a mano']], 'desde_neto', { name: 'modo' });

  const nuevaLinea = () => {
    const iva = h('input', { name: 'iva', placeholder: 'IVA', inputmode: 'decimal', class: 'solo-manual' });
    const fila = h('div', { class: 'linea-calc' },
      select([['gravado', 'Gravado'], ['exento', 'Exento'], ['no_gravado', 'No gravado']], 'gravado', { name: 'tratamiento' }),
      select(alicuotas.map((a) => [a, a.replace('IVA_', '').replace('_', ',') + '%']), 'IVA_21', { name: 'alicuota' }),
      h('input', { name: 'importe', placeholder: 'Importe', inputmode: 'decimal', required: true }),
      iva,
      h('button', { class: 'btn btn-chico', type: 'button', 'aria-label': 'Quitar línea', onclick: () => fila.remove() }, '✕'));
    lineas.appendChild(fila);
  };

  const form = h('form', {
    class: 'tarjeta form-grilla',
    onsubmit: (e) => {
      e.preventDefault();
      const d = leerForm(form);
      try {
        const ls = [...lineas.querySelectorAll('.linea-calc')].map((f) => {
          const g = (n) => f.querySelector(`[name="${n}"]`).value;
          const imp = aCentavos(g('importe'));
          return { tratamiento: g('tratamiento'), alicuota: g('alicuota'),
            neto: d.modo === 'desde_total' ? undefined : imp, total: d.modo === 'desde_total' ? imp : imp,
            iva: d.modo === 'manual' ? aCentavos(g('iva')) : undefined };
        });
        mostrarResultado(resultado, calcularComprobante({ tipoCodigo: d.tipo, condicionEmisor: d.emisor, condicionReceptor: d.receptor, fecha: d.fecha, modo: d.modo, lineas: ls }, catalogo));
      } catch (err) { error(err.message); }
    },
  },
    campo('Tipo de comprobante', select(catalogo.tiposComprobante.filter((t) => t.activo).map((t) => [t.codigo, `${t.codigo} · ${t.descripcion}`]), '1', { name: 'tipo' })),
    campo('Fecha', h('input', { type: 'date', name: 'fecha', value: hoyISO(), required: true })),
    campo('Condición del emisor', select(condiciones, 'RI', { name: 'emisor' })),
    campo('Condición del receptor', select(condiciones, 'RI', { name: 'receptor' })),
    campo('Forma de carga', modoSel),
    h('div', { class: 'campo-ancho' }, h('span', { class: 'campo-etiqueta' }, 'Líneas'), lineas,
      h('button', { class: 'btn btn-chico', type: 'button', onclick: nuevaLinea }, '+ Agregar línea')),
    h('div', { class: 'campo-ancho' }, h('button', { class: 'btn btn-primario', type: 'submit' }, 'Calcular')),
  );
  const actualizarModo = () => form.classList.toggle('modo-manual', modoSel.value === 'manual');
  modoSel.addEventListener('change', actualizarModo);
  nuevaLinea();
  actualizarModo();

  vaciar(cuerpo,
    h('p', { class: 'descripcion' }, 'Sirve para probar el motor de IVA con los parámetros vigentes. No guarda nada.'),
    h('div', { class: 'grilla-2' }, form, resultado));
}

function mostrarResultado(cont, r) {
  if (!r.ok) {
    vaciar(cont, h('div', { class: 'tarjeta tarjeta-error' }, h('h2', {}, 'No se puede calcular'), h('ul', {}, r.errores.map((e) => h('li', {}, e)))));
    return;
  }
  const t = r.totales;
  const fila = (k, v, fuerte) => h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, fuerte ? h('strong', {}, formatear(v)) : formatear(v)));
  vaciar(cont, h('div', { class: 'tarjeta' },
    h('h2', {}, 'Resultado'),
    h('table', { class: 'tabla' }, h('tbody', {},
      t.netoGravado ? fila('Neto gravado', t.netoGravado) : null,
      Object.entries(t.porAlicuota).map(([a, v]) => fila(`IVA ${(v.bp / 100).toLocaleString('es-AR')}%${r.discriminaIva ? '' : ' (contenido, no discriminado)'}`, v.iva)),
      t.exento ? fila('Exento', t.exento) : null,
      t.noGravado ? fila('No gravado', t.noGravado) : null,
      t.sinDiscriminar ? fila('Importe sin IVA discriminado', t.sinDiscriminar) : null,
      fila(r.signo < 0 ? 'Total (nota de crédito: resta)' : 'Total', t.total, true),
      fila('Crédito fiscal computable', r.creditoFiscal, true))),
    h('p', {}, r.generaCreditoFiscal ? etiqueta('Genera crédito fiscal', 'ok') : etiqueta('No genera crédito fiscal', 'alerta'), ' ', r.motivoCreditoFiscal),
    r.advertencias.length ? h('ul', { class: 'advertencias' }, r.advertencias.map((a) => h('li', {}, a))) : null));
}
