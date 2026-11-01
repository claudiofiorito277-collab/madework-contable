// Prueba la migración 004 (compras y pagos) sobre la 001, 002 y 003, en un Postgres embebido (PGlite).
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

console.log('\n1) Aplicar migraciones 001 a 004');
for (const f of ['001_base.sql', '002_contratos.sql', '003_ventas.sql']) await db.exec(leer(f));
try { await db.exec(leer('004_compras.sql')); check('migración 004 aplicada sin errores', true); }
catch (e) { check('migración 004 aplicada sin errores', false, e.message); process.exit(1); }
await db.exec(`insert into auth.users values ('${U1}','claudio@demo.test'),('${U2}','mario@demo.test'),('${U3}','contador@demo.test'),('${U4}','consulta@demo.test');
               update perfiles set rol='operador', activo=true where id='${U2}';
               update perfiles set rol='contador', activo=true where id='${U3}';
               update perfiles set rol='consulta', activo=true where id='${U4}';`);
check('agente de retención desactivado por defecto', n((await uno(`select valor from parametros_fiscales where tipo='AGENTE_RETENCION'`)).valor) === 0);

// Contrato E55 con dos ítems
await comoE(U1, `insert into clientes (razon_social) values ('Caminos de las Sierras S.A. (DEMO)')`);
const cli = (await uno(`select id from clientes`)).id;
await comoE(U1, `insert into contratos (codigo, cliente_id, descripcion) values ('E55', '${cli}', 'Pintura columnas RP-E55')`);
const ctr = (await uno(`select id from contratos`)).id;
await comoE(U1, `insert into contrato_items (contrato_id, codigo, descripcion, unidad, cantidad, precio_unitario) values
  ('${ctr}', '1', 'Pintado de columnas', 'CU', 539, 172670), ('${ctr}', '2', 'Señalización de obra', 'GL', 1, 500000)`);
const i1 = (await uno(`select id from contrato_items where codigo='1'`)).id;
const i2 = (await uno(`select id from contrato_items where codigo='2'`)).id;
await comoE(U1, `insert into contratos (codigo, cliente_id, descripcion) values ('X01', '${cli}', 'Otra obra')`);
const ctr2 = (await uno(`select id from contratos where codigo='X01'`)).id;
await comoE(U1, `insert into contrato_items (contrato_id, codigo, descripcion, unidad, cantidad, precio_unitario) values ('${ctr2}', '1', 'Otro', 'GL', 1, 1)`);
const iOtro = (await uno(`select id from contrato_items where contrato_id='${ctr2}'`)).id;

console.log('\n2) Proveedores');
await comoE(U2, `insert into proveedores (razon_social, cuit, condicion_iva, categoria, cbu) values ('Pinturerías Córdoba S.A. (DEMO)', '30712345671', 'RI', 'pinturas', '0110599520000001234567')`);
check('el operador da de alta un proveedor (carga desde la obra)', (await uno(`select count(*)::int c from proveedores`)).c === 1);
const pRI = (await uno(`select id from proveedores where cuit='30712345671'`)).id;
await comoE(U1, `insert into proveedores (razon_social, cuit, condicion_iva, categoria) values ('Juan Pérez - pintor (DEMO)', '20111111112', 'MT', 'subcontratistas')`);
const pMT = (await uno(`select id from proveedores where cuit='20111111112'`)).id;
await falla('CUIT inválido rechazado', U1, `insert into proveedores (razon_social, cuit) values ('X', '30712345670')`, /cuit_check/);
await falla('CBU con menos de 22 dígitos rechazado', U1, `insert into proveedores (razon_social, cbu) values ('X', '0110599')`, /cbu_check/);
await falla('CUIT repetido rechazado', U1, `insert into proveedores (razon_social, cuit) values ('Otra', '30712345671')`, /duplicate key/);
await comoE(U2, `update proveedores set categoria='otros' where id='${pRI}'`);
check('el operador no modifica proveedores', (await uno(`select categoria from proveedores where id='${pRI}'`)).categoria === 'pinturas');

