-- =====================================================================
-- MADEWORK · Sistema contable · Migración 005 · Tesorería, bancos y cheques
-- Etapa 5 · 01/11/2026
--
-- Crea: cajas y cuentas bancarias, movimientos de tesorería, cartera de
-- cheques y echeqs (recibidos y emitidos), reversión de deuda por cheque
-- rechazado, extractos bancarios con mapeo de columnas por banco y
-- conciliación.
--
-- Desde esta etapa cada cobranza y cada pago genera solo su movimiento:
--   transferencia / efectivo -> movimiento en la cuenta elegida
--   cheque / echeq recibido  -> cheque en cartera
--   cheque / echeq propio    -> cheque emitido (se debita en su fecha)
--   cheque de terceros       -> se endosa al proveedor
--
-- Requiere las migraciones 001 a 004. Se corre UNA sola vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Parámetros y adjuntos
-- ---------------------------------------------------------------------
insert into public.parametros_fiscales (tipo, codigo, descripcion, valor, unidad, vigente_desde, a_confirmar, observacion) values
  ('TESORERIA', 'DIAS_AVISO_CHEQUES', 'Días de anticipación para avisar cheques a depositar o a debitar', 3, 'días', '2026-11-01', false, null);

alter table public.adjuntos drop constraint if exists adjuntos_tabla_check;
alter table public.adjuntos add constraint adjuntos_tabla_check check (tabla in (
  'contratos','certificados','polizas','multas','avance_unidades','redeterminaciones','clientes',
  'comprobantes_venta','cobranzas','retenciones_sufridas',
  'proveedores','ordenes_compra','comprobantes_compra','pagos',
  'cuentas_tesoreria','movimientos_tesoreria','cheques','extractos_bancarios'));

-- ---------------------------------------------------------------------
-- Cajas y cuentas bancarias
-- ---------------------------------------------------------------------
create table public.cuentas_tesoreria (
  id                    uuid primary key default gen_random_uuid(),
  nombre                text not null unique check (trim(nombre) <> ''),
  tipo                  text not null check (tipo in ('caja','banco')),
  banco                 text,
  numero_cuenta         text,
  cbu                   text check (cbu is null or cbu ~ '^\d{22}$'),
  alias_cbu             text,
  saldo_inicial         numeric(16,2) not null default 0,
  fecha_saldo_inicial   date not null default '2026-11-01',
  aplica_imp_deb_cred   boolean not null default false,
  activo                boolean not null default true,
  observacion           text,
  creado_en             timestamptz not null default now(),
  modificado_en         timestamptz not null default now(),
  check (tipo = 'banco' or (cbu is null and not aplica_imp_deb_cred))
);
create trigger trg_cuentas_tes_mod before update on public.cuentas_tesoreria for each row execute function public.fn_set_modificado();

-- ---------------------------------------------------------------------
-- Cheques y echeqs
-- ---------------------------------------------------------------------
create table public.cheques (
  id                      uuid primary key default gen_random_uuid(),
  tipo                    text not null check (tipo in ('recibido','emitido')),
  formato                 text not null default 'fisico' check (formato in ('fisico','echeq')),
  numero                  text not null check (trim(numero) <> ''),
  banco                   text,
  librador                text,
  cuit_librador           text check (cuit_librador is null or public.fn_cuit_valido(cuit_librador)),
  fecha_emision           date,
  fecha_pago              date not null,
  importe                 numeric(16,2) not null check (importe > 0),
  estado                  text not null check (estado in ('en_cartera','depositado','cobrado','endosado','emitido','debitado','rechazado','anulado')),
  cuenta_id               uuid references public.cuentas_tesoreria(id),   -- recibido: donde se depositó; emitido: cuenta propia
  cliente_id              uuid references public.clientes(id),
  proveedor_id            uuid references public.proveedores(id),
  cobranza_id             uuid references public.cobranzas(id),
  pago_id                 uuid references public.pagos(id),                 -- emitido: el pago que lo originó
  endoso_pago_id          uuid references public.pagos(id),                 -- recibido: el pago en que se endosó
  endosado_a_proveedor_id uuid references public.proveedores(id),
  fecha_estado            date,
  motivo                  text,
  observacion             text,
  creado_en               timestamptz not null default now(),
  modificado_en           timestamptz not null default now(),
  check ((tipo = 'recibido' and estado in ('en_cartera','depositado','cobrado','endosado','rechazado','anulado'))
      or (tipo = 'emitido'  and estado in ('emitido','debitado','rechazado','anulado'))),
  check (tipo = 'recibido' or cuenta_id is not null),
  check (estado <> 'rechazado' or coalesce(trim(motivo), '') <> '')
);
create unique index cheques_recibidos_unicos on public.cheques (upper(coalesce(banco, '')), upper(numero), coalesce(cuit_librador, ''))
  where tipo = 'recibido' and estado <> 'anulado';
create unique index cheques_emitidos_unicos on public.cheques (cuenta_id, upper(numero)) where tipo = 'emitido' and estado <> 'anulado';
create index cheques_estado on public.cheques (tipo, estado, fecha_pago);
create trigger trg_cheques_mod before update on public.cheques for each row execute function public.fn_set_modificado();

-- ---------------------------------------------------------------------
-- Movimientos de tesorería
-- ---------------------------------------------------------------------
create table public.movimientos_tesoreria (
  id                  uuid primary key default gen_random_uuid(),
  cuenta_id           uuid not null references public.cuentas_tesoreria(id),
  fecha               date not null,
  tipo                text not null check (tipo in ('ingreso','egreso')),
  categoria           text not null check (categoria in ('cobranza','pago','transferencia','cheque','gasto_bancario','impuesto_bancario',
                        'imp_deb_cred','aporte','retiro','ajuste','otro')),
  importe             numeric(16,2) not null check (importe > 0),
  descripcion         text,
  referencia          text,
  cobranza_id         uuid references public.cobranzas(id),
  pago_id             uuid references public.pagos(id),
  cheque_id           uuid references public.cheques(id),
  transferencia_id    uuid,
  movimiento_origen_id uuid references public.movimientos_tesoreria(id),   -- impuesto déb/créd generado por otro movimiento
  automatico          boolean not null default false,
  conciliado          boolean not null default false,
  estado              text not null default 'vigente' check (estado in ('vigente','anulado')),
  motivo              text,
  observacion         text,
  creado_por          uuid default auth.uid(),
  creado_en           timestamptz not null default now(),
  modificado_en       timestamptz not null default now(),
  check (estado <> 'anulado' or coalesce(trim(motivo), '') <> '')
);
create index movimientos_cuenta on public.movimientos_tesoreria (cuenta_id, fecha);
create index movimientos_transferencia on public.movimientos_tesoreria (transferencia_id);
create trigger trg_mov_mod before update on public.movimientos_tesoreria for each row execute function public.fn_set_modificado();

-- Deuda que se reabre cuando se rechaza un cheque (de cliente o propio)
create table public.reversiones_cheque (
  id                     uuid primary key default gen_random_uuid(),
  cheque_id              uuid not null references public.cheques(id),
  cobranza_id            uuid references public.cobranzas(id),
  pago_id                uuid references public.pagos(id),
  comprobante_venta_id   uuid references public.comprobantes_venta(id),
  comprobante_compra_id  uuid references public.comprobantes_compra(id),
  importe                numeric(16,2) not null check (importe > 0),
  creado_en              timestamptz not null default now(),
  check ((cobranza_id is not null) <> (pago_id is not null))
);
create index reversiones_venta on public.reversiones_cheque (comprobante_venta_id);
create index reversiones_compra on public.reversiones_cheque (comprobante_compra_id);

-- ---------------------------------------------------------------------
-- Extractos bancarios y conciliación
-- ---------------------------------------------------------------------
create table public.mapeos_extracto (
  id          uuid primary key default gen_random_uuid(),
  banco       text not null unique check (trim(banco) <> ''),
  config      jsonb not null,
  creado_en   timestamptz not null default now(),
  modificado_en timestamptz not null default now()
);
create trigger trg_mapeos_mod before update on public.mapeos_extracto for each row execute function public.fn_set_modificado();

