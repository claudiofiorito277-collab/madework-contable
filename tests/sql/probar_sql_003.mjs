// Prueba la migración 003 (ventas y cobranzas) sobre la 001 y 002, en un Postgres embebido (PGlite).
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

console.log('\n1) Aplicar migraciones 001, 002 y 003');
await db.exec(leer('001_base.sql'));
await db.exec(leer('002_contratos.sql'));
try { await db.exec(leer('003_ventas.sql')); check('migración 003 aplicada sin errores', true); }
catch (e) { check('migración 003 aplicada sin errores', false, e.message); process.exit(1); }
await db.exec(`insert into auth.users values ('${U1}','claudio@demo.test'),('${U2}','mario@demo.test'),('${U3}','contador@demo.test'),('${U4}','consulta@demo.test');
               update perfiles set rol='operador', activo=true where id='${U2}';
               update perfiles set rol='contador', activo=true where id='${U3}';
               update perfiles set rol='consulta', activo=true where id='${U4}';`);

// Datos base: cliente sin CUIT, contrato E55 con fondo de reparo 5% retenido en el pago, certificado aprobado
await comoE(U1, `insert into clientes (razon_social) values ('Caminos de las Sierras S.A. (DEMO)')`);
const cli = (await uno(`select id from clientes`)).id;
await comoE(U1, `insert into contratos (codigo, cliente_id, descripcion, fondo_reparo_pct) values ('E55', '${cli}', 'Pintura columnas RP-E55', 5)`);
const ctr = (await uno(`select id from contratos`)).id;
await comoE(U1, `insert into contrato_items (contrato_id, codigo, descripcion, unidad, cantidad, precio_unitario) values ('${ctr}', '1', 'Pintado de columnas', 'CU', 539, 172670)`);
const it = (await uno(`select id from contrato_items`)).id;
const nuevoCert = async (desde, hasta, cant) => {
  await comoE(U1, `insert into certificados (contrato_id, periodo_desde, periodo_hasta) values ('${ctr}', '${desde}', '${hasta}')`);
  const c = await uno(`select id from certificados order by numero desc limit 1`);
  const bruto = cant * 172670;
  const fr = Math.round(bruto * 5) / 100;
  const iva = Math.round(bruto * 21) / 100;
  await comoE(U1, `insert into certificado_items (certificado_id, item_id, cantidad, precio_unitario, importe) values ('${c.id}', '${it}', ${cant}, 172670, ${bruto});
                   update certificados set bruto = ${bruto}, fondo_reparo = ${fr}, base_factura = ${bruto}, iva = ${iva}, total_factura = ${bruto + iva},
                     neto_a_cobrar = ${bruto + iva - fr} where id = '${c.id}';
                   update certificados set estado = 'presentado' where id = '${c.id}';
                   update certificados set estado = 'aprobado' where id = '${c.id}';`);
  return c.id;
};
const cert1 = await nuevoCert('2026-11-16', '2026-11-20', 100);
const estadoCert = async (id) => (await uno(`select estado from certificados where id = '${id}'`)).estado;
check('certificado N° 1 aprobado (bruto $17.267.000)', (await estadoCert(cert1)) === 'aprobado');

const factura = (extra = {}) => JSON.stringify({
  cliente_id: cli, certificado_id: cert1, tipo_codigo: '1', punto_venta: 3, numero: 125, fecha: '2026-11-23', vencimiento: '2026-12-11',
  cae: '76123456789012', cae_vencimiento: '2026-12-03', alicuotas: [{ alicuota: 'IVA_21', neto: 17267000, iva: 3626070 }], ...extra });
const registrar = (uid, j) => comoQ(uid, `select fn_registrar_comprobante_venta($1::jsonb) id`, [j]);

console.log('\n2) Factura desde el certificado');
await falla('no se puede marcar facturado a mano', U1, `update certificados set estado = 'facturado' where id = '${cert1}'`, /lo pone el sistema/);
await falla('el operador no registra facturas', U2, `select fn_registrar_comprobante_venta($1::jsonb)`, /Solo el administrador o el contador/, [factura()]);
await falla('nadie inserta directo en la tabla (solo por la función)', U1,
  `insert into comprobantes_venta (cliente_id, tipo_codigo, clase, letra, punto_venta, numero, fecha, neto_gravado, total) values ('${cli}', '1', 'factura', 'A', 1, 1, '2026-11-23', 1, 1)`, /permission denied|row-level security/);
