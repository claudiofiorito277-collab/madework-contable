// Prueba la migración 002 (contratos y certificados) sobre la 001, en un Postgres embebido (PGlite).
// Requiere "npm install". Correr con: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';

const db = new PGlite({ extensions: { btree_gist } });
let ok = 0, mal = 0;
const check = (n, c, extra = '') => { if (c) { ok++; console.log('  OK  ', n); } else { mal++; console.log('  FALLA', n, extra); } };
const U1 = '11111111-1111-1111-1111-111111111111';  // administrador
const U2 = '22222222-2222-2222-2222-222222222222';  // operador
const comoQ = async (uid, sql) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
};
const comoE = async (uid, sql) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await db.exec(sql); } finally { await db.exec('reset role;'); }
};
const falla = async (nombre, uid, sql, patron) => {
  try { await comoE(uid, sql); check(nombre, false, '(no dio error)'); }
  catch (e) { check(nombre, patron.test(e.message), `-> ${e.message}`); }
};
const uno = async (sql) => (await db.query(sql)).rows[0];

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

console.log('\n1) Aplicar migraciones 001 y 002');
await db.exec(leer('001_base.sql'));
try { await db.exec(leer('002_contratos.sql')); check('migración 002 aplicada sin errores', true); }
catch (e) { check('migración 002 aplicada sin errores', false, e.message); process.exit(1); }
await db.exec(`insert into auth.users values ('${U1}','claudio@demo.test'),('${U2}','mario@demo.test');
               update perfiles set rol='operador', activo=true where id='${U2}';`);
check('bucket privado "adjuntos" creado', (await uno(`select public from storage.buckets where id='adjuntos'`))?.public === false);

console.log('\n2) Cliente, contrato e ítems');
await comoE(U1, `insert into clientes (razon_social) values ('Caminos de las Sierras S.A. (DEMO)')`);
const cli = (await uno(`select id from clientes`)).id;
await falla('operador no puede crear contratos', U2,
  `insert into contratos (codigo, cliente_id, descripcion) values ('X', '${cli}', 'x')`, /row-level security/);
await comoE(U1, `insert into contratos (codigo, cliente_id, descripcion, numero_concurso, ruta, km_desde, km_hasta, plazo_dias, fecha_acta_replanteo,
                 pago_dia_semana, anticipo_pct, anticipo_descuento_pct)
                 values ('E55', '${cli}', 'Pintura columnas de iluminación RP-E55', '2026/0115', 'RP E55', 0, 32.6, 90, '2026-11-10', 5, 20, 20)`);
const ctr = await uno(`select c.id, cc.codigo cc from contratos c join centros_costo cc on cc.id = c.centro_costo_id`);
check('el contrato crea su centro de costo automáticamente', ctr?.cc === 'E55');
await comoE(U1, `insert into contrato_items (contrato_id, codigo, descripcion, unidad, cantidad, precio_unitario, costo_mano_obra, costo_materiales, costo_equipos)
                 values ('${ctr.id}', '1', 'Pintado de columnas', 'CU', 539, 172670, 22486.09, 6200, 13974.04)`);
const it = await uno(`select i.id, cc.codigo cc from contrato_items i join centros_costo cc on cc.id = i.centro_costo_id`);
check('el ítem crea su centro de costo (E55-1)', it?.cc === 'E55-1');
const v = await uno(`select monto_contractual, fecha_fin_prevista::text f from v_contratos`);
check('vista: monto contractual $93.069.130 y fin de plazo 08/02/2027', Number(v.monto_contractual) === 93069130 && v.f === '2027-02-08', JSON.stringify(v));

console.log('\n3) Registro de columnas (avance)');
await comoE(U2, `insert into contrato_tramos (contrato_id, orden, nombre, cantidad_prevista) values ('${ctr.id}', 1, 'Tropezón - Peaje', 168)`);
const tr = (await uno(`select id from contrato_tramos`)).id;
await comoE(U2, `insert into avance_unidades (contrato_id, item_id, tramo_id, identificador, progresiva_km, fecha_ejecucion, estado, inspector, fecha_aprobacion)
                 select '${ctr.id}', '${it.id}', '${tr}', 'C-' || g, g * 0.05, '2026-11-12', 'aprobada', 'Insp. DEMO', '2026-11-13' from generate_series(1, 3) g`);
await comoE(U2, `insert into avance_unidades (contrato_id, item_id, identificador, estado) values ('${ctr.id}', '${it.id}', 'C-4', 'ejecutada')`);
check('operador carga columnas pintadas y aprobadas', (await uno(`select count(*)::int n from avance_unidades`)).n === 4);
await falla('una columna repetida es rechazada', U2,
  `insert into avance_unidades (contrato_id, item_id, identificador) values ('${ctr.id}', '${it.id}', 'C-1')`, /duplicate key/);
await falla('aprobada sin fecha de aprobación es rechazada', U2,
  `insert into avance_unidades (contrato_id, item_id, identificador, estado) values ('${ctr.id}', '${it.id}', 'C-9', 'aprobada')`, /check/);
check('vista: 3 unidades por certificar', Number((await uno(`select unidades_por_certificar u from v_contratos`)).u) === 3);

