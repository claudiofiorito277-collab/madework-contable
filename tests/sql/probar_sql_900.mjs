// Prueba el borrado de datos DEMO (sql/900_borrar_demo.sql) sobre las migraciones 001 a 007, en PGlite.
// Criterio de la Etapa 9: borro los datos DEMO, cargo mis datos reales de empresa y el contrato real.
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';

const db = new PGlite({ extensions: { btree_gist } });
let ok = 0, mal = 0;
const check = (n, c, extra = '') => { if (c) { ok++; console.log('  OK  ', n); } else { mal++; console.log('  FALLA', n, extra); } };
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const como = async (uid, fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const comoE = (uid, sql) => como(uid, () => db.exec(sql));
const comoQ = (uid, sql, params) => como(uid, () => db.query(sql, params));
const uno = async (sql) => (await db.query(sql)).rows[0];
const J = (o) => [JSON.stringify(o)];
const n = async (t) => (await uno(`select count(*)::int c from public.${t}`)).c;

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
for (const f of ['001_base.sql', '002_contratos.sql', '003_ventas.sql', '004_compras.sql', '005_tesoreria.sql', '006_contabilidad.sql', '007_costos.sql', '008_seguridad.sql']) await db.exec(leer(f));
await db.exec(`insert into auth.users values ('${U1}','claudio@demo.test'),('${U2}','mario@demo.test'); update perfiles set rol='operador', activo=true where id='${U2}';`);

console.log('\n1) Datos DEMO de todas las etapas');
await comoE(U1, `insert into clientes (razon_social, cuit) values ('Caminos de las Sierras S.A. (DEMO)', '30712345671')`);
const cli = (await uno(`select id from clientes`)).id;
await comoE(U1, `insert into contratos (codigo, cliente_id, descripcion) values ('E55-DEMO', '${cli}', 'Pintura columnas (DEMO)')`);
const ctr = (await uno(`select id from contratos`)).id;
await comoE(U1, `insert into contrato_items (contrato_id, codigo, descripcion, unidad, cantidad, precio_unitario) values ('${ctr}', '1', 'Pintura de columnas', 'u', 400, 172670)`);
const it = (await uno(`select id from contrato_items`)).id;
await comoQ(U1, `select fn_registrar_comprobante_venta($1::jsonb)`, J({ cliente_id: cli, contrato_id: ctr, tipo_codigo: '1', punto_venta: 3, numero: 125, fecha: '2026-11-10', alicuotas: [{ alicuota: 'IVA_21', neto: 1000000, iva: 210000 }] }));
await comoE(U1, `insert into proveedores (razon_social, cuit, condicion_iva) values ('Pinturerías (DEMO)', '30500000003', 'RI')`);
const prov = (await uno(`select id from proveedores`)).id;
await comoQ(U1, `select fn_registrar_comprobante_compra($1::jsonb)`, J({ proveedor_id: prov, tipo_codigo: '1', punto_venta: 4, numero: 1520, fecha: '2026-11-10',
  alicuotas: [{ alicuota: 'IVA_21', neto: 100000, iva: 21000 }], imputaciones: [{ contrato_id: ctr, item_id: it, categoria: 'materiales', porcentaje: 100, importe: 100000 }] }));
await comoE(U1, `insert into cuentas_tesoreria (nombre, tipo, saldo_inicial, fecha_saldo_inicial) values ('Galicia (DEMO)', 'banco', 1000, '2026-11-01')`);
const banco = (await uno(`select id from plan_cuentas where codigo='1.1.1.02'`)).id; const capital = (await uno(`select id from plan_cuentas where codigo='3.1.01'`)).id;
await comoQ(U1, `select fn_registrar_asiento($1::jsonb)`, J({ fecha: '2026-11-01', tipo: 'manual', descripcion: 'Aporte (DEMO)', lineas: [{ cuenta_id: banco, debe: 1000 }, { cuenta_id: capital, haber: 1000 }] }));
await comoE(U1, `insert into personal (nombre, cuadrilla) values ('Juan (DEMO)', 'A')`);
const per = (await uno(`select id from personal`)).id;
await comoQ(U2, `select fn_registrar_parte($1::jsonb)`, J({ fecha: '2026-11-10', contrato_id: ctr, item_id: it, cantidad_producida: 10, personal: [{ personal_id: per, jornales: 1 }] }));
await comoE(U1, `insert into materiales (codigo, nombre, unidad) values ('PINT', 'Pintura (DEMO)', 'l')`);
await comoQ(U1, `select fn_registrar_indirecto($1::jsonb)`, J({ fecha: '2026-11-10', concepto: 'Póliza (DEMO)', importe: 1000 }));
const antes = { clientes: await n('clientes'), contratos: await n('contratos'), comprobantes_venta: await n('comprobantes_venta'), comprobantes_compra: await n('comprobantes_compra'),
  asientos: await n('asientos'), partes_diarios: await n('partes_diarios'), auditoria: await n('auditoria'), centros: await n('centros_costo') };
check('hay datos DEMO en ventas, compras, tesorería, contabilidad y costos', Object.values(antes).every((x) => x > 0), JSON.stringify(antes));

console.log('\n2) Sin confirmar no se borra nada');
const script = leer('900_borrar_demo.sql');
try { await db.exec(script); check('sin cambiar NO por SI, el script se frena', false); }
catch (e) { check('sin cambiar NO por SI, el script se frena con un mensaje claro', /No se borró nada/.test(e.message), e.message); }
await db.exec('rollback').catch(() => {});
check('los datos siguen intactos', await n('clientes') === antes.clientes && await n('asientos') === antes.asientos && await n('auditoria') === antes.auditoria);

console.log('\n3) Borrado confirmado');
const conSi = script.replace("set_config('mw.confirmo_borrar_demo', 'NO', true)", "set_config('mw.confirmo_borrar_demo', 'SI', true)");
check('el script tiene una sola línea para confirmar', conSi !== script);
try { await db.exec(conSi); check('el borrado corre sin errores', true); } catch (e) { check('el borrado corre sin errores', false, e.message); process.exit(1); }
const operativas = ['clientes', 'contratos', 'contrato_items', 'certificados', 'comprobantes_venta', 'comprobante_venta_alicuotas', 'cobranzas', 'proveedores', 'comprobantes_compra',
  'comprobante_compra_imputaciones', 'pagos', 'cuentas_tesoreria', 'movimientos_tesoreria', 'cheques', 'asientos', 'asiento_lineas', 'ejercicios', 'personal', 'personal_tarifas',
  'partes_diarios', 'parte_personal', 'materiales', 'material_movimientos', 'costos_indirectos', 'adjuntos'];
const quedan = [];
for (const t of operativas) if (await n(t)) quedan.push(t);
check(`las ${operativas.length} tablas operativas quedan vacías`, !quedan.length, quedan.join(', '));
check('se conserva la configuración: empresa, usuarios, parámetros, tipos, plan de cuentas e imputaciones',
  await n('empresa') === 1 && await n('perfiles') === 2 && await n('parametros_fiscales') > 10 && await n('tipos_comprobante') > 10 && await n('plan_cuentas') > 80 && await n('imputaciones_contables') === 38);
check('el usuario operador conserva su rol', (await uno(`select rol from perfiles where id='${U2}'`)).rol === 'operador');
check('quedan solo los centros de costo generales (ADM)', JSON.stringify((await db.query(`select codigo from centros_costo order by codigo`)).rows.map((r) => r.codigo)) === '["ADM"]');
check('un solo mes abierto (el actual)', (await uno(`select count(*)::int c, bool_and(estado = 'abierto') a from periodos`)).c === 1);
check('el depósito central vuelve a estar', (await uno(`select string_agg(nombre, ',') d from depositos`)).d === 'Depósito central');
const au = await db.query(`select tabla, registro_id from auditoria`);
check('la auditoría arranca con un único registro del borrado', au.rows.length === 1 && au.rows[0].registro_id === 'borrado-demo', JSON.stringify(au.rows));

console.log('\n4) Datos reales después del borrado (criterio de aceptación)');
await comoE(U1, `update empresa set razon_social = 'Claudio Esteban Fiorito', nombre_fantasia = 'MADEWORK', cuit = '20111111112', domicilio = 'Córdoba' where id = 1`);
check('el administrador carga los datos reales de la empresa', (await uno(`select razon_social from empresa`)).razon_social === 'Claudio Esteban Fiorito');
await comoE(U1, `insert into clientes (razon_social, cuit) values ('Caminos de las Sierras S.A.', '30712345671')`);
const cli2 = (await uno(`select id from clientes`)).id;
await comoE(U1, `insert into contratos (codigo, cliente_id, descripcion, numero_concurso, ruta) values ('2026/0115', '${cli2}', 'Pintura de columnas RP-E55', '2026/0115', 'RP E55')`);
const ctr2 = (await uno(`select id from contratos`)).id;
await comoE(U1, `insert into contrato_items (contrato_id, codigo, descripcion, unidad, cantidad, precio_unitario) values ('${ctr2}', '1', 'Pintura de columnas', 'u', 400, 172670)`);
check('se carga el contrato real con su ítem y su centro de costo', (await uno(`select count(*)::int c from contrato_items`)).c === 1 && (await uno(`select centro_costo_id from contratos`)).centro_costo_id !== null);
await comoQ(U1, `select fn_registrar_comprobante_venta($1::jsonb)`, J({ cliente_id: cli2, contrato_id: ctr2, tipo_codigo: '1', punto_venta: 3, numero: 125, fecha: new Date().toISOString().slice(0, 10), alicuotas: [{ alicuota: 'IVA_21', neto: 1000, iva: 210 }] }));
check('el número de factura que usó la DEMO se puede usar de nuevo', await n('comprobantes_venta') === 1);
const a = (await comoQ(U1, `select fn_registrar_asiento($1::jsonb) id`, J({ fecha: new Date().toISOString().slice(0, 10), tipo: 'manual', descripcion: 'Saldos iniciales', lineas: [{ cuenta_id: banco, debe: 500 }, { cuenta_id: capital, haber: 500 }] }))).rows[0].id;
check('la numeración de asientos arranca de nuevo en 1', (await uno(`select numero from asientos where id='${a}'`)).numero === 1);
check('la auditoría registra los datos reales', await n('auditoria') > 1);

console.log('\n5) Preparar una base nueva para restaurar un respaldo (sql/990)');
const prep = leer('990_restaurar_preparar.sql');
let msg = '';
try { await db.exec(prep); } catch (e) { msg = e.message; }
await db.exec('rollback').catch(() => {});
check('sin confirmar, no vacía nada', /No se vació nada/.test(msg) && await n('clientes') === 1, msg);
await db.exec(prep.replace("'mw.confirmo_preparar_restauracion', 'NO'", "'mw.confirmo_preparar_restauracion', 'SI'"));
const llenas = (await db.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => r.tablename);
const conFilas = []; for (const t of llenas) if (await n(t)) conFilas.push(t);
check(`confirmado: las ${llenas.length} tablas quedan vacías para cargar el respaldo`, !conFilas.length, conFilas.join(', '));

console.log(`\nResultado: ${ok} OK, ${mal} fallas`);
if (mal) process.exit(1);
