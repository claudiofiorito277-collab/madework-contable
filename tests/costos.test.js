import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aMilesimas, porCantidad, tarifaVigente, costoParte, validarParte, valorizarMateriales, bajoMinimo,
  repartir, prorratearIndirecto, costoPorItem, lunes,
} from '../js/core/costos.js';

const TARIFAS = {
  personal: {
    juan: [{ vigente_desde: '2026-11-01', costo_hora: 950000, costo_jornal: 7600000 }, { vigente_desde: '2026-12-01', costo_hora: 1000000, costo_jornal: 8000000 }],
    pedro: [{ vigente_desde: '2026-11-01', costo_hora: 800000, costo_jornal: null }],
  },
  equipos: { hidro: [{ vigente_desde: '2026-11-01', costo_hora: 2500000, costo_dia: 18000000 }] },
};

test('C01 · cantidades en milésimas y costo por cantidad', () => {
  assert.equal(aMilesimas('1,5'), 1500);
  assert.equal(aMilesimas(8), 8000);
  assert.equal(aMilesimas('0.333'), 333);
  assert.equal(porCantidad(950000, 8000), 7600000);
  assert.equal(porCantidad(100, 333), 33);   // 0,333 × $1 = $0,333 -> $0,33
  assert.throws(() => aMilesimas('abc'));
});

test('C02 · tarifa vigente según la fecha', () => {
  assert.equal(tarifaVigente(TARIFAS.personal.juan, '2026-11-30').costo_hora, 950000);
  assert.equal(tarifaVigente(TARIFAS.personal.juan, '2026-12-01').costo_hora, 1000000);
  assert.equal(tarifaVigente(TARIFAS.personal.juan, '2026-10-31'), null);
});

test('C03 · costo de un parte diario: personas por hora y por jornal + hidroelevador', () => {
  const parte = { fecha: '2026-11-03', personal: [{ personal_id: 'juan', jornales: 1000 }, { personal_id: 'pedro', horas: 8000 }],
    equipos: [{ equipo_id: 'hidro', horas: 6500 }], cantidad_producida: 12000 };
  const c = costoParte(parte, TARIFAS);
  assert.equal(c.mano_obra, 7600000 + 6400000);   // $76.000 + 8 h × $8.000
  assert.equal(c.equipos, 16250000);              // 6,5 h × $25.000
  assert.equal(c.total, 30250000);
  assert.deepEqual(c.faltantes, []);
});

test('C04 · costo de parte: avisa la falta de tarifa y usa la vigente al cambiar de mes', () => {
  const c = costoParte({ fecha: '2026-11-03', personal: [{ personal_id: 'pedro', jornales: 1000, nombre: 'Pedro' }, { personal_id: 'nuevo', horas: 8000, nombre: 'Nuevo' }] }, TARIFAS);
  assert.equal(c.total, 0);
  assert.equal(c.faltantes.length, 2);
  assert.match(c.faltantes[0], /Pedro.*jornal/);
  assert.match(c.faltantes[1], /Nuevo: sin tarifa/);
  assert.equal(costoParte({ fecha: '2026-12-02', personal: [{ personal_id: 'juan', jornales: 1000 }] }, TARIFAS).total, 8000000);
});

test('C05 · validación del parte', () => {
  assert.equal(validarParte({ fecha: '2026-11-03', contrato_id: 'c', personal: [{ personal_id: 'juan', jornales: 1000 }] }).ok, true);
  const v = validarParte({ fecha: '2026-11-03', contrato_id: 'c', personal: [{ personal_id: 'juan', horas: 4000, jornales: 1000 }, { personal_id: 'juan', horas: 25000 }] });
  assert.equal(v.ok, false);
  assert.ok(v.errores.some((e) => /uno de los dos/.test(e)));
  assert.ok(v.errores.some((e) => /24 horas/.test(e)));
  assert.ok(v.errores.some((e) => /repetida/.test(e)));
  assert.equal(validarParte({ fecha: '2026-11-03', contrato_id: 'c' }).ok, false);
});

test('C06 · stock después de ingresos, transferencia y consumos (costo promedio ponderado)', () => {
  const movs = [
    { id: 1, fecha: '2026-11-02', material_id: 'pint', tipo: 'ingreso', deposito_destino_id: 'dep', cantidad: 100000, costo_unitario: 1000000 },   // 100 l × $10.000
    { id: 2, fecha: '2026-11-03', material_id: 'pint', tipo: 'ingreso', deposito_destino_id: 'dep', cantidad: 100000, costo_unitario: 1200000 },   // 100 l × $12.000
    { id: 3, fecha: '2026-11-03', material_id: 'pint', tipo: 'transferencia', deposito_origen_id: 'dep', deposito_destino_id: 'obra', cantidad: 80000 },
    { id: 4, fecha: '2026-11-04', material_id: 'pint', tipo: 'consumo', deposito_origen_id: 'obra', cantidad: 30000, contrato_id: 'e55', item_id: 'it1' },
    { id: 5, fecha: '2026-11-05', material_id: 'pint', tipo: 'consumo', deposito_origen_id: 'obra', cantidad: 25000, contrato_id: 'e55', item_id: 'it1' },
    { id: 6, fecha: '2026-11-05', material_id: 'pint', tipo: 'consumo', deposito_origen_id: 'obra', cantidad: 5000, estado: 'anulado' },
  ];
  const v = valorizarMateriales(movs);
  assert.equal(v.stock.pint.dep, 120000);
  assert.equal(v.stock.pint.obra, 25000);
  assert.equal(v.total.pint, 145000);
  assert.equal(v.promedio.pint, 1100000);
  const cons = v.valorizados.filter((m) => m.tipo === 'consumo');
  assert.deepEqual(cons.map((c) => c.costo_total), [33000000, 27500000]);
  assert.equal(v.valor.pint, 220000000 - 60500000);
  assert.deepEqual(v.errores, []);
});