create table public.extractos_bancarios (
  id            uuid primary key default gen_random_uuid(),
  cuenta_id     uuid not null references public.cuentas_tesoreria(id),
  archivo       text,
  fecha_desde   date,
  fecha_hasta   date,
  saldo_final   numeric(16,2),
  lineas        integer not null default 0,
  repetidas     integer not null default 0,
  creado_por    uuid default auth.uid(),
  creado_en     timestamptz not null default now()
);

create table public.extracto_lineas (
  id              uuid primary key default gen_random_uuid(),
  extracto_id     uuid not null references public.extractos_bancarios(id),
  cuenta_id       uuid not null references public.cuentas_tesoreria(id),
  fecha           date not null,
  descripcion     text,
  referencia      text,
  importe         numeric(16,2) not null check (importe <> 0),   -- + crédito / − débito
  movimiento_id   uuid unique references public.movimientos_tesoreria(id),
  estado          text not null default 'pendiente' check (estado in ('pendiente','conciliado','ignorado')),
  motivo          text,
  conciliado_por  uuid,
  conciliado_en   timestamptz,
  check ((estado = 'conciliado') = (movimiento_id is not null)),
  check (estado <> 'ignorado' or coalesce(trim(motivo), '') <> '')
);
create index extracto_lineas_cuenta on public.extracto_lineas (cuenta_id, fecha);

-- ---------------------------------------------------------------------
-- Medios de cobro y de pago: cuenta y cheque
-- ---------------------------------------------------------------------
alter table public.cobranza_medios add column cuenta_id uuid references public.cuentas_tesoreria(id);
alter table public.pago_medios add column cuenta_id uuid references public.cuentas_tesoreria(id);
alter table public.pago_medios add column cheque_id uuid references public.cheques(id);
alter table public.pago_medios add column fecha_emision date;
alter table public.pago_medios drop constraint if exists pago_medios_medio_check;
alter table public.pago_medios add constraint pago_medios_medio_check check (medio in ('transferencia','echeq','cheque','cheque_tercero','efectivo','otro'));

-- ---------------------------------------------------------------------
-- Saldos de comprobantes: lo revertido por cheques rechazados vuelve a deberse
-- ---------------------------------------------------------------------
create or replace function public.fn_cobrado_comprobante(p_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(a.importe) from public.aplicaciones_cobro a
                     join public.cobranzas c on c.id = a.cobranza_id and c.estado = 'registrada'
                    where a.comprobante_id = p_id), 0)
       - coalesce((select sum(r.importe) from public.reversiones_cheque r
                     join public.cobranzas c on c.id = r.cobranza_id and c.estado = 'registrada'
                    where r.comprobante_venta_id = p_id), 0)
$$;

create or replace function public.fn_pagado_compra(p_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(a.importe) from public.pago_aplicaciones a
                     join public.pagos p on p.id = a.pago_id and p.estado = 'registrado'
                    where a.comprobante_id = p_id), 0)
       - coalesce((select sum(r.importe) from public.reversiones_cheque r
                     join public.pagos p on p.id = r.pago_id and p.estado = 'registrado'
                    where r.comprobante_compra_id = p_id), 0)
$$;

create or replace view public.v_comprobantes_venta with (security_invoker = true) as
select cv.*,
       cl.razon_social as cliente, cl.cuit as cliente_cuit,
       ct.codigo as contrato_codigo,
       ce.numero as certificado_numero,
       tc.descripcion as tipo_descripcion,
       lpad(cv.punto_venta::text, 5, '0') || '-' || lpad(cv.numero::text, 8, '0') as numero_formateado,
       asoc.tipo_codigo as asociado_tipo,
       lpad(asoc.punto_venta::text, 5, '0') || '-' || lpad(asoc.numero::text, 8, '0') as asociado_numero,
       case when cv.clase = 'nota_credito' then -1 else 1 end as signo,
       coalesce(nc.total, 0) as notas_credito,
       coalesce(ap.total, 0) - coalesce(rv.total, 0) as cobrado,
       case when cv.clase in ('factura','nota_debito') and cv.estado = 'emitido'
            then cv.total - coalesce(nc.total, 0) - coalesce(ap.total, 0) + coalesce(rv.total, 0) end as saldo
  from public.comprobantes_venta cv
  join public.clientes cl on cl.id = cv.cliente_id
  join public.tipos_comprobante tc on tc.codigo = cv.tipo_codigo
  left join public.contratos ct on ct.id = cv.contrato_id
  left join public.certificados ce on ce.id = cv.certificado_id
  left join public.comprobantes_venta asoc on asoc.id = cv.comprobante_asociado_id
  left join (select comprobante_asociado_id id, sum(total) total from public.comprobantes_venta
              where clase = 'nota_credito' and estado = 'emitido' group by comprobante_asociado_id) nc on nc.id = cv.id
  left join (select a.comprobante_id id, sum(a.importe) total from public.aplicaciones_cobro a
               join public.cobranzas c on c.id = a.cobranza_id and c.estado = 'registrada' group by a.comprobante_id) ap on ap.id = cv.id
  left join (select r.comprobante_venta_id id, sum(r.importe) total from public.reversiones_cheque r
               join public.cobranzas c on c.id = r.cobranza_id and c.estado = 'registrada'
              where r.comprobante_venta_id is not null group by r.comprobante_venta_id) rv on rv.id = cv.id;

create or replace view public.v_comprobantes_compra with (security_invoker = true) as
select cc.*,
       pr.razon_social as proveedor, pr.cuit as proveedor_cuit, pr.condicion_iva as proveedor_condicion, pr.categoria as proveedor_categoria,
       tc.descripcion as tipo_descripcion,
       lpad(cc.punto_venta::text, 5, '0') || '-' || lpad(cc.numero::text, 8, '0') as numero_formateado,
       lpad(asoc.punto_venta::text, 5, '0') || '-' || lpad(asoc.numero::text, 8, '0') as asociado_numero,
       oc.numero as orden_compra_numero,
       coalesce(nc.total, 0) as notas_credito,
       coalesce(ap.total, 0) - coalesce(rv.total, 0) as pagado,
       case when cc.clase <> 'nota_credito' and cc.estado = 'emitido'
            then cc.total - coalesce(nc.total, 0) - coalesce(ap.total, 0) + coalesce(rv.total, 0) end as saldo
  from public.comprobantes_compra cc
  join public.proveedores pr on pr.id = cc.proveedor_id
  join public.tipos_comprobante tc on tc.codigo = cc.tipo_codigo
  left join public.comprobantes_compra asoc on asoc.id = cc.comprobante_asociado_id
  left join public.ordenes_compra oc on oc.id = cc.orden_compra_id
  left join (select comprobante_asociado_id id, sum(total) total from public.comprobantes_compra
              where clase = 'nota_credito' and estado = 'emitido' group by comprobante_asociado_id) nc on nc.id = cc.id
  left join (select a.comprobante_id id, sum(a.importe) total from public.pago_aplicaciones a
               join public.pagos p on p.id = a.pago_id and p.estado = 'registrado' group by a.comprobante_id) ap on ap.id = cc.id
  left join (select r.comprobante_compra_id id, sum(r.importe) total from public.reversiones_cheque r
               join public.pagos p on p.id = r.pago_id and p.estado = 'registrado'
              where r.comprobante_compra_id is not null group by r.comprobante_compra_id) rv on rv.id = cc.id;

-- ---------------------------------------------------------------------
-- Controles de movimientos
-- Los movimientos automáticos (de cobranzas, pagos, cheques, transferencias e
-- impuestos) los crean solo las funciones de la base, marcadas con mw.tesoreria.
-- ---------------------------------------------------------------------
create or replace function public.fn_interno() returns boolean language sql stable as $$
  select coalesce(current_setting('mw.tesoreria', true), '') = 'on'
$$;