console.log('\n4) Certificados');
await comoE(U2, `insert into certificados (contrato_id, periodo_desde, periodo_hasta) values ('${ctr.id}', '2026-11-09', '2026-11-13')`);
const c1 = await uno(`select id, numero, estado from certificados`);
check('certificado nuevo: N° 1 en borrador', c1.numero === 1 && c1.estado === 'borrador');
await comoE(U2, `insert into certificado_items (certificado_id, item_id, cantidad, precio_unitario, importe) values ('${c1.id}', '${it.id}', 3, 172670, 518010);
                 update avance_unidades set certificado_id = '${c1.id}' where estado = 'aprobada';
                 update certificados set bruto = 518010, base_factura = 414408, descuento_anticipo = 103602, iva = 87025.68, total_factura = 501433.68, neto_a_cobrar = 501433.68 where id = '${c1.id}'`);
await falla('no se puede certificar una columna no aprobada', U2,
  `update avance_unidades set certificado_id = '${c1.id}' where identificador = 'C-4'`, /aprobadas/);
await falla('total de factura inconsistente es rechazado', U2,
  `update certificados set total_factura = 1 where id = '${c1.id}'`, /check/);
await comoE(U2, `update certificados set estado = 'presentado' where id = '${c1.id}'`);
check('operador presenta el certificado (se verifica bruto = ítems)', (await uno(`select estado, fecha_presentacion from certificados`)).estado === 'presentado');
await falla('presentado: los importes ya no se pueden cambiar', U1, `update certificados set bruto = 1 where id = '${c1.id}'`, /solo se pueden modificar importes en borrador/);
await falla('presentado: los ítems quedan bloqueados', U1, `update certificado_items set cantidad = 5`, /ya no se pueden modificar/);
await falla('presentado: una columna certificada no se puede modificar', U1, `update avance_unidades set estado = 'observada' where identificador = 'C-1'`, /ya está en el certificado/);
await falla('operador no puede aprobar', U2, `update certificados set estado = 'aprobado' where id = '${c1.id}'`, /Solo el administrador o el contador/);
await falla('saltear estados no está permitido (presentado → cobrado)', U1, `update certificados set estado = 'cobrado' where id = '${c1.id}'`, /No se puede pasar/);
await comoE(U1, `update certificados set estado = 'aprobado' where id = '${c1.id}'`);
check('administrador aprueba (queda la fecha de aprobación)', (await uno(`select fecha_aprobacion from certificados`)).fecha_aprobacion !== null);
const v2 = await uno(`select certificado_bruto, cantidad_certificada, anticipo_descontado, unidades_por_certificar from v_contratos`);
check('vista: certificado $518.010, 3 columnas, anticipo descontado $103.602', Number(v2.certificado_bruto) === 518010 && Number(v2.cantidad_certificada) === 3 && Number(v2.anticipo_descontado) === 103602 && Number(v2.unidades_por_certificar) === 0, JSON.stringify(v2));

await comoE(U2, `insert into certificados (contrato_id, periodo_desde, periodo_hasta) values ('${ctr.id}', '2026-11-16', '2026-11-20')`);
const c2 = await uno(`select id, numero from certificados where numero = 2`);
check('el siguiente certificado es el N° 2', c2?.numero === 2);
await falla('anular sin motivo es rechazado', U1, `update certificados set estado = 'anulado' where id = '${c2.id}'`, /motivo/);
await falla('operador no puede anular', U2, `update certificados set estado = 'anulado', motivo = 'x' where id = '${c2.id}'`, /Solo el administrador o el contador/);
await comoE(U1, `update certificados set estado = 'anulado', motivo = 'Prueba' where id = '${c2.id}'`);
check('administrador anula con motivo; el número se conserva', (await uno(`select estado, numero from certificados where id = '${c2.id}'`)).estado === 'anulado');
await falla('presentar un certificado sin ítems es rechazado', U2,
  `insert into certificados (contrato_id, periodo_desde, periodo_hasta) values ('${ctr.id}', '2026-11-23', '2026-11-27');
   update certificados set estado = 'presentado' where numero = 3`, /no tiene ítems/);
await falla('nadie puede borrar certificados', U1, `delete from certificados where id = '${c2.id}'`, /permission denied/);

console.log('\n5) Multas, pólizas y adjuntos');
await comoE(U2, `insert into multas (contrato_id, fecha, motivo, referencia, litros, precio_litro, importe) values ('${ctr.id}', '2026-11-20', 'orden_servicio', 'OS 3', 600, 2300, 1380000)`);
check('se registra una multa de 600 L', Number((await uno(`select importe from multas`)).importe) === 1380000);
await comoE(U2, `update multas set importe = 0`);  // sin permiso: RLS no modifica ninguna fila
check('operador no puede modificar multas (el importe no cambió)',Number((await uno(`select importe from multas`)).importe) === 1380000);
await comoE(U2, `insert into polizas (contrato_id, tipo, aseguradora, suma_asegurada, franquicia, vigencia_desde, vigencia_hasta) values ('${ctr.id}', 'responsabilidad_civil', 'Aseguradora DEMO', 100000000, 10000000, '2026-11-10', '2027-02-10')`);
check('se registra la póliza de RC', (await uno(`select count(*)::int n from polizas`)).n === 1);
await comoE(U2, `insert into adjuntos (tabla, registro_id, nombre, ruta) values ('certificados', '${c1.id}', 'planilla.pdf', 'certificados/${c1.id}/planilla.pdf')`);
check('adjunto registrado con el usuario que lo subió', (await uno(`select subido_por from adjuntos`)).subido_por === U2);
check('auditoría registra contratos, certificados y avance', (await uno(`select count(distinct tabla)::int n from auditoria where tabla in ('contratos','certificados','avance_unidades','multas','polizas')`)).n === 5);

console.log(`\nResultado: ${ok} OK, ${mal} fallas`);
process.exit(mal ? 1 : 0);