test('C07 · stock insuficiente se detecta y el último retiro no deja centavos sueltos', () => {
  const v = valorizarMateriales([
    { id: 1, fecha: '2026-11-02', material_id: 'm', tipo: 'ingreso', deposito_destino_id: 'd', cantidad: 3000, costo_unitario: 100 },
    { id: 2, fecha: '2026-11-02', material_id: 'm', tipo: 'ingreso', deposito_destino_id: 'd', cantidad: 3000, costo_unitario: 101 },
    { id: 3, fecha: '2026-11-03', material_id: 'm', tipo: 'consumo', deposito_origen_id: 'd', cantidad: 1000 },
    { id: 4, fecha: '2026-11-03', material_id: 'm', tipo: 'consumo', deposito_origen_id: 'd', cantidad: 5000 },
    { id: 5, fecha: '2026-11-04', material_id: 'm', tipo: 'consumo', deposito_origen_id: 'd', cantidad: 1000 },
  ]);
  const c = v.valorizados.filter((x) => x.tipo === 'consumo');
  assert.equal(c[0].costo_total + c[1].costo_total, 603);
  assert.equal(v.errores.length, 1);
  assert.match(v.errores[0].error, /Stock insuficiente/);
  assert.deepEqual(bajoMinimo([{ id: 'm', stock_minimo: 2000, activo: true }], { m: 0 }).length, 1);
});

test('C08 · repartir sin perder centavos', () => {
  const r = repartir(10000, [{ id: 'a', peso: 1 }, { id: 'b', peso: 1 }, { id: 'c', peso: 1 }]);
  assert.equal(r.a + r.b + r.c, 10000);
  assert.deepEqual(Object.values(r).sort(), [3333, 3333, 3334]);
  assert.deepEqual(repartir(100, [{ id: 'a', peso: 0 }]), {});
});

test('C09 · prorrateo de indirectos según la regla', () => {
  const ctx = { contratos: [{ id: 'e55', monto: 300000000, activo: true }, { id: 'x', monto: 100000000, activo: true }], costoDirecto: { e55: 6000000, x: 2000000 } };
  assert.deepEqual(prorratearIndirecto({ importe: 400000, regla: 'monto_contractual' }, ctx).reparto, { e55: 300000, x: 100000 });
  assert.deepEqual(prorratearIndirecto({ importe: 400000, regla: 'costo_directo' }, ctx).reparto, { e55: 300000, x: 100000 });
  assert.deepEqual(prorratearIndirecto({ importe: 400001, regla: 'partes_iguales' }, ctx).reparto, { e55: 200001, x: 200000 });
  assert.deepEqual(prorratearIndirecto({ importe: 400000, regla: 'porcentajes', porcentajes: [{ contrato_id: 'e55', porcentaje: 70 }, { contrato_id: 'x', porcentaje: 30 }] }, ctx).reparto, { e55: 280000, x: 120000 });
  assert.match(prorratearIndirecto({ importe: 1, regla: 'porcentajes', porcentajes: [{ contrato_id: 'e55', porcentaje: 70 }] }, ctx).error, /suman 70/);
  assert.deepEqual(prorratearIndirecto({ importe: 1000, regla: 'costo_directo' }, { contratos: [{ id: 'e55' }], costoDirecto: {} }).reparto, { e55: 1000 });
});

test('C10 · costo real por ítem y por columna', () => {
  const r = costoPorItem({
    items: [{ id: 'it1', codigo: '1', descripcion: 'Pintura de columnas', unidad: 'u', precio_unitario: 17267000 }, { id: 'it2', codigo: '2', descripcion: 'Señalización', unidad: 'u', precio_unitario: 100000 }],
    partes: [{ item_id: 'it1', mano_obra: 30000000, equipos: 16250000, cantidad_producida: 12000 }, { item_id: 'it1', mano_obra: 28000000, equipos: 15000000, cantidad_producida: 10000 }],
    consumos: [{ item_id: 'it1', costo_total: 33000000 }],
    compras: [{ item_id: 'it1', categoria: 'otros', importe: 1750000 }, { item_id: null, categoria: 'otros', importe: 1000000 }],
    indirecto: 12500000,
  });
  const it1 = r.filas.find((f) => f.item_id === 'it1');
  assert.equal(it1.directo, 124000000);
  assert.equal(it1.producido, 22000);
  assert.equal(it1.indirectos + r.filas.find((f) => f.item_id === null).indirectos, 12500000);
  assert.equal(it1.total, 124000000 + it1.indirectos);
  assert.equal(it1.costo_unitario, Math.round(it1.total / 22));
  assert.equal(it1.margen_unitario, 17267000 - it1.costo_unitario);
  assert.equal(r.totales.total, 125000000 + 12500000);
  assert.equal(r.filas.find((f) => f.item_id === 'it2').costo_unitario, null);
  assert.equal(r.filas[r.filas.length - 1].item, null);   // "Sin ítem" al final
});

test('C11 · semana: lunes de cada fecha', () => {
  assert.equal(lunes('2026-11-01'), '2026-10-26');
  assert.equal(lunes('2026-11-02'), '2026-11-02');
  assert.equal(lunes('2026-11-08'), '2026-11-02');
});
