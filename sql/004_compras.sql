-- =====================================================================
-- MADEWORK · Sistema contable · Migración 004 · Compras y pagos
-- Etapa 4 · 01/11/2026
--
-- Crea: proveedores, órdenes de compra, comprobantes de compra (facturas,
-- notas de crédito y débito, tickets) con IVA por alícuota, percepciones
-- sufridas e imputación a contratos / ítems / centros de costo; pagos
-- (órdenes de pago) con medios, retenciones practicadas y aplicación.
--
-- Las retenciones que practica MADEWORK quedan DESACTIVADAS por defecto
-- (parámetro AGENTE_RETENCION / ACTIVO = 0) hasta confirmarlo con el contador.
--
-- Altas, anulaciones y cambios de comprobantes y pagos pasan por funciones
-- de la base: se guardan completos o no se guardan.
--
-- Requiere las migraciones 001, 002 y 003. Se corre UNA sola vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Parámetros
-- ---------------------------------------------------------------------
insert into public.parametros_fiscales (tipo, codigo, descripcion, valor, unidad, vigente_desde, a_confirmar, observacion) values
  ('AGENTE_RETENCION', 'ACTIVO', 'MADEWORK practica retenciones como agente (1 = sí, 0 = no)', 0, 'sí/no', '2026-11-01', true,
   'A CONFIRMAR CON CONTADOR. Desactivado: el sistema no deja cargar retenciones en los pagos.'),
  ('RETENCION_PRACTICADA', 'RET_GANANCIAS', 'Retención de Ganancias que practica MADEWORK', null, '%', '2026-11-01', true, 'A CONFIRMAR CON CONTADOR'),
  ('RETENCION_PRACTICADA', 'RET_IIBB_CBA',  'Retención de IIBB Córdoba que practica MADEWORK', null, '%', '2026-11-01', true, 'A CONFIRMAR CON CONTADOR'),
  ('RETENCION_PRACTICADA', 'RET_SUSS',      'Retención de SUSS que practica MADEWORK', null, '%', '2026-11-01', true, 'A CONFIRMAR CON CONTADOR'),
  ('RETENCION_PRACTICADA', 'RET_IVA',       'Retención de IVA que practica MADEWORK', null, '%', '2026-11-01', true, 'A CONFIRMAR CON CONTADOR');

-- Adjuntos: se suman proveedores, órdenes de compra, comprobantes de compra y pagos
alter table public.adjuntos drop constraint if exists adjuntos_tabla_check;
alter table public.adjuntos add constraint adjuntos_tabla_check check (tabla in (
  'contratos','certificados','polizas','multas','avance_unidades','redeterminaciones','clientes',
  'comprobantes_venta','cobranzas','retenciones_sufridas',
  'proveedores','ordenes_compra','comprobantes_compra','pagos'));

-- ---------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------
create table public.proveedores (
  id              uuid primary key default gen_random_uuid(),
  razon_social    text not null check (trim(razon_social) <> ''),
  cuit            text unique check (cuit is null or public.fn_cuit_valido(cuit)),
  condicion_iva   text not null default 'RI' references public.condiciones_iva(codigo),
  categoria       text not null default 'otros' check (categoria in ('pinturas','materiales','combustible','alquiler_equipos',
                    'subcontratistas','seguridad','transporte','seguros','servicios','otros')),
  domicilio       text,
  localidad       text,
  provincia       text default 'Córdoba',
  email           text,
  telefono        text,
  contacto        text,
  banco           text,
  cbu             text check (cbu is null or cbu ~ '^\d{22}$'),
  alias_cbu       text,
  titular_cuenta  text,
  observacion     text,
  activo          boolean not null default true,
  creado_por      uuid default auth.uid(),
  creado_en       timestamptz not null default now(),
  modificado_en   timestamptz not null default now()
);
create trigger trg_proveedores_mod before update on public.proveedores for each row execute function public.fn_set_modificado();

-- ---------------------------------------------------------------------
-- Órdenes de compra (opcionales)
-- ---------------------------------------------------------------------
create table public.ordenes_compra (
  id                uuid primary key default gen_random_uuid(),
  numero            integer unique,
  proveedor_id      uuid not null references public.proveedores(id),
  contrato_id       uuid references public.contratos(id),
  fecha             date not null default current_date,
  descripcion       text not null check (trim(descripcion) <> ''),
  importe_estimado  numeric(16,2) check (importe_estimado is null or importe_estimado >= 0),
  estado            text not null default 'abierta' check (estado in ('abierta','cumplida','anulada')),
  motivo            text,
  observacion       text,
  creado_por        uuid default auth.uid(),
  creado_en         timestamptz not null default now(),
  modificado_en     timestamptz not null default now(),
  check (estado <> 'anulada' or coalesce(trim(motivo), '') <> '')
);
create trigger trg_oc_mod before update on public.ordenes_compra for each row execute function public.fn_set_modificado();

create or replace function public.fn_ordenes_compra_control()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('ordenes_compra'));
    select coalesce(max(numero), 0) + 1 into new.numero from public.ordenes_compra;
    new.estado := 'abierta';
    return new;
  end if;
  if new.numero is distinct from old.numero or new.proveedor_id is distinct from old.proveedor_id then
    raise exception 'El número y el proveedor de una orden de compra no se modifican';
  end if;
  if old.estado = 'anulada' then raise exception 'La orden de compra está anulada'; end if;
  return new;
end $$;
create trigger trg_oc_control before insert or update on public.ordenes_compra
  for each row execute function public.fn_ordenes_compra_control();

