// Prueba la migración 006 (contabilidad) sobre la 001 a 005, en un Postgres embebido (PGlite).
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

console.log('\n1) Aplicar migraciones 001 a 006');
for (const f of ['001_base.sql', '002_contratos.sql', '003_ventas.sql', '004_compras.sql', '005_tesoreria.sql']) await db.exec(leer(f));
try { await db.exec(leer('006_contabilidad.sql')); check('migración 006 aplicada sin errores', true); }
catch (e) { check('migración 006 aplicada sin errores', false, e.message); process.exit(1); }
await db.exec(`insert into auth.users values ('${U1}','claudio@demo.test'),('${U2}','mario@demo.test'),('${U3}','contador@demo.test'),('${U4}','consulta@demo.test');
               update perfiles set rol='operador', activo=true where id='${U2}';
               update perfiles set rol='contador', activo=true where id='${U3}';
               update perfiles set rol='consulta', activo=true where id='${U4}';`);
const cta = async (cod) => (await uno(`select id from plan_cuentas where codigo='${cod}'`)).id;
const imp = await uno(`select count(*)::int n, count(*) filter (where cuenta_id is null)::int sin from imputaciones_contables`);
check('configuración de imputaciones: 38 conceptos, todos con cuenta', imp.n === 38 && imp.sin === 0, JSON.stringify(imp));
const caja = await cta('1.1.1.01'); const banco = await cta('1.1.1.02'); const capital = await cta('3.1.01'); const ventas = await cta('4.1.01');
const deudores = await cta('1.1.2.01'); const ivadf = await cta('2.1.2.01'); const activo = await cta('1');

// Datos: cliente y una factura de venta registrada
await comoE(U1, `insert into clientes (razon_social, cuit) values ('Caminos de las Sierras S.A. (DEMO)', '30712345671')`);
const cli = (await uno(`select id from clientes`)).id;
const fac = (await comoQ(U1, `select fn_registrar_comprobante_venta($1::jsonb) id`, [JSON.stringify({ cliente_id: cli, tipo_codigo: '1', punto_venta: 3, numero: 125,
  fecha: '2026-11-23', alicuotas: [{ alicuota: 'IVA_21', neto: 1000000, iva: 210000 }] })])).rows[0].id;
const reg = (uid, p) => comoQ(uid, `select fn_registrar_asiento($1::jsonb) id`, [JSON.stringify(p)]).then((r) => r.rows[0].id);

console.log('\n2) Asientos manuales');
const a1 = await reg(U3, { fecha: '2026-11-01', tipo: 'manual', descripcion: 'Aporte inicial de capital', lineas: [{ cuenta_id: banco, debe: 3000000 }, { cuenta_id: capital, haber: 3000000 }] });
const a1r = await uno(`select numero, total, ejercicio_id from asientos where id='${a1}'`);
check('asiento manual N° 1 del ejercicio, total $3.000.000', a1r.numero === 1 && n(a1r.total) === 3000000);
check('el ejercicio 2026 se crea solo (01/01 al 31/12)', (await uno(`select anio, desde::text d, hasta::text h from ejercicios`)).h === '2026-12-31');
await falla('un asiento que no balancea es rechazado', U3, `select fn_registrar_asiento($1::jsonb)`, /no balancea/,
  [JSON.stringify({ fecha: '2026-11-02', tipo: 'manual', descripcion: 'x', lineas: [{ cuenta_id: banco, debe: 100 }, { cuenta_id: capital, haber: 90 }] })]);
await falla('una cuenta madre no es imputable', U3, `select fn_registrar_asiento($1::jsonb)`, /no es imputable/,
  [JSON.stringify({ fecha: '2026-11-02', tipo: 'manual', descripcion: 'x', lineas: [{ cuenta_id: activo, debe: 100 }, { cuenta_id: capital, haber: 100 }] })]);
await falla('una línea al debe y al haber a la vez es rechazada', U3, `select fn_registrar_asiento($1::jsonb)`, /debe o al haber/,
  [JSON.stringify({ fecha: '2026-11-02', tipo: 'manual', descripcion: 'x', lineas: [{ cuenta_id: banco, debe: 100, haber: 100 }, { cuenta_id: capital, haber: 100 }] })]);
