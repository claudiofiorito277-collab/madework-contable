// Parte diario de trabajo: carga simple desde el celular (personas, equipos, producción y consumos de materiales).
import { h, vaciar, pantalla, campo, select, modal, aviso, error, etiqueta, fechaAR, cent, hoyISO, cantidadAR } from './dom.js';
import { costos, contratos as repoContratos } from '../data/repos.js';
import { tarifas } from '../data/costos.js';
import { costoParte, validarParte, aMilesimas } from '../core/costos.js';

const mil = (v) => { try { return aMilesimas(v); } catch { return NaN; } };
const txt = (m) => (m ? String(m / 1000).replace('.', ',') : '');
const dec = (m) => (m / 1000).toString();

/** Detalle de un parte, con su costo (solo administrador y contador) y sus consumos de materiales. */
export async function pantallaParte(cont, ctx, id) {
  const rol = ctx.perfil.rol;
  const puede = ['administrador', 'contador'].includes(rol);
  await pantalla(cont, async () => {
    const [p, personal, equipos, movs] = await Promise.all([costos.parte(id), costos.personal(), costos.equipos(), costos.movimientosMaterial()]);
    if (!p) throw new Error('No se encontró el parte.');
    const nomP = Object.fromEntries(personal.map((x) => [x.id, x.nombre])); const eq = Object.fromEntries(equipos.map((x) => [x.id, x]));
    const consumos = movs.filter((m) => m.parte_id === id);
    const vigente = p.estado === 'registrado';
    const parte = { fecha: p.fecha, personal: p.personal.map((l) => ({ personal_id: l.personal_id, nombre: nomP[l.personal_id], horas: mil(l.horas), jornales: mil(l.jornales) })),
      equipos: p.equipos.map((l) => ({ equipo_id: l.equipo_id, nombre: eq[l.equipo_id]?.nombre, horas: mil(l.horas), dias: mil(l.dias) })) };
    const costo = puede ? costoParte(parte, await tarifas()) : null;
    const prod = mil(p.cantidad_producida);
    const recargar = () => pantallaParte(cont, ctx, id);
    const anular = async () => {
      const m = await modal({ titulo: `Anular el parte del ${fechaAR(p.fecha)}`, peligro: true, aceptar: 'Anular', contenido: campo('Motivo', h('input', { name: 'm', required: true })),
        alAceptar: async (f) => { await costos.anularParte(id, f.elements.m.value.trim()); return true; } });
      if (m) { aviso('Parte anulado.'); await recargar(); }
    };
    const consumo = async () => {
      const [mats, deps] = await Promise.all([costos.materiales(), costos.depositos()]);
      const obra = deps.find((d) => d.tipo === 'obra' && d.contrato_id === p.contrato_id) ?? deps[0];
      const ok = await modal({ titulo: 'Consumo de materiales', aceptar: 'Registrar consumo', contenido: h('div', { class: 'form-grilla' },
        campo('Material', select(mats.filter((m) => m.activo).map((m) => [m.id, `${m.nombre} (${m.unidad})`]), '', { name: 'mat', required: true })),
        campo('Cantidad', h('input', { name: 'cant', inputmode: 'decimal', required: true })),
        campo('Sale de', select(deps.filter((d) => d.activo).map((d) => [d.id, d.nombre]), obra?.id, { name: 'dep' }))),
      alAceptar: async (f) => {
        const q = mil(f.elements.cant.value); if (!(q > 0)) throw new Error('Falta la cantidad.');
        await costos.moverMaterial({ tipo: 'consumo', fecha: p.fecha, material_id: f.elements.mat.value, cantidad: dec(q), deposito_origen_id: f.elements.dep.value,
          contrato_id: p.contrato_id, item_id: p.item_id, parte_id: id });
        return true;
      } });
      if (ok) { aviso('Consumo registrado.'); await recargar(); }
    };
    const anularConsumo = async (c) => {
      const ok = await modal({ titulo: 'Anular consumo', peligro: true, aceptar: 'Anular', contenido: campo('Motivo', h('input', { name: 'm', required: true })),
        alAceptar: async (f) => { await costos.anularMovimientoMaterial(c.id, f.elements.m.value.trim()); return true; } });
      if (ok) { aviso('Consumo anulado: el material vuelve al stock.'); await recargar(); }
    };
    const usoTxt = (a, b, ta, tb) => [a ? `${txt(a)} ${ta}` : '', b ? `${txt(b)} ${tb}` : ''].filter(Boolean).join(' + ');
    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/costos/partes' }, 'Partes diarios'), ` › ${fechaAR(p.fecha)}`),
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, `Parte del ${fechaAR(p.fecha)} `, vigente ? etiqueta('Registrado', 'ok') : etiqueta('Anulado', 'peligro')),
          h('p', { class: 'descripcion' }, [p.contrato_codigo, p.item_codigo ? `ítem ${p.item_codigo} ${p.item_descripcion}` : 'sin ítem', p.cuadrilla ? `cuadrilla ${p.cuadrilla}` : '', p.cargado_por ? `cargó ${p.cargado_por}` : ''].filter(Boolean).join(' · ')),
          vigente ? null : h('p', { class: 'nota' }, `Motivo: ${p.motivo}`)),
        h('div', { class: 'acciones acciones-envolver' },
          h('a', { class: 'btn', href: '#/nuevo-parte' }, '+ Otro parte'),
          puede && vigente ? h('button', { class: 'btn btn-peligro', type: 'button', onclick: anular }, 'Anular') : null)),
      h('div', { class: 'datos' },
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Producción'), h('div', { class: 'dato-valor' }, `${cantidadAR(prod / 1000)} ${p.item_unidad ?? ''}`)),
        costo ? h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Mano de obra'), h('div', { class: 'dato-valor' }, cent(costo.mano_obra))) : null,
        costo ? h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Equipos'), h('div', { class: 'dato-valor' }, cent(costo.equipos))) : null,
        costo ? h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, `Costo por ${p.item_unidad === 'u' ? 'unidad' : p.item_unidad ?? 'unidad'} (sin materiales)`),
          h('div', { class: 'dato-valor' }, prod ? cent(Math.round(costo.total * 1000 / prod)) : '—')) : null),
      costo?.faltantes.length ? h('div', { class: 'tarjeta tarjeta-alerta' }, 'No suman al costo: ', costo.faltantes.join(' · '), '. Cargá el costo en Personal o en Vehículos y equipos.') : null,
      p.observaciones ? h('section', { class: 'tarjeta' }, p.observaciones) : null,
      h('div', { class: 'grilla-2' },
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Personal'),
          h('ul', { class: 'lista-tareas' }, parte.personal.map((l) => h('li', {}, `${l.nombre} · ${usoTxt(l.jornales, l.horas, 'jornal(es)', 'h')}`))),
          parte.equipos.length ? [h('h2', {}, 'Equipos'), h('ul', { class: 'lista-tareas' }, parte.equipos.map((l) => h('li', {}, `${eq[l.equipo_id]?.codigo ?? ''} ${l.nombre} · ${usoTxt(l.dias, l.horas, 'día(s)', 'h')}`)))] : null),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Materiales consumidos'),
          consumos.length ? h('ul', { class: 'lista-tareas' }, consumos.map((c) => h('li', { class: c.estado === 'anulado' ? 'inactivo' : '' },
            `${c.material}: ${cantidadAR(c.cantidad)} ${c.unidad} (de ${c.deposito_origen})`, c.estado === 'anulado' ? h('span', {}, ' ', etiqueta('Anulado', 'peligro')) : null,
            puede && c.estado === 'vigente' ? h('span', {}, ' ', h('button', { class: 'btn btn-chico', type: 'button', onclick: () => anularConsumo(c) }, 'Anular')) : null)))
            : h('p', { class: 'texto-suave' }, 'Sin consumos cargados.'),
          vigente && rol !== 'consulta' ? h('button', { class: 'btn', type: 'button', onclick: consumo }, '+ Consumo de materiales') : null)));
  });
}