create or replace function public.fn_movimientos_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cta public.cuentas_tesoreria;
begin
  if tg_op = 'INSERT' then
    select * into v_cta from public.cuentas_tesoreria where id = new.cuenta_id;
    if not v_cta.activo then raise exception 'La cuenta "%" está inactiva', v_cta.nombre; end if;
    if new.fecha < v_cta.fecha_saldo_inicial then
      raise exception 'La fecha es anterior al saldo inicial de la cuenta "%" (%)', v_cta.nombre, to_char(v_cta.fecha_saldo_inicial, 'DD/MM/YYYY');
    end if;
    if not public.fn_periodo_abierto(new.fecha) then
      raise exception 'El período % está cerrado: no se pueden registrar movimientos con esa fecha', to_char(new.fecha, 'MM/YYYY');
    end if;
    new.estado := 'vigente';
    new.conciliado := false;
    if public.fn_interno() then
      new.automatico := true;
    else
      new.automatico := false;
      if new.categoria not in ('gasto_bancario','impuesto_bancario','imp_deb_cred','aporte','retiro','ajuste','otro')
         or new.cobranza_id is not null or new.pago_id is not null or new.cheque_id is not null
         or new.transferencia_id is not null or new.movimiento_origen_id is not null then
        raise exception 'Ese tipo de movimiento lo genera el sistema (cobranzas, pagos, cheques o transferencias)';
      end if;
    end if;
    return new;
  end if;
  if old.estado = 'anulado' then raise exception 'El movimiento está anulado: no se puede modificar'; end if;
  if (new.cuenta_id, new.fecha, new.tipo, new.categoria, new.importe, new.cobranza_id, new.pago_id, new.cheque_id,
      new.transferencia_id, new.movimiento_origen_id, new.automatico, new.creado_por)
     is distinct from (old.cuenta_id, old.fecha, old.tipo, old.categoria, old.importe, old.cobranza_id, old.pago_id, old.cheque_id,
      old.transferencia_id, old.movimiento_origen_id, old.automatico, old.creado_por) then
    raise exception 'Los datos e importes de un movimiento no se modifican: anulalo y cargalo de nuevo';
  end if;
  if new.estado = 'anulado' then
    if old.automatico and not public.fn_interno() then
      raise exception 'Este movimiento lo generó el sistema: se anula desde su origen (cobranza, pago, cheque o transferencia)';
    end if;
    if old.conciliado then raise exception 'El movimiento está conciliado con el extracto: desconcilialo primero'; end if;
    if not public.fn_periodo_abierto(old.fecha) then raise exception 'El período % está cerrado', to_char(old.fecha, 'MM/YYYY'); end if;
  end if;
  if new.conciliado is distinct from old.conciliado and not public.fn_interno() then
    raise exception 'La conciliación se hace desde la pantalla de conciliación';
  end if;
  return new;
end $$;
create trigger trg_mov_control before insert or update on public.movimientos_tesoreria
  for each row execute function public.fn_movimientos_control();

-- Impuesto a los débitos y créditos: se genera solo en cuentas bancarias que lo tienen marcado
-- y si el parámetro tiene valor (hoy está A CONFIRMAR CON CONTADOR, así que no se genera).
create or replace function public.fn_movimientos_despues()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cta public.cuentas_tesoreria; v_pct numeric; v_imp numeric(16,2);
        v_prev text := coalesce(current_setting('mw.tesoreria', true), '');
begin
  if tg_op = 'INSERT' then
    if new.categoria in ('transferencia','imp_deb_cred') then return null; end if;
    select * into v_cta from public.cuentas_tesoreria where id = new.cuenta_id;
    if v_cta.tipo <> 'banco' or not v_cta.aplica_imp_deb_cred then return null; end if;
    v_pct := public.fn_parametro_vigente('BANCARIO', 'IMP_DEB_CRED', new.fecha);
    if v_pct is null or v_pct = 0 then return null; end if;
    v_imp := round(new.importe * v_pct / 100, 2);
    if v_imp <= 0 then return null; end if;
    perform set_config('mw.tesoreria', 'on', true);
    insert into public.movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe, descripcion, movimiento_origen_id)
    values (new.cuenta_id, new.fecha, 'egreso', 'imp_deb_cred', v_imp,
            format('Imp. débitos y créditos %s%% s/ %s', v_pct, new.importe), new.id);
    perform set_config('mw.tesoreria', v_prev, true);
  elsif new.estado = 'anulado' and old.estado = 'vigente' then
    perform set_config('mw.tesoreria', 'on', true);
    update public.movimientos_tesoreria set estado = 'anulado', motivo = 'Se anuló el movimiento que lo generó'
     where movimiento_origen_id = new.id and estado = 'vigente';
    perform set_config('mw.tesoreria', v_prev, true);
  end if;
  return null;
end $$;
create trigger trg_mov_despues after insert or update on public.movimientos_tesoreria
  for each row execute function public.fn_movimientos_despues();

-- Cheques: alta solo desde cobranzas/pagos y cambios de estado solo por las funciones
create or replace function public.fn_cheques_control()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_interno() then
    raise exception 'Los cheques se cargan desde las cobranzas y los pagos, y cambian de estado con las acciones de Tesorería';
  end if;
  if tg_op = 'UPDATE' then
    if (new.tipo, new.numero, new.importe, new.fecha_pago, new.cobranza_id, new.pago_id) is distinct from
       (old.tipo, old.numero, old.importe, old.fecha_pago, old.cobranza_id, old.pago_id) then
      raise exception 'Los datos de un cheque no se modifican';
    end if;
    if old.estado in ('rechazado','anulado') then raise exception 'El cheque está %', old.estado; end if;
  end if;
  return new;
end $$;
create trigger trg_cheques_control before insert or update on public.cheques
  for each row execute function public.fn_cheques_control();

-- ---------------------------------------------------------------------
-- Cobranzas y pagos generan su tesorería
-- ---------------------------------------------------------------------
create or replace function public.fn_cobranza_medios_tesoreria()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cob public.cobranzas; v_cta public.cuentas_tesoreria;
begin
  select * into v_cob from public.cobranzas where id = new.cobranza_id;
  perform set_config('mw.tesoreria', 'on', true);
  if new.medio in ('echeq','cheque') then
    if coalesce(trim(new.numero), '') = '' then raise exception 'Falta el número del cheque o echeq'; end if;
    if new.fecha_pago is null then raise exception 'Falta la fecha de pago del cheque N° %', new.numero; end if;
    insert into public.cheques (tipo, formato, numero, banco, librador, cuit_librador, fecha_emision, fecha_pago, importe, estado,
                                cliente_id, cobranza_id, fecha_estado)
    values ('recibido', case when new.medio = 'echeq' then 'echeq' else 'fisico' end, trim(new.numero), new.banco, new.librador,
            new.cuit_librador, new.fecha_emision, new.fecha_pago, new.importe, 'en_cartera', v_cob.cliente_id, v_cob.id, v_cob.fecha);
  else
    if new.cuenta_id is null then raise exception 'Elegí la cuenta o caja donde entra el %', new.medio; end if;
    select * into v_cta from public.cuentas_tesoreria where id = new.cuenta_id;
    if new.medio = 'efectivo' and v_cta.tipo <> 'caja' then raise exception 'El efectivo entra a una caja, no a una cuenta bancaria'; end if;
    if new.medio = 'transferencia' and v_cta.tipo <> 'banco' then raise exception 'Una transferencia entra a una cuenta bancaria'; end if;
    insert into public.movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe, descripcion, referencia, cobranza_id)
    values (new.cuenta_id, greatest(coalesce(new.fecha_pago, v_cob.fecha), v_cta.fecha_saldo_inicial), 'ingreso', 'cobranza', new.importe,
            format('Recibo N° %s', v_cob.numero), new.numero, v_cob.id);
  end if;
  perform set_config('mw.tesoreria', 'off', true);
  return null;
end $$;
create trigger trg_cm_tesoreria after insert on public.cobranza_medios
  for each row execute function public.fn_cobranza_medios_tesoreria();

