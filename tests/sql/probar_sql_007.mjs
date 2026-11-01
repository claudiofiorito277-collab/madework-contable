// Prueba la migración 007 (costos de obra) sobre la 001 a 006, en un Postgres embebido (PGlite).
// Requiere "npm install". Correr con: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';

const db = new PGlite({ extensions: { btree_gist } });
let ok = 0, mal = 0;
const check = (n, c, extra = '') => { if (c) { ok++; console.log('  OK  ', n); } else { mal++; console.log('  FALLA', n, extra); } };
const U1 = '11111111-1111-1111-1111-111111111111';  // administrador
const U2 = '22222222-2222-2222-2222-222222222222';  // operador
const U3 = '33333333-3333-3333-3333-333333333333';  // contador
const U4 = '44444444-4444-4444-4444-444444444444';  // consulta
const como = async (uid, fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
};
const comoE = (uid, sql) => como(uid, () => db.exec(sql));
const comoQ = (uid, sql, params) => como(uid, () => db.query(sql, params));
const falla = async (nombre, uid, sql, patron, params) => {
  try { await comoQ(uid, sql, params); check(nombre, false, '(no dio error)'); }
  catch (e) { check(nombre, patron.test(e.message), `-> ${e.message}`); }
};
const uno = async (sql) => (await db.query(sql)).rows[0];
const n = (x) => Number(x);
const J = (o) => [JSON.stringify(o)];

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema auth, public, storage to authenticated, anon;
  grant all on storage.objects to authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`);
const leer = (f) => readFileSync(new URL(`../../sql/${f}`, import.meta.url), 'utf8');

console.log('\n1) Aplicar migraciones 001 a 007');
for (const f of ['001_base.sql', '002_contratos.sql', '003_ventas.sql', '004_compras.sql', '005_tesoreria.sql', '006_contabilidad.sql']) await db.exec(leer(f));
try { await db.exec(leer('007_costos.sql')); check('migración 007 aplicada sin errores', true); }
catch (e) { check('migración 007 aplicada sin errores', false, e.message); process.exit(1); }
await db.exec(`insert into auth.users values ('${U1}','claudio@demo.test'),('${U2}','mario@demo.test'),('${U3}','contador@demo.test'),('${U4}','consulta@demo.test');
               update perfiles set rol='operador', activo=true where id='${U2}';
               update perfiles set rol='contador', activo=true where id='${U3}';
               update perfiles set rol='consulta', activo=true where id='${U4}';`);

await comoE(U1, `insert into clientes (razon_social, cuit) values ('Caminos de las Sierras S.A. (DEMO)', '30712345671')`);
const cli = (await uno(`select id from clientes`)).id;
await comoE(U1, `insert into contratos (codigo, cliente_id, descripcion) values ('E55', '${cli}', 'Pintura columnas RP-E55')`);
const ctr = (await uno(`select id from contratos`)).id;
await comoE(U1, `insert into contrato_items (contrato_id, codigo, descripcion, unidad, cantidad, precio_unitario) values ('${ctr}', '1', 'Pintura de columnas', 'u', 400, 172670)`);
const it1 = (await uno(`select id from contrato_items`)).id;

console.log('\n2) Personal: datos personales y costos solo para administrador y contador');
await comoE(U1, `insert into personal (nombre, categoria, modalidad, cuadrilla) values ('Juan Gómez (DEMO)', 'Oficial pintor', 'dependencia', 'A'), ('Pedro Díaz (DEMO)', 'Ayudante', 'monotributista', 'A')`);
const juan = (await uno(`select id from personal where nombre like 'Juan%'`)).id; const pedro = (await uno(`select id from personal where nombre like 'Pedro%'`)).id;
await comoE(U3, `insert into personal_datos (personal_id, cuil, telefono) values ('${juan}', '20111111112', '351 000-0000')`);
await comoE(U3, `insert into personal_tarifas (personal_id, vigente_desde, costo_hora, costo_jornal) values ('${juan}', '2026-11-01', 9500, 76000), ('${pedro}', '2026-11-01', 8000, null)`);
await falla('el operador no da de alta personal', U2, `insert into personal (nombre) values ('x')`, /row-level security/);
check('el operador ve los nombres para cargar partes', (await comoQ(U2, `select count(*)::int c from personal`)).rows[0].c === 2);
check('el operador NO ve CUIL ni teléfono', (await comoQ(U2, `select count(*)::int c from personal_datos`)).rows[0].c === 0);
check('el operador NO ve los costos por hora', (await comoQ(U2, `select count(*)::int c from personal_tarifas`)).rows[0].c === 0);
check('la consulta tampoco ve datos personales', (await comoQ(U4, `select count(*)::int c from personal_datos`)).rows[0].c === 0);
check('el contador ve datos y tarifas', (await comoQ(U3, `select count(*)::int c from personal_tarifas`)).rows[0].c === 2 && (await comoQ(U3, `select count(*)::int c from personal_datos`)).rows[0].c === 1);
await falla('un CUIL mal escrito es rechazado', U3, `insert into personal_datos (personal_id, cuil) values ('${pedro}', '20-1111')`, /check/);
await falla('una tarifa no se modifica (se carga otra con nueva vigencia)', U3, `update personal_tarifas set costo_hora = 1`, /permission denied|no se modifica/);
await comoE(U3, `insert into personal_tarifas (personal_id, vigente_desde, costo_hora, costo_jornal) values ('${juan}', '2026-12-01', 10000, 80000)`);
check('dos vigencias de tarifa para la misma persona', (await uno(`select count(*)::int c from personal_tarifas where personal_id='${juan}'`)).c === 2);
await falla('la misma vigencia dos veces es rechazada', U3, `insert into personal_tarifas (personal_id, vigente_desde, costo_hora) values ('${juan}', '2026-12-01', 1)`, /duplicate|unique/);

console.log('\n3) Equipos');
await comoE(U1, `insert into equipos (codigo, nombre, tipo, patente) values ('HID-01', 'Hidroelevador (DEMO)', 'vehiculo', 'AB123CD'), ('CMP-01', 'Compresor', 'equipo', null)`);
const hid = (await uno(`select id from equipos where codigo='HID-01'`)).id;
await comoE(U1, `insert into equipo_tarifas (equipo_id, vigente_desde, costo_hora, costo_dia) values ('${hid}', '2026-11-01', 25000, 180000)`);
await comoE(U2, `insert into equipo_gastos (equipo_id, tipo, fecha, litros, importe, contrato_id) values ('${hid}', 'combustible', '2026-11-03', 60, 72000, '${ctr}')`);
check('el operador carga combustible desde la obra', (await uno(`select count(*)::int c from equipo_gastos`)).c === 1);
await falla('combustible sin litros es rechazado', U2, `insert into equipo_gastos (equipo_id, tipo, fecha, importe) values ('${hid}', 'combustible', '2026-11-03', 1000)`, /check/);
await falla('un gasto registrado no se modifica', U1, `update equipo_gastos set importe = 1`, /no se modifica/);
await comoE(U1, `update equipo_gastos set estado = 'anulado', motivo = 'cargado dos veces'`);
check('el gasto se anula con motivo', (await uno(`select estado from equipo_gastos`)).estado === 'anulado');

console.log('\n4) Partes diarios');
const parte = (uid, p) => comoQ(uid, `select fn_registrar_parte($1::jsonb) id`, J(p)).then((r) => r.rows[0].id);
const P1 = { fecha: '2026-11-02', contrato_id: ctr, item_id: it1, cuadrilla: 'A', cantidad_producida: 12, personal: [{ personal_id: juan, jornales: 1 }, { personal_id: pedro, horas: 8 }], equipos: [{ equipo_id: hid, horas: 6.5 }] };
const p1 = await parte(U2, P1);
const v = await uno(`select personas, horas, jornales, equipos, cantidad_producida, item_codigo, cargado_por from v_partes where id='${p1}'`);
check('el operador carga un parte: 2 personas, 8 h + 1 jornal, hidroelevador, 12 columnas', n(v.personas) === 2 && n(v.horas) === 8 && n(v.jornales) === 1 && v.equipos.includes('Hidroelevador') && n(v.cantidad_producida) === 12 && v.cargado_por === 'mario@demo.test', JSON.stringify(v));
await falla('horas y jornales a la vez es rechazado', U2, `select fn_registrar_parte($1::jsonb)`, /check|violates/, J({ ...P1, personal: [{ personal_id: juan, horas: 4, jornales: 1 }], equipos: [] }));
await falla('más de 24 horas es rechazado', U2, `select fn_registrar_parte($1::jsonb)`, /check|violates/, J({ ...P1, personal: [{ personal_id: juan, horas: 25 }], equipos: [] }));
await falla('la misma persona dos veces en un parte es rechazada', U2, `select fn_registrar_parte($1::jsonb)`, /duplicate|unique/, J({ ...P1, personal: [{ personal_id: juan, horas: 4 }, { personal_id: juan, horas: 4 }], equipos: [] }));
await falla('un parte vacío es rechazado', U2, `select fn_registrar_parte($1::jsonb)`, /al menos una persona/, J({ ...P1, personal: [], equipos: [] }));
await falla('la consulta no carga partes', U4, `select fn_registrar_parte($1::jsonb)`, /permiso/, J(P1));
await falla('nadie inserta partes directo en la tabla', U1, `insert into partes_diarios (fecha, contrato_id) values ('2026-11-02', '${ctr}')`, /permission denied/);
await falla('el operador no anula partes', U2, `select fn_anular_parte('${p1}', 'x')`, /Solo el administrador o el contador/);
const p2 = await parte(U2, { ...P1, fecha: '2026-11-03', cantidad_producida: 10 });
await comoQ(U3, `select fn_anular_parte('${p2}', 'Duplicado')`);
check('el contador anula un parte con motivo', (await uno(`select estado from partes_diarios where id='${p2}'`)).estado === 'anulado');

console.log('\n5) Materiales y stock');
await comoE(U1, `insert into materiales (codigo, nombre, unidad, categoria, stock_minimo) values ('PINT-AM', 'Esmalte amarillo vial (DEMO)', 'l', 'pinturas', 40)`);
const pint = (await uno(`select id from materiales`)).id;
const central = (await uno(`select id from depositos where nombre='Depósito central'`)).id;
await comoE(U1, `insert into depositos (nombre, tipo, contrato_id) values ('Obrador E55', 'obra', '${ctr}')`);
const obra = (await uno(`select id from depositos where tipo='obra'`)).id;
await falla('un depósito de obra sin contrato es rechazado', U1, `insert into depositos (nombre, tipo) values ('X', 'obra')`, /check/);
const mov = (uid, p) => comoQ(uid, `select fn_movimiento_material($1::jsonb) id`, J(p)).then((r) => r.rows[0].id);
const pR = (await (async () => { await comoE(U1, `insert into proveedores (razon_social, cuit, condicion_iva) values ('Pinturerías Córdoba (DEMO)', '30500000003', 'RI')`); return (await uno(`select id from proveedores`)).id; })());
const fc = (await comoQ(U1, `select fn_registrar_comprobante_compra($1::jsonb) id`, J({ proveedor_id: pR, tipo_codigo: '1', punto_venta: 4, numero: 1520, fecha: '2026-11-02',
  alicuotas: [{ alicuota: 'IVA_21', neto: 2000000, iva: 420000 }], imputaciones: [{ contrato_id: ctr, item_id: it1, categoria: 'materiales', porcentaje: 100, importe: 2000000 }] }))).rows[0].id;
const ni = (await comoQ(U3, `select fn_ingreso_desde_compra($1::jsonb) n`, J({ comprobante_compra_id: fc, deposito_id: central, lineas: [{ material_id: pint, cantidad: 100, costo_unitario: 10000 }, { material_id: pint, cantidad: 100, costo_unitario: 10000 }] }))).rows[0].n;
check('ingreso al stock desde la factura de compra: 2 líneas, 200 l', ni === 2 && n((await comoQ(U1, `select fn_stock('${pint}', '${central}') s`)).rows[0].s) === 200);
await falla('el operador no carga ingresos', U2, `select fn_movimiento_material($1::jsonb)`, /administrador o el contador/, J({ fecha: '2026-11-02', tipo: 'ingreso', material_id: pint, deposito_destino_id: central, cantidad: 1, costo_unitario: 1 }));
await mov(U2, { fecha: '2026-11-02', tipo: 'transferencia', material_id: pint, deposito_origen_id: central, deposito_destino_id: obra, cantidad: 80 });
const c1 = await mov(U2, { fecha: '2026-11-02', tipo: 'consumo', material_id: pint, deposito_origen_id: obra, item_id: it1, cantidad: 30, parte_id: p1 });
check('el consumo en el depósito de obra toma el contrato del depósito', (await uno(`select contrato_id from material_movimientos where id='${c1}'`)).contrato_id === ctr);
const st = (await db.query(`select deposito, cantidad from v_stock order by deposito`)).rows;
check('stock: central 120 l, obrador 50 l', JSON.stringify(st.map((x) => [x.deposito, n(x.cantidad)])) === JSON.stringify([['Depósito central', 120], ['Obrador E55', 50]]), JSON.stringify(st));
await falla('no se consume más de lo que hay en el obrador', U2, `select fn_movimiento_material($1::jsonb)`, /Stock insuficiente/, J({ fecha: '2026-11-03', tipo: 'consumo', material_id: pint, deposito_origen_id: obra, cantidad: 51 }));
await falla('transferencia al mismo depósito es rechazada', U2, `select fn_movimiento_material($1::jsonb)`, /check|violates/, J({ fecha: '2026-11-03', tipo: 'transferencia', material_id: pint, deposito_origen_id: obra, deposito_destino_id: obra, cantidad: 1 }));
await falla('el ítem de otro contrato es rechazado', U2, `select fn_movimiento_material($1::jsonb)`, /no pertenece/, J({ fecha: '2026-11-03', tipo: 'consumo', material_id: pint, deposito_origen_id: obra, contrato_id: ctr, item_id: '00000000-0000-0000-0000-000000000001', cantidad: 1 }));
await falla('no se anula un ingreso si el material ya salió del depósito', U3, `select fn_anular_movimiento_material((select id from material_movimientos where tipo='transferencia'), 'x')`, /ya se usó o se movió/);
await comoQ(U3, `select fn_anular_movimiento_material('${c1}', 'Mal cargado')`);
check('al anular el consumo el stock vuelve (obrador 80 l)', n((await uno(`select fn_stock('${pint}', '${obra}') s`)).s) === 80);
const aj = await mov(U3, { fecha: '2026-11-04', tipo: 'ajuste', material_id: pint, deposito_destino_id: central, cantidad: 5 });
check('ajuste positivo sin costo: toma el costo promedio ($10.000)', n((await uno(`select costo_unitario from material_movimientos where id='${aj}'`)).costo_unitario) === 10000);

console.log('\n6) Costos indirectos');
const ind = (uid, p) => comoQ(uid, `select fn_registrar_indirecto($1::jsonb) id`, J(p)).then((r) => r.rows[0].id);
await ind(U3, { fecha: '2026-11-05', concepto: 'Póliza de caución', categoria: 'polizas', importe: 125000, regla: 'costo_directo' });
await falla('porcentajes que no suman 100 son rechazados', U3, `select fn_registrar_indirecto($1::jsonb)`, /suman 70/, J({ fecha: '2026-11-05', concepto: 'x', importe: 1, regla: 'porcentajes', porcentajes: [{ contrato_id: ctr, porcentaje: 70 }] }));
await ind(U3, { fecha: '2026-11-05', concepto: 'Honorarios contador', categoria: 'administracion', importe: 300000, regla: 'porcentajes', porcentajes: [{ contrato_id: ctr, porcentaje: 100 }] });
check('indirecto con porcentajes fijos guardado', (await uno(`select count(*)::int c from indirecto_porcentajes`)).c === 1);
await falla('una factura ya imputada a la obra no se carga también como indirecto', U3, `select fn_registrar_indirecto($1::jsonb)`, /contaría dos veces/, J({ fecha: '2026-11-05', concepto: 'x', importe: 1, comprobante_compra_id: fc }));
await falla('el operador no carga indirectos', U2, `select fn_registrar_indirecto($1::jsonb)`, /Solo el administrador o el contador/, J({ fecha: '2026-11-05', concepto: 'x', importe: 1 }));

console.log('\n7) Mes cerrado');
await db.exec(`insert into periodos (anio, mes, estado) values (2026, 12, 'cerrado') on conflict (anio, mes) do update set estado = 'cerrado'`);
await falla('no se carga un parte en un mes cerrado', U2, `select fn_registrar_parte($1::jsonb)`, /cerrado/, J({ ...P1, fecha: '2026-12-01' }));
await falla('no se mueve stock en un mes cerrado', U2, `select fn_movimiento_material($1::jsonb)`, /cerrado/, J({ fecha: '2026-12-01', tipo: 'consumo', material_id: pint, deposito_origen_id: obra, cantidad: 1 }));
await falla('no se carga combustible en un mes cerrado', U2, `insert into equipo_gastos (equipo_id, tipo, fecha, litros, importe) values ('${hid}', 'combustible', '2026-12-01', 10, 1)`, /cerrado/);
await falla('no se carga un indirecto en un mes cerrado', U3, `select fn_registrar_indirecto($1::jsonb)`, /cerrado/, J({ fecha: '2026-12-01', concepto: 'x', importe: 1 }));

console.log('\n8) Auditoría');
const au = await uno(`select count(distinct tabla)::int t from auditoria where tabla in ('personal','personal_datos','personal_tarifas','partes_diarios','parte_personal','material_movimientos','costos_indirectos','equipo_gastos')`);
check('auditoría registra personal, datos, tarifas, partes, stock, indirectos y gastos de equipos', au.t === 8, au.t);

console.log(`\nResultado: ${ok} OK, ${mal} fallas`);
if (mal) process.exit(1);