await falla('el operador no registra asientos', U2, `select fn_registrar_asiento($1::jsonb)`, /Solo el administrador o el contador/,
  [JSON.stringify({ fecha: '2026-11-02', tipo: 'manual', descripcion: 'x', lineas: [{ cuenta_id: banco, debe: 1 }, { cuenta_id: capital, haber: 1 }] })]);
await falla('nadie inserta asientos directo en la tabla', U1, `insert into asientos (ejercicio_id, numero, fecha, tipo, descripcion, total) values ('${a1r.ejercicio_id}', 99, '2026-11-01', 'manual', 'x', 1)`, /permission denied/);
await falla('un asiento registrado no se modifica', U1, `update asiento_lineas set debe = 1`, /permission denied|no se modifican/);

console.log('\n3) Asiento automático de un comprobante y pendientes');
const pend = async () => (await db.query(`select origen_tabla, origen_id, accion, asiento_id from v_pendientes_contabilizar`)).rows;
check('la factura aparece pendiente de contabilizar', (await pend()).some((p) => p.origen_id === fac && p.accion === 'contabilizar'));
const AUTO = { fecha: '2026-11-23', tipo: 'automatico', origen_tabla: 'comprobantes_venta', origen_id: fac, evento: 'alta', descripcion: 'Factura A 00003-00000125',
  lineas: [{ cuenta_id: deudores, debe: 1210000 }, { cuenta_id: ventas, haber: 1000000 }, { cuenta_id: ivadf, haber: 210000 }] };
const a2 = await reg(U3, AUTO);
check('asiento N° 2 vinculado a la factura; ya no está pendiente', (await uno(`select numero, origen_id from asientos where id='${a2}'`)).origen_id === fac && !(await pend()).some((p) => p.origen_id === fac));
await falla('el mismo comprobante no se contabiliza dos veces', U3, `select fn_registrar_asiento($1::jsonb)`, /ya tiene su asiento/, [JSON.stringify(AUTO)]);
await falla('un asiento automático necesita su origen', U3, `select fn_registrar_asiento($1::jsonb)`, /check/, [JSON.stringify({ ...AUTO, origen_id: null })]);

console.log('\n4) Anulación con contraasiento');
await comoQ(U1, `select fn_anular_comprobante_venta($1, 'Error de carga')`, [fac]);
check('anulada la factura, su asiento queda pendiente "anular"', (await pend()).some((p) => p.origen_id === fac && p.accion === 'anular' && p.asiento_id === a2));
await falla('anular sin motivo es rechazado', U3, `select fn_anular_asiento('${a2}', '')`, /motivo/);
const ca = (await comoQ(U3, `select fn_anular_asiento($1, 'Se anuló el comprobante de origen') id`, [a2])).rows[0].id;
const caR = await uno(`select numero, tipo, anula_a_id, total from asientos where id='${ca}'`);
check('contraasiento N° 3 por el mismo total, que anula al N° 2', caR.numero === 3 && caR.tipo === 'anulacion' && caR.anula_a_id === a2 && n(caR.total) === 1210000);
check('el asiento original queda "anulado" con su motivo', (await uno(`select estado, motivo from asientos where id='${a2}'`)).estado === 'anulado');
const sd = await uno(`select sum(debe - haber) s from asiento_lineas where cuenta_id='${deudores}'`);
check('deudores vuelve a cero', n(sd.s) === 0);
check('ya no queda nada pendiente de esa factura', !(await pend()).some((p) => p.origen_id === fac));
await falla('un asiento anulado no se vuelve a anular', U3, `select fn_anular_asiento('${a2}', 'x')`, /ya está anulado/);
await falla('un contraasiento no se anula', U3, `select fn_anular_asiento('${ca}', 'x')`, /no se anula/);