await falla('Factura A a un cliente sin CUIT es rechazada', U1, `select fn_registrar_comprobante_venta($1::jsonb)`, /tiene que tener CUIT/, [factura()]);
await comoE(U1, `update clientes set cuit = '30712345671' where id = '${cli}'`);
await falla('IVA que no cuadra con el 21% es rechazado', U1, `select fn_registrar_comprobante_venta($1::jsonb)`, /no cuadra/,
  [factura({ alicuotas: [{ alicuota: 'IVA_21', neto: 17267000, iva: 3626000 }] })]);
await falla('Factura C no se permite a un Responsable Inscripto', U1, `select fn_registrar_comprobante_venta($1::jsonb)`, /A, B o M/,
  [factura({ tipo_codigo: '11', certificado_id: null })]);
await falla('CAE con menos de 14 dígitos es rechazado', U1, `select fn_registrar_comprobante_venta($1::jsonb)`, /check/, [factura({ cae: '123' })]);
const f1 = (await registrar(U3, factura())).rows[0].id;
const fv = await uno(`select clase, letra, contrato_id, origen, neto_gravado, iva, total from comprobantes_venta where id = '${f1}'`);
check('contador registra la Factura A 00003-00000125 por $20.893.070', fv.clase === 'factura' && fv.letra === 'A' && n(fv.total) === 20893070 && fv.contrato_id === ctr && fv.origen === 'certificado', JSON.stringify(fv));
check('el certificado pasa a "facturado" solo', (await estadoCert(cert1)) === 'facturado');
await falla('número de comprobante repetido es rechazado', U1, `select fn_registrar_comprobante_venta($1::jsonb)`, /duplicate key|ya existe/,
  [factura({ certificado_id: null })]);
await falla('un certificado facturado no se vuelve a facturar', U1, `select fn_registrar_comprobante_venta($1::jsonb)`, /solo se factura un certificado aprobado/,
  [factura({ numero: 126 })]);
await falla('los importes de una factura registrada no se modifican', U1, `select fn_actualizar_comprobante_venta('${f1}', '{"cae":"1"}'::jsonb)`, /check/);
await comoQ(U1, `select fn_actualizar_comprobante_venta('${f1}', '{"observacion":"Entregada en mesa de entradas"}'::jsonb)`);
check('se puede completar la observación', (await uno(`select observacion from comprobantes_venta where id='${f1}'`)).observacion === 'Entregada en mesa de entradas');
check('consulta y operador ven las facturas', (await comoQ(U4, `select count(*)::int n from v_comprobantes_venta`)).rows[0].n === 1 && (await comoQ(U2, `select count(*)::int n from v_comprobantes_venta`)).rows[0].n === 1);

console.log('\n3) Nota de crédito parcial por multas');
await comoE(U1, `insert into multas (contrato_id, fecha, motivo, referencia, litros, precio_litro, importe) values ('${ctr}', '2026-11-20', 'orden_servicio', 'OS 3', 200, 2500, 500000)`);
const multa = (await uno(`select id from multas`)).id;
const nc = (extra = {}) => JSON.stringify({ cliente_id: cli, tipo_codigo: '3', punto_venta: 3, numero: 7, fecha: '2026-11-25', comprobante_asociado_id: f1,
  origen: 'multas', alicuotas: [{ alicuota: 'IVA_21', neto: 500000, iva: 105000 }], multas_ids: [multa], ...extra });
await falla('NC sin factura asociada es rechazada', U1, `select fn_registrar_comprobante_venta($1::jsonb)`, /check|asociado/, [nc({ comprobante_asociado_id: null, multas_ids: [] })]);
await falla('NC de otra letra es rechazada', U1, `select fn_registrar_comprobante_venta($1::jsonb)`, /letra/, [nc({ tipo_codigo: '8', multas_ids: [] })]);
await falla('NC mayor que la factura es rechazada', U1, `select fn_registrar_comprobante_venta($1::jsonb)`, /supera/,
  [nc({ alicuotas: [{ alicuota: 'IVA_21', neto: 20000000, iva: 4200000 }], multas_ids: [] })]);