-- ---------------------------------------------------------------------
-- Comprobantes de compra
-- total = neto gravado + exento + no gravado + sin discriminar + IVA + percepciones + otros tributos
-- costo = total − crédito fiscal − percepciones (lo que se imputa a obra)
-- ---------------------------------------------------------------------
create table public.comprobantes_compra (
  id                       uuid primary key default gen_random_uuid(),
  proveedor_id             uuid not null references public.proveedores(id),
  tipo_codigo              text not null references public.tipos_comprobante(codigo),
  clase                    text not null check (clase in ('factura','nota_debito','nota_credito','ticket')),
  letra                    text not null,
  punto_venta              integer not null check (punto_venta between 0 and 99999),
  numero                   bigint not null check (numero between 1 and 99999999),
  fecha                    date not null,
  vencimiento              date,
  comprobante_asociado_id  uuid references public.comprobantes_compra(id),
  orden_compra_id          uuid references public.ordenes_compra(id),
  descripcion              text,
  neto_gravado             numeric(16,2) not null default 0 check (neto_gravado >= 0),
  exento                   numeric(16,2) not null default 0 check (exento >= 0),
  no_gravado               numeric(16,2) not null default 0 check (no_gravado >= 0),
  sin_discriminar          numeric(16,2) not null default 0 check (sin_discriminar >= 0),
  iva                      numeric(16,2) not null default 0 check (iva >= 0),
  percepciones             numeric(16,2) not null default 0 check (percepciones >= 0),
  otros_tributos           numeric(16,2) not null default 0 check (otros_tributos >= 0),
  total                    numeric(16,2) not null check (total > 0),
  genera_credito_fiscal    boolean not null default false,
  credito_fiscal           numeric(16,2) not null default 0 check (credito_fiscal >= 0),
  costo                    numeric(16,2) not null default 0 check (costo >= 0),
  duplicado_autorizado     boolean not null default false,
  motivo_duplicado         text,
  revisado                 boolean not null default false,
  estado                   text not null default 'emitido' check (estado in ('emitido','anulado')),
  motivo                   text,
  observacion              text,
  creado_por               uuid default auth.uid(),
  creado_en                timestamptz not null default now(),
  modificado_en            timestamptz not null default now(),
  check (total = neto_gravado + exento + no_gravado + sin_discriminar + iva + percepciones + otros_tributos),
  check (costo = total - credito_fiscal - percepciones),
  check (credito_fiscal <= iva),
  check (vencimiento is null or vencimiento >= fecha),
  check (clase <> 'nota_credito' or comprobante_asociado_id is not null),
  check (not duplicado_autorizado or coalesce(trim(motivo_duplicado), '') <> '')
);
-- Un comprobante de un proveedor no se carga dos veces (salvo duplicado autorizado por el administrador)
create unique index comprobantes_compra_numero on public.comprobantes_compra (proveedor_id, tipo_codigo, punto_venta, numero)
  where estado = 'emitido' and not duplicado_autorizado;
create index comprobantes_compra_proveedor on public.comprobantes_compra (proveedor_id, fecha);
create index comprobantes_compra_venc on public.comprobantes_compra (vencimiento) where estado = 'emitido';
create trigger trg_cc_mod before update on public.comprobantes_compra for each row execute function public.fn_set_modificado();

create table public.comprobante_compra_alicuotas (
  id              uuid primary key default gen_random_uuid(),
  comprobante_id  uuid not null references public.comprobantes_compra(id),
  alicuota        text not null,
  porcentaje      numeric(7,4) not null,
  neto            numeric(16,2) not null check (neto > 0),
  iva             numeric(16,2) not null check (iva >= 0),
  unique (comprobante_id, alicuota)
);

create table public.comprobante_compra_percepciones (
  id              uuid primary key default gen_random_uuid(),
  comprobante_id  uuid not null references public.comprobantes_compra(id),
  tipo            text not null check (tipo in ('PERC_IVA','PERC_IIBB_CBA','PERC_IIBB_OTRAS','PERC_GANANCIAS','OTRA')),
  descripcion     text,
  importe         numeric(16,2) not null check (importe > 0),
  check (tipo <> 'OTRA' or coalesce(trim(descripcion), '') <> '')
);

create table public.comprobante_compra_imputaciones (
  id               uuid primary key default gen_random_uuid(),
  comprobante_id   uuid not null references public.comprobantes_compra(id),
  contrato_id      uuid references public.contratos(id),
  item_id          uuid references public.contrato_items(id),
  centro_costo_id  uuid references public.centros_costo(id),
  categoria        text check (categoria is null or categoria in ('materiales','mano_obra','equipos','subcontratos','otros')),
  porcentaje       numeric(5,2) not null check (porcentaje > 0 and porcentaje <= 100),
  importe          numeric(16,2) not null,
  check (contrato_id is not null or centro_costo_id is not null),
  check (item_id is null or contrato_id is not null)
);
create index imputaciones_compra_contrato on public.comprobante_compra_imputaciones (contrato_id);