console.log('\n5) Cierre de mes');
const fac2 = (await comoQ(U1, `select fn_registrar_comprobante_venta($1::jsonb) id`, [JSON.stringify({ cliente_id: cli, tipo_codigo: '1', punto_venta: 3, numero: 126,
  fecha: '2026-11-25', alicuotas: [{ alicuota: 'IVA_21', neto: 500000, iva: 105000 }] })])).rows[0].id;
await falla('no se cierra noviembre con comprobantes sin contabilizar', U3, `select fn_cerrar_periodo(2026, 11)`, /sin contabilizar/);
await reg(U3, { ...AUTO, origen_id: fac2, fecha: '2026-11-25', lineas: [{ cuenta_id: deudores, debe: 605000 }, { cuenta_id: ventas, haber: 500000 }, { cuenta_id: ivadf, haber: 105000 }] });
await falla('el operador no cierra meses', U2, `select fn_cerrar_periodo(2026, 11)`, /Solo el administrador o el contador/);
await comoQ(U3, `select fn_cerrar_periodo(2026, 11)`);
check('noviembre cerrado por el contador', (await uno(`select estado, cerrado_por from periodos where anio=2026 and mes=11`)).cerrado_por === U3);
await falla('CRITERIO: no se carga una factura en un mes cerrado', U1, `select fn_registrar_comprobante_venta($1::jsonb)`, /cerrado/,
  [JSON.stringify({ cliente_id: cli, tipo_codigo: '1', punto_venta: 3, numero: 127, fecha: '2026-11-28', alicuotas: [{ alicuota: 'IVA_21', neto: 100, iva: 21 }] })]);
await falla('CRITERIO: no se carga un asiento en un mes cerrado', U3, `select fn_registrar_asiento($1::jsonb)`, /cerrado/,
  [JSON.stringify({ fecha: '2026-11-30', tipo: 'manual', descripcion: 'x', lineas: [{ cuenta_id: banco, debe: 1 }, { cuenta_id: capital, haber: 1 }] })]);
await comoE(U3, `insert into cuentas_tesoreria (nombre, tipo) values ('Caja', 'caja')`);
await falla('CRITERIO: no se carga un gasto de caja en un mes cerrado', U3, `insert into movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe) select id, '2026-11-30', 'egreso', 'otro', 1 from cuentas_tesoreria`, /cerrado/);
await falla('no se anula un comprobante de un mes cerrado', U1, `select fn_anular_comprobante_venta('${fac2}', 'x')`, /cerrado/);
await falla('nadie cambia el estado de un mes a mano', U1, `update periodos set estado='abierto' where mes=11`, /permission denied/);
await falla('reabrir sin motivo es rechazado', U3, `select fn_reabrir_periodo(2026, 11, '')`, /motivo/);
await comoQ(U3, `select fn_reabrir_periodo(2026, 11, 'Falta una factura de compra del 28/11')`);
check('reabierto con motivo; queda en la auditoría', (await uno(`select estado, motivo from periodos where mes=11`)).estado === 'abierto'
  && (await uno(`select count(*)::int c from auditoria where tabla='periodos' and accion='MODIFICACION'`)).c >= 2);

console.log('\n6) Cierre del ejercicio');
await reg(U3, { fecha: '2026-12-15', tipo: 'manual', descripcion: 'Gastos bancarios', lineas: [{ cuenta_id: await cta('6.2.01'), debe: 50000 }, { cuenta_id: banco, haber: 50000 }] });
const tot = await uno(`select sum(debe) d, sum(haber) h from asiento_lineas`);
check('la suma de todos los asientos da debe = haber', n(tot.d) === n(tot.h));
await comoQ(U3, `select fn_cerrar_ejercicio(2026)`);
const tipos = (await db.query(`select tipo, fecha::text f from asientos where tipo in ('refundicion','cierre','apertura') order by fecha, numero`)).rows;
check('se generan refundición y cierre al 31/12 y apertura al 01/01', tipos.map((t) => t.tipo).join() === 'refundicion,cierre,apertura' && tipos[2].f === '2027-01-01', JSON.stringify(tipos));
const s26 = await uno(`select count(*)::int c from (select l.cuenta_id from asiento_lineas l join asientos a on a.id = l.asiento_id join ejercicios e on e.id = a.ejercicio_id
  where e.anio = 2026 group by l.cuenta_id having sum(l.debe - l.haber) <> 0) x`);
