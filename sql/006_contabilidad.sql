-- =====================================================================
-- MADEWORK · Sistema contable · Migración 006 · Contabilidad general
-- Etapa 6 · 01/11/2026
--
-- Crea: configuración de imputaciones contables (qué cuenta usa cada
-- concepto), ejercicios, asientos con su numeración correlativa por
-- ejercicio, anulación con contraasiento, cierre y reapertura de meses,
-- cierre de ejercicio con refundición, cierre y apertura, y la lista de
-- comprobantes pendientes de contabilizar.
--
-- Los asientos automáticos los arma el sistema (js/core/asientos.js) con la
-- configuración de imputaciones y los registra con fn_registrar_asiento.
-- Un asiento registrado no se modifica: se anula con contraasiento.
--
-- Ajuste por inflación: NO se calcula. A CONFIRMAR CON CONTADOR.
--
-- Requiere las migraciones 001 a 005. Se corre UNA sola vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Plan de cuentas: cuentas que faltaban para las imputaciones automáticas
-- ---------------------------------------------------------------------
insert into public.plan_cuentas (codigo, nombre, rubro, imputable) values
  ('1.1.3.09', 'Otras retenciones y percepciones sufridas', 'activo', true),
  ('2.1.2.06', 'Retenciones practicadas a depositar',       'pasivo', true),
  ('2.1.2.07', 'Otros tributos facturados a depositar',     'pasivo', true),
  ('6.2.06',   'Multas contractuales',                      'egreso', true)
on conflict (codigo) do nothing;

-- Una cuenta con asientos no cambia de código ni de rubro, ni deja de ser imputable
create or replace function public.fn_plan_cuentas_en_uso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.codigo, new.rubro, new.imputable) is distinct from (old.codigo, old.rubro, old.imputable)
     and exists (select 1 from public.asiento_lineas where cuenta_id = old.id) then
    raise exception 'La cuenta % ya tiene asientos: no se cambia su código, rubro ni si es imputable', old.codigo;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Configuración de imputaciones: concepto -> cuenta
-- ---------------------------------------------------------------------
create table public.imputaciones_contables (
  clave        text primary key,
  descripcion  text not null,
  cuenta_id    uuid references public.plan_cuentas(id),
  grupo        text not null,
  observacion  text,
  modificado_en timestamptz not null default now()
);
create trigger trg_imput_mod before update on public.imputaciones_contables for each row execute function public.fn_set_modificado();

create or replace function public.fn_imputaciones_contables_control()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cuenta_id is not null and not exists (select 1 from public.plan_cuentas where id = new.cuenta_id and imputable and activo) then
    raise exception 'La cuenta elegida tiene que ser imputable y estar activa';
  end if;
  if new.clave is distinct from old.clave then raise exception 'La clave no se modifica'; end if;
  return new;
end $$;
create trigger trg_imput_control before update on public.imputaciones_contables for each row execute function public.fn_imputaciones_contables_control();