const reg = (uid, p) => comoQ(uid, `select fn_registrar_comprobante_compra($1::jsonb) id`, [JSON.stringify(p)]).then((r) => r.rows[0].id);
const FA = { proveedor_id: pRI, tipo_codigo: '1', punto_venta: 4, numero: 1520, fecha: '2026-11-18', vencimiento: '2026-12-18', descripcion: '200 L esmalte sintético',
  alicuotas: [{ alicuota: 'IVA_21', neto: 1700000, iva: 357000 }],
  percepciones: [{ tipo: 'PERC_IVA', importe: 51000 }, { tipo: 'PERC_IIBB_CBA', importe: 34000 }],
  imputaciones: [{ contrato_id: ctr, item_id: i1, categoria: 'materiales', porcentaje: 60, importe: 1020000 },
                 { contrato_id: ctr, item_id: i2, categoria: 'materiales', porcentaje: 40, importe: 680000 }] };

console.log('\n3) Factura A de pintura imputada 60/40 (criterio de aceptación)');
const fA = await reg(U2, FA);
const a = await uno(`select * from comprobantes_compra where id='${fA}'`);
check('factura A cargada por el operador: total $2.142.000 (neto + IVA + percepciones)', n(a.total) === 2142000, a.total);
check('crédito fiscal $357.000 (factura A de un RI)', a.genera_credito_fiscal === true && n(a.credito_fiscal) === 357000);
check('costo de obra $1.700.000 (sin IVA ni percepciones)', n(a.costo) === 1700000);
check('queda "a revisar" porque la cargó el operador', a.revisado === false);
const imp = (await db.query(`select porcentaje, importe from comprobante_compra_imputaciones where comprobante_id='${fA}' order by importe desc`)).rows;
check('imputación 60/40: $1.020.000 al ítem 1 y $680.000 al ítem 2', n(imp[0].importe) === 1020000 && n(imp[1].importe) === 680000 && n(imp[0].porcentaje) === 60);
check('2 percepciones registradas', (await uno(`select count(*)::int c from comprobante_compra_percepciones where comprobante_id='${fA}'`)).c === 2);

console.log('\n4) Duplicados');
await falla('CRITERIO: el mismo comprobante otra vez es frenado', U2, `select fn_registrar_comprobante_compra($1::jsonb)`, /COMPROBANTE DUPLICADO/, [JSON.stringify(FA)]);
await falla('el contador no puede forzar un duplicado', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /Solo el administrador/,
  [JSON.stringify({ ...FA, forzar_duplicado: true, motivo_duplicado: 'x' })]);
await falla('el administrador tiene que dar el motivo', U1, `select fn_registrar_comprobante_compra($1::jsonb)`, /motivo/,
  [JSON.stringify({ ...FA, forzar_duplicado: true })]);
const fDup = await reg(U1, { ...FA, forzar_duplicado: true, motivo_duplicado: 'El proveedor repitió la numeración (nota del 18/11)' });
check('el administrador lo fuerza con motivo y queda marcado', (await uno(`select duplicado_autorizado d from comprobantes_compra where id='${fDup}'`)).d === true);
await comoQ(U1, `select fn_anular_comprobante_compra($1, 'Prueba de duplicado')`, [fDup]);
check('el duplicado forzado se anula con motivo', (await uno(`select estado from comprobantes_compra where id='${fDup}'`)).estado === 'anulado');
await falla('otro tipo, mismo número: no es duplicado pero sí controla la letra', U2, `select fn_registrar_comprobante_compra($1::jsonb)`, /Responsable Inscripto no emite comprobantes C/,
  [JSON.stringify({ ...FA, tipo_codigo: '11', alicuotas: [], percepciones: [], sin_discriminar: 1700000, imputaciones: [{ contrato_id: ctr, porcentaje: 100, importe: 1700000 }] })]);