check('después del cierre, todas las cuentas de 2026 quedan en cero', s26.c === 0);
const ap = await uno(`select sum(l.debe - l.haber) filter (where c.codigo = '3.1.02') noasig, sum(l.debe - l.haber) filter (where c.codigo = '1.1.1.02') banco,
  bool_or(c.codigo = '3.1.03') res from asiento_lineas l join asientos a on a.id = l.asiento_id join plan_cuentas c on c.id = l.cuenta_id where a.tipo = 'apertura'`);
check('apertura 2027: banco $2.950.000 y el resultado ($1.000.000 − $50.000) en Resultados no asignados', n(ap.banco) === 2950000 && n(ap.noasig) === -450000 && ap.res === false, JSON.stringify(ap));
check('el ejercicio 2027 empieza con numeración propia (N° 1)', (await uno(`select a.numero from asientos a where tipo='apertura'`)).numero === 1);
await falla('no se registra nada en un ejercicio cerrado', U3, `select fn_registrar_asiento($1::jsonb)`, /cerrado/,
  [JSON.stringify({ fecha: '2026-12-20', tipo: 'manual', descripcion: 'x', lineas: [{ cuenta_id: banco, debe: 1 }, { cuenta_id: capital, haber: 1 }] })]);
await falla('no se reabre un mes de un ejercicio cerrado', U3, `select fn_reabrir_periodo(2026, 12, 'x')`, /ejercicio de ese mes está cerrado/);
await falla('una cuenta con asientos no deja de ser imputable', U1, `update plan_cuentas set imputable = false where codigo = '1.1.1.02'`, /ya tiene asientos/);

console.log('\n7) Configuración y auditoría');
await comoE(U3, `update imputaciones_contables set cuenta_id = '${await cta('4.1.02')}' where clave = 'VENTAS'`);
check('el contador cambia la cuenta de un concepto', (await uno(`select c.codigo from imputaciones_contables i join plan_cuentas c on c.id = i.cuenta_id where clave='VENTAS'`)).codigo === '4.1.02');
await falla('la configuración no acepta una cuenta madre', U3, `update imputaciones_contables set cuenta_id = '${activo}' where clave = 'VENTAS'`, /imputable/);
await comoE(U2, `update imputaciones_contables set cuenta_id = null where clave = 'VENTAS'`);
check('el operador no cambia la configuración', (await uno(`select cuenta_id from imputaciones_contables where clave='VENTAS'`)).cuenta_id !== null);
const au = await uno(`select count(distinct tabla)::int t from auditoria where tabla in ('asientos','asiento_lineas','ejercicios','imputaciones_contables')`);
check('auditoría registra asientos, líneas, ejercicios y configuración', au.t === 4);

console.log('\n8) Compatibilidad con las etapas anteriores');
await comoE(U1, `insert into proveedores (razon_social, cuit, condicion_iva) values ('Pinturerías Córdoba (DEMO)', '30500000003', 'RI')`);
const prov = (await uno(`select id from proveedores`)).id;
try {
  await comoQ(U1, `select fn_registrar_comprobante_compra($1::jsonb)`, [JSON.stringify({ proveedor_id: prov, tipo_codigo: '1', punto_venta: 4, numero: 77, fecha: '2027-01-05',
    alicuotas: [{ alicuota: 'IVA_21', neto: 1000, iva: 210 }], imputaciones: [{ centro_costo_id: (await uno(`select id from centros_costo limit 1`)).id, porcentaje: 100, importe: 1000 }] })]);
  check('después de la 006 se siguen cargando facturas de compra con imputación', true);
} catch (e) { check('después de la 006 se siguen cargando facturas de compra con imputación', false, e.message); }

console.log(`\nResultado: ${ok} OK, ${mal} fallas`);
if (mal) process.exit(1);