insert into public.imputaciones_contables (clave, descripcion, grupo, cuenta_id, observacion)
select x.clave, x.descripcion, x.grupo, (select id from public.plan_cuentas where codigo = x.codigo), x.obs
from (values
  ('DEUDORES_POR_VENTAS',        'Deudores por ventas (clientes)',                    'Ventas',    '1.1.2.01', null),
  ('VENTAS',                     'Ventas / certificados de obra',                     'Ventas',    '4.1.01',   null),
  ('VENTAS_ANTICIPO',            'Anticipo financiero facturado',                     'Ventas',    '2.1.1.03', 'A CONFIRMAR CON CONTADOR'),
  ('MULTAS_CONTRACTUALES',       'Multas descontadas por nota de crédito',            'Ventas',    '6.2.06',   'A CONFIRMAR CON CONTADOR'),
  ('IVA_DEBITO_FISCAL',          'IVA débito fiscal',                                 'Ventas',    '2.1.2.01', null),
  ('OTROS_TRIBUTOS_VENTA',       'Otros tributos facturados',                         'Ventas',    '2.1.2.07', null),
  ('ANTICIPOS_DE_CLIENTES',      'Anticipos de clientes / cobros a cuenta',           'Cobranzas', '2.1.1.03', null),
  ('VALORES_A_DEPOSITAR',        'Cheques y echeqs de terceros en cartera',           'Cobranzas', '1.1.1.03', null),
  ('FONDO_REPARO_A_COBRAR',      'Fondo de reparo retenido por el cliente',           'Cobranzas', '1.1.2.02', null),
  ('RET_GANANCIAS_SUFRIDAS',     'Retenciones de Ganancias sufridas',                 'Cobranzas', '1.1.3.04', null),
  ('RET_IVA_SUFRIDAS',           'Retenciones de IVA sufridas',                       'Cobranzas', '1.1.3.02', null),
  ('RET_IIBB_CBA_SUFRIDAS',      'Retenciones de IIBB Córdoba sufridas',              'Cobranzas', '1.1.3.05', null),
  ('RET_SUSS_SUFRIDAS',          'Retenciones de SUSS sufridas',                      'Cobranzas', '1.1.3.07', null),
  ('RET_OTRAS_SUFRIDAS',         'Otras retenciones sufridas',                        'Cobranzas', '1.1.3.09', null),
  ('PROVEEDORES',                'Proveedores',                                       'Compras',   '2.1.1.01', null),
  ('IVA_CREDITO_FISCAL',         'IVA crédito fiscal',                                'Compras',   '1.1.3.01', null),
  ('PERC_IVA_SUFRIDAS',          'Percepciones de IVA sufridas',                      'Compras',   '1.1.3.03', null),
  ('PERC_IIBB_SUFRIDAS',         'Percepciones de IIBB sufridas',                     'Compras',   '1.1.3.06', null),
  ('PERC_OTRAS_SUFRIDAS',        'Otras percepciones sufridas',                       'Compras',   '1.1.3.09', null),
  ('COSTO_MATERIALES',           'Costo: materiales y pinturas',                      'Compras',   '5.1.01',   null),
  ('COSTO_MANO_OBRA',            'Costo: mano de obra',                               'Compras',   '5.1.02',   null),
  ('COSTO_EQUIPOS',              'Costo: equipos',                                    'Compras',   '5.1.06',   null),
  ('COSTO_SUBCONTRATOS',         'Costo: subcontratos',                               'Compras',   '5.1.04',   null),
  ('COSTO_OTROS',                'Costo: otros',                                      'Compras',   '5.1.11',   null),
  ('ANTICIPOS_A_PROVEEDORES',    'Anticipos a proveedores',                           'Pagos',     '1.1.4.01', null),
  ('CHEQUES_DIFERIDOS_A_PAGAR',  'Cheques propios diferidos emitidos',                'Pagos',     '2.1.1.02', null),
  ('RET_PRACTICADAS_A_DEPOSITAR','Retenciones practicadas a depositar',               'Pagos',     '2.1.2.06', null),
  ('CAJA',                       'Caja (si la cuenta de tesorería no tiene cuenta contable)',  'Tesorería', '1.1.1.01', null),
  ('BANCOS',                     'Bancos (si la cuenta de tesorería no tiene cuenta contable)', 'Tesorería', '1.1.1.02', null),
  ('GASTOS_BANCARIOS',           'Gastos bancarios',                                  'Tesorería', '6.2.01',   null),
  ('IMPUESTO_DEB_CRED',          'Impuesto a los débitos y créditos',                 'Tesorería', '6.2.02',   null),
  ('IMPUESTOS_BANCARIOS',        'Otros impuestos bancarios',                         'Tesorería', '6.2.01',   null),
  ('APORTES_SOCIOS',             'Aportes del titular',                               'Tesorería', '3.1.04',   null),
  ('RETIROS_SOCIOS',             'Retiros del titular',                               'Tesorería', '3.1.04',   null),
  ('AJUSTES',                    'Ajustes y diferencias',                             'Tesorería', '4.2.02',   null),
  ('OTROS_MOVIMIENTOS',          'Otros ingresos y egresos de caja',                  'Tesorería', '4.2.02',   null),
  ('RESULTADO_EJERCICIO',        'Resultado del ejercicio',                           'Cierre',    '3.1.03',   null),
  ('RESULTADOS_NO_ASIGNADOS',    'Resultados no asignados',                           'Cierre',    '3.1.02',   null)
) as x(clave, descripcion, grupo, codigo, obs);

-- Cada caja o banco puede tener su propia cuenta contable
alter table public.cuentas_tesoreria add column cuenta_contable_id uuid references public.plan_cuentas(id);