-- ---------------------------------------------------------------------
-- Pagos (órdenes de pago)
-- total = medios + retenciones practicadas = aplicado + a cuenta (anticipo)
-- ---------------------------------------------------------------------
create table public.pagos (
  id                   uuid primary key default gen_random_uuid(),
  numero               integer unique,
  proveedor_id         uuid not null references public.proveedores(id),
  fecha                date not null,
  importe_medios       numeric(16,2) not null default 0 check (importe_medios >= 0),
  importe_retenciones  numeric(16,2) not null default 0 check (importe_retenciones >= 0),
  total                numeric(16,2) not null check (total > 0),
  importe_aplicado     numeric(16,2) not null default 0 check (importe_aplicado >= 0),
  a_cuenta             numeric(16,2) generated always as (total - importe_aplicado) stored,
  estado               text not null default 'registrado' check (estado in ('registrado','anulado')),
  motivo               text,
  observacion          text,
  creado_por           uuid default auth.uid(),
  creado_en            timestamptz not null default now(),
  modificado_en        timestamptz not null default now(),
  check (total = importe_medios + importe_retenciones),
  check (importe_aplicado <= total)
);
create index pagos_proveedor on public.pagos (proveedor_id, fecha);
create trigger trg_pagos_mod before update on public.pagos for each row execute function public.fn_set_modificado();

create table public.pago_medios (
  id          uuid primary key default gen_random_uuid(),
  pago_id     uuid not null references public.pagos(id),
  medio       text not null check (medio in ('transferencia','echeq','cheque','efectivo','otro')),
  importe     numeric(16,2) not null check (importe > 0),
  banco       text,
  numero      text,
  fecha_pago  date,
  referencia  text
);

create table public.retenciones_practicadas (
  id                  uuid primary key default gen_random_uuid(),
  pago_id             uuid not null references public.pagos(id),
  tipo                text not null check (tipo in ('RET_GANANCIAS','RET_IIBB_CBA','RET_SUSS','RET_IVA','OTRA')),
  descripcion         text,
  numero_certificado  text,
  base                numeric(16,2) check (base is null or base >= 0),
  alicuota            numeric(7,4) check (alicuota is null or alicuota between 0 and 100),
  importe             numeric(16,2) not null check (importe > 0)
);

create table public.pago_aplicaciones (
  id              uuid primary key default gen_random_uuid(),
  pago_id         uuid not null references public.pagos(id),
  comprobante_id  uuid not null references public.comprobantes_compra(id),
  importe         numeric(16,2) not null check (importe > 0),
  unique (pago_id, comprobante_id)
);
create index pago_aplicaciones_comprobante on public.pago_aplicaciones (comprobante_id);

-- ---------------------------------------------------------------------
-- Saldos
-- ---------------------------------------------------------------------
create or replace function public.fn_pagado_compra(p_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(a.importe), 0) from public.pago_aplicaciones a
    join public.pagos p on p.id = a.pago_id and p.estado = 'registrado'
   where a.comprobante_id = p_id
$$;

create or replace function public.fn_nc_compra(p_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(total), 0) from public.comprobantes_compra
   where comprobante_asociado_id = p_id and clase = 'nota_credito' and estado = 'emitido'
$$;

create or replace function public.fn_saldo_compra(p_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select c.total - public.fn_nc_compra(c.id) - public.fn_pagado_compra(c.id)
    from public.comprobantes_compra c where c.id = p_id
$$;

create or replace function public.fn_agente_retencion(p_fecha date)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.fn_parametro_vigente('AGENTE_RETENCION', 'ACTIVO', p_fecha), 0) = 1
$$;

-- ---------------------------------------------------------------------
-- Controles de integridad
-- ---------------------------------------------------------------------
create or replace function public.fn_comprobantes_compra_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo public.tipos_comprobante;
  v_prov public.proveedores;
  v_asoc public.comprobantes_compra;
  v_oc public.ordenes_compra;