console.log('\n5) Factura C de monotributista (criterio de aceptación)');
const FC = { proveedor_id: pMT, tipo_codigo: '11', punto_venta: 2, numero: 37, fecha: '2026-11-19', vencimiento: '2026-11-26', descripcion: 'Mano de obra pintura semana 1',
  sin_discriminar: 450000, imputaciones: [{ contrato_id: ctr, item_id: i1, categoria: 'mano_obra', porcentaje: 100, importe: 450000 }] };
const fC = await reg(U3, FC);
const c = await uno(`select * from comprobantes_compra where id='${fC}'`);
check('factura C: sin crédito fiscal y todo es costo ($450.000)', c.genera_credito_fiscal === false && n(c.credito_fiscal) === 0 && n(c.costo) === 450000);
check('cargada por el contador: queda revisada', c.revisado === true);
await falla('monotributista con factura A es rechazada', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /monotributista emite comprobantes C/,
  [JSON.stringify({ ...FA, proveedor_id: pMT, numero: 99 })]);
await falla('factura C con IVA discriminado es rechazada', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /no discrimina IVA/,
  [JSON.stringify({ ...FC, numero: 38, sin_discriminar: 0, alicuotas: [{ alicuota: 'IVA_21', neto: 100, iva: 21 }], imputaciones: [{ contrato_id: ctr, porcentaje: 100, importe: 100 }] })]);

console.log('\n6) Controles de importes e imputación');
await falla('imputación que suma 90 % es rechazada', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /sumar 100/,
  [JSON.stringify({ ...FC, numero: 40, imputaciones: [{ contrato_id: ctr, porcentaje: 90, importe: 450000 }] })]);
await falla('importes imputados que no suman el costo', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /no suman el costo/,
  [JSON.stringify({ ...FC, numero: 41, imputaciones: [{ contrato_id: ctr, porcentaje: 100, importe: 400000 }] })]);
await falla('ítem de otro contrato es rechazado', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /no pertenece al contrato/,
  [JSON.stringify({ ...FC, numero: 42, imputaciones: [{ contrato_id: ctr, item_id: iOtro, porcentaje: 100, importe: 450000 }] })]);
await falla('compra sin imputar es rechazada', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /Falta imputar/,
  [JSON.stringify({ ...FC, numero: 43, imputaciones: [] })]);
await falla('IVA que no cuadra con la alícuota es rechazado', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /no cuadra/,
  [JSON.stringify({ ...FA, numero: 1600, alicuotas: [{ alicuota: 'IVA_21', neto: 1700000, iva: 350000 }] })]);
await falla('la consulta no carga comprobantes', U4, `select fn_registrar_comprobante_compra($1::jsonb)`, /permiso/, [JSON.stringify({ ...FC, numero: 44 })]);
await falla('nadie inserta directo en la tabla', U1, `insert into comprobantes_compra (proveedor_id, tipo_codigo, clase, letra, punto_venta, numero, fecha, total) values ('${pRI}','1','factura','A',1,1,'2026-11-18',1)`, /permission denied/);

console.log('\n7) Nota de crédito');
const NC = { proveedor_id: pRI, tipo_codigo: '3', punto_venta: 4, numero: 88, fecha: '2026-11-20', comprobante_asociado_id: fA, descripcion: 'Bonificación',
  alicuotas: [{ alicuota: 'IVA_21', neto: 100000, iva: 21000 }], imputaciones: [{ contrato_id: ctr, item_id: i1, categoria: 'materiales', porcentaje: 100, importe: 100000 }] };
const nc = await reg(U3, NC);
check('NC de $121.000 baja el saldo de la factura a $2.021.000', n((await uno(`select saldo from v_comprobantes_compra where id='${fA}'`)).saldo) === 2021000);
await falla('NC sin factura asociada', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /comprobante_asociado_id|asociado/, [JSON.stringify({ ...NC, numero: 89, comprobante_asociado_id: null })]);
await falla('NC mayor que lo que queda', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /supera/,
  [JSON.stringify({ ...NC, numero: 90, alicuotas: [{ alicuota: 'IVA_21', neto: 1700000, iva: 357000 }], imputaciones: [{ contrato_id: ctr, porcentaje: 100, importe: 1700000 }] })]);

