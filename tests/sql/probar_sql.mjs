// Opcional: requiere "npm install" (instala PGlite, un Postgres embebido). Correr con: npm run test:sql
// Prueba la migración 001 en un Postgres embebido (PGlite) simulando lo mínimo de Supabase:
// esquema auth, auth.uid() y los roles anon/authenticated.
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';

const db = new PGlite({ extensions: { btree_gist } });
let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log('  OK  ', nombre); } else { mal++; console.log('  FALLA', nombre, extra); }
};
async function espera_error(nombre, sql, patron) {
  try { await db.exec(sql); check(nombre, false, '(no dio error)'); }
  catch (e) { check(nombre, patron.test(e.message), `-> ${e.message}`); }
}
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const como = async (uid, sql) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
};
const comoExec = async (uid, sql) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await db.exec(sql); } finally { await db.exec('reset role;'); }
};

// --- Simulación mínima de Supabase ---
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant usage on schema public to authenticated, anon;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`);

console.log('\n1) Aplicar migración 001');
try { await db.exec(readFileSync(new URL('../../sql/001_base.sql', import.meta.url), 'utf8')); check('migración aplicada sin errores', true); }
catch (e) { check('migración aplicada sin errores', false, e.message); process.exit(1); }

const cuenta = async (t) => (await db.query(`select count(*)::int n from ${t}`)).rows[0].n;
check('16 tipos de comprobante', (await cuenta('tipos_comprobante')) === 16);
check('13 parámetros fiscales', (await cuenta('parametros_fiscales')) === 13);
check('plan de cuentas cargado (>80 cuentas)', (await cuenta('plan_cuentas')) > 80);
check('auditoría vacía después de los datos iniciales', (await cuenta('auditoria')) === 0);
const huerf = await db.query(`select count(*)::int n from plan_cuentas where nivel > 1 and padre_id is null`);
check('todas las subcuentas tienen cuenta madre', huerf.rows[0].n === 0);

console.log('\n2) Usuarios y roles');
await db.exec(`insert into auth.users values ('${U1}', 'claudio@demo.test'), ('${U2}', 'mario@demo.test');`);
const perf = (await db.query(`select id, rol, activo from perfiles order by email`)).rows;
check('primer usuario = administrador activo', perf.find((p) => p.id === U1)?.rol === 'administrador' && perf.find((p) => p.id === U1)?.activo);
check('segundo usuario = consulta inactivo', perf.find((p) => p.id === U2)?.rol === 'consulta' && !perf.find((p) => p.id === U2)?.activo);
check('usuario inactivo no ve parámetros', (await como(U2, 'select * from parametros_fiscales')).rows.length === 0);
check('administrador ve parámetros', (await como(U1, 'select * from parametros_fiscales')).rows.length === 13);

console.log('\n3) Parámetros con vigencia');
await como(U1, `select fn_nueva_vigencia('ALICUOTA_IVA', 'IVA_21', 22, '2027-01-01', 'PRUEBA ficticia')`);
const hist = (await db.query(`select valor, vigente_desde::text d, vigente_hasta::text h from parametros_fiscales where codigo='IVA_21' order by vigente_desde`)).rows;
check('nueva vigencia cierra la anterior al 31/12/2026', hist.length === 2 && hist[0].h === '2026-12-31' && Number(hist[1].valor) === 22 && hist[1].h === null);
const aud = (await como(U1, `select accion, usuario_email from auditoria where tabla='parametros_fiscales' order by id`)).rows;
check('auditoría registra la modificación y el alta con el usuario', aud.length === 2 && aud[0].accion === 'MODIFICACION' && aud[1].accion === 'ALTA' && aud[1].usuario_email === 'claudio@demo.test', JSON.stringify(aud));
try { await como(U1, `select fn_nueva_vigencia('ALICUOTA_IVA', 'IVA_21', 23, '2026-12-01')`); check('vigencia anterior a la actual es rechazada', false); }
catch (e) { check('vigencia anterior a la actual es rechazada', /debe empezar después/.test(e.message), e.message); }
await espera_error('dos vigencias superpuestas son rechazadas por la base',
  `insert into parametros_fiscales (tipo, codigo, descripcion, valor, vigente_desde) values ('ALICUOTA_IVA','IVA_10_5','x',11,'2026-12-01')`,
  /parametros_sin_superposicion|conflicting key/);
try { await comoExec(U1, `update parametros_fiscales set valor=20 where codigo='IVA_27'`); check('un valor definido no se puede pisar', false); }
catch (e) { check('un valor definido no se puede pisar', /Nueva vigencia/.test(e.message), e.message); }
await comoExec(U1, `update parametros_fiscales set valor=4.75, a_confirmar=false where codigo='ALICUOTA_CBA_SERVICIOS'`);
check('un valor vacío (a confirmar) se puede completar', Number((await db.query(`select valor from parametros_fiscales where codigo='ALICUOTA_CBA_SERVICIOS'`)).rows[0].valor) === 4.75);
try { await comoExec(U1, `delete from parametros_fiscales where codigo='IVA_27'`); check('nadie puede borrar parámetros', false); }
catch (e) { check('nadie puede borrar parámetros', /permission denied/.test(e.message), e.message); }

console.log('\n4) Permisos por rol');
await comoExec(U1, `update perfiles set rol='operador', activo=true where id='${U2}'`);
check('administrador activa a Mario como operador', (await db.query(`select rol, activo from perfiles where id='${U2}'`)).rows[0].rol === 'operador');
try { await como(U2, `select fn_nueva_vigencia('ALICUOTA_IVA', 'IVA_27', 28, '2027-02-01')`); check('operador no puede cambiar parámetros fiscales', false); }
catch (e) { check('operador no puede cambiar parámetros fiscales', /Solo el administrador o el contador/.test(e.message), e.message); }
await comoExec(U2, `insert into centros_costo (codigo, nombre, tipo) values ('DEMO-E55', 'Contrato DEMO RP-E55', 'contrato')`);
check('operador puede crear centros de costo', (await cuenta(`centros_costo where codigo='DEMO-E55'`)) === 1);
check('operador no ve la auditoría', (await como(U2, 'select * from auditoria')).rows.length === 0);
const r2 = await comoExec(U2, `update plan_cuentas set nombre='hack' where codigo='1.1.1.01'`);
check('operador no puede modificar el plan de cuentas', (await db.query(`select nombre from plan_cuentas where codigo='1.1.1.01'`)).rows[0].nombre === 'Caja');
try { await comoExec(U1, `update perfiles set rol='contador' where id='${U1}'`); check('no se puede quitar el último administrador', false); }
catch (e) { check('no se puede quitar el último administrador', /último administrador/.test(e.message), e.message); }
try { await comoExec(U1, `update auditoria set accion='BAJA'`); check('la auditoría no se puede modificar', false); }
catch (e) { check('la auditoría no se puede modificar', /permission denied/.test(e.message), e.message); }
try { await comoExec(U2, `update perfiles set rol='administrador' where id='${U2}'`); } catch {}
check('operador no puede subirse de rol', (await db.query(`select rol from perfiles where id='${U2}'`)).rows[0].rol === 'operador');

console.log('\n5) Plan de cuentas');
try { await comoExec(U1, `insert into plan_cuentas (codigo, nombre, rubro, imputable) values ('1.1.1.01.1','sub de caja','activo',true)`); check('no se puede colgar una cuenta de una imputable', false); }
catch (e) { check('no se puede colgar una cuenta de una imputable', /es imputable/.test(e.message), e.message); }
try { await comoExec(U1, `insert into plan_cuentas (codigo, nombre, rubro) values ('7.1','sin madre','egreso')`); check('cuenta sin madre es rechazada', false); }
catch (e) { check('cuenta sin madre es rechazada', /No existe la cuenta madre 7/.test(e.message), e.message); }
try { await comoExec(U1, `insert into plan_cuentas (codigo, nombre, rubro, imputable) values ('5.1.12','otro rubro','activo',true)`); check('subcuenta de otro rubro es rechazada', false); }
catch (e) { check('subcuenta de otro rubro es rechazada', /mismo rubro/.test(e.message), e.message); }
await comoExec(U1, `insert into plan_cuentas (codigo, nombre, rubro, imputable) values ('5.1.12','Viáticos de obra','egreso',true)`);
const nueva = (await db.query(`select p.codigo madre from plan_cuentas c join plan_cuentas p on p.id=c.padre_id where c.codigo='5.1.12'`)).rows[0];
check('cuenta nueva toma su madre automáticamente', nueva?.madre === '5.1');

console.log('\n6) Empresa y CUIT');
try { await comoExec(U1, `update empresa set cuit='20123456780'`); check('CUIT con dígito verificador incorrecto es rechazado', false); }
catch (e) { check('CUIT con dígito verificador incorrecto es rechazado', /check/.test(e.message), e.message); }
await comoExec(U1, `update empresa set cuit='20123456786'`);
check('CUIT válido (ficticio) es aceptado', (await db.query(`select cuit from empresa`)).rows[0].cuit === '20123456786');
await comoExec(U2, `update empresa set razon_social='otra'`);
check('operador no puede modificar los datos de la empresa', (await db.query(`select razon_social from empresa`)).rows[0].razon_social === 'Claudio Esteban Fiorito');

console.log(`\nResultado: ${ok} OK, ${mal} fallas`);
process.exit(mal ? 1 : 0);