begin
  if tg_op = 'INSERT' then
    select * into v_tipo from public.tipos_comprobante where codigo = new.tipo_codigo;
    if v_tipo.clase not in ('factura','nota_debito','nota_credito','ticket') then
      raise exception 'El tipo "%" no se carga como comprobante de compra', v_tipo.descripcion;
    end if;
    new.clase := v_tipo.clase;
    new.letra := v_tipo.letra;
    if new.estado <> 'emitido' then raise exception 'Un comprobante nuevo se registra como emitido'; end if;
    if not public.fn_periodo_abierto(new.fecha) then
      raise exception 'El período % está cerrado: no se pueden registrar comprobantes con esa fecha', to_char(new.fecha, 'MM/YYYY');
    end if;
    select * into v_prov from public.proveedores where id = new.proveedor_id;
    if not v_prov.activo then raise exception 'El proveedor "%" está inactivo', v_prov.razon_social; end if;
    if v_prov.condicion_iva = 'MT' and new.letra not in ('C','X') then raise exception 'Un monotributista emite comprobantes C'; end if;
    if v_prov.condicion_iva = 'RI' and new.letra = 'C' then raise exception 'Un Responsable Inscripto no emite comprobantes C'; end if;
    if new.letra in ('A','M') and v_prov.cuit is null then
      raise exception 'Para un comprobante % el proveedor "%" tiene que tener CUIT', new.letra, v_prov.razon_social;
    end if;
    -- Crédito fiscal: lo decide la base con la misma regla que el motor de IVA
    new.genera_credito_fiscal := v_tipo.discrimina_iva and v_tipo.genera_credito_fiscal and v_prov.condicion_iva = 'RI';
    new.credito_fiscal := case when new.genera_credito_fiscal then new.iva else 0 end;
    if not v_tipo.discrimina_iva and (new.iva <> 0 or new.neto_gravado <> 0) then
      raise exception 'El comprobante % no discrimina IVA: el importe va como "sin discriminar"', v_tipo.descripcion;
    end if;
    new.costo := new.total - new.credito_fiscal - new.percepciones;
    if new.duplicado_autorizado and not public.fn_tiene_rol('administrador') then
      raise exception 'Solo el administrador puede autorizar un comprobante duplicado';
    end if;
    if new.clase = 'nota_credito' or (new.clase = 'nota_debito' and new.comprobante_asociado_id is not null) then
      select * into v_asoc from public.comprobantes_compra where id = new.comprobante_asociado_id for update;
      if not found then raise exception 'No existe el comprobante asociado'; end if;
      if v_asoc.estado <> 'emitido' then raise exception 'El comprobante asociado está anulado'; end if;
      if v_asoc.proveedor_id <> new.proveedor_id then raise exception 'El comprobante asociado es de otro proveedor'; end if;
      if v_asoc.clase not in ('factura','nota_debito','ticket') then raise exception 'Solo se asocia a una factura o nota de débito'; end if;
      if new.clase = 'nota_credito' and new.total > v_asoc.total - public.fn_nc_compra(v_asoc.id) then
        raise exception 'La nota de crédito (%) supera lo que queda del comprobante asociado (%)', new.total, v_asoc.total - public.fn_nc_compra(v_asoc.id);
      end if;
    elsif new.comprobante_asociado_id is not null then
      raise exception 'Una factura no lleva comprobante asociado';
    end if;
    if new.orden_compra_id is not null then
      select * into v_oc from public.ordenes_compra where id = new.orden_compra_id;
      if v_oc.proveedor_id <> new.proveedor_id then raise exception 'La orden de compra es de otro proveedor'; end if;
      if v_oc.estado = 'anulada' then raise exception 'La orden de compra está anulada'; end if;
    end if;
    return new;
  end if;

  -- UPDATE: solo se completan datos sin importes, se marca revisado o se anula
  if old.estado = 'anulado' then raise exception 'El comprobante está anulado: no se puede modificar'; end if;
  if (new.proveedor_id, new.tipo_codigo, new.clase, new.letra, new.punto_venta, new.numero, new.fecha, new.comprobante_asociado_id,
      new.neto_gravado, new.exento, new.no_gravado, new.sin_discriminar, new.iva, new.percepciones, new.otros_tributos, new.total,
      new.genera_credito_fiscal, new.credito_fiscal, new.costo, new.duplicado_autorizado, new.motivo_duplicado, new.creado_por)
     is distinct from
     (old.proveedor_id, old.tipo_codigo, old.clase, old.letra, old.punto_venta, old.numero, old.fecha, old.comprobante_asociado_id,
      old.neto_gravado, old.exento, old.no_gravado, old.sin_discriminar, old.iva, old.percepciones, old.otros_tributos, old.total,
      old.genera_credito_fiscal, old.credito_fiscal, old.costo, old.duplicado_autorizado, old.motivo_duplicado, old.creado_por) then
    raise exception 'Los datos e importes de un comprobante registrado no se modifican. Si hubo un error de carga, anulalo y cargalo de nuevo';
  end if;
  if new.estado = 'anulado' then
    if coalesce(trim(new.motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
    if public.fn_pagado_compra(old.id) > 0 then raise exception 'El comprobante tiene pagos aplicados: anulá primero esos pagos'; end if;
    if exists (select 1 from public.comprobantes_compra where comprobante_asociado_id = old.id and estado = 'emitido') then
      raise exception 'El comprobante tiene notas de crédito o débito asociadas: anulalas primero';
    end if;
    if not public.fn_periodo_abierto(old.fecha) then raise exception 'El período % está cerrado', to_char(old.fecha, 'MM/YYYY'); end if;
  end if;
  return new;
end $$;
create trigger trg_cc_control before insert or update on public.comprobantes_compra
  for each row execute function public.fn_comprobantes_compra_control();

create trigger trg_cca_inmutable before update or delete on public.comprobante_compra_alicuotas     for each row execute function public.fn_detalle_inmutable();
create trigger trg_ccp_inmutable before update or delete on public.comprobante_compra_percepciones  for each row execute function public.fn_detalle_inmutable();
create trigger trg_cci_inmutable before update or delete on public.comprobante_compra_imputaciones  for each row execute function public.fn_detalle_inmutable();
create trigger trg_pm_inmutable  before update or delete on public.pago_medios                      for each row execute function public.fn_detalle_inmutable();
create trigger trg_rp_inmutable  before update or delete on public.retenciones_practicadas          for each row execute function public.fn_detalle_inmutable();
create trigger trg_pa_inmutable  before update or delete on public.pago_aplicaciones                for each row execute function public.fn_detalle_inmutable();

-- Imputación: el ítem es del contrato
create or replace function public.fn_imputaciones_control()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is not null and not exists (select 1 from public.contrato_items where id = new.item_id and contrato_id = new.contrato_id) then
    raise exception 'El ítem no pertenece al contrato elegido';
  end if;
  return new;
end $$;
create trigger trg_cci_control before insert on public.comprobante_compra_imputaciones
  for each row execute function public.fn_imputaciones_control();

create or replace function public.fn_pagos_control()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'registrado' then raise exception 'Un pago nuevo se registra como registrado'; end if;
    if not public.fn_periodo_abierto(new.fecha) then
      raise exception 'El período % está cerrado: no se pueden registrar pagos con esa fecha', to_char(new.fecha, 'MM/YYYY');
    end if;
    perform pg_advisory_xact_lock(hashtext('pagos'));
    select coalesce(max(numero), 0) + 1 into new.numero from public.pagos;
    return new;
  end if;
  if old.estado = 'anulado' then raise exception 'El pago está anulado: no se puede modificar'; end if;
  if (new.numero, new.proveedor_id, new.fecha, new.importe_medios, new.importe_retenciones, new.total, new.importe_aplicado, new.creado_por)
     is distinct from (old.numero, old.proveedor_id, old.fecha, old.importe_medios, old.importe_retenciones, old.total, old.importe_aplicado, old.creado_por) then
    raise exception 'Los importes de un pago registrado no se modifican. Si hubo un error, anulalo y cargalo de nuevo';
  end if;
  if new.estado = 'anulado' then
    if coalesce(trim(new.motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
    if not public.fn_periodo_abierto(old.fecha) then raise exception 'El período % está cerrado', to_char(old.fecha, 'MM/YYYY'); end if;
  end if;
  return new;
end $$;
create trigger trg_pagos_control before insert or update on public.pagos for each row execute function public.fn_pagos_control();

create or replace function public.fn_pago_aplicaciones_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_comp public.comprobantes_compra; v_pago public.pagos; v_saldo numeric;
begin
  select * into v_pago from public.pagos where id = new.pago_id;
  if v_pago.estado <> 'registrado' then raise exception 'El pago está anulado'; end if;
  select * into v_comp from public.comprobantes_compra where id = new.comprobante_id for update;
  if v_comp.estado <> 'emitido' then raise exception 'El comprobante está anulado'; end if;
  if v_comp.clase = 'nota_credito' then raise exception 'Un pago no se aplica a una nota de crédito'; end if;
  if v_comp.proveedor_id <> v_pago.proveedor_id then raise exception 'El comprobante es de otro proveedor'; end if;
  v_saldo := public.fn_saldo_compra(v_comp.id);
  if new.importe > v_saldo then
    raise exception 'Se aplica % al comprobante %-% que tiene saldo %', new.importe, lpad(v_comp.punto_venta::text, 5, '0'), lpad(v_comp.numero::text, 8, '0'), v_saldo;
  end if;
  return new;
end $$;
create trigger trg_pa_control before insert on public.pago_aplicaciones for each row execute function public.fn_pago_aplicaciones_control();

create or replace function public.fn_retenciones_practicadas_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fecha date;
begin
  select fecha into v_fecha from public.pagos where id = new.pago_id;
  if not public.fn_agente_retencion(v_fecha) then
    raise exception 'MADEWORK no está configurado como agente de retención (Parámetros fiscales > AGENTE_RETENCION). Confirmalo con el contador';
  end if;
  return new;
end $$;
create trigger trg_rp_control before insert on public.retenciones_practicadas
  for each row execute function public.fn_retenciones_practicadas_control();

-- ---------------------------------------------------------------------
-- Funciones de alta, cambio y anulación
-- ---------------------------------------------------------------------

-- Registra un comprobante de compra completo.
-- p: { proveedor_id, tipo_codigo, punto_venta, numero, fecha, vencimiento, comprobante_asociado_id, orden_compra_id,
--      descripcion, observacion, exento, no_gravado, sin_discriminar, otros_tributos,
--      alicuotas: [{ alicuota, neto, iva }], percepciones: [{ tipo, descripcion, importe }],
--      imputaciones: [{ contrato_id, item_id, centro_costo_id, categoria, porcentaje, importe }],
--      forzar_duplicado: bool, motivo_duplicado }
create or replace function public.fn_registrar_comprobante_compra(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_fecha date := (p->>'fecha')::date;
  v_tol numeric;
  v_neto numeric(16,2) := 0;
  v_iva numeric(16,2) := 0;
  v_perc numeric(16,2);
  v_exento numeric(16,2) := coalesce((p->>'exento')::numeric, 0);
  v_nogr numeric(16,2) := coalesce((p->>'no_gravado')::numeric, 0);
  v_sind numeric(16,2) := coalesce((p->>'sin_discriminar')::numeric, 0);
  v_otros numeric(16,2) := coalesce((p->>'otros_tributos')::numeric, 0);
  v_forzar boolean := coalesce((p->>'forzar_duplicado')::boolean, false);
  v_dup record;
  v_costo numeric(16,2);
  v_pct numeric;
  v_suma_pct numeric;
  v_suma_imp numeric;
  l record;
begin
  if not public.fn_tiene_rol('administrador','contador','operador') then
    raise exception 'No tenés permiso para cargar comprobantes de compra';
  end if;
  if v_fecha is null then raise exception 'Falta la fecha del comprobante'; end if;
  if not public.fn_periodo_abierto(v_fecha) then raise exception 'El período % está cerrado', to_char(v_fecha, 'MM/YYYY'); end if;

  -- Duplicado: mismo proveedor (CUIT) + tipo + punto de venta + número
  select c.id, c.fecha, c.total into v_dup from public.comprobantes_compra c
   where c.proveedor_id = (p->>'proveedor_id')::uuid and c.tipo_codigo = p->>'tipo_codigo'
     and c.punto_venta = (p->>'punto_venta')::integer and c.numero = (p->>'numero')::bigint and c.estado = 'emitido'
   limit 1;
  if found then
    if not v_forzar then
      raise exception 'COMPROBANTE DUPLICADO: ese comprobante del proveedor ya está cargado (fecha %, total %). Si de verdad es otro, el administrador puede forzarlo indicando el motivo',
        to_char(v_dup.fecha, 'DD/MM/YYYY'), v_dup.total;
    end if;
    if not public.fn_tiene_rol('administrador') then raise exception 'Solo el administrador puede forzar un comprobante duplicado'; end if;
    if coalesce(trim(p->>'motivo_duplicado'), '') = '' then raise exception 'Indicá el motivo para cargar el duplicado'; end if;
  else
    v_forzar := false;
  end if;

  v_tol := coalesce(public.fn_parametro_vigente('TOLERANCIA', 'CUADRE_IVA_CENTAVOS', v_fecha), 1) / 100;
  for l in select * from jsonb_to_recordset(coalesce(p->'alicuotas', '[]'::jsonb)) as x(alicuota text, neto numeric, iva numeric) loop
    v_pct := public.fn_parametro_vigente('ALICUOTA_IVA', l.alicuota, v_fecha);
    if v_pct is null then raise exception 'La alícuota % no tiene valor vigente al %', l.alicuota, to_char(v_fecha, 'DD/MM/YYYY'); end if;
    if l.neto is null or l.neto <= 0 then raise exception 'El neto de la alícuota % tiene que ser mayor a cero', l.alicuota; end if;
    if abs(coalesce(l.iva, -1) - round(l.neto * v_pct / 100, 2)) > v_tol then
      raise exception 'El IVA % (%) no cuadra con el % %% de % (esperado %)', l.alicuota, l.iva, v_pct, l.neto, round(l.neto * v_pct / 100, 2);
    end if;
    v_neto := v_neto + round(l.neto, 2);
    v_iva := v_iva + round(l.iva, 2);
  end loop;
  select coalesce(sum(round((x->>'importe')::numeric, 2)), 0) into v_perc from jsonb_array_elements(coalesce(p->'percepciones', '[]')) x;

  insert into public.comprobantes_compra (
    proveedor_id, tipo_codigo, clase, letra, punto_venta, numero, fecha, vencimiento, comprobante_asociado_id, orden_compra_id,
    descripcion, neto_gravado, exento, no_gravado, sin_discriminar, iva, percepciones, otros_tributos, total,
    duplicado_autorizado, motivo_duplicado, revisado, observacion)
  values (
    (p->>'proveedor_id')::uuid, p->>'tipo_codigo', 'factura', '?', (p->>'punto_venta')::integer, (p->>'numero')::bigint, v_fecha,
    nullif(p->>'vencimiento', '')::date, nullif(p->>'comprobante_asociado_id', '')::uuid, nullif(p->>'orden_compra_id', '')::uuid,
    nullif(trim(p->>'descripcion'), ''), v_neto, v_exento, v_nogr, v_sind, v_iva, v_perc, v_otros,
    v_neto + v_exento + v_nogr + v_sind + v_iva + v_perc + v_otros,
    v_forzar, case when v_forzar then trim(p->>'motivo_duplicado') end,
    public.fn_tiene_rol('administrador','contador'), nullif(trim(p->>'observacion'), ''))
  returning id, costo into v_id, v_costo;

  insert into public.comprobante_compra_alicuotas (comprobante_id, alicuota, porcentaje, neto, iva)
  select v_id, x.alicuota, public.fn_parametro_vigente('ALICUOTA_IVA', x.alicuota, v_fecha), round(x.neto, 2), round(x.iva, 2)
    from jsonb_to_recordset(coalesce(p->'alicuotas', '[]'::jsonb)) as x(alicuota text, neto numeric, iva numeric);

  insert into public.comprobante_compra_percepciones (comprobante_id, tipo, descripcion, importe)
  select v_id, x.tipo, nullif(trim(x.descripcion), ''), round(x.importe, 2)
    from jsonb_to_recordset(coalesce(p->'percepciones', '[]'::jsonb)) as x(tipo text, descripcion text, importe numeric)
   where x.importe > 0;

  -- Imputación: obligatoria, porcentajes que suman 100 e importes que suman el costo
  if jsonb_array_length(coalesce(p->'imputaciones', '[]'::jsonb)) = 0 then
    raise exception 'Falta imputar la compra a un contrato o centro de costo';
  end if;
  select sum((x->>'porcentaje')::numeric), sum(round((x->>'importe')::numeric, 2)) into v_suma_pct, v_suma_imp
    from jsonb_array_elements(p->'imputaciones') x;
  if v_suma_pct <> 100 then raise exception 'La imputación tiene que sumar 100 %% (suma %)', v_suma_pct; end if;
  if v_suma_imp <> v_costo then raise exception 'Los importes imputados (%) no suman el costo del comprobante (%)', v_suma_imp, v_costo; end if;
  insert into public.comprobante_compra_imputaciones (comprobante_id, contrato_id, item_id, centro_costo_id, categoria, porcentaje, importe)
  select v_id, x.contrato_id, x.item_id, x.centro_costo_id, nullif(x.categoria, ''), x.porcentaje, round(x.importe, 2)
    from jsonb_to_recordset(p->'imputaciones') as x(contrato_id uuid, item_id uuid, centro_costo_id uuid, categoria text, porcentaje numeric, importe numeric);

  return v_id;
end $$;

-- Completa datos que no cambian importes; "revisado" lo marcan administrador o contador
create or replace function public.fn_actualizar_comprobante_compra(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Solo el administrador o el contador modifican comprobantes de compra';
  end if;
  update public.comprobantes_compra set
    vencimiento = case when p ? 'vencimiento' then nullif(p->>'vencimiento', '')::date else vencimiento end,
    descripcion = case when p ? 'descripcion' then nullif(trim(p->>'descripcion'), '') else descripcion end,
    observacion = case when p ? 'observacion' then nullif(trim(p->>'observacion'), '') else observacion end,
    orden_compra_id = case when p ? 'orden_compra_id' then nullif(p->>'orden_compra_id', '')::uuid else orden_compra_id end,
    revisado = case when p ? 'revisado' then (p->>'revisado')::boolean else revisado end
  where id = p_id;
  if not found then raise exception 'No existe el comprobante'; end if;
end $$;

create or replace function public.fn_anular_comprobante_compra(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Solo el administrador o el contador anulan comprobantes de compra';
  end if;
  update public.comprobantes_compra set estado = 'anulado', motivo = p_motivo where id = p_id;
  if not found then raise exception 'No existe el comprobante'; end if;
end $$;

-- Registra un pago completo.
-- p: { proveedor_id, fecha, observacion,
--      medios: [{ medio, importe, banco, numero, fecha_pago, referencia }],
--      retenciones: [{ tipo, descripcion, numero_certificado, base, alicuota, importe }],
--      aplicaciones: [{ comprobante_id, importe }] }
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

  insert into public.pago_medios (pago_id, medio, importe, banco, numero, fecha_pago, referencia)
  select v_id, x.medio, round(x.importe, 2), nullif(trim(x.banco), ''), nullif(trim(x.numero), ''), x.fecha_pago, nullif(trim(x.referencia), '')
    from jsonb_to_recordset(coalesce(p->'medios', '[]')) as x(medio text, importe numeric, banco text, numero text, fecha_pago date, referencia text);

  insert into public.retenciones_practicadas (pago_id, tipo, descripcion, numero_certificado, base, alicuota, importe)
  select v_id, x.tipo, nullif(trim(x.descripcion), ''), nullif(trim(x.numero_certificado), ''), x.base, x.alicuota, round(x.importe, 2)
    from jsonb_to_recordset(coalesce(p->'retenciones', '[]')) as x(tipo text, descripcion text, numero_certificado text, base numeric, alicuota numeric, importe numeric);

  insert into public.pago_aplicaciones (pago_id, comprobante_id, importe)
  select v_id, x.comprobante_id, round(x.importe, 2)
    from jsonb_to_recordset(coalesce(p->'aplicaciones', '[]')) as x(comprobante_id uuid, importe numeric);
  return v_id;
end $$;

create or replace function public.fn_anular_pago(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Solo el administrador o el contador anulan pagos'; end if;
  update public.pagos set estado = 'anulado', motivo = p_motivo where id = p_id;
  if not found then raise exception 'No existe el pago'; end if;
end $$;

create or replace function public.fn_actualizar_pago(p_id uuid, p_observacion text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Solo el administrador o el contador modifican pagos'; end if;
  update public.pagos set observacion = nullif(trim(p_observacion), '') where id = p_id;
  if not found then raise exception 'No existe el pago'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Vistas (respetan los permisos de quien consulta)
-- ---------------------------------------------------------------------
create view public.v_comprobantes_compra with (security_invoker = true) as
select cc.*,
       pr.razon_social as proveedor, pr.cuit as proveedor_cuit, pr.condicion_iva as proveedor_condicion, pr.categoria as proveedor_categoria,
       tc.descripcion as tipo_descripcion,
       lpad(cc.punto_venta::text, 5, '0') || '-' || lpad(cc.numero::text, 8, '0') as numero_formateado,
       lpad(asoc.punto_venta::text, 5, '0') || '-' || lpad(asoc.numero::text, 8, '0') as asociado_numero,
       oc.numero as orden_compra_numero,
       coalesce(nc.total, 0) as notas_credito,
       coalesce(ap.total, 0) as pagado,
       case when cc.clase <> 'nota_credito' and cc.estado = 'emitido'
            then cc.total - coalesce(nc.total, 0) - coalesce(ap.total, 0) end as saldo
  from public.comprobantes_compra cc
  join public.proveedores pr on pr.id = cc.proveedor_id
  join public.tipos_comprobante tc on tc.codigo = cc.tipo_codigo
  left join public.comprobantes_compra asoc on asoc.id = cc.comprobante_asociado_id
  left join public.ordenes_compra oc on oc.id = cc.orden_compra_id
  left join (select comprobante_asociado_id id, sum(total) total from public.comprobantes_compra
              where clase = 'nota_credito' and estado = 'emitido' group by comprobante_asociado_id) nc on nc.id = cc.id
  left join (select a.comprobante_id id, sum(a.importe) total from public.pago_aplicaciones a
               join public.pagos p on p.id = a.pago_id and p.estado = 'registrado' group by a.comprobante_id) ap on ap.id = cc.id;

create view public.v_pagos with (security_invoker = true) as
select p.*, pr.razon_social as proveedor, pr.cuit as proveedor_cuit, pr.cbu as proveedor_cbu, pr.alias_cbu as proveedor_alias, pr.banco as proveedor_banco
  from public.pagos p join public.proveedores pr on pr.id = p.proveedor_id;

-- Costo imputado (base de la Etapa 7: costos de obra). Las NC restan.
create view public.v_costos_imputados with (security_invoker = true) as
select i.*, cc.fecha, cc.proveedor_id, pr.razon_social as proveedor, cc.clase, cc.tipo_codigo,
       lpad(cc.punto_venta::text, 5, '0') || '-' || lpad(cc.numero::text, 8, '0') as numero_formateado,
       case when cc.clase = 'nota_credito' then -i.importe else i.importe end as importe_con_signo,
       ct.codigo as contrato_codigo, it.codigo as item_codigo, it.descripcion as item_descripcion, ce.codigo as centro_codigo
  from public.comprobante_compra_imputaciones i
  join public.comprobantes_compra cc on cc.id = i.comprobante_id and cc.estado = 'emitido'
  join public.proveedores pr on pr.id = cc.proveedor_id
  left join public.contratos ct on ct.id = i.contrato_id
  left join public.contrato_items it on it.id = i.item_id
  left join public.centros_costo ce on ce.id = i.centro_costo_id;

-- =====================================================================
-- Seguridad
-- =====================================================================
alter table public.proveedores                     enable row level security;
alter table public.ordenes_compra                  enable row level security;
alter table public.comprobantes_compra             enable row level security;
alter table public.comprobante_compra_alicuotas    enable row level security;
alter table public.comprobante_compra_percepciones enable row level security;
alter table public.comprobante_compra_imputaciones enable row level security;
alter table public.pagos                           enable row level security;
alter table public.pago_medios                     enable row level security;
alter table public.retenciones_practicadas         enable row level security;
alter table public.pago_aplicaciones               enable row level security;

create policy prov_ver  on public.proveedores for select to authenticated using (public.fn_rol() is not null);
-- El operador puede dar de alta un proveedor desde la obra (carga rápida); modificar, solo administrador y contador
create policy prov_alta on public.proveedores for insert to authenticated with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy prov_mod  on public.proveedores for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));

create policy oc_ver  on public.ordenes_compra for select to authenticated using (public.fn_rol() is not null);
create policy oc_alta on public.ordenes_compra for insert to authenticated with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy oc_mod  on public.ordenes_compra for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));

create policy cc_ver  on public.comprobantes_compra             for select to authenticated using (public.fn_rol() is not null);
create policy cca_ver on public.comprobante_compra_alicuotas    for select to authenticated using (public.fn_rol() is not null);
create policy ccp_ver on public.comprobante_compra_percepciones for select to authenticated using (public.fn_rol() is not null);
create policy cci_ver on public.comprobante_compra_imputaciones for select to authenticated using (public.fn_rol() is not null);
create policy pg_ver  on public.pagos                           for select to authenticated using (public.fn_rol() is not null);
create policy pm_ver  on public.pago_medios                     for select to authenticated using (public.fn_rol() is not null);
create policy rp_ver  on public.retenciones_practicadas         for select to authenticated using (public.fn_rol() is not null);
create policy pa_ver  on public.pago_aplicaciones               for select to authenticated using (public.fn_rol() is not null);

revoke delete, truncate on public.proveedores, public.ordenes_compra from anon, authenticated;
revoke insert, update, delete, truncate on public.comprobantes_compra, public.comprobante_compra_alicuotas, public.comprobante_compra_percepciones,
  public.comprobante_compra_imputaciones, public.pagos, public.pago_medios, public.retenciones_practicadas, public.pago_aplicaciones
  from anon, authenticated;
revoke all on public.proveedores, public.ordenes_compra, public.comprobantes_compra, public.comprobante_compra_alicuotas,
  public.comprobante_compra_percepciones, public.comprobante_compra_imputaciones, public.pagos, public.pago_medios,
  public.retenciones_practicadas, public.pago_aplicaciones, public.v_comprobantes_compra, public.v_pagos, public.v_costos_imputados from anon;

revoke execute on function public.fn_registrar_comprobante_compra(jsonb), public.fn_actualizar_comprobante_compra(uuid, jsonb),
  public.fn_anular_comprobante_compra(uuid, text), public.fn_registrar_pago(jsonb), public.fn_anular_pago(uuid, text),
  public.fn_actualizar_pago(uuid, text) from public, anon;
grant execute on function public.fn_registrar_comprobante_compra(jsonb), public.fn_actualizar_comprobante_compra(uuid, jsonb),
  public.fn_anular_comprobante_compra(uuid, text), public.fn_registrar_pago(jsonb), public.fn_anular_pago(uuid, text),
  public.fn_actualizar_pago(uuid, text) to authenticated;

-- =====================================================================
-- Auditoría
-- =====================================================================
create trigger trg_audit_prov after insert or update or delete on public.proveedores                     for each row execute function public.fn_auditar();
create trigger trg_audit_oc   after insert or update or delete on public.ordenes_compra                  for each row execute function public.fn_auditar();
create trigger trg_audit_cc   after insert or update or delete on public.comprobantes_compra             for each row execute function public.fn_auditar();
create trigger trg_audit_cca  after insert or update or delete on public.comprobante_compra_alicuotas    for each row execute function public.fn_auditar();
create trigger trg_audit_ccp  after insert or update or delete on public.comprobante_compra_percepciones for each row execute function public.fn_auditar();
create trigger trg_audit_cci  after insert or update or delete on public.comprobante_compra_imputaciones for each row execute function public.fn_auditar();
create trigger trg_audit_pg   after insert or update or delete on public.pagos                           for each row execute function public.fn_auditar();
create trigger trg_audit_pm   after insert or update or delete on public.pago_medios                     for each row execute function public.fn_auditar();
create trigger trg_audit_rp   after insert or update or delete on public.retenciones_practicadas         for each row execute function public.fn_auditar();
create trigger trg_audit_pa   after insert or update or delete on public.pago_aplicaciones               for each row execute function public.fn_auditar();

-- Fin de la migración 004