console.log('\n8) Pagos');
const pagar = (uid, p) => comoQ(uid, `select fn_registrar_pago($1::jsonb) id`, [JSON.stringify(p)]).then((r) => r.rows[0].id);
await falla('el operador no registra pagos', U2, `select fn_registrar_pago($1::jsonb)`, /Solo el administrador o el contador/,
  [JSON.stringify({ proveedor_id: pRI, fecha: '2026-11-25', medios: [{ medio: 'transferencia', importe: 1 }] })]);
await falla('con el agente de retención desactivado no se cargan retenciones', U3, `select fn_registrar_pago($1::jsonb)`, /agente de retención/,
  [JSON.stringify({ proveedor_id: pRI, fecha: '2026-11-25', medios: [{ medio: 'transferencia', importe: 980000 }], retenciones: [{ tipo: 'RET_GANANCIAS', importe: 20000 }], aplicaciones: [{ comprobante_id: fA, importe: 1000000 }] })]);
await falla('aplicar más que el saldo es rechazado', U3, `select fn_registrar_pago($1::jsonb)`, /saldo/,
  [JSON.stringify({ proveedor_id: pMT, fecha: '2026-11-25', medios: [{ medio: 'efectivo', importe: 500000 }], aplicaciones: [{ comprobante_id: fC, importe: 500000 }] })]);
await falla('aplicar a un comprobante de otro proveedor es rechazado', U3, `select fn_registrar_pago($1::jsonb)`, /otro proveedor/,
  [JSON.stringify({ proveedor_id: pMT, fecha: '2026-11-25', medios: [{ medio: 'efectivo', importe: 100 }], aplicaciones: [{ comprobante_id: fA, importe: 100 }] })]);
const pg1 = await pagar(U3, { proveedor_id: pRI, fecha: '2026-11-25', medios: [{ medio: 'transferencia', importe: 1000000, banco: 'Galicia', numero: 'OP-1' }], aplicaciones: [{ comprobante_id: fA, importe: 1000000 }] });
check('orden de pago N° 1: saldo de la factura $1.021.000', n((await uno(`select saldo from v_comprobantes_compra where id='${fA}'`)).saldo) === 1021000 && (await uno(`select numero from pagos where id='${pg1}'`)).numero === 1);
const pg2 = await pagar(U3, { proveedor_id: pMT, fecha: '2026-11-26', medios: [{ medio: 'efectivo', importe: 500000 }], aplicaciones: [{ comprobante_id: fC, importe: 450000 }] });
check('pago al monotributista con $50.000 de anticipo a cuenta', n((await uno(`select a_cuenta from pagos where id='${pg2}'`)).a_cuenta) === 50000 && n((await uno(`select saldo from v_comprobantes_compra where id='${fC}'`)).saldo) === 0);

console.log('\n9) Retenciones practicadas (activando el agente)');
await comoQ(U1, `select fn_nueva_vigencia('AGENTE_RETENCION', 'ACTIVO', 1, '2026-11-27', 'Prueba', false)`);
const pg3 = await pagar(U3, { proveedor_id: pRI, fecha: '2026-11-27', medios: [{ medio: 'echeq', importe: 1000000 }],
  retenciones: [{ tipo: 'RET_GANANCIAS', numero_certificado: 'R-1', base: 1700000, alicuota: 1.2353, importe: 21000 }], aplicaciones: [{ comprobante_id: fA, importe: 1021000 }] });
check('con el agente activo, pago con retención salda la factura', n((await uno(`select saldo from v_comprobantes_compra where id='${fA}'`)).saldo) === 0 && n((await uno(`select importe_retenciones r from pagos where id='${pg3}'`)).r) === 21000);