/** Alta de un parte. */
export async function pantallaNuevoParte(cont, ctx) {
  if (!['administrador', 'contador', 'operador'].includes(ctx.perfil.rol)) {
    vaciar(cont, h('div', { class: 'tarjeta tarjeta-error' }, 'Tu usuario es de solo consulta.'));
    return;
  }
  await pantalla(cont, async () => {
    const [ctrs, gente, eqs, mats, deps] = await Promise.all([repoContratos.listar(), costos.personal(), costos.equipos(), costos.materiales(), costos.depositos()]);
    const activos = ctrs.filter((c) => !['finalizado', 'rescindido'].includes(c.estado));
    const e = { fecha: hoyISO(), contrato_id: activos[0]?.id ?? '', item_id: '', cuadrilla: '', cantidad_producida: 0, observaciones: '',
      personal: [{ personal_id: '', jornales: 1000, horas: 0 }], equipos: [], consumos: [] };
    let items = [];
    const cargarItems = async () => {
      items = e.contrato_id ? (await repoContratos.items(e.contrato_id)).filter((i) => i.activo) : [];
      if (!items.some((i) => i.id === e.item_id)) e.item_id = items[0]?.id ?? '';
    };
    await cargarItems();
    const zona = h('div');
    const personas = gente.filter((p) => p.activo);
    const cuadrillas = [...new Set(personas.map((p) => p.cuadrilla).filter(Boolean))].sort();
    const obraDe = () => deps.find((d) => d.tipo === 'obra' && d.contrato_id === e.contrato_id && d.activo) ?? deps.find((d) => d.activo);
    const pintar = () => {
      const unidad = items.find((i) => i.id === e.item_id)?.unidad ?? '';
      vaciar(zona,
        h('section', { class: 'tarjeta' }, h('div', { class: 'form-grilla' },
          campo('Fecha', h('input', { type: 'date', value: e.fecha, required: true, 'aria-label': 'Fecha', onchange: (x) => { e.fecha = x.target.value; } })),
          campo('Contrato', select(activos.map((c) => [c.id, `${c.codigo} · ${c.descripcion}`]), e.contrato_id, { 'aria-label': 'Contrato',
            onchange: async (x) => { e.contrato_id = x.target.value; await cargarItems(); pintar(); } })),
          campo('Ítem', select([['', '— sin ítem —'], ...items.map((i) => [i.id, `${i.codigo} · ${i.descripcion} (${i.unidad})`])], e.item_id, { 'aria-label': 'Ítem', onchange: (x) => { e.item_id = x.target.value; pintar(); } })),
          campo('Cuadrilla', h('input', { value: e.cuadrilla, placeholder: 'A', list: 'cuadrillas', 'aria-label': 'Cuadrilla', onchange: (x) => { e.cuadrilla = x.target.value; } }),
            cuadrillas.length ? h('datalist', { id: 'cuadrillas' }, cuadrillas.map((c) => h('option', { value: c }))) : null),
          campo(`Cantidad producida${unidad ? ` (${unidad})` : ''}`, h('input', { inputmode: 'decimal', value: txt(e.cantidad_producida), 'aria-label': 'Cantidad producida',
            onchange: (x) => { e.cantidad_producida = mil(x.target.value); } }), 'Ej.: columnas pintadas en el día.'))),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Personal'),
          h('div', { class: 'lineas-parte' }, e.personal.map((l, i) => h('div', { class: 'linea-parte' },
            campo('Persona', select([['', 'Elegí'], ...personas.map((p) => [p.id, `${p.nombre}${p.categoria ? ` · ${p.categoria}` : ''}`])], l.personal_id,
              { 'aria-label': `Persona ${i + 1}`, onchange: (x) => { l.personal_id = x.target.value; } })),
            h('label', { class: 'campo campo-chico' }, h('span', { class: 'campo-etiqueta' }, 'Jornales'),
              h('input', { inputmode: 'decimal', value: txt(l.jornales), 'aria-label': `Jornales ${i + 1}`, onchange: (x) => { l.jornales = mil(x.target.value); if (l.jornales) { l.horas = 0; pintar(); } } })),
            h('label', { class: 'campo campo-chico' }, h('span', { class: 'campo-etiqueta' }, 'Horas'),
              h('input', { inputmode: 'decimal', value: txt(l.horas), 'aria-label': `Horas ${i + 1}`, onchange: (x) => { l.horas = mil(x.target.value); if (l.horas) { l.jornales = 0; pintar(); } } })),
            h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { e.personal.splice(i, 1); pintar(); } }, 'Quitar')))),
          h('div', { class: 'botones-agregar' },
            h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { e.personal.push({ personal_id: '', jornales: 1000, horas: 0 }); pintar(); } }, '+ Persona'),
            ...cuadrillas.map((c) => h('button', { class: 'btn btn-chico', type: 'button', onclick: () => {
              const ya = new Set(e.personal.map((l) => l.personal_id));
              e.personal = [...e.personal.filter((l) => l.personal_id), ...personas.filter((p) => p.cuadrilla === c && !ya.has(p.id)).map((p) => ({ personal_id: p.id, jornales: 1000, horas: 0 }))];
              e.cuadrilla ||= c; pintar();
            } }, `Cuadrilla ${c} con 1 jornal`)))),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Equipos'),
          h('div', { class: 'lineas-parte' }, e.equipos.map((l, i) => h('div', { class: 'linea-parte' },
            campo('Equipo', select([['', 'Elegí'], ...eqs.filter((q) => q.activo).map((q) => [q.id, `${q.codigo} · ${q.nombre}`])], l.equipo_id,
              { 'aria-label': `Equipo ${i + 1}`, onchange: (x) => { l.equipo_id = x.target.value; } })),
            h('label', { class: 'campo campo-chico' }, h('span', { class: 'campo-etiqueta' }, 'Horas'),
              h('input', { inputmode: 'decimal', value: txt(l.horas), 'aria-label': `Horas equipo ${i + 1}`, onchange: (x) => { l.horas = mil(x.target.value); if (l.horas) { l.dias = 0; pintar(); } } })),
            h('label', { class: 'campo campo-chico' }, h('span', { class: 'campo-etiqueta' }, 'Días'),
              h('input', { inputmode: 'decimal', value: txt(l.dias), 'aria-label': `Días equipo ${i + 1}`, onchange: (x) => { l.dias = mil(x.target.value); if (l.dias) { l.horas = 0; pintar(); } } })),
            h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { e.equipos.splice(i, 1); pintar(); } }, 'Quitar')))),
          h('div', { class: 'botones-agregar' }, h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { e.equipos.push({ equipo_id: '', horas: 0, dias: 0 }); pintar(); } }, '+ Equipo'))),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Materiales consumidos'),
          h('p', { class: 'texto-suave' }, 'Salen del stock del obrador (o del depósito que elijas) y se cargan al ítem del parte.'),
          h('div', { class: 'lineas-parte' }, e.consumos.map((l, i) => h('div', { class: 'linea-parte' },
            campo('Material', select([['', 'Elegí'], ...mats.filter((m) => m.activo).map((m) => [m.id, `${m.nombre} (${m.unidad})`])], l.material_id,
              { 'aria-label': `Material ${i + 1}`, onchange: (x) => { l.material_id = x.target.value; } })),
            h('label', { class: 'campo campo-chico' }, h('span', { class: 'campo-etiqueta' }, 'Cantidad'),
              h('input', { inputmode: 'decimal', value: txt(l.cantidad), 'aria-label': `Cantidad material ${i + 1}`, onchange: (x) => { l.cantidad = mil(x.target.value); } })),
            campo('Sale de', select(deps.filter((d) => d.activo).map((d) => [d.id, d.nombre]), l.deposito_id, { 'aria-label': `Depósito ${i + 1}`, onchange: (x) => { l.deposito_id = x.target.value; } })),
            h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { e.consumos.splice(i, 1); pintar(); } }, 'Quitar')))),
          h('div', { class: 'botones-agregar' }, h('button', { class: 'btn btn-chico', type: 'button', disabled: !mats.length,
            onclick: () => { e.consumos.push({ material_id: '', cantidad: 0, deposito_id: obraDe()?.id }); pintar(); } }, '+ Material'))),
        h('section', { class: 'tarjeta' }, campo('Observaciones', h('textarea', { rows: 2, 'aria-label': 'Observaciones', onchange: (x) => { e.observaciones = x.target.value; } }, e.observaciones)),
          h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/costos/partes' }, 'Cancelar'),
            h('button', { class: 'btn btn-primario', type: 'submit' }, 'Guardar parte'))));
    };
    const guardar = async (ev) => {
      ev.preventDefault();
      const p = { ...e, personal: e.personal.filter((l) => l.personal_id || l.horas || l.jornales), equipos: e.equipos.filter((l) => l.equipo_id || l.horas || l.dias) };
      const v = validarParte(p);
      const consumos = e.consumos.filter((l) => l.material_id || l.cantidad);
      if (consumos.some((l) => !l.material_id || !(l.cantidad > 0))) v.errores.push('Cada material necesita la cantidad.');
      if ([e.cantidad_producida, ...p.personal.flatMap((l) => [l.horas, l.jornales]), ...p.equipos.flatMap((l) => [l.horas, l.dias])].some((x) => Number.isNaN(x))) v.errores.push('Hay una cantidad mal escrita.');
      if (v.errores.length) { error(v.errores.join(' ')); return; }
      const btn = ev.submitter; if (btn) btn.disabled = true;
      try {
        const nuevo = await costos.registrarParte({ fecha: p.fecha, contrato_id: p.contrato_id, item_id: p.item_id || null, cuadrilla: p.cuadrilla, cantidad_producida: dec(p.cantidad_producida || 0),
          observaciones: p.observaciones, personal: p.personal.map((l) => ({ personal_id: l.personal_id, horas: dec(l.horas), jornales: dec(l.jornales) })),
          equipos: p.equipos.map((l) => ({ equipo_id: l.equipo_id, horas: dec(l.horas), dias: dec(l.dias) })) });
        const fallas = [];
        for (const c of consumos) {
          try { await costos.moverMaterial({ tipo: 'consumo', fecha: p.fecha, material_id: c.material_id, cantidad: dec(c.cantidad), deposito_origen_id: c.deposito_id, contrato_id: p.contrato_id, item_id: p.item_id || null, parte_id: nuevo }); }
          catch (err) { fallas.push(err.message); }
        }
        if (fallas.length) error(`El parte se guardó, pero no se registraron consumos: ${fallas.join(' ')}`); else aviso('Parte guardado.');
        location.hash = `#/parte/${nuevo}`;
      } catch (err) { error(err.message); if (btn) btn.disabled = false; }
    };
    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/costos/partes' }, 'Partes diarios'), ' › Nuevo parte'),
      h('div', { class: 'encabezado' }, h('div', {}, h('h1', {}, 'Parte diario'),
        h('p', { class: 'descripcion' }, 'Quién trabajó, cuánto, con qué equipos, qué se produjo y qué materiales se usaron.'))),
      h('form', { onsubmit: guardar }, zona));
    pintar();
  });
}