const nc1 = (await registrar(U1, nc())).rows[0].id;
const s1 = await uno(`select saldo, notas_credito from v_comprobantes_venta where id = '${f1}'`);
check('NC de $605.000 baja el saldo de la factura a $20.288.070', n(s1.saldo) === 20288070 && n(s1.notas_credito) === 605000, JSON.stringify(s1));
const m1 = await uno(`select estado, comprobante_venta_id from multas where id = '${multa}'`);
check('la multa queda "descontada" y vinculada a la NC', m1.estado === 'descontada' && m1.comprobante_venta_id === nc1);
check('con la NC el certificado sigue facturado', (await estadoCert(cert1)) === 'facturado');

console.log('\n4) Cobranza en dos partes con retenciones de Ganancias, IVA e IIBB');
const cob = (j) => comoQ(U1, `select fn_registrar_cobranza($1::jsonb) id`, [JSON.stringify(j)]);
await falla('aplicar más que el saldo es rechazado', U1, `select fn_registrar_cobranza($1::jsonb)`, /tiene saldo/,
  [JSON.stringify({ cliente_id: cli, fecha: '2026-12-11', medios: [{ medio: 'transferencia', importe: 30000000 }], aplicaciones: [{ comprobante_id: f1, importe: 30000000 }] })]);
await falla('aplicar más de lo cobrado es rechazado', U1, `select fn_registrar_cobranza($1::jsonb)`, /más .* de lo que se cobra/,
  [JSON.stringify({ cliente_id: cli, fecha: '2026-12-11', medios: [{ medio: 'transferencia', importe: 100 }], aplicaciones: [{ comprobante_id: f1, importe: 200 }] })]);
await falla('el operador no registra cobranzas', U2, `select fn_registrar_cobranza($1::jsonb)`, /Solo el administrador o el contador/,
  [JSON.stringify({ cliente_id: cli, fecha: '2026-12-11', medios: [{ medio: 'efectivo', importe: 1 }] })]);
// Primer pago: transferencia + Ganancias + IIBB + fondo de reparo 5% retenido
const r1 = (await cob({
  cliente_id: cli, fecha: '2026-12-11',
  medios: [{ medio: 'transferencia', importe: 8000000, banco: 'Banco de Córdoba', numero: 'TRF-001' }],
  retenciones: [
    { tipo: 'RET_GANANCIAS', numero_certificado: 'G-0001', base: 17267000, alicuota: 2, importe: 345340, comprobante_venta_id: f1 },
    { tipo: 'RET_IIBB_CBA', numero_certificado: 'IB-0001', base: 17267000, alicuota: 1.0345, importe: 178634.2 },
  ],
  fondo_reparo: [{ contrato_id: ctr, importe: 863350, comprobante_venta_id: f1 }],
  aplicaciones: [{ comprobante_id: f1, importe: 9387324.2 }],
})).rows[0].id;
const rc1 = await uno(`select numero, total, importe_retenciones, a_cuenta from cobranzas where id = '${r1}'`);
check('recibo N° 1: $9.387.324,20 (incluye 2 retenciones y el fondo de reparo)', rc1.numero === 1 && n(rc1.total) === 9387324.2 && n(rc1.importe_retenciones) === 523974.2 && n(rc1.a_cuenta) === 0, JSON.stringify(rc1));
check('saldo de la factura después del primer pago: $10.900.745,80', n((await uno(`select saldo from v_comprobantes_venta where id='${f1}'`)).saldo) === 10900745.8);
check('el certificado sigue "facturado" (cobro parcial)', (await estadoCert(cert1)) === 'facturado');
check('fondo de reparo retenido del contrato: $863.350', n((await uno(`select saldo from v_fondo_reparo where contrato_id='${ctr}'`)).saldo) === 863350);
await falla('el mismo certificado de retención no se carga dos veces', U1, `select fn_registrar_cobranza($1::jsonb)`, /ya está cargado/,
  [JSON.stringify({ cliente_id: cli, fecha: '2026-12-12', retenciones: [{ tipo: 'RET_GANANCIAS', numero_certificado: 'g-0001 ', importe: 1 }] })]);