-- ---------------------------------------------------------------------
-- Ejercicios
-- ---------------------------------------------------------------------
create table public.ejercicios (
  id          uuid primary key default gen_random_uuid(),
  anio        integer not null unique,          -- año en que cierra
  desde       date not null,
  hasta       date not null,
  estado      text not null default 'abierto' check (estado in ('abierto','cerrado')),
  cerrado_por uuid,
  cerrado_en  timestamptz,
  ajuste_inflacion text not null default 'A CONFIRMAR CON CONTADOR: no se calcula',
  check (hasta > desde)
);

-- Ejercicio al que pertenece una fecha (lo crea si no existe), según el cierre de la Empresa
create or replace function public.fn_ejercicio_de(p_fecha date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_mes int; v_dia int; v_fin date; v_ini date; v_id uuid; v_anio int := extract(year from p_fecha);
begin
  select cierre_ejercicio_mes, cierre_ejercicio_dia into v_mes, v_dia from public.empresa where id = 1;
  v_mes := coalesce(v_mes, 12); v_dia := coalesce(v_dia, 31);
  v_fin := least(make_date(v_anio, v_mes, 1) + interval '1 month' - interval '1 day', make_date(v_anio, v_mes, 1) + (v_dia - 1))::date;
  if p_fecha > v_fin then
    v_anio := v_anio + 1;
    v_fin := least(make_date(v_anio, v_mes, 1) + interval '1 month' - interval '1 day', make_date(v_anio, v_mes, 1) + (v_dia - 1))::date;
  end if;
  v_ini := (least(make_date(v_anio - 1, v_mes, 1) + interval '1 month' - interval '1 day', make_date(v_anio - 1, v_mes, 1) + (v_dia - 1)) + interval '1 day')::date;
  select id into v_id from public.ejercicios where anio = v_anio;
  if v_id is null then
    insert into public.ejercicios (anio, desde, hasta) values (v_anio, v_ini, v_fin) on conflict (anio) do nothing;
    select id into v_id from public.ejercicios where anio = v_anio;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Asientos
-- ---------------------------------------------------------------------
create table public.asientos (
  id               uuid primary key default gen_random_uuid(),
  ejercicio_id     uuid not null references public.ejercicios(id),
  numero           integer not null,
  fecha            date not null,
  tipo             text not null check (tipo in ('automatico','manual','anulacion','refundicion','cierre','apertura')),
  origen_tabla     text check (origen_tabla in ('comprobantes_venta','cobranzas','comprobantes_compra','pagos','movimientos_tesoreria','cheques','certificados')),
  origen_id        uuid,
  evento           text,
  descripcion      text not null check (trim(descripcion) <> ''),
  total            numeric(16,2) not null check (total > 0),
  estado           text not null default 'contabilizado' check (estado in ('contabilizado','anulado')),
  anula_a_id       uuid references public.asientos(id),
  anulado_por_id   uuid references public.asientos(id),
  motivo           text,
  creado_por       uuid default auth.uid(),
  creado_en        timestamptz not null default now(),
  unique (ejercicio_id, numero),
  check ((tipo = 'automatico') = (origen_tabla is not null and origen_id is not null and evento is not null)),
  check ((tipo = 'anulacion') = (anula_a_id is not null)),
  check (estado = 'contabilizado' or (anulado_por_id is not null and coalesce(trim(motivo), '') <> ''))
);
-- Un comprobante tiene un solo asiento vigente por evento
create unique index asientos_origen_vigente on public.asientos (origen_tabla, origen_id, evento) where tipo = 'automatico' and estado = 'contabilizado';
create index asientos_fecha on public.asientos (fecha);

create table public.asiento_lineas (
  id               uuid primary key default gen_random_uuid(),
  asiento_id       uuid not null references public.asientos(id),
  orden            integer not null,
  cuenta_id        uuid not null references public.plan_cuentas(id),
  debe             numeric(16,2) not null default 0 check (debe >= 0),
  haber            numeric(16,2) not null default 0 check (haber >= 0),
  contrato_id      uuid references public.contratos(id),
  centro_costo_id  uuid references public.centros_costo(id),
  detalle          text,
  check ((debe > 0) <> (haber > 0))
);
create index asiento_lineas_cuenta on public.asiento_lineas (cuenta_id);
create index asiento_lineas_asiento on public.asiento_lineas (asiento_id);

create trigger trg_plan_en_uso before update on public.plan_cuentas for each row execute function public.fn_plan_cuentas_en_uso();

-- Los asientos solo los escriben las funciones (marcadas con mw.contabilidad)
create or replace function public.fn_asientos_inmutables()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('mw.contabilidad', true), '') <> 'on' then
    raise exception 'Los asientos registrados no se modifican: se anulan con contraasiento';
  end if;
  if tg_op = 'DELETE' then raise exception 'Los asientos no se borran'; end if;
  return new;