create or replace function public.fn_pago_medios_tesoreria()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pago public.pagos; v_cta public.cuentas_tesoreria; v_ch public.cheques;
begin
  select * into v_pago from public.pagos where id = new.pago_id;
  perform set_config('mw.tesoreria', 'on', true);
  if new.medio = 'cheque_tercero' then
    select * into v_ch from public.cheques where id = new.cheque_id for update;
    if not found or v_ch.tipo <> 'recibido' then raise exception 'Elegí un cheque de terceros de la cartera'; end if;
    if v_ch.estado <> 'en_cartera' then raise exception 'El cheque N° % no está en cartera (está %)', v_ch.numero, v_ch.estado; end if;
    if v_ch.importe <> new.importe then raise exception 'El cheque N° % es de % y se está usando por %', v_ch.numero, v_ch.importe, new.importe; end if;
    update public.cheques set estado = 'endosado', endoso_pago_id = v_pago.id, endosado_a_proveedor_id = v_pago.proveedor_id, fecha_estado = v_pago.fecha
     where id = v_ch.id;
  elsif new.medio in ('echeq','cheque') then
    if new.cuenta_id is null then raise exception 'Elegí la cuenta bancaria del cheque propio'; end if;
    if coalesce(trim(new.numero), '') = '' then raise exception 'Falta el número del cheque o echeq'; end if;
    if new.fecha_pago is null then raise exception 'Falta la fecha de pago del cheque N° %', new.numero; end if;
    select * into v_cta from public.cuentas_tesoreria where id = new.cuenta_id;
    if v_cta.tipo <> 'banco' then raise exception 'Un cheque propio sale de una cuenta bancaria'; end if;
    insert into public.cheques (tipo, formato, numero, banco, librador, fecha_emision, fecha_pago, importe, estado, cuenta_id,
                                proveedor_id, pago_id, fecha_estado)
    values ('emitido', case when new.medio = 'echeq' then 'echeq' else 'fisico' end, trim(new.numero), coalesce(new.banco, v_cta.banco),
            'MADEWORK', coalesce(new.fecha_emision, v_pago.fecha), new.fecha_pago, new.importe, 'emitido', new.cuenta_id,
            v_pago.proveedor_id, v_pago.id, v_pago.fecha);
  else
    if new.cuenta_id is null then raise exception 'Elegí la cuenta o caja de la que sale el %', new.medio; end if;
    select * into v_cta from public.cuentas_tesoreria where id = new.cuenta_id;
    if new.medio = 'efectivo' and v_cta.tipo <> 'caja' then raise exception 'El efectivo sale de una caja, no de una cuenta bancaria'; end if;
    if new.medio = 'transferencia' and v_cta.tipo <> 'banco' then raise exception 'Una transferencia sale de una cuenta bancaria'; end if;
    insert into public.movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe, descripcion, referencia, pago_id)
    values (new.cuenta_id, greatest(coalesce(new.fecha_pago, v_pago.fecha), v_cta.fecha_saldo_inicial), 'egreso', 'pago', new.importe,
            format('Orden de pago N° %s', v_pago.numero), new.numero, v_pago.id);
  end if;
  perform set_config('mw.tesoreria', 'off', true);
  return null;
end $$;
create trigger trg_pm_tesoreria after insert on public.pago_medios
  for each row execute function public.fn_pago_medios_tesoreria();

-- Al anular una cobranza o un pago se anula su tesorería (si los cheques todavía no se movieron)
create or replace function public.fn_cobranzas_tesoreria()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ch public.cheques;
begin
  if new.estado = 'anulada' and old.estado = 'registrada' then
    for v_ch in select * from public.cheques where cobranza_id = new.id and tipo = 'recibido' and estado <> 'anulado' loop
      if v_ch.estado <> 'en_cartera' then
        raise exception 'El cheque N° % de esta cobranza ya está "%": no se puede anular la cobranza', v_ch.numero, v_ch.estado;
      end if;
    end loop;
    perform set_config('mw.tesoreria', 'on', true);
    update public.cheques set estado = 'anulado', motivo = 'Se anuló el recibo', fecha_estado = current_date
     where cobranza_id = new.id and tipo = 'recibido' and estado = 'en_cartera';
    if exists (select 1 from public.movimientos_tesoreria where cobranza_id = new.id and estado = 'vigente' and conciliado) then
      raise exception 'Un movimiento de esta cobranza ya está conciliado con el banco: desconcilialo primero';
    end if;
    update public.movimientos_tesoreria set estado = 'anulado', motivo = 'Se anuló el recibo'
     where cobranza_id = new.id and estado = 'vigente';
    perform set_config('mw.tesoreria', 'off', true);
  end if;
  return null;
end $$;
create trigger trg_cob_tesoreria after update on public.cobranzas for each row execute function public.fn_cobranzas_tesoreria();

create or replace function public.fn_pagos_tesoreria()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ch public.cheques;
begin
  if new.estado = 'anulado' and old.estado = 'registrado' then
    for v_ch in select * from public.cheques where pago_id = new.id and tipo = 'emitido' and estado <> 'anulado' loop
      if v_ch.estado <> 'emitido' then
        raise exception 'El cheque propio N° % de este pago ya está "%": no se puede anular el pago', v_ch.numero, v_ch.estado;
      end if;
    end loop;
    if exists (select 1 from public.movimientos_tesoreria where pago_id = new.id and estado = 'vigente' and conciliado) then
      raise exception 'Un movimiento de este pago ya está conciliado con el banco: desconcilialo primero';
    end if;
    perform set_config('mw.tesoreria', 'on', true);
    update public.cheques set estado = 'anulado', motivo = 'Se anuló la orden de pago', fecha_estado = current_date
     where pago_id = new.id and tipo = 'emitido' and estado = 'emitido';
    update public.cheques set estado = 'en_cartera', endoso_pago_id = null, endosado_a_proveedor_id = null, fecha_estado = current_date
     where endoso_pago_id = new.id and estado = 'endosado';
    update public.movimientos_tesoreria set estado = 'anulado', motivo = 'Se anuló la orden de pago'
     where pago_id = new.id and estado = 'vigente';
    perform set_config('mw.tesoreria', 'off', true);
  end if;
  return null;
end $$;
create trigger trg_pagos_tesoreria after update on public.pagos for each row execute function public.fn_pagos_tesoreria();