await falla('una retención sin número de certificado es rechazada', U1, `select fn_registrar_cobranza($1::jsonb)`, /check|null/,
  [JSON.stringify({ cliente_id: cli, fecha: '2026-12-12', retenciones: [{ tipo: 'RET_IVA', numero_certificado: '', importe: 1 }] })]);
const pago2 = { cliente_id: cli, fecha: '2026-12-18',
  medios: [{ medio: 'echeq', importe: 10246967.8, banco: 'Banco Galicia', numero: 'E-778899', fecha_pago: '2026-12-28', librador: 'Caminos de las Sierras S.A.', cuit_librador: '30-71234567-1' }],
  retenciones: [{ tipo: 'RET_IVA', numero_certificado: 'IVA-0001', base: 3626070, alicuota: 18.0402, importe: 653778 }],
  aplicaciones: [{ comprobante_id: f1, importe: 10900745.8 }] };
let r2 = (await cob(pago2)).rows[0].id;
check('segundo pago (echeq + retención de IVA): la factura queda en cero', n((await uno(`select saldo from v_comprobantes_venta where id='${f1}'`)).saldo) === 0);
check('el certificado pasa a "cobrado" solo', (await estadoCert(cert1)) === 'cobrado');
const cc = await uno(`select
   (select coalesce(sum(case when clase = 'nota_credito' then -total else total end), 0) from comprobantes_venta where cliente_id = '${cli}' and estado = 'emitido') -
   (select coalesce(sum(total - importe_devolucion_fr), 0) from cobranzas where cliente_id = '${cli}' and estado = 'registrada') as saldo`);
check('CRITERIO DE ACEPTACIÓN: la cuenta corriente del cliente queda en cero', n(cc.saldo) === 0, JSON.stringify(cc));
check('retenciones registradas: Ganancias, IIBB e IVA', (await uno(`select string_agg(tipo, ',' order by tipo) t from v_retenciones_sufridas`)).t === 'RET_GANANCIAS,RET_IIBB_CBA,RET_IVA');

console.log('\n5) Anulaciones');
await falla('no se anula una factura con cobranzas', U1, `select fn_anular_comprobante_venta('${f1}', 'error')`, /cobranzas aplicadas/);
await falla('anular sin motivo es rechazado', U1, `select fn_anular_cobranza('${r2}', '')`, /motivo/);
await comoQ(U1, `select fn_anular_cobranza('${r2}', 'Echeq rechazado')`);
check('al anular el segundo recibo vuelve el saldo y el certificado a "facturado"', n((await uno(`select saldo from v_comprobantes_venta where id='${f1}'`)).saldo) === 10900745.8 && (await estadoCert(cert1)) === 'facturado');
await falla('una cobranza anulada no se modifica', U1, `select fn_actualizar_cobranza('${r2}', 'x')`, /anulada/);
r2 = (await cob(pago2)).rows[0].id;
check('se vuelve a cargar (el certificado de retención se puede reutilizar) y queda "cobrado"', (await estadoCert(cert1)) === 'cobrado' && (await uno(`select numero from cobranzas where id='${r2}'`)).numero === 3);
await falla('no se anula una factura con notas de crédito vigentes', U1, `select fn_anular_comprobante_venta('${f1}', 'x')`, /cobranzas|notas de crédito/);

console.log('\n6) Fondo de reparo: devolución');
await falla('no se devuelve más que lo retenido', U1, `select fn_registrar_cobranza($1::jsonb)`, /supera el fondo de reparo/,
  [JSON.stringify({ cliente_id: cli, fecha: '2027-12-20', medios: [{ medio: 'transferencia', importe: 900000 }], devoluciones_fr: [{ contrato_id: ctr, importe: 900000 }] })]);
