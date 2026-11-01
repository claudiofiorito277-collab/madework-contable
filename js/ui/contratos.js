import { h, vaciar, pantalla, campo, select, leerForm, modal, aviso, etiqueta, pesos, barra, fechaAR, hoyISO } from './dom.js';
import { encabezado } from './layout.js';
import { contratos, clientes } from '../data/repos.js';
import { diasEntre } from '../core/certificados.js';

export const ESTADOS_CONTRATO = {
  en_oferta: ['En oferta', 'neutra'], adjudicado: ['Adjudicado', 'alerta'], en_ejecucion: ['En ejecución', 'ok'],
  suspendido: ['Suspendido', 'peligro'], recepcion_provisoria: ['Recepción provisoria', 'ok'],
  finalizado: ['Finalizado', 'neutra'], rescindido: ['Rescindido', 'peligro'],
};
export const TIPOS_TRABAJO = [['pintura_columnas', 'Pintura de columnas'], ['bacheo', 'Bacheo'], ['reparacion_calzada', 'Reparación de calzada'],
  ['senalizacion', 'Señalización'], ['mantenimiento', 'Mantenimiento'], ['otro', 'Otro']];

export async function pantallaContratos(cont, ctx) {
  const puedeEditar = ['administrador', 'contador'].includes(ctx.perfil.rol);
  const cuerpo = h('div');

  const cargar = async () => {
    const lista = await contratos.listar();
    if (!lista.length) {
      vaciar(cuerpo, h('div', { class: 'tarjeta' }, h('p', {}, 'Todavía no hay contratos.'),
        puedeEditar ? h('p', { class: 'texto-suave' }, 'Primero cargá el cliente en "Clientes" y después creá el contrato.') : null));
      return;
    }
    vaciar(cuerpo, h('div', { class: 'grilla-2' }, lista.map((c) => {
      const pct = Number(c.monto_contractual) ? Math.round((Number(c.certificado_bruto) / Number(c.monto_contractual)) * 10000) / 100 : 0;
      const [est, tipo] = ESTADOS_CONTRATO[c.estado] ?? [c.estado, 'neutra'];
      const restan = c.fecha_fin_prevista ? diasEntre(hoyISO(), c.fecha_fin_prevista) : null;
      return h('a', { class: 'tarjeta tarjeta-link', href: `#/contrato/${c.id}` },
        h('div', { class: 'fila-titulo' }, h('h2', {}, `${c.codigo} · ${c.descripcion}`), etiqueta(est, tipo)),
        h('p', { class: 'texto-suave' }, `${c.cliente}${c.numero_concurso ? ' · Concurso ' + c.numero_concurso : ''}`),
        h('div', { class: 'datos-fila' },
          h('div', {}, h('small', {}, 'Contrato'), h('strong', {}, pesos(c.monto_contractual))),
          h('div', {}, h('small', {}, 'Certificado'), h('strong', {}, pesos(c.certificado_bruto))),
          h('div', {}, h('small', {}, 'Avance'), h('strong', {}, `${pct.toLocaleString('es-AR')} %`))),
        barra(pct),
        h('p', { class: 'texto-suave' },
          c.fecha_fin_prevista ? `Fin de plazo: ${fechaAR(c.fecha_fin_prevista)} (${restan >= 0 ? `faltan ${restan} días` : `vencido hace ${-restan} días`})` : 'Sin acta de replanteo cargada',
          Number(c.unidades_por_certificar) ? h('span', {}, ' · ', etiqueta(`${Number(c.unidades_por_certificar)} unidades por certificar`, 'alerta')) : null));
    })));
  };

  vaciar(cont,
    encabezado('Contratos', 'Contratos y obras con sus ítems, avance, certificados, multas y pólizas.',
      puedeEditar ? h('button', { class: 'btn btn-primario', type: 'button', onclick: () => nuevoContrato(cargar) }, '+ Nuevo contrato') : null),
    cuerpo);
  await pantalla(cuerpo, cargar);
}

async function nuevoContrato(recargar) {
  const lista = (await clientes.listar()).filter((c) => c.activo);
  if (!lista.length) { aviso('Primero cargá el cliente en la pantalla Clientes.', 'error'); return; }
  const ok = await modal({
    titulo: 'Nuevo contrato',
    contenido: [
      campo('Código interno', h('input', { name: 'codigo', required: true, placeholder: 'Ej.: E55', maxlength: 20 }), 'Corto y único. También es el código del centro de costo.'),
      campo('Cliente', select(lista.map((c) => [c.id, c.razon_social]), lista[0].id, { name: 'cliente_id' })),
      campo('Obra / descripción', h('input', { name: 'descripcion', required: true, placeholder: 'Ej.: Pintura de columnas de iluminación en RP-E55' })),
      campo('Tipo de trabajo', select(TIPOS_TRABAJO, 'pintura_columnas', { name: 'tipo_trabajo' })),
      campo('N° de concurso / licitación', h('input', { name: 'numero_concurso' })),
      campo('Estado', select(Object.entries(ESTADOS_CONTRATO).map(([k, [t]]) => [k, t]), 'adjudicado', { name: 'estado' })),
    ],
    aceptar: 'Crear contrato',
    alAceptar: async (form) => {
      const d = leerForm(form);
      const [c] = await contratos.crear({ codigo: d.codigo.toUpperCase(), cliente_id: d.cliente_id, descripcion: d.descripcion,
        tipo_trabajo: d.tipo_trabajo, numero_concurso: d.numero_concurso || null, estado: d.estado });
      return c;
    },
  });
  if (ok) { aviso('Contrato creado. Completá sus condiciones e ítems.'); location.hash = `#/contrato/${ok.id}`; } else recargar();
}