console.log('\n10) Anulaciones e inmutabilidad');
await falla('no se anula una factura con pagos', U1, `select fn_anular_comprobante_compra('${fA}', 'x')`, /pagos aplicados/);
await falla('anular un pago sin motivo es rechazado', U1, `select fn_anular_pago('${pg3}', '')`, /motivo/);
await comoQ(U1, `select fn_anular_pago($1, 'Echeq rechazado')`, [pg3]);
check('al anular el pago vuelve el saldo ($1.021.000)', n((await uno(`select saldo from v_comprobantes_compra where id='${fA}'`)).saldo) === 1021000);
await falla('un pago anulado no se modifica', U1, `select fn_actualizar_pago('${pg3}', 'x')`, /anulado/);
await comoQ(U3, `select fn_actualizar_comprobante_compra($1, $2::jsonb)`, [fA, JSON.stringify({ revisado: true, vencimiento: '2026-12-20' })]);
check('el contador marca revisado y cambia el vencimiento', (await uno(`select revisado from comprobantes_compra where id='${fA}'`)).revisado === true);
await falla('el operador no marca revisado', U2, `select fn_actualizar_comprobante_compra('${fA}', '{"revisado": true}')`, /Solo el administrador o el contador/);
await falla('nadie borra comprobantes', U1, `delete from comprobantes_compra`, /permission denied/);
await falla('nadie modifica imputaciones', U1, `update comprobante_compra_imputaciones set importe = 1`, /permission denied/);

console.log('\n11) Órdenes de compra');
await comoE(U2, `insert into ordenes_compra (proveedor_id, contrato_id, descripcion, importe_estimado) values ('${pRI}', '${ctr}', '400 L esmalte', 3400000)`);
const oc = await uno(`select * from ordenes_compra`);
check('el operador crea la orden de compra N° 1', oc.numero === 1 && oc.estado === 'abierta');
await falla('una factura de otro proveedor no se vincula a esa OC', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /otro proveedor/,
  [JSON.stringify({ ...FC, numero: 50, orden_compra_id: oc.id })]);
const fOC = await reg(U3, { ...FA, numero: 1700, orden_compra_id: oc.id });
check('factura vinculada a la OC', (await uno(`select orden_compra_numero n from v_comprobantes_compra where id='${fOC}'`)).n === 1);
await comoE(U3, `update ordenes_compra set estado='cumplida' where id='${oc.id}'`);
check('la OC se marca cumplida', (await uno(`select estado from ordenes_compra where id='${oc.id}'`)).estado === 'cumplida');
await falla('anular una OC sin motivo es rechazado', U3, `update ordenes_compra set estado='anulada' where id='${oc.id}'`, /check/);

console.log('\n12) Costos imputados y período cerrado');
const cost = await uno(`select sum(importe_con_signo) t, sum(importe_con_signo) filter (where item_id='${i1}') i1 from v_costos_imputados where contrato_id='${ctr}'`);
check('costo imputado a E55: 1.700.000 + 450.000 − 100.000 + 1.700.000 = $3.750.000', n(cost.t) === 3750000, cost.t);
check('costo del ítem 1: 1.020.000 + 450.000 − 100.000 + 1.020.000 = $2.390.000', n(cost.i1) === 2390000, cost.i1);
await db.exec(`insert into periodos (anio, mes, estado) values (2026, 10, 'cerrado')`);
await falla('no se registra una compra en un período cerrado', U3, `select fn_registrar_comprobante_compra($1::jsonb)`, /cerrado/, [JSON.stringify({ ...FC, numero: 60, fecha: '2026-10-30' })]);

console.log('\n13) Auditoría');
const au = await uno(`select count(distinct tabla)::int t from auditoria where tabla in ('proveedores','ordenes_compra','comprobantes_compra','comprobante_compra_alicuotas','comprobante_compra_percepciones','comprobante_compra_imputaciones','pagos','pago_medios','retenciones_practicadas','pago_aplicaciones')`);
check('auditoría registra las 10 tablas de compras', au.t === 10, au.t);

console.log(`\nResultado: ${ok} OK, ${mal} fallas`);
if (mal) process.exit(1);