end $$;
create trigger trg_asientos_inmutables before update or delete on public.asientos for each row execute function public.fn_asientos_inmutables();
create trigger trg_lineas_inmutables before update or delete on public.asiento_lineas for each row execute function public.fn_asientos_inmutables();

-- Registro interno: valida y numera (sin control de rol ni de período: lo hacen quienes la llaman)
create or replace function public.fn_insertar_asiento(p jsonb, p_controlar_periodo boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_fecha date := (p->>'fecha')::date;
  v_ej public.ejercicios;
  v_id uuid;
  v_num integer;
  v_debe numeric(16,2) := 0;
  v_haber numeric(16,2) := 0;
  v_n integer := 0;
  l record;
  v_cta public.plan_cuentas;
  v_prev text := coalesce(current_setting('mw.contabilidad', true), '');
begin
  if v_fecha is null then raise exception 'Falta la fecha del asiento'; end if;
  if p_controlar_periodo and not public.fn_periodo_abierto(v_fecha) then
    raise exception 'El período % está cerrado: no se pueden registrar asientos con esa fecha', to_char(v_fecha, 'MM/YYYY');
  end if;
  v_id := public.fn_ejercicio_de(v_fecha);
  select * into v_ej from public.ejercicios where id = v_id;
  if v_ej.estado = 'cerrado' and p_controlar_periodo then raise exception 'El ejercicio % está cerrado', v_ej.anio; end if;
  for l in select * from jsonb_to_recordset(coalesce(p->'lineas', '[]'::jsonb)) as x(cuenta_id uuid, debe numeric, haber numeric) loop
    select * into v_cta from public.plan_cuentas where id = l.cuenta_id;
    if not found then raise exception 'Hay una línea sin cuenta o con una cuenta que no existe'; end if;
    if not v_cta.imputable then raise exception 'La cuenta % % no es imputable (es una cuenta madre)', v_cta.codigo, v_cta.nombre; end if;
    if not v_cta.activo then raise exception 'La cuenta % % está inactiva', v_cta.codigo, v_cta.nombre; end if;
    if (coalesce(l.debe, 0) > 0) = (coalesce(l.haber, 0) > 0) then raise exception 'Cada línea va al debe o al haber (cuenta %)', v_cta.codigo; end if;
    v_debe := v_debe + round(coalesce(l.debe, 0), 2);
    v_haber := v_haber + round(coalesce(l.haber, 0), 2);
    v_n := v_n + 1;
  end loop;
  if v_n < 2 then raise exception 'Un asiento necesita al menos dos líneas'; end if;
  if v_debe <> v_haber then raise exception 'El asiento no balancea: debe % y haber %', v_debe, v_haber; end if;

  perform pg_advisory_xact_lock(hashtext('asientos'), hashtext(v_ej.id::text));
  select coalesce(max(numero), 0) + 1 into v_num from public.asientos where ejercicio_id = v_ej.id;
  insert into public.asientos (ejercicio_id, numero, fecha, tipo, origen_tabla, origen_id, evento, descripcion, total, anula_a_id)
  values (v_ej.id, v_num, v_fecha, p->>'tipo', nullif(p->>'origen_tabla', ''), nullif(p->>'origen_id', '')::uuid, nullif(p->>'evento', ''),
          coalesce(nullif(trim(p->>'descripcion'), ''), 'Asiento'), v_debe, nullif(p->>'anula_a_id', '')::uuid)
  returning id into v_id;
  insert into public.asiento_lineas (asiento_id, orden, cuenta_id, debe, haber, contrato_id, centro_costo_id, detalle)
  select v_id, e.ord, (e.v->>'cuenta_id')::uuid, round(coalesce((e.v->>'debe')::numeric, 0), 2), round(coalesce((e.v->>'haber')::numeric, 0), 2),
         nullif(e.v->>'contrato_id', '')::uuid,
         coalesce(nullif(e.v->>'centro_costo_id', '')::uuid, (select centro_costo_id from public.contratos where id = nullif(e.v->>'contrato_id', '')::uuid)),
         nullif(trim(e.v->>'detalle'), '')
    from jsonb_array_elements(p->'lineas') with ordinality as e(v, ord);
  return v_id;
end $$;

-- Registra un asiento automático (desde un comprobante) o manual.
-- p: { fecha, tipo ('automatico'|'manual'), descripcion, origen_tabla, origen_id, evento,
--      lineas: [{ cuenta_id, debe, haber, contrato_id, centro_costo_id, detalle }] }
create or replace function public.fn_registrar_asiento(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Solo el administrador o el contador registran asientos';
  end if;
  if coalesce(p->>'tipo', '') not in ('automatico','manual') then raise exception 'Tipo de asiento inválido'; end if;
  if p->>'tipo' = 'automatico' and exists (select 1 from public.asientos where tipo = 'automatico' and estado = 'contabilizado'
       and origen_tabla = p->>'origen_tabla' and origen_id = (p->>'origen_id')::uuid and evento = p->>'evento') then
    raise exception 'Ese comprobante ya tiene su asiento';
  end if;
  return public.fn_insertar_asiento(p, true);
end $$;

-- Anula un asiento con un contraasiento (mismas líneas invertidas). La fecha es la del asiento
-- original salvo que se indique otra (por ejemplo, si su mes ya está cerrado).
create or replace function public.fn_anular_asiento(p_id uuid, p_motivo text, p_fecha date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_a public.asientos; v_c uuid; v_lineas jsonb;
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Solo el administrador o el contador anulan asientos'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
  select * into v_a from public.asientos where id = p_id for update;
  if not found then raise exception 'No existe el asiento'; end if;
  if v_a.estado = 'anulado' then raise exception 'El asiento N° % ya está anulado', v_a.numero; end if;
  if v_a.tipo in ('anulacion','refundicion','cierre','apertura') then raise exception 'Un asiento de % no se anula', v_a.tipo; end if;
  select jsonb_agg(jsonb_build_object('cuenta_id', cuenta_id, 'debe', haber, 'haber', debe, 'contrato_id', contrato_id,
         'centro_costo_id', centro_costo_id, 'detalle', detalle) order by orden) into v_lineas
    from public.asiento_lineas where asiento_id = p_id;
  v_c := public.fn_insertar_asiento(jsonb_build_object('fecha', coalesce(p_fecha, v_a.fecha), 'tipo', 'anulacion', 'anula_a_id', v_a.id,
          'descripcion', format('Anulación del asiento N° %s: %s', v_a.numero, p_motivo), 'lineas', v_lineas), true);
  perform set_config('mw.contabilidad', 'on', true);
  update public.asientos set estado = 'anulado', anulado_por_id = v_c, motivo = p_motivo where id = p_id;
  perform set_config('mw.contabilidad', 'off', true);
  return v_c;
end $$;

-- ---------------------------------------------------------------------
-- Comprobantes pendientes de contabilizar (o de anular su asiento)
-- ---------------------------------------------------------------------
create view public.v_pendientes_contabilizar with (security_invoker = true) as
with vig as (select origen_tabla, origen_id, evento, id from public.asientos where tipo = 'automatico' and estado = 'contabilizado')
select 'comprobantes_venta'::text as origen_tabla, cv.id as origen_id, 'alta'::text as evento, cv.fecha,
       tc.descripcion || ' ' || lpad(cv.punto_venta::text, 5, '0') || '-' || lpad(cv.numero::text, 8, '0') as descripcion,
       case when cv.estado = 'emitido' then 'contabilizar' else 'anular' end as accion, v.id as asiento_id
  from public.comprobantes_venta cv join public.tipos_comprobante tc on tc.codigo = cv.tipo_codigo
  left join vig v on v.origen_tabla = 'comprobantes_venta' and v.origen_id = cv.id
 where (cv.estado = 'emitido' and v.id is null) or (cv.estado = 'anulado' and v.id is not null)
union all
select 'cobranzas', c.id, 'alta', c.fecha, 'Recibo N° ' || c.numero, case when c.estado = 'registrada' then 'contabilizar' else 'anular' end, v.id
  from public.cobranzas c left join vig v on v.origen_tabla = 'cobranzas' and v.origen_id = c.id
 where (c.estado = 'registrada' and v.id is null) or (c.estado = 'anulada' and v.id is not null)
union all
select 'comprobantes_compra', k.id, 'alta', k.fecha,
       tc.descripcion || ' ' || lpad(k.punto_venta::text, 5, '0') || '-' || lpad(k.numero::text, 8, '0'),
       case when k.estado = 'emitido' then 'contabilizar' else 'anular' end, v.id
  from public.comprobantes_compra k join public.tipos_comprobante tc on tc.codigo = k.tipo_codigo
  left join vig v on v.origen_tabla = 'comprobantes_compra' and v.origen_id = k.id
 where (k.estado = 'emitido' and v.id is null) or (k.estado = 'anulado' and v.id is not null)
union all
select 'pagos', p.id, 'alta', p.fecha, 'Orden de pago N° ' || p.numero, case when p.estado = 'registrado' then 'contabilizar' else 'anular' end, v.id
  from public.pagos p left join vig v on v.origen_tabla = 'pagos' and v.origen_id = p.id
 where (p.estado = 'registrado' and v.id is null) or (p.estado = 'anulado' and v.id is not null)
union all
select 'movimientos_tesoreria', m.id, 'alta', m.fecha, coalesce(m.descripcion, 'Movimiento de tesorería'),
       case when m.estado = 'vigente' then 'contabilizar' else 'anular' end, v.id
  from public.movimientos_tesoreria m left join vig v on v.origen_tabla = 'movimientos_tesoreria' and v.origen_id = m.id
 where m.categoria not in ('cobranza','pago') and not (m.categoria = 'transferencia' and m.tipo = 'ingreso')
   and ((m.estado = 'vigente' and v.id is null) or (m.estado = 'anulado' and v.id is not null))
union all
select 'cheques', ch.id, 'rechazo', coalesce(ch.fecha_estado, ch.fecha_pago), 'Rechazo cheque N° ' || ch.numero, 'contabilizar', null::uuid
  from public.cheques ch left join vig v on v.origen_tabla = 'cheques' and v.origen_id = ch.id and v.evento = 'rechazo'
 where ch.estado = 'rechazado' and v.id is null
   and not exists (select 1 from public.movimientos_tesoreria m where m.cheque_id = ch.id and m.categoria = 'cheque'
                    and m.tipo = case when ch.tipo = 'recibido' then 'egreso' else 'ingreso' end)
union all
select 'certificados', ce.id, 'anticipo', coalesce(ce.fecha_aprobacion, ce.periodo_hasta), 'Descuento de anticipo · certificado N° ' || ce.numero, 'contabilizar', null::uuid
  from public.certificados ce join public.contratos ct on ct.id = ce.contrato_id
  left join vig v on v.origen_tabla = 'certificados' and v.origen_id = ce.id and v.evento = 'anticipo'
 where ce.estado in ('facturado','cobrado') and ce.descuento_anticipo > 0 and ct.anticipo_en_factura and v.id is null;

-- ---------------------------------------------------------------------
-- Períodos: cerrar y reabrir meses
-- ---------------------------------------------------------------------
create or replace function public.fn_cerrar_periodo(p_anio int, p_mes int)
returns void language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Solo el administrador o el contador cierran meses'; end if;
  select count(*) into v_n from public.v_pendientes_contabilizar
   where extract(year from fecha) = p_anio and extract(month from fecha) = p_mes;
  if v_n > 0 then raise exception 'Hay % comprobante(s) de %/% sin contabilizar: contabilizalos antes de cerrar el mes', v_n, lpad(p_mes::text, 2, '0'), p_anio; end if;
  insert into public.periodos (anio, mes, estado, cerrado_por, cerrado_en, motivo) values (p_anio, p_mes, 'cerrado', auth.uid(), now(), null)
  on conflict (anio, mes) do update set estado = 'cerrado', cerrado_por = auth.uid(), cerrado_en = now(), motivo = null;
end $$;

create or replace function public.fn_reabrir_periodo(p_anio int, p_mes int, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Solo el administrador o el contador reabren meses'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo para reabrir el mes'; end if;
  if exists (select 1 from public.ejercicios where estado = 'cerrado' and make_date(p_anio, p_mes, 1) between desde and hasta) then
    raise exception 'El ejercicio de ese mes está cerrado: no se puede reabrir';
  end if;
  update public.periodos set estado = 'abierto', motivo = p_motivo where anio = p_anio and mes = p_mes and estado = 'cerrado';
  if not found then raise exception 'El mes %/% no está cerrado', lpad(p_mes::text, 2, '0'), p_anio; end if;
end $$;

-- Los meses se cierran y reabren solo con estas funciones (quedan en la auditoría)
revoke insert, update, delete on public.periodos from authenticated, anon;

-- ---------------------------------------------------------------------
-- Cierre del ejercicio: refundición, cierre y apertura del siguiente
-- ---------------------------------------------------------------------
create or replace function public.fn_cerrar_ejercicio(p_anio int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ej public.ejercicios; v_res uuid; v_noasig uuid; v_lineas jsonb; v_neto numeric(16,2); v_cierre uuid; v_sig uuid; v_ap jsonb;
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Solo el administrador o el contador cierran el ejercicio'; end if;
  select * into v_ej from public.ejercicios where anio = p_anio for update;
  if not found then raise exception 'No hay asientos en el ejercicio %', p_anio; end if;
  if v_ej.estado = 'cerrado' then raise exception 'El ejercicio % ya está cerrado', p_anio; end if;
  if exists (select 1 from public.v_pendientes_contabilizar where fecha between v_ej.desde and v_ej.hasta) then
    raise exception 'Hay comprobantes del ejercicio sin contabilizar';
  end if;
  select cuenta_id into v_res from public.imputaciones_contables where clave = 'RESULTADO_EJERCICIO';
  select cuenta_id into v_noasig from public.imputaciones_contables where clave = 'RESULTADOS_NO_ASIGNADOS';
  if v_res is null or v_noasig is null then raise exception 'Configurá las cuentas de Resultado del ejercicio y Resultados no asignados'; end if;

  -- Refundición de cuentas de resultado
  with s as (select l.cuenta_id, sum(l.debe - l.haber) saldo from public.asiento_lineas l join public.asientos a on a.id = l.asiento_id
              join public.plan_cuentas c on c.id = l.cuenta_id
             where a.ejercicio_id = v_ej.id and c.rubro in ('ingreso','egreso') group by l.cuenta_id having sum(l.debe - l.haber) <> 0)
  select jsonb_agg(jsonb_build_object('cuenta_id', cuenta_id, 'debe', greatest(-saldo, 0), 'haber', greatest(saldo, 0))), coalesce(sum(saldo), 0)
    into v_lineas, v_neto from s;
  if v_lineas is not null then
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta_id', v_res, 'debe', greatest(v_neto, 0), 'haber', greatest(-v_neto, 0)));
    v_lineas := (select jsonb_agg(x) from jsonb_array_elements(v_lineas) x where (x->>'debe')::numeric > 0 or (x->>'haber')::numeric > 0);
    perform public.fn_insertar_asiento(jsonb_build_object('fecha', v_ej.hasta, 'tipo', 'refundicion', 'descripcion', 'Refundición de cuentas de resultado', 'lineas', v_lineas), false);
  end if;

  -- Cierre patrimonial
  with s as (select l.cuenta_id, sum(l.debe - l.haber) saldo from public.asiento_lineas l join public.asientos a on a.id = l.asiento_id
              join public.plan_cuentas c on c.id = l.cuenta_id
             where a.ejercicio_id = v_ej.id and c.rubro in ('activo','pasivo','patrimonio_neto') group by l.cuenta_id having sum(l.debe - l.haber) <> 0)
  select jsonb_agg(jsonb_build_object('cuenta_id', cuenta_id, 'debe', greatest(-saldo, 0), 'haber', greatest(saldo, 0))) into v_lineas from s;
  if v_lineas is not null then
    v_cierre := public.fn_insertar_asiento(jsonb_build_object('fecha', v_ej.hasta, 'tipo', 'cierre', 'descripcion', 'Asiento de cierre del ejercicio ' || p_anio, 'lineas', v_lineas), false);
    -- Apertura del siguiente: lo inverso del cierre, con el resultado en Resultados no asignados
    with inv as (select case when cuenta_id = v_res then v_noasig else cuenta_id end cuenta_id, sum(haber - debe) saldo
                   from public.asiento_lineas where asiento_id = v_cierre group by 1 having sum(haber - debe) <> 0)
    select jsonb_agg(jsonb_build_object('cuenta_id', cuenta_id, 'debe', greatest(saldo, 0), 'haber', greatest(-saldo, 0))) into v_ap from inv;
    if v_ap is not null then
      v_sig := public.fn_ejercicio_de(v_ej.hasta + 1);
      perform public.fn_insertar_asiento(jsonb_build_object('fecha', v_ej.hasta + 1, 'tipo', 'apertura', 'descripcion', 'Asiento de apertura del ejercicio ' || (p_anio + 1), 'lineas', v_ap), false);
    end if;
  end if;
  update public.ejercicios set estado = 'cerrado', cerrado_por = auth.uid(), cerrado_en = now() where id = v_ej.id;
  insert into public.periodos (anio, mes, estado, cerrado_por, cerrado_en)
  select extract(year from d)::int, extract(month from d)::int, 'cerrado', auth.uid(), now()
    from generate_series(date_trunc('month', v_ej.desde), v_ej.hasta, interval '1 month') d
  on conflict (anio, mes) do update set estado = 'cerrado';
end $$;

-- ---------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------
create view public.v_asientos with (security_invoker = true) as
select a.*, e.anio as ejercicio, an.numero as anula_a_numero, ap.numero as anulado_por_numero
  from public.asientos a join public.ejercicios e on e.id = a.ejercicio_id
  left join public.asientos an on an.id = a.anula_a_id
  left join public.asientos ap on ap.id = a.anulado_por_id;

create view public.v_asiento_lineas with (security_invoker = true) as
select l.*, a.fecha, a.numero, a.tipo, a.estado, a.descripcion as asiento_descripcion, a.origen_tabla, a.origen_id, a.ejercicio_id, e.anio as ejercicio,
       c.codigo as cuenta_codigo, c.nombre as cuenta_nombre, c.rubro, ct.codigo as contrato_codigo, cc.codigo as centro_codigo
  from public.asiento_lineas l
  join public.asientos a on a.id = l.asiento_id
  join public.ejercicios e on e.id = a.ejercicio_id
  join public.plan_cuentas c on c.id = l.cuenta_id
  left join public.contratos ct on ct.id = l.contrato_id
  left join public.centros_costo cc on cc.id = l.centro_costo_id;

-- =====================================================================
-- Seguridad
-- =====================================================================
alter table public.imputaciones_contables enable row level security;
alter table public.ejercicios             enable row level security;
alter table public.asientos               enable row level security;
alter table public.asiento_lineas         enable row level security;

create policy imp_ver on public.imputaciones_contables for select to authenticated using (public.fn_rol() is not null);
create policy imp_mod on public.imputaciones_contables for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy eje_ver on public.ejercicios     for select to authenticated using (public.fn_rol() is not null);
create policy asi_ver on public.asientos       for select to authenticated using (public.fn_rol() is not null);
create policy asl_ver on public.asiento_lineas for select to authenticated using (public.fn_rol() is not null);

revoke insert, delete, truncate on public.imputaciones_contables from anon, authenticated;
revoke insert, update, delete, truncate on public.ejercicios, public.asientos, public.asiento_lineas from anon, authenticated;
revoke all on public.imputaciones_contables, public.ejercicios, public.asientos, public.asiento_lineas,
  public.v_asientos, public.v_asiento_lineas, public.v_pendientes_contabilizar from anon;

revoke execute on function public.fn_insertar_asiento(jsonb, boolean), public.fn_ejercicio_de(date) from public, anon, authenticated;
revoke execute on function public.fn_registrar_asiento(jsonb), public.fn_anular_asiento(uuid, text, date), public.fn_cerrar_periodo(int, int),
  public.fn_reabrir_periodo(int, int, text), public.fn_cerrar_ejercicio(int) from public, anon;
grant execute on function public.fn_registrar_asiento(jsonb), public.fn_anular_asiento(uuid, text, date), public.fn_cerrar_periodo(int, int),
  public.fn_reabrir_periodo(int, int, text), public.fn_cerrar_ejercicio(int) to authenticated;

-- =====================================================================
-- Auditoría
-- =====================================================================
create trigger trg_audit_imp after insert or update or delete on public.imputaciones_contables for each row execute function public.fn_auditar();
create trigger trg_audit_eje after insert or update or delete on public.ejercicios             for each row execute function public.fn_auditar();
create trigger trg_audit_asi after insert or update or delete on public.asientos               for each row execute function public.fn_auditar();
create trigger trg_audit_asl after insert or update or delete on public.asiento_lineas         for each row execute function public.fn_auditar();

-- Fin de la migración 006