-- ---------------------------------------------------------------------
-- Cobranzas y pagos: las funciones de alta ahora reciben la cuenta y el cheque
-- (mismo comportamiento que en las Etapas 3 y 4, más la tesorería)
-- ---------------------------------------------------------------------
create or replace function public.fn_registrar_cobranza(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_fecha date := (p->>'fecha')::date;
  v_medios numeric(16,2);
  v_ret numeric(16,2);
  v_fr numeric(16,2);
  v_apl numeric(16,2);
  v_dev numeric(16,2);
  v_cert uuid;
begin
  if not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Solo el administrador o el contador registran cobranzas';
  end if;
  if v_fecha is null then raise exception 'Falta la fecha de la cobranza'; end if;

  select coalesce(sum(round((x->>'importe')::numeric, 2)), 0) into v_medios from jsonb_array_elements(coalesce(p->'medios', '[]')) x;
  select coalesce(sum(round((x->>'importe')::numeric, 2)), 0) into v_ret from jsonb_array_elements(coalesce(p->'retenciones', '[]')) x;
  select coalesce(sum(round((x->>'importe')::numeric, 2)), 0) into v_fr from jsonb_array_elements(coalesce(p->'fondo_reparo', '[]')) x;
  select coalesce(sum(round((x->>'importe')::numeric, 2)), 0) into v_apl from jsonb_array_elements(coalesce(p->'aplicaciones', '[]')) x;
  select coalesce(sum(round((x->>'importe')::numeric, 2)), 0) into v_dev from jsonb_array_elements(coalesce(p->'devoluciones_fr', '[]')) x;
  if v_medios + v_ret + v_fr <= 0 then raise exception 'La cobranza no tiene importes'; end if;
  if v_apl + v_dev > v_medios + v_ret + v_fr then
    raise exception 'Se aplica más (%) de lo que se cobra (%)', v_apl + v_dev, v_medios + v_ret + v_fr;
  end if;

  insert into public.cobranzas (cliente_id, fecha, importe_medios, importe_retenciones, importe_fondo_reparo, total,
                                importe_aplicado, importe_devolucion_fr, observacion)
  values ((p->>'cliente_id')::uuid, v_fecha, v_medios, v_ret, v_fr, v_medios + v_ret + v_fr, v_apl, v_dev, nullif(trim(p->>'observacion'), ''))
  returning id into v_id;

  insert into public.cobranza_medios (cobranza_id, medio, importe, banco, numero, fecha_emision, fecha_pago, librador, cuit_librador, referencia, cuenta_id)
  select v_id, x.medio, round(x.importe, 2), nullif(trim(x.banco), ''), nullif(trim(x.numero), ''), x.fecha_emision, x.fecha_pago,
         nullif(trim(x.librador), ''), nullif(regexp_replace(coalesce(x.cuit_librador, ''), '\D', '', 'g'), ''), nullif(trim(x.referencia), ''), x.cuenta_id
    from jsonb_to_recordset(coalesce(p->'medios', '[]')) as x(medio text, importe numeric, banco text, numero text, fecha_emision date,
         fecha_pago date, librador text, cuit_librador text, referencia text, cuenta_id uuid);

  insert into public.retenciones_sufridas (cobranza_id, tipo, descripcion, numero_certificado, fecha, base, alicuota, importe, comprobante_venta_id)
  select v_id, x.tipo, nullif(trim(x.descripcion), ''), trim(x.numero_certificado), coalesce(x.fecha, v_fecha), x.base, x.alicuota,
         round(x.importe, 2), x.comprobante_venta_id
    from jsonb_to_recordset(coalesce(p->'retenciones', '[]')) as x(tipo text, descripcion text, numero_certificado text, fecha date,
         base numeric, alicuota numeric, importe numeric, comprobante_venta_id uuid);

  insert into public.fondo_reparo_movimientos (contrato_id, cobranza_id, comprobante_venta_id, tipo, importe)
  select x.contrato_id, v_id, x.comprobante_venta_id, 'retencion', round(x.importe, 2)
    from jsonb_to_recordset(coalesce(p->'fondo_reparo', '[]')) as x(contrato_id uuid, comprobante_venta_id uuid, importe numeric);

  insert into public.aplicaciones_cobro (cobranza_id, comprobante_id, importe)
  select v_id, x.comprobante_id, round(x.importe, 2)
    from jsonb_to_recordset(coalesce(p->'aplicaciones', '[]')) as x(comprobante_id uuid, importe numeric);

  insert into public.fondo_reparo_movimientos (contrato_id, cobranza_id, tipo, importe)
  select x.contrato_id, v_id, 'devolucion', round(x.importe, 2)
    from jsonb_to_recordset(coalesce(p->'devoluciones_fr', '[]')) as x(contrato_id uuid, importe numeric);

  for v_cert in select distinct cv.certificado_id from public.aplicaciones_cobro a
                  join public.comprobantes_venta cv on cv.id = a.comprobante_id
                 where a.cobranza_id = v_id and cv.certificado_id is not null loop
    perform public.fn_sync_certificado(v_cert);
  end loop;
  return v_id;
end $$;

create or replace function public.fn_registrar_pago(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_fecha date := (p->>'fecha')::date;
  v_medios numeric(16,2);
  v_ret numeric(16,2);
  v_apl numeric(16,2);
begin
  if not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Solo el administrador o el contador registran pagos';
  end if;
  if v_fecha is null then raise exception 'Falta la fecha del pago'; end if;
  select coalesce(sum(round((x->>'importe')::numeric, 2)), 0) into v_medios from jsonb_array_elements(coalesce(p->'medios', '[]')) x;
  select coalesce(sum(round((x->>'importe')::numeric, 2)), 0) into v_ret from jsonb_array_elements(coalesce(p->'retenciones', '[]')) x;
  select coalesce(sum(round((x->>'importe')::numeric, 2)), 0) into v_apl from jsonb_array_elements(coalesce(p->'aplicaciones', '[]')) x;
  if v_medios + v_ret <= 0 then raise exception 'El pago no tiene importes'; end if;
  if v_apl > v_medios + v_ret then raise exception 'Se aplica más (%) de lo que se paga (%)', v_apl, v_medios + v_ret; end if;

  insert into public.pagos (proveedor_id, fecha, importe_medios, importe_retenciones, total, importe_aplicado, observacion)
  values ((p->>'proveedor_id')::uuid, v_fecha, v_medios, v_ret, v_medios + v_ret, v_apl, nullif(trim(p->>'observacion'), ''))
  returning id into v_id;

  insert into public.pago_medios (pago_id, medio, importe, banco, numero, fecha_emision, fecha_pago, referencia, cuenta_id, cheque_id)
  select v_id, x.medio, round(x.importe, 2), nullif(trim(x.banco), ''), nullif(trim(x.numero), ''), x.fecha_emision, x.fecha_pago,
         nullif(trim(x.referencia), ''), x.cuenta_id, x.cheque_id
    from jsonb_to_recordset(coalesce(p->'medios', '[]')) as x(medio text, importe numeric, banco text, numero text, fecha_emision date,
         fecha_pago date, referencia text, cuenta_id uuid, cheque_id uuid);

  insert into public.retenciones_practicadas (pago_id, tipo, descripcion, numero_certificado, base, alicuota, importe)
  select v_id, x.tipo, nullif(trim(x.descripcion), ''), nullif(trim(x.numero_certificado), ''), x.base, x.alicuota, round(x.importe, 2)
    from jsonb_to_recordset(coalesce(p->'retenciones', '[]')) as x(tipo text, descripcion text, numero_certificado text, base numeric, alicuota numeric, importe numeric);

  insert into public.pago_aplicaciones (pago_id, comprobante_id, importe)
  select v_id, x.comprobante_id, round(x.importe, 2)
    from jsonb_to_recordset(coalesce(p->'aplicaciones', '[]')) as x(comprobante_id uuid, importe numeric);
  return v_id;
end $$;

-- Una cobranza o un pago con un cheque rechazado no se anula (la deuda ya se reabrió por el rechazo)
create or replace function public.fn_bloqueo_anular_con_rechazo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'cobranzas' and new.estado = 'anulada' and old.estado = 'registrada'
     and exists (select 1 from public.reversiones_cheque where cobranza_id = new.id) then
    raise exception 'Esta cobranza tiene un cheque rechazado que ya reabrió la deuda del cliente: no se anula';
  end if;
  if tg_table_name = 'pagos' and new.estado = 'anulado' and old.estado = 'registrado'
     and exists (select 1 from public.reversiones_cheque where pago_id = new.id) then
    raise exception 'Este pago tiene un cheque rechazado que ya reabrió la deuda con el proveedor: no se anula';
  end if;
  return new;
end $$;
create trigger trg_cob_bloqueo_rechazo before update on public.cobranzas for each row execute function public.fn_bloqueo_anular_con_rechazo();
create trigger trg_pag_bloqueo_rechazo before update on public.pagos for each row execute function public.fn_bloqueo_anular_con_rechazo();

-- ---------------------------------------------------------------------
-- Funciones de tesorería
-- ---------------------------------------------------------------------
create or replace function public.fn_solo_tesoreria() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Solo el administrador o el contador operan la tesorería';
  end if;
end $$;

-- Transferencia entre cuentas propias: dos movimientos con el mismo código
create or replace function public.fn_transferencia(p_origen uuid, p_destino uuid, p_fecha date, p_importe numeric, p_descripcion text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_t uuid := gen_random_uuid(); v_o text; v_d text;
begin
  perform public.fn_solo_tesoreria();
  if p_origen = p_destino then raise exception 'La cuenta de origen y la de destino tienen que ser distintas'; end if;
  if p_importe is null or p_importe <= 0 then raise exception 'El importe tiene que ser mayor a cero'; end if;
  select nombre into v_o from public.cuentas_tesoreria where id = p_origen;
  select nombre into v_d from public.cuentas_tesoreria where id = p_destino;
  if v_o is null or v_d is null then raise exception 'No existe alguna de las cuentas'; end if;
  perform set_config('mw.tesoreria', 'on', true);
  insert into public.movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe, descripcion, transferencia_id)
  values (p_origen, p_fecha, 'egreso', 'transferencia', round(p_importe, 2), coalesce(nullif(trim(p_descripcion), ''), 'Transferencia a ' || v_d), v_t),
         (p_destino, p_fecha, 'ingreso', 'transferencia', round(p_importe, 2), coalesce(nullif(trim(p_descripcion), ''), 'Transferencia desde ' || v_o), v_t);
  perform set_config('mw.tesoreria', 'off', true);
  return v_t;
end $$;

-- Anula un movimiento manual o una transferencia (las dos patas)
create or replace function public.fn_anular_movimiento(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.movimientos_tesoreria;
begin
  perform public.fn_solo_tesoreria();
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
  select * into v_m from public.movimientos_tesoreria where id = p_id;
  if not found then raise exception 'No existe el movimiento'; end if;
  if v_m.transferencia_id is not null then
    if exists (select 1 from public.movimientos_tesoreria where transferencia_id = v_m.transferencia_id and conciliado) then
      raise exception 'Una de las patas de la transferencia está conciliada: desconciliala primero';
    end if;
    perform set_config('mw.tesoreria', 'on', true);
    update public.movimientos_tesoreria set estado = 'anulado', motivo = p_motivo where transferencia_id = v_m.transferencia_id and estado = 'vigente';
    perform set_config('mw.tesoreria', 'off', true);
  else
    update public.movimientos_tesoreria set estado = 'anulado', motivo = p_motivo where id = p_id;
  end if;
end $$;

create or replace function public.fn_cheque_depositar(p_id uuid, p_cuenta uuid, p_fecha date)
returns void language plpgsql security definer set search_path = public as $$
declare v_ch public.cheques; v_cta public.cuentas_tesoreria;
begin
  perform public.fn_solo_tesoreria();
  select * into v_ch from public.cheques where id = p_id for update;
  if v_ch.tipo <> 'recibido' or v_ch.estado <> 'en_cartera' then raise exception 'Solo se deposita un cheque de terceros en cartera'; end if;
  select * into v_cta from public.cuentas_tesoreria where id = p_cuenta;
  if v_cta.tipo <> 'banco' then raise exception 'Un cheque se deposita en una cuenta bancaria'; end if;
  if p_fecha < v_ch.fecha_pago then
    raise exception 'El cheque es de pago diferido: se puede depositar desde el %', to_char(v_ch.fecha_pago, 'DD/MM/YYYY');
  end if;
  perform set_config('mw.tesoreria', 'on', true);
  update public.cheques set estado = 'depositado', cuenta_id = p_cuenta, fecha_estado = p_fecha where id = p_id;
  perform set_config('mw.tesoreria', 'off', true);
end $$;

-- Acreditado: entra la plata a la cuenta (si estaba en cartera, se deposita y acredita en un paso)
create or replace function public.fn_cheque_acreditar(p_id uuid, p_fecha date, p_cuenta uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ch public.cheques; v_cuenta uuid;
begin
  perform public.fn_solo_tesoreria();
  select * into v_ch from public.cheques where id = p_id for update;
  if v_ch.tipo <> 'recibido' or v_ch.estado not in ('en_cartera','depositado') then raise exception 'Solo se acredita un cheque de terceros en cartera o depositado'; end if;
  v_cuenta := coalesce(p_cuenta, v_ch.cuenta_id);
  if v_cuenta is null then raise exception 'Elegí la cuenta donde se acreditó'; end if;
  if (select tipo from public.cuentas_tesoreria where id = v_cuenta) <> 'banco' then raise exception 'Un cheque se acredita en una cuenta bancaria'; end if;
  perform set_config('mw.tesoreria', 'on', true);
  update public.cheques set estado = 'cobrado', cuenta_id = v_cuenta, fecha_estado = p_fecha where id = p_id;
  insert into public.movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe, descripcion, referencia, cheque_id, cobranza_id)
  values (v_cuenta, p_fecha, 'ingreso', 'cheque', v_ch.importe,
          format('Acreditación %s N° %s - %s', case when v_ch.formato = 'echeq' then 'echeq' else 'cheque' end, v_ch.numero, coalesce(v_ch.librador, '')),
          v_ch.numero, v_ch.id, v_ch.cobranza_id);
  perform set_config('mw.tesoreria', 'off', true);
end $$;

-- Cheque propio debitado de la cuenta
create or replace function public.fn_cheque_debitar(p_id uuid, p_fecha date)
returns void language plpgsql security definer set search_path = public as $$
declare v_ch public.cheques; v_prov text;
begin
  perform public.fn_solo_tesoreria();
  select * into v_ch from public.cheques where id = p_id for update;
  if v_ch.tipo <> 'emitido' or v_ch.estado <> 'emitido' then raise exception 'Solo se debita un cheque propio pendiente'; end if;
  select razon_social into v_prov from public.proveedores where id = v_ch.proveedor_id;
  perform set_config('mw.tesoreria', 'on', true);
  update public.cheques set estado = 'debitado', fecha_estado = p_fecha where id = p_id;
  insert into public.movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe, descripcion, referencia, cheque_id, pago_id)
  values (v_ch.cuenta_id, p_fecha, 'egreso', 'cheque', v_ch.importe,
          format('Débito %s propio N° %s - %s', case when v_ch.formato = 'echeq' then 'echeq' else 'cheque' end, v_ch.numero, coalesce(v_prov, '')),
          v_ch.numero, v_ch.id, v_ch.pago_id);
  perform set_config('mw.tesoreria', 'off', true);
end $$;

-- Rechazo: si ya se había acreditado o debitado, se revierte en la cuenta; la deuda se reabre
-- en los comprobantes que pagó (de la última factura a la primera)
create or replace function public.fn_cheque_rechazar(p_id uuid, p_fecha date, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ch public.cheques; v_resto numeric(16,2); v_x numeric(16,2); v_acuenta numeric(16,2); v_usado numeric(16,2);
  a record; v_cert uuid; v_cob public.cobranzas; v_pago public.pagos; v_mov public.movimientos_tesoreria;
begin
  perform public.fn_solo_tesoreria();
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo del rechazo'; end if;
  select * into v_ch from public.cheques where id = p_id for update;
  if not found then raise exception 'No existe el cheque'; end if;
  if (v_ch.tipo = 'recibido' and v_ch.estado not in ('en_cartera','depositado','cobrado'))
     or (v_ch.tipo = 'emitido' and v_ch.estado not in ('emitido','debitado')) then
    raise exception 'Un cheque "%" no se puede rechazar', v_ch.estado;
  end if;
  perform set_config('mw.tesoreria', 'on', true);
  -- Reversa del movimiento de la cuenta
  if v_ch.estado in ('cobrado','debitado') then
    select * into v_mov from public.movimientos_tesoreria where cheque_id = v_ch.id and estado = 'vigente' and categoria = 'cheque' limit 1;
    insert into public.movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe, descripcion, referencia, cheque_id)
    values (v_ch.cuenta_id, p_fecha, case when v_ch.tipo = 'recibido' then 'egreso' else 'ingreso' end, 'cheque', v_ch.importe,
            format('Rechazo cheque N° %s: %s', v_ch.numero, p_motivo), v_ch.numero, v_ch.id);
  end if;
  update public.cheques set estado = 'rechazado', motivo = p_motivo, fecha_estado = p_fecha where id = p_id;

  v_resto := v_ch.importe;
  if v_ch.tipo = 'recibido' then
    select * into v_cob from public.cobranzas where id = v_ch.cobranza_id;
    if v_cob.estado = 'registrada' then
      -- primero lo que estaba a cuenta
      select coalesce(sum(importe), 0) into v_usado from public.reversiones_cheque where cobranza_id = v_cob.id and comprobante_venta_id is null;
      v_acuenta := greatest(v_cob.a_cuenta - v_usado, 0);
      v_x := least(v_resto, v_acuenta);
      if v_x > 0 then
        insert into public.reversiones_cheque (cheque_id, cobranza_id, importe) values (v_ch.id, v_cob.id, v_x);
        v_resto := v_resto - v_x;
      end if;
      for a in select ap.comprobante_id, ap.importe - coalesce((select sum(r.importe) from public.reversiones_cheque r
                     where r.cobranza_id = v_cob.id and r.comprobante_venta_id = ap.comprobante_id), 0) as disponible
                 from public.aplicaciones_cobro ap join public.comprobantes_venta cv on cv.id = ap.comprobante_id
                where ap.cobranza_id = v_cob.id order by cv.fecha desc, cv.numero desc loop
        exit when v_resto <= 0;
        v_x := least(v_resto, a.disponible);
        if v_x > 0 then
          insert into public.reversiones_cheque (cheque_id, cobranza_id, comprobante_venta_id, importe) values (v_ch.id, v_cob.id, a.comprobante_id, v_x);
          v_resto := v_resto - v_x;
        end if;
      end loop;
      for v_cert in select distinct cv.certificado_id from public.reversiones_cheque r join public.comprobantes_venta cv on cv.id = r.comprobante_venta_id
                     where r.cheque_id = v_ch.id and cv.certificado_id is not null loop
        perform public.fn_sync_certificado(v_cert);
      end loop;
    end if;
  else
    select * into v_pago from public.pagos where id = v_ch.pago_id;
    if v_pago.estado = 'registrado' then
      select coalesce(sum(importe), 0) into v_usado from public.reversiones_cheque where pago_id = v_pago.id and comprobante_compra_id is null;
      v_acuenta := greatest(v_pago.a_cuenta - v_usado, 0);
      v_x := least(v_resto, v_acuenta);
      if v_x > 0 then
        insert into public.reversiones_cheque (cheque_id, pago_id, importe) values (v_ch.id, v_pago.id, v_x);
        v_resto := v_resto - v_x;
      end if;
      for a in select ap.comprobante_id, ap.importe - coalesce((select sum(r.importe) from public.reversiones_cheque r
                     where r.pago_id = v_pago.id and r.comprobante_compra_id = ap.comprobante_id), 0) as disponible
                 from public.pago_aplicaciones ap join public.comprobantes_compra cc on cc.id = ap.comprobante_id
                where ap.pago_id = v_pago.id order by cc.fecha desc, cc.numero desc loop
        exit when v_resto <= 0;
        v_x := least(v_resto, a.disponible);
        if v_x > 0 then
          insert into public.reversiones_cheque (cheque_id, pago_id, comprobante_compra_id, importe) values (v_ch.id, v_pago.id, a.comprobante_id, v_x);
          v_resto := v_resto - v_x;
        end if;
      end loop;
    end if;
  end if;
  perform set_config('mw.tesoreria', 'off', true);
end $$;

-- Importa las líneas de un extracto. Las líneas iguales a otras ya importadas de la misma cuenta se saltean.
-- p: { cuenta_id, archivo, saldo_final, lineas: [{ fecha, descripcion, referencia, importe }] }
create or replace function public.fn_importar_extracto(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cuenta uuid := (p->>'cuenta_id')::uuid; v_n integer := 0; v_rep integer := 0; l record;
begin
  perform public.fn_solo_tesoreria();
  if (select tipo from public.cuentas_tesoreria where id = v_cuenta) is distinct from 'banco' then raise exception 'El extracto es de una cuenta bancaria'; end if;
  if jsonb_array_length(coalesce(p->'lineas', '[]')) = 0 then raise exception 'El extracto no tiene líneas'; end if;
  insert into public.extractos_bancarios (cuenta_id, archivo, saldo_final) values (v_cuenta, nullif(trim(p->>'archivo'), ''), nullif(p->>'saldo_final', '')::numeric)
  returning id into v_id;
  for l in select * from jsonb_to_recordset(p->'lineas') as x(fecha date, descripcion text, referencia text, importe numeric) loop
    if exists (select 1 from public.extracto_lineas e where e.cuenta_id = v_cuenta and e.fecha = l.fecha and e.importe = round(l.importe, 2)
                and coalesce(e.descripcion, '') = coalesce(nullif(trim(l.descripcion), ''), '') and coalesce(e.referencia, '') = coalesce(nullif(trim(l.referencia), ''), '')) then
      v_rep := v_rep + 1;
    else
      insert into public.extracto_lineas (extracto_id, cuenta_id, fecha, descripcion, referencia, importe)
      values (v_id, v_cuenta, l.fecha, nullif(trim(l.descripcion), ''), nullif(trim(l.referencia), ''), round(l.importe, 2));
      v_n := v_n + 1;
    end if;
  end loop;
  update public.extractos_bancarios set lineas = v_n, repetidas = v_rep,
    fecha_desde = (select min(fecha) from public.extracto_lineas where extracto_id = v_id),
    fecha_hasta = (select max(fecha) from public.extracto_lineas where extracto_id = v_id)
   where id = v_id;
  return v_id;
end $$;

create or replace function public.fn_conciliar(p_linea uuid, p_movimiento uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_l public.extracto_lineas; v_m public.movimientos_tesoreria;
begin
  perform public.fn_solo_tesoreria();
  select * into v_l from public.extracto_lineas where id = p_linea for update;
  select * into v_m from public.movimientos_tesoreria where id = p_movimiento for update;
  if v_l.estado <> 'pendiente' then raise exception 'La línea del extracto ya está %', v_l.estado; end if;
  if v_m.estado <> 'vigente' then raise exception 'El movimiento está anulado'; end if;
  if v_m.conciliado then raise exception 'El movimiento ya está conciliado con otra línea'; end if;
  if v_m.cuenta_id <> v_l.cuenta_id then raise exception 'El movimiento es de otra cuenta'; end if;
  if (case when v_m.tipo = 'ingreso' then v_m.importe else -v_m.importe end) <> v_l.importe then
    raise exception 'Los importes no coinciden (banco %, sistema %). Si la diferencia es un gasto del banco, cargalo desde la línea del extracto',
      v_l.importe, case when v_m.tipo = 'ingreso' then v_m.importe else -v_m.importe end;
  end if;
  perform set_config('mw.tesoreria', 'on', true);
  update public.extracto_lineas set movimiento_id = v_m.id, estado = 'conciliado', conciliado_por = auth.uid(), conciliado_en = now() where id = v_l.id;
  update public.movimientos_tesoreria set conciliado = true where id = v_m.id;
  perform set_config('mw.tesoreria', 'off', true);
end $$;

create or replace function public.fn_desconciliar(p_linea uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_l public.extracto_lineas;
begin
  perform public.fn_solo_tesoreria();
  select * into v_l from public.extracto_lineas where id = p_linea for update;
  if v_l.estado = 'pendiente' then return; end if;
  perform set_config('mw.tesoreria', 'on', true);
  if v_l.movimiento_id is not null then update public.movimientos_tesoreria set conciliado = false where id = v_l.movimiento_id; end if;
  update public.extracto_lineas set movimiento_id = null, estado = 'pendiente', motivo = null, conciliado_por = null, conciliado_en = null where id = v_l.id;
  perform set_config('mw.tesoreria', 'off', true);
end $$;

create or replace function public.fn_ignorar_linea(p_linea uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_solo_tesoreria();
  update public.extracto_lineas set estado = 'ignorado', motivo = p_motivo where id = p_linea and estado = 'pendiente';
  if not found then raise exception 'La línea no está pendiente'; end if;
end $$;

-- Lo que está en el banco y no en el sistema (comisiones, impuestos, intereses): se carga y concilia en un paso
create or replace function public.fn_movimiento_desde_linea(p_linea uuid, p_categoria text, p_descripcion text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_l public.extracto_lineas; v_id uuid;
begin
  perform public.fn_solo_tesoreria();
  select * into v_l from public.extracto_lineas where id = p_linea for update;
  if v_l.estado <> 'pendiente' then raise exception 'La línea del extracto ya está %', v_l.estado; end if;
  insert into public.movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe, descripcion, referencia)
  values (v_l.cuenta_id, v_l.fecha, case when v_l.importe > 0 then 'ingreso' else 'egreso' end, p_categoria, abs(v_l.importe),
          coalesce(nullif(trim(p_descripcion), ''), v_l.descripcion), v_l.referencia)
  returning id into v_id;
  perform public.fn_conciliar(p_linea, v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------
create view public.v_saldos_cuentas with (security_invoker = true) as
select c.*,
       c.saldo_inicial + coalesce(sum(case when m.tipo = 'ingreso' then m.importe else -m.importe end), 0) as saldo,
       c.saldo_inicial + coalesce(sum(case when m.tipo = 'ingreso' then m.importe else -m.importe end) filter (where m.conciliado), 0) as saldo_conciliado,
       count(m.id) filter (where not m.conciliado and c.tipo = 'banco') as sin_conciliar,
       max(m.fecha) as ultimo_movimiento
  from public.cuentas_tesoreria c
  left join public.movimientos_tesoreria m on m.cuenta_id = c.id and m.estado = 'vigente'
 group by c.id;

create view public.v_movimientos with (security_invoker = true) as
select m.*, c.nombre as cuenta, c.tipo as cuenta_tipo,
       case when m.tipo = 'ingreso' then m.importe else -m.importe end as importe_con_signo,
       coalesce(cl.razon_social, pr.razon_social, clc.razon_social, prc.razon_social) as tercero,
       cob.numero as recibo, pg.numero as orden_pago, ch.numero as cheque_numero
  from public.movimientos_tesoreria m
  join public.cuentas_tesoreria c on c.id = m.cuenta_id
  left join public.cobranzas cob on cob.id = m.cobranza_id
  left join public.clientes cl on cl.id = cob.cliente_id
  left join public.pagos pg on pg.id = m.pago_id
  left join public.proveedores pr on pr.id = pg.proveedor_id
  left join public.cheques ch on ch.id = m.cheque_id
  left join public.clientes clc on clc.id = ch.cliente_id
  left join public.proveedores prc on prc.id = ch.proveedor_id;

create view public.v_cheques with (security_invoker = true) as
select ch.*, cl.razon_social as cliente, pr.razon_social as proveedor, en.razon_social as endosado_a,
       cob.numero as recibo, pg.numero as orden_pago, pe.numero as orden_pago_endoso, ct.nombre as cuenta,
       ch.fecha_pago + 30 as vence_para_depositar
  from public.cheques ch
  left join public.clientes cl on cl.id = ch.cliente_id
  left join public.proveedores pr on pr.id = ch.proveedor_id
  left join public.proveedores en on en.id = ch.endosado_a_proveedor_id
  left join public.cobranzas cob on cob.id = ch.cobranza_id
  left join public.pagos pg on pg.id = ch.pago_id
  left join public.pagos pe on pe.id = ch.endoso_pago_id
  left join public.cuentas_tesoreria ct on ct.id = ch.cuenta_id;

-- =====================================================================
-- Seguridad
-- =====================================================================
alter table public.cuentas_tesoreria     enable row level security;
alter table public.movimientos_tesoreria enable row level security;
alter table public.cheques               enable row level security;
alter table public.reversiones_cheque    enable row level security;
alter table public.mapeos_extracto       enable row level security;
alter table public.extractos_bancarios   enable row level security;
alter table public.extracto_lineas       enable row level security;

create policy ctes_ver on public.cuentas_tesoreria     for select to authenticated using (public.fn_rol() is not null);
create policy mov_ver  on public.movimientos_tesoreria for select to authenticated using (public.fn_rol() is not null);
create policy chq_ver  on public.cheques               for select to authenticated using (public.fn_rol() is not null);
create policy rev_ver  on public.reversiones_cheque    for select to authenticated using (public.fn_rol() is not null);
create policy map_ver  on public.mapeos_extracto       for select to authenticated using (public.fn_rol() is not null);
create policy ext_ver  on public.extractos_bancarios   for select to authenticated using (public.fn_rol() is not null);
create policy exl_ver  on public.extracto_lineas       for select to authenticated using (public.fn_rol() is not null);

-- Cuentas, movimientos manuales y mapeos: administrador y contador
create policy ctes_alta on public.cuentas_tesoreria for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy ctes_mod  on public.cuentas_tesoreria for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy mov_alta on public.movimientos_tesoreria for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy mov_mod  on public.movimientos_tesoreria for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy map_alta on public.mapeos_extracto for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy map_mod  on public.mapeos_extracto for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));

-- El saldo inicial de una cuenta no se cambia una vez que tiene movimientos
create or replace function public.fn_cuentas_tes_control()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.saldo_inicial, new.fecha_saldo_inicial, new.tipo) is distinct from (old.saldo_inicial, old.fecha_saldo_inicial, old.tipo)
     and exists (select 1 from public.movimientos_tesoreria where cuenta_id = old.id) then
    raise exception 'La cuenta ya tiene movimientos: el saldo inicial, su fecha y el tipo no se cambian (cargá un ajuste)';
  end if;
  return new;
end $$;
create trigger trg_cuentas_tes_control before update on public.cuentas_tesoreria
  for each row execute function public.fn_cuentas_tes_control();

revoke delete, truncate on public.cuentas_tesoreria, public.movimientos_tesoreria, public.mapeos_extracto from anon, authenticated;
revoke insert, update, delete, truncate on public.cheques, public.reversiones_cheque, public.extractos_bancarios, public.extracto_lineas
  from anon, authenticated;
revoke all on public.cuentas_tesoreria, public.movimientos_tesoreria, public.cheques, public.reversiones_cheque, public.mapeos_extracto,
  public.extractos_bancarios, public.extracto_lineas, public.v_saldos_cuentas, public.v_movimientos, public.v_cheques from anon;

revoke execute on function public.fn_transferencia(uuid, uuid, date, numeric, text), public.fn_anular_movimiento(uuid, text),
  public.fn_cheque_depositar(uuid, uuid, date), public.fn_cheque_acreditar(uuid, date, uuid), public.fn_cheque_debitar(uuid, date),
  public.fn_cheque_rechazar(uuid, date, text), public.fn_importar_extracto(jsonb), public.fn_conciliar(uuid, uuid),
  public.fn_desconciliar(uuid), public.fn_ignorar_linea(uuid, text), public.fn_movimiento_desde_linea(uuid, text, text) from public, anon;
grant execute on function public.fn_transferencia(uuid, uuid, date, numeric, text), public.fn_anular_movimiento(uuid, text),
  public.fn_cheque_depositar(uuid, uuid, date), public.fn_cheque_acreditar(uuid, date, uuid), public.fn_cheque_debitar(uuid, date),
  public.fn_cheque_rechazar(uuid, date, text), public.fn_importar_extracto(jsonb), public.fn_conciliar(uuid, uuid),
  public.fn_desconciliar(uuid), public.fn_ignorar_linea(uuid, text), public.fn_movimiento_desde_linea(uuid, text, text) to authenticated;

-- =====================================================================
-- Auditoría
-- =====================================================================
create trigger trg_audit_ctes after insert or update or delete on public.cuentas_tesoreria     for each row execute function public.fn_auditar();
create trigger trg_audit_mov  after insert or update or delete on public.movimientos_tesoreria for each row execute function public.fn_auditar();
create trigger trg_audit_chq  after insert or update or delete on public.cheques               for each row execute function public.fn_auditar();
create trigger trg_audit_rev  after insert or update or delete on public.reversiones_cheque    for each row execute function public.fn_auditar();
create trigger trg_audit_map  after insert or update or delete on public.mapeos_extracto       for each row execute function public.fn_auditar();
create trigger trg_audit_ext  after insert or update or delete on public.extractos_bancarios   for each row execute function public.fn_auditar();
create trigger trg_audit_exl  after insert or update or delete on public.extracto_lineas       for each row execute function public.fn_auditar();

-- Fin de la migración 005