const r4 = (await cob({ cliente_id: cli, fecha: '2027-12-20', medios: [{ medio: 'transferencia', importe: 863350 }], devoluciones_fr: [{ contrato_id: ctr, importe: 863350 }] })).rows[0].id;
check('devolución del fondo de reparo: saldo del contrato en cero', n((await uno(`select saldo from v_fondo_reparo where contrato_id='${ctr}'`)).saldo) === 0);
const cc2 = await uno(`select
   (select coalesce(sum(case when clase = 'nota_credito' then -total else total end), 0) from comprobantes_venta where cliente_id = '${cli}' and estado = 'emitido') -
   (select coalesce(sum(total - importe_devolucion_fr), 0) from cobranzas where cliente_id = '${cli}' and estado = 'registrada') as saldo`);
check('la devolución del fondo de reparo no altera la cuenta corriente', n(cc2.saldo) === 0);
await falla('no se anula la cobranza que retuvo un fondo de reparo ya devuelto', U1, `select fn_anular_cobranza('${r1}', 'x')`, /ya se devolvió/);
check('el recibo de la devolución sigue vigente', (await uno(`select estado from cobranzas where id='${r4}'`)).estado === 'registrada');

console.log('\n7) Factura manual, anulación y períodos');
const fm = (await registrar(U1, JSON.stringify({ cliente_id: cli, contrato_id: ctr, origen: 'anticipo', tipo_codigo: '1', punto_venta: 3, numero: 130, fecha: '2026-11-30',
  descripcion: 'Anticipo financiero 20%', alicuotas: [{ alicuota: 'IVA_21', neto: 1000, iva: 210 }] }))).rows[0].id;
check('factura manual de anticipo sin certificado', (await uno(`select origen, certificado_id from comprobantes_venta where id='${fm}'`)).origen === 'anticipo');
await comoQ(U1, `select fn_anular_comprobante_venta('${fm}', 'Error de carga')`);
check('anulada con motivo; el número queda libre para cargarla bien', (await uno(`select estado from comprobantes_venta where id='${fm}'`)).estado === 'anulado');
await registrar(U1, JSON.stringify({ cliente_id: cli, contrato_id: ctr, origen: 'anticipo', tipo_codigo: '1', punto_venta: 3, numero: 130, fecha: '2026-11-30',
  alicuotas: [{ alicuota: 'IVA_21', neto: 1000, iva: 210 }] }));
check('se registró de nuevo con el mismo número', (await uno(`select count(*)::int n from comprobantes_venta where numero = 130`)).n === 2);
await db.exec(`insert into periodos (anio, mes, estado) values (2026, 10, 'cerrado')`);
await falla('no se registra una factura en un período cerrado', U1, `select fn_registrar_comprobante_venta($1::jsonb)`, /cerrado/,
  [JSON.stringify({ cliente_id: cli, tipo_codigo: '1', punto_venta: 3, numero: 131, fecha: '2026-10-30', alicuotas: [{ alicuota: 'IVA_21', neto: 1000, iva: 210 }] })]);
await falla('nadie borra comprobantes', U1, `delete from comprobantes_venta`, /permission denied/);
await falla('las aplicaciones no se modifican', U1, `update aplicaciones_cobro set importe = 1`, /permission denied/);
await falla('las funciones internas no se pueden llamar', U1, `select fn_sync_certificado('${cert1}')`, /permission denied/);

console.log('\n8) Auditoría');
const au = await uno(`select count(distinct tabla)::int t, bool_and(usuario_id is not null) u from auditoria
                      where tabla in ('comprobantes_venta','comprobante_venta_alicuotas','cobranzas','cobranza_medios','retenciones_sufridas','aplicaciones_cobro','fondo_reparo_movimientos')`);
check('auditoría registra las 7 tablas de ventas, con usuario', au.t === 7 && au.u === true, JSON.stringify(au));
check('la auditoría guarda quién registró la factura (contador)', (await uno(`select usuario_email from auditoria where tabla='comprobantes_venta' and registro_id='${f1}' and accion='ALTA'`)).usuario_email === 'contador@demo.test');

console.log(`\nResultado: ${ok} OK, ${mal} fallas`);
process.exit(mal ? 1 : 0);
