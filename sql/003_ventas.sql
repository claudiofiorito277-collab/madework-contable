-- =====================================================================
-- MADEWORK · Sistema contable · Migración 003 · Ventas y cobranzas
-- Etapa 3 · 01/11/2026
--
-- Crea: comprobantes de venta (facturas, notas de crédito y débito) con su
-- detalle por alícuota, cobranzas (recibos) con medios de cobro, retenciones
-- sufridas, aplicación a facturas, fondo de reparo retenido y su devolución.
--
-- Las facturas se emiten en ARCA por fuera del sistema: acá se registran con
-- su número y CAE. Las retenciones se cargan como figuran en cada certificado.
--
-- Toda alta, modificación o anulación pasa por funciones de la base
-- (fn_registrar_comprobante_venta, fn_registrar_cobranza, etc.): así cada
-- operación se guarda completa o no se guarda. Las tablas son de solo lectura
-- para los usuarios.
--
-- Requiere las migraciones 001 y 002. Se corre UNA sola vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ayudas generales
-- ---------------------------------------------------------------------
create or replace function public.fn_periodo_abierto(p_fecha date)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.periodos
                      where anio = extract(year from p_fecha) and mes = extract(month from p_fecha) and estado = 'cerrado')
$$;

-- Alícuota vigente (en %) de un parámetro a una fecha
create or replace function public.fn_parametro_vigente(p_tipo text, p_codigo text, p_fecha date)
returns numeric language sql stable security definer set search_path = public as $$
  select valor from public.parametros_fiscales
   where tipo = p_tipo and codigo = p_codigo and vigente_desde <= p_fecha
     and (vigente_hasta is null or vigente_hasta >= p_fecha)
   limit 1
$$;

-- Adjuntos: se suman comprobantes, cobranzas y certificados de retención
alter table public.adjuntos drop constraint if exists adjuntos_tabla_check;
alter table public.adjuntos add constraint adjuntos_tabla_check check (tabla in (
  'contratos','certificados','polizas','multas','avance_unidades','redeterminaciones','clientes',
  'comprobantes_venta','cobranzas','retenciones_sufridas'));

-- ---------------------------------------------------------------------
-- Certificados: desde esta etapa los estados "facturado" y "cobrado" los
-- maneja la base al registrar la factura y las cobranzas (no se tocan a mano).
-- ---------------------------------------------------------------------
create or replace function public.fn_certificados_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_permitidos text[];
  v_suma numeric(16,2);
  v_mal integer;
  v_sistema boolean := coalesce(current_setting('mw.sync_certificado', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then raise exception 'Un certificado nuevo tiene que empezar en borrador'; end if;
    perform pg_advisory_xact_lock(hashtext(new.contrato_id::text));
    select coalesce(max(numero), 0) + 1 into new.numero from public.certificados where contrato_id = new.contrato_id;
    return new;
  end if;

  if new.numero <> old.numero or new.contrato_id <> old.contrato_id then
    raise exception 'No se puede cambiar el número ni el contrato de un certificado';
  end if;

  if old.estado <> 'borrador' and (
       new.bruto <> old.bruto or new.fondo_reparo <> old.fondo_reparo or new.descuento_anticipo <> old.descuento_anticipo
       or new.multas <> old.multas or new.base_factura <> old.base_factura or new.iva <> old.iva
       or new.periodo_desde <> old.periodo_desde or new.periodo_hasta <> old.periodo_hasta) then
    raise exception 'El certificado N° % está %: solo se pueden modificar importes en borrador', old.numero, old.estado;
  end if;

  if new.estado <> old.estado then
    if (new.estado in ('facturado','cobrado') or old.estado in ('facturado','cobrado')) and not v_sistema then
      raise exception 'El estado facturado o cobrado lo pone el sistema al registrar la factura y las cobranzas (Ventas y cobranzas)';
    end if;
    v_permitidos := case old.estado
      when 'borrador'   then array['presentado','anulado']
      when 'presentado' then array['observado','aprobado','anulado']
      when 'observado'  then array['borrador','presentado','anulado']
      when 'aprobado'   then array['facturado','anulado']
      when 'facturado'  then array['cobrado','aprobado']
      when 'cobrado'    then array['facturado']
      else array[]::text[] end;
    if not new.estado = any(v_permitidos) then
      raise exception 'No se puede pasar un certificado de "%" a "%"', old.estado, new.estado;
    end if;
    if new.estado in ('aprobado','anulado') and not v_sistema and not public.fn_tiene_rol('administrador','contador') then
      raise exception 'Solo el administrador o el contador pueden marcar un certificado como %', new.estado;
    end if;
    if new.estado in ('anulado','observado') and coalesce(trim(new.motivo), '') = '' then
      raise exception 'Indicá el motivo para marcar el certificado como %', new.estado;
    end if;
    if new.estado = 'presentado' then
      select coalesce(sum(importe), 0),
             count(*) filter (where importe <> round(cantidad * precio_unitario, 2))
        into v_suma, v_mal
        from public.certificado_items where certificado_id = new.id;
      if v_suma = 0 then raise exception 'El certificado no tiene ítems'; end if;
      if v_mal > 0 then raise exception 'Hay ítems cuyo importe no coincide con cantidad × precio'; end if;
      if v_suma <> new.bruto then raise exception 'El bruto (%) no coincide con la suma de los ítems (%)', new.bruto, v_suma; end if;
      new.fecha_presentacion := coalesce(new.fecha_presentacion, current_date);
    end if;
    if new.estado = 'aprobado' then new.fecha_aprobacion := coalesce(new.fecha_aprobacion, current_date); end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Comprobantes de venta (facturas, notas de débito y de crédito)
-- ---------------------------------------------------------------------
create table public.comprobantes_venta (
  id                       uuid primary key default gen_random_uuid(),
  cliente_id               uuid not null references public.clientes(id),
  contrato_id              uuid references public.contratos(id),
  certificado_id           uuid references public.certificados(id),
  origen                   text not null default 'manual' check (origen in ('certificado','anticipo','fondo_reparo','multas','manual')),
  tipo_codigo              text not null references public.tipos_comprobante(codigo),
  clase                    text not null check (clase in ('factura','nota_debito','nota_credito')),
  letra                    text not null,
  punto_venta              integer not null check (punto_venta between 1 and 99999),
  numero                   bigint not null check (numero between 1 and 99999999),
  fecha                    date not null,
  vencimiento              date,
  periodo_desde            date,
  periodo_hasta            date,
  cae                      text check (cae is null or cae ~ '^\d{14}$'),
  cae_vencimiento          date,
  comprobante_asociado_id  uuid references public.comprobantes_venta(id),
  descripcion              text,
  neto_gravado             numeric(16,2) not null default 0 check (neto_gravado >= 0),
  exento                   numeric(16,2) not null default 0 check (exento >= 0),
  no_gravado               numeric(16,2) not null default 0 check (no_gravado >= 0),
  iva                      numeric(16,2) not null default 0 check (iva >= 0),
  otros_tributos           numeric(16,2) not null default 0 check (otros_tributos >= 0),
  otros_tributos_detalle   text,
  total                    numeric(16,2) not null check (total > 0),
  estado                   text not null default 'emitido' check (estado in ('emitido','anulado')),
  motivo                   text,
  observacion              text,
  creado_por               uuid default auth.uid(),
  creado_en                timestamptz not null default now(),
  modificado_en            timestamptz not null default now(),
  check (total = neto_gravado + exento + no_gravado + iva + otros_tributos),
  check (vencimiento is null or vencimiento >= fecha),
  check (periodo_hasta is null or periodo_desde is null or periodo_hasta >= periodo_desde),
  check (clase = 'factura' or comprobante_asociado_id is not null),
  check (cae is null or cae_vencimiento is not null)
);
-- Un número de ARCA no se repite (los anulados por error de carga no cuentan)
create unique index comprobantes_venta_numero on public.comprobantes_venta (tipo_codigo, punto_venta, numero) where estado = 'emitido';
-- Un certificado tiene una sola factura vigente
create unique index comprobantes_venta_certificado on public.comprobantes_venta (certificado_id)
  where certificado_id is not null and clase = 'factura' and estado = 'emitido';
create index comprobantes_venta_cliente on public.comprobantes_venta (cliente_id, fecha);
create index comprobantes_venta_asociado on public.comprobantes_venta (comprobante_asociado_id);
create trigger trg_cv_mod before update on public.comprobantes_venta for each row execute function public.fn_set_modificado();

create table public.comprobante_venta_alicuotas (
  id              uuid primary key default gen_random_uuid(),
  comprobante_id  uuid not null references public.comprobantes_venta(id),
  alicuota        text not null,                 -- código del parámetro (IVA_21, IVA_10_5...)
  porcentaje      numeric(7,4) not null,
  neto            numeric(16,2) not null check (neto > 0),
  iva             numeric(16,2) not null check (iva >= 0),
  unique (comprobante_id, alicuota)
);

-- Las multas descontadas por nota de crédito quedan vinculadas a ella
alter table public.multas add column comprobante_venta_id uuid references public.comprobantes_venta(id);

-- ---------------------------------------------------------------------
-- Cobranzas (recibos)
-- total = medios + retenciones + fondo de reparo retenido
-- total = aplicado a comprobantes + devolución de fondo de reparo + a cuenta
-- ---------------------------------------------------------------------
create table public.cobranzas (
  id                      uuid primary key default gen_random_uuid(),
  numero                  integer unique,
  cliente_id              uuid not null references public.clientes(id),
  fecha                   date not null,
  importe_medios          numeric(16,2) not null default 0 check (importe_medios >= 0),
  importe_retenciones     numeric(16,2) not null default 0 check (importe_retenciones >= 0),
  importe_fondo_reparo    numeric(16,2) not null default 0 check (importe_fondo_reparo >= 0),
  total                   numeric(16,2) not null check (total > 0),
  importe_aplicado        numeric(16,2) not null default 0 check (importe_aplicado >= 0),
  importe_devolucion_fr   numeric(16,2) not null default 0 check (importe_devolucion_fr >= 0),
  a_cuenta                numeric(16,2) generated always as (total - importe_aplicado - importe_devolucion_fr) stored,
  estado                  text not null default 'registrada' check (estado in ('registrada','anulada')),
  motivo                  text,
  observacion             text,
  creado_por              uuid default auth.uid(),
  creado_en               timestamptz not null default now(),
  modificado_en           timestamptz not null default now(),
  check (total = importe_medios + importe_retenciones + importe_fondo_reparo),
  check (importe_aplicado + importe_devolucion_fr <= total)
);
create index cobranzas_cliente on public.cobranzas (cliente_id, fecha);
create trigger trg_cob_mod before update on public.cobranzas for each row execute function public.fn_set_modificado();

create table public.cobranza_medios (
  id                  uuid primary key default gen_random_uuid(),
  cobranza_id         uuid not null references public.cobranzas(id),
  medio               text not null check (medio in ('transferencia','echeq','cheque','efectivo','otro')),
  importe             numeric(16,2) not null check (importe > 0),
  banco               text,
  numero              text,                -- N° de cheque / echeq / operación
  fecha_emision       date,
  fecha_pago          date,                -- fecha de cobro del cheque o acreditación
  librador            text,
  cuit_librador       text check (cuit_librador is null or public.fn_cuit_valido(cuit_librador)),
  referencia          text
);

create table public.retenciones_sufridas (
  id                    uuid primary key default gen_random_uuid(),
  cobranza_id           uuid not null references public.cobranzas(id),
  tipo                  text not null check (tipo in ('RET_GANANCIAS','RET_IVA','RET_IIBB_CBA','RET_SUSS','OTRA')),
  descripcion           text,
  numero_certificado    text not null check (trim(numero_certificado) <> ''),
  fecha                 date not null,
  base                  numeric(16,2) check (base is null or base >= 0),
  alicuota              numeric(7,4) check (alicuota is null or alicuota between 0 and 100),
  importe               numeric(16,2) not null check (importe > 0),
  comprobante_venta_id  uuid references public.comprobantes_venta(id),
  check (tipo <> 'OTRA' or coalesce(trim(descripcion), '') <> '')
);
create index retenciones_cobranza on public.retenciones_sufridas (cobranza_id);

create table public.aplicaciones_cobro (
  id              uuid primary key default gen_random_uuid(),
  cobranza_id     uuid not null references public.cobranzas(id),
  comprobante_id  uuid not null references public.comprobantes_venta(id),
  importe         numeric(16,2) not null check (importe > 0),
  unique (cobranza_id, comprobante_id)
);
create index aplicaciones_comprobante on public.aplicaciones_cobro (comprobante_id);

-- Fondo de reparo: lo que el cliente retiene en cada pago y lo que devuelve después
create table public.fondo_reparo_movimientos (
  id                    uuid primary key default gen_random_uuid(),
  contrato_id           uuid not null references public.contratos(id),
  cobranza_id           uuid not null references public.cobranzas(id),
  comprobante_venta_id  uuid references public.comprobantes_venta(id),
  tipo                  text not null check (tipo in ('retencion','devolucion')),
  importe               numeric(16,2) not null check (importe > 0)
);
create index fr_contrato on public.fondo_reparo_movimientos (contrato_id);

-- ---------------------------------------------------------------------
-- Saldos
-- ---------------------------------------------------------------------
create or replace function public.fn_cobrado_comprobante(p_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(a.importe), 0) from public.aplicaciones_cobro a
    join public.cobranzas c on c.id = a.cobranza_id and c.estado = 'registrada'
   where a.comprobante_id = p_id
$$;

create or replace function public.fn_nc_comprobante(p_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(total), 0) from public.comprobantes_venta
   where comprobante_asociado_id = p_id and clase = 'nota_credito' and estado = 'emitido'
$$;

create or replace function public.fn_saldo_comprobante(p_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select c.total - public.fn_nc_comprobante(c.id) - public.fn_cobrado_comprobante(c.id)
    from public.comprobantes_venta c where c.id = p_id
$$;

create or replace function public.fn_saldo_fondo_reparo(p_contrato uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when m.tipo = 'retencion' then m.importe else -m.importe end), 0)
    from public.fondo_reparo_movimientos m
    join public.cobranzas c on c.id = m.cobranza_id and c.estado = 'registrada'
   where m.contrato_id = p_contrato
$$;

-- Pone el certificado en aprobado / facturado / cobrado según su factura
create or replace function public.fn_sync_certificado(p_cert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actual text;
  v_fac record;
  v_nuevo text;
begin
  if p_cert is null then return; end if;
  select estado into v_actual from public.certificados where id = p_cert for update;
  if v_actual is null or v_actual not in ('aprobado','facturado','cobrado') then return; end if;
  select id into v_fac from public.comprobantes_venta
   where certificado_id = p_cert and clase = 'factura' and estado = 'emitido';
  if not found then
    v_nuevo := 'aprobado';
  elsif public.fn_cobrado_comprobante(v_fac.id) > 0 and public.fn_saldo_comprobante(v_fac.id) <= 0 then
    v_nuevo := 'cobrado';
  else
    v_nuevo := 'facturado';
  end if;
  if v_nuevo = v_actual then return; end if;
  perform set_config('mw.sync_certificado', 'on', true);
  if v_actual = 'aprobado' and v_nuevo = 'cobrado' then
    update public.certificados set estado = 'facturado' where id = p_cert;
  elsif v_actual = 'cobrado' and v_nuevo = 'aprobado' then
    update public.certificados set estado = 'facturado' where id = p_cert;
  end if;
  update public.certificados set estado = v_nuevo where id = p_cert;
  perform set_config('mw.sync_certificado', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- Controles de integridad (se aplican siempre, también fuera de las funciones)
-- ---------------------------------------------------------------------
create or replace function public.fn_comprobantes_venta_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo public.tipos_comprobante;
  v_cli public.clientes;
  v_cert record;
  v_asoc public.comprobantes_venta;
  v_emp_cond text;
begin
  if tg_op = 'INSERT' then
    select * into v_tipo from public.tipos_comprobante where codigo = new.tipo_codigo;
    if v_tipo.clase not in ('factura','nota_debito','nota_credito') then
      raise exception 'El tipo "%" no es una factura ni una nota de crédito o débito', v_tipo.descripcion;
    end if;
    if not v_tipo.activo then raise exception 'El tipo de comprobante "%" está desactivado', v_tipo.descripcion; end if;
    new.clase := v_tipo.clase;
    new.letra := v_tipo.letra;
    select condicion_iva into v_emp_cond from public.empresa where id = 1;
    if coalesce(v_emp_cond, 'RI') = 'RI' and new.letra not in ('A','B','M') then
      raise exception 'Como Responsable Inscripto, MADEWORK emite comprobantes A, B o M (no %)', new.letra;
    end if;
    if new.estado <> 'emitido' then raise exception 'Un comprobante nuevo se registra como emitido'; end if;
    if not public.fn_periodo_abierto(new.fecha) then
      raise exception 'El período % está cerrado: no se pueden registrar comprobantes con esa fecha', to_char(new.fecha, 'MM/YYYY');
    end if;

    select * into v_cli from public.clientes where id = new.cliente_id;
    if new.letra in ('A','M') and v_cli.cuit is null then
      raise exception 'Para un comprobante % el cliente "%" tiene que tener CUIT cargado (Clientes > Editar)', new.letra, v_cli.razon_social;
    end if;

    if new.contrato_id is not null and not exists (select 1 from public.contratos where id = new.contrato_id and cliente_id = new.cliente_id) then
      raise exception 'El contrato no corresponde a ese cliente';
    end if;

    if new.certificado_id is not null then
      if new.clase <> 'factura' then raise exception 'Solo una factura se vincula a un certificado'; end if;
      select ce.estado, ce.numero, ce.contrato_id, ct.cliente_id into v_cert
        from public.certificados ce join public.contratos ct on ct.id = ce.contrato_id where ce.id = new.certificado_id for update of ce;
      if v_cert.estado <> 'aprobado' then
        raise exception 'El certificado N° % está "%": solo se factura un certificado aprobado', v_cert.numero, v_cert.estado;
      end if;
      if v_cert.cliente_id <> new.cliente_id then raise exception 'El certificado es de otro cliente'; end if;
      new.contrato_id := coalesce(new.contrato_id, v_cert.contrato_id);
      if new.contrato_id <> v_cert.contrato_id then raise exception 'El certificado es de otro contrato'; end if;
      new.origen := 'certificado';
    end if;

    if new.clase = 'factura' then
      if new.comprobante_asociado_id is not null then raise exception 'Una factura no lleva comprobante asociado'; end if;
    else
      select * into v_asoc from public.comprobantes_venta where id = new.comprobante_asociado_id for update;
      if not found then raise exception 'No existe el comprobante asociado'; end if;
      if v_asoc.estado <> 'emitido' then raise exception 'El comprobante asociado está anulado'; end if;
      if v_asoc.clase not in ('factura','nota_debito') then raise exception 'Solo se asocia a una factura o nota de débito'; end if;
      if v_asoc.letra <> new.letra then raise exception 'La letra (%) tiene que coincidir con la del comprobante asociado (%)', new.letra, v_asoc.letra; end if;
      if v_asoc.cliente_id <> new.cliente_id then raise exception 'El comprobante asociado es de otro cliente'; end if;
      if new.fecha < v_asoc.fecha then raise exception 'La fecha no puede ser anterior a la del comprobante asociado'; end if;
      new.contrato_id := coalesce(new.contrato_id, v_asoc.contrato_id);
      if new.clase = 'nota_credito' and new.total > v_asoc.total - public.fn_nc_comprobante(v_asoc.id) then
        raise exception 'La nota de crédito (%) supera lo que queda del comprobante asociado (%)', new.total, v_asoc.total - public.fn_nc_comprobante(v_asoc.id);
      end if;
    end if;
    return new;
  end if;

  -- UPDATE: solo datos complementarios o anulación
  if old.estado = 'anulado' then raise exception 'El comprobante está anulado: no se puede modificar'; end if;
  if (new.cliente_id, new.contrato_id, new.certificado_id, new.origen, new.tipo_codigo, new.clase, new.letra, new.punto_venta, new.numero,
      new.fecha, new.comprobante_asociado_id, new.neto_gravado, new.exento, new.no_gravado, new.iva, new.otros_tributos, new.total, new.creado_por)
     is distinct from
     (old.cliente_id, old.contrato_id, old.certificado_id, old.origen, old.tipo_codigo, old.clase, old.letra, old.punto_venta, old.numero,
      old.fecha, old.comprobante_asociado_id, old.neto_gravado, old.exento, old.no_gravado, old.iva, old.otros_tributos, old.total, old.creado_por) then
    raise exception 'Los datos e importes de un comprobante registrado no se modifican. Si hubo un error de carga, anulalo y cargalo de nuevo';
  end if;
  if new.estado = 'anulado' then
    if coalesce(trim(new.motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
    if public.fn_cobrado_comprobante(old.id) > 0 then
      raise exception 'El comprobante tiene cobranzas aplicadas: anulá primero esas cobranzas';
    end if;
    if exists (select 1 from public.comprobantes_venta where comprobante_asociado_id = old.id and estado = 'emitido') then
      raise exception 'El comprobante tiene notas de crédito o débito asociadas: anulalas primero';
    end if;
    if not public.fn_periodo_abierto(old.fecha) then
      raise exception 'El período % está cerrado', to_char(old.fecha, 'MM/YYYY');
    end if;
  end if;
  return new;
end $$;
create trigger trg_cv_control before insert or update on public.comprobantes_venta
  for each row execute function public.fn_comprobantes_venta_control();

create or replace function public.fn_comprobantes_venta_despues()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_sync_certificado(new.certificado_id);
  if new.comprobante_asociado_id is not null then
    perform public.fn_sync_certificado((select certificado_id from public.comprobantes_venta where id = new.comprobante_asociado_id));
  end if;
  if tg_op = 'UPDATE' and new.estado = 'anulado' then
    update public.multas set estado = 'aplicada', comprobante_venta_id = null
     where comprobante_venta_id = new.id and estado = 'descontada';
  end if;
  return null;
end $$;
create trigger trg_cv_despues after insert or update on public.comprobantes_venta
  for each row execute function public.fn_comprobantes_venta_despues();

-- El detalle por alícuota no se modifica una vez cargado
create or replace function public.fn_detalle_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Este detalle no se modifica: anulá el registro completo y cargalo de nuevo';
end $$;
create trigger trg_cva_inmutable before update or delete on public.comprobante_venta_alicuotas for each row execute function public.fn_detalle_inmutable();
create trigger trg_cm_inmutable  before update or delete on public.cobranza_medios            for each row execute function public.fn_detalle_inmutable();
create trigger trg_rs_inmutable  before update or delete on public.retenciones_sufridas       for each row execute function public.fn_detalle_inmutable();
create trigger trg_ac_inmutable  before update or delete on public.aplicaciones_cobro         for each row execute function public.fn_detalle_inmutable();
create trigger trg_fr_inmutable  before update or delete on public.fondo_reparo_movimientos   for each row execute function public.fn_detalle_inmutable();

-- Número de recibo correlativo y control de la cobranza
create or replace function public.fn_cobranzas_control()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'registrada' then raise exception 'Una cobranza nueva se registra como registrada'; end if;
    if not public.fn_periodo_abierto(new.fecha) then
      raise exception 'El período % está cerrado: no se pueden registrar cobranzas con esa fecha', to_char(new.fecha, 'MM/YYYY');
    end if;
    perform pg_advisory_xact_lock(hashtext('cobranzas'));
    select coalesce(max(numero), 0) + 1 into new.numero from public.cobranzas;
    return new;
  end if;
  if old.estado = 'anulada' then raise exception 'La cobranza está anulada: no se puede modificar'; end if;
  if (new.numero, new.cliente_id, new.fecha, new.importe_medios, new.importe_retenciones, new.importe_fondo_reparo, new.total,
      new.importe_aplicado, new.importe_devolucion_fr, new.creado_por)
     is distinct from
     (old.numero, old.cliente_id, old.fecha, old.importe_medios, old.importe_retenciones, old.importe_fondo_reparo, old.total,
      old.importe_aplicado, old.importe_devolucion_fr, old.creado_por) then
    raise exception 'Los importes de una cobranza registrada no se modifican. Si hubo un error, anulala y cargala de nuevo';
  end if;
  if new.estado = 'anulada' then
    if coalesce(trim(new.motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
    if not public.fn_periodo_abierto(old.fecha) then raise exception 'El período % está cerrado', to_char(old.fecha, 'MM/YYYY'); end if;
  end if;
  return new;
end $$;
create trigger trg_cob_control before insert or update on public.cobranzas
  for each row execute function public.fn_cobranzas_control();

-- Una aplicación no puede superar el saldo del comprobante
create or replace function public.fn_aplicaciones_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_comp public.comprobantes_venta; v_cob public.cobranzas; v_saldo numeric;
begin
  select * into v_cob from public.cobranzas where id = new.cobranza_id;
  if v_cob.estado <> 'registrada' then raise exception 'La cobranza está anulada'; end if;
  select * into v_comp from public.comprobantes_venta where id = new.comprobante_id for update;
  if v_comp.estado <> 'emitido' then raise exception 'El comprobante está anulado'; end if;
  if v_comp.clase not in ('factura','nota_debito') then raise exception 'Una cobranza se aplica a facturas o notas de débito'; end if;
  if v_comp.cliente_id <> v_cob.cliente_id then raise exception 'El comprobante es de otro cliente'; end if;
  v_saldo := public.fn_saldo_comprobante(v_comp.id);
  if new.importe > v_saldo then
    raise exception 'Se aplica % al comprobante %-% que tiene saldo %', new.importe, lpad(v_comp.punto_venta::text, 5, '0'), lpad(v_comp.numero::text, 8, '0'), v_saldo;
  end if;
  return new;
end $$;
create trigger trg_ac_control before insert on public.aplicaciones_cobro for each row execute function public.fn_aplicaciones_control();

-- Retenciones: no se repite el certificado de un mismo tipo para el mismo cliente
create or replace function public.fn_retenciones_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cli uuid;
begin
  select cliente_id into v_cli from public.cobranzas where id = new.cobranza_id;
  if exists (select 1 from public.retenciones_sufridas r join public.cobranzas c on c.id = r.cobranza_id
              where c.estado = 'registrada' and c.cliente_id = v_cli and r.tipo = new.tipo
                and upper(trim(r.numero_certificado)) = upper(trim(new.numero_certificado))) then
    raise exception 'El certificado de retención % N° % ya está cargado para este cliente', new.tipo, new.numero_certificado;
  end if;
  return new;
end $$;
create trigger trg_rs_control before insert on public.retenciones_sufridas for each row execute function public.fn_retenciones_control();

-- Fondo de reparo: el contrato es del cliente y no se devuelve más de lo retenido
create or replace function public.fn_fondo_reparo_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cli uuid;
begin
  select cliente_id into v_cli from public.cobranzas where id = new.cobranza_id;
  if not exists (select 1 from public.contratos where id = new.contrato_id and cliente_id = v_cli) then
    raise exception 'El contrato del fondo de reparo no es de este cliente';
  end if;
  if new.tipo = 'devolucion' then
    perform pg_advisory_xact_lock(hashtext('fr' || new.contrato_id::text));
    if new.importe > public.fn_saldo_fondo_reparo(new.contrato_id) then
      raise exception 'La devolución (%) supera el fondo de reparo retenido del contrato (%)', new.importe, public.fn_saldo_fondo_reparo(new.contrato_id);
    end if;
  end if;
  return new;
end $$;
create trigger trg_fr_control before insert on public.fondo_reparo_movimientos for each row execute function public.fn_fondo_reparo_control();

-- ---------------------------------------------------------------------
-- Funciones de operación (las llama la aplicación)
-- ---------------------------------------------------------------------

-- Registra un comprobante de venta con su detalle por alícuota.
-- p: { cliente_id, contrato_id, certificado_id, origen, tipo_codigo, punto_venta, numero, fecha, vencimiento,
--      periodo_desde, periodo_hasta, cae, cae_vencimiento, comprobante_asociado_id, descripcion,
--      exento, no_gravado, otros_tributos, otros_tributos_detalle, observacion,
--      alicuotas: [{ alicuota, neto, iva }], multas_ids: [uuid] }
create or replace function public.fn_registrar_comprobante_venta(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_fecha date := (p->>'fecha')::date;
  v_tol numeric;
  v_neto numeric(16,2) := 0;
  v_iva numeric(16,2) := 0;
  v_exento numeric(16,2) := coalesce((p->>'exento')::numeric, 0);
  v_nogr numeric(16,2) := coalesce((p->>'no_gravado')::numeric, 0);
  v_otros numeric(16,2) := coalesce((p->>'otros_tributos')::numeric, 0);
  l record;
  v_pct numeric;
  v_n integer;
begin
  if not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Solo el administrador o el contador registran comprobantes de venta';
  end if;
  if v_fecha is null then raise exception 'Falta la fecha del comprobante'; end if;
  if not public.fn_periodo_abierto(v_fecha) then
    raise exception 'El período % está cerrado', to_char(v_fecha, 'MM/YYYY');
  end if;
  v_tol := coalesce(public.fn_parametro_vigente('TOLERANCIA', 'CUADRE_IVA_CENTAVOS', v_fecha), 1) / 100;

  -- Controla cada alícuota contra el parámetro vigente a la fecha
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

  insert into public.comprobantes_venta (
    cliente_id, contrato_id, certificado_id, origen, tipo_codigo, clase, letra, punto_venta, numero, fecha, vencimiento,
    periodo_desde, periodo_hasta, cae, cae_vencimiento, comprobante_asociado_id, descripcion,
    neto_gravado, exento, no_gravado, iva, otros_tributos, otros_tributos_detalle, total, observacion)
  values (
    (p->>'cliente_id')::uuid, nullif(p->>'contrato_id', '')::uuid, nullif(p->>'certificado_id', '')::uuid,
    coalesce(nullif(p->>'origen', ''), 'manual'), p->>'tipo_codigo', 'factura', '?', (p->>'punto_venta')::integer, (p->>'numero')::bigint,
    v_fecha, nullif(p->>'vencimiento', '')::date, nullif(p->>'periodo_desde', '')::date, nullif(p->>'periodo_hasta', '')::date,
    nullif(trim(p->>'cae'), ''), nullif(p->>'cae_vencimiento', '')::date, nullif(p->>'comprobante_asociado_id', '')::uuid,
    nullif(trim(p->>'descripcion'), ''), v_neto, v_exento, v_nogr, v_iva, v_otros, nullif(trim(p->>'otros_tributos_detalle'), ''),
    v_neto + v_exento + v_nogr + v_iva + v_otros, nullif(trim(p->>'observacion'), ''))
  returning id into v_id;

  insert into public.comprobante_venta_alicuotas (comprobante_id, alicuota, porcentaje, neto, iva)
  select v_id, x.alicuota, public.fn_parametro_vigente('ALICUOTA_IVA', x.alicuota, v_fecha), round(x.neto, 2), round(x.iva, 2)
    from jsonb_to_recordset(coalesce(p->'alicuotas', '[]'::jsonb)) as x(alicuota text, neto numeric, iva numeric);

  -- Multas descontadas con esta nota de crédito
  if jsonb_array_length(coalesce(p->'multas_ids', '[]'::jsonb)) > 0 then
    if (select clase from public.comprobantes_venta where id = v_id) <> 'nota_credito' then
      raise exception 'Las multas se descuentan con una nota de crédito';
    end if;
    update public.multas m set estado = 'descontada', comprobante_venta_id = v_id
     where m.id in (select (x #>> '{}')::uuid from jsonb_array_elements(p->'multas_ids') x)
       and m.estado = 'aplicada'
       and m.contrato_id = (select contrato_id from public.comprobantes_venta where id = v_id);
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(p->'multas_ids') then
      raise exception 'Alguna multa no está pendiente o es de otro contrato';
    end if;
  end if;
  return v_id;
end $$;

-- Completa o corrige datos que no cambian importes (CAE, vencimientos, observación)
create or replace function public.fn_actualizar_comprobante_venta(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Solo el administrador o el contador modifican comprobantes de venta';
  end if;
  update public.comprobantes_venta set
    cae = case when p ? 'cae' then nullif(trim(p->>'cae'), '') else cae end,
    cae_vencimiento = case when p ? 'cae_vencimiento' then nullif(p->>'cae_vencimiento', '')::date else cae_vencimiento end,
    vencimiento = case when p ? 'vencimiento' then nullif(p->>'vencimiento', '')::date else vencimiento end,
    descripcion = case when p ? 'descripcion' then nullif(trim(p->>'descripcion'), '') else descripcion end,
    observacion = case when p ? 'observacion' then nullif(trim(p->>'observacion'), '') else observacion end
  where id = p_id;
  if not found then raise exception 'No existe el comprobante'; end if;
end $$;

create or replace function public.fn_anular_comprobante_venta(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Solo el administrador o el contador anulan comprobantes de venta';
  end if;
  update public.comprobantes_venta set estado = 'anulado', motivo = p_motivo where id = p_id;
  if not found then raise exception 'No existe el comprobante'; end if;
end $$;

-- Registra una cobranza completa.
-- p: { cliente_id, fecha, observacion,
--      medios: [{ medio, importe, banco, numero, fecha_emision, fecha_pago, librador, cuit_librador, referencia }],
--      retenciones: [{ tipo, descripcion, numero_certificado, fecha, base, alicuota, importe, comprobante_venta_id }],
--      fondo_reparo: [{ contrato_id, importe, comprobante_venta_id }],
--      aplicaciones: [{ comprobante_id, importe }],
--      devoluciones_fr: [{ contrato_id, importe }] }
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

  insert into public.cobranza_medios (cobranza_id, medio, importe, banco, numero, fecha_emision, fecha_pago, librador, cuit_librador, referencia)
  select v_id, x.medio, round(x.importe, 2), nullif(trim(x.banco), ''), nullif(trim(x.numero), ''), x.fecha_emision, x.fecha_pago,
         nullif(trim(x.librador), ''), nullif(regexp_replace(coalesce(x.cuit_librador, ''), '\D', '', 'g'), ''), nullif(trim(x.referencia), '')
    from jsonb_to_recordset(coalesce(p->'medios', '[]')) as x(medio text, importe numeric, banco text, numero text, fecha_emision date,
         fecha_pago date, librador text, cuit_librador text, referencia text);

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

  -- Certificados que quedan cobrados
  for v_cert in select distinct cv.certificado_id from public.aplicaciones_cobro a
                  join public.comprobantes_venta cv on cv.id = a.comprobante_id
                 where a.cobranza_id = v_id and cv.certificado_id is not null loop
    perform public.fn_sync_certificado(v_cert);
  end loop;
  return v_id;
end $$;

create or replace function public.fn_anular_cobranza(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_m record; v_cert uuid;
begin
  if not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Solo el administrador o el contador anulan cobranzas';
  end if;
  update public.cobranzas set estado = 'anulada', motivo = p_motivo where id = p_id;
  if not found then raise exception 'No existe la cobranza'; end if;
  -- Si retuvo fondo de reparo que ya se devolvió, el saldo quedaría negativo
  for v_m in select distinct contrato_id from public.fondo_reparo_movimientos where cobranza_id = p_id and tipo = 'retencion' loop
    if public.fn_saldo_fondo_reparo(v_m.contrato_id) < 0 then
      raise exception 'Parte del fondo de reparo de esta cobranza ya se devolvió: anulá primero la cobranza de la devolución';
    end if;
  end loop;
  for v_cert in select distinct cv.certificado_id from public.aplicaciones_cobro a
                  join public.comprobantes_venta cv on cv.id = a.comprobante_id
                 where a.cobranza_id = p_id and cv.certificado_id is not null loop
    perform public.fn_sync_certificado(v_cert);
  end loop;
end $$;

create or replace function public.fn_actualizar_cobranza(p_id uuid, p_observacion text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Solo el administrador o el contador modifican cobranzas'; end if;
  update public.cobranzas set observacion = nullif(trim(p_observacion), '') where id = p_id;
  if not found then raise exception 'No existe la cobranza'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Vistas (respetan los permisos de quien consulta)
-- ---------------------------------------------------------------------
create view public.v_comprobantes_venta with (security_invoker = true) as
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
       coalesce(ap.total, 0) as cobrado,
       case when cv.clase in ('factura','nota_debito') and cv.estado = 'emitido'
            then cv.total - coalesce(nc.total, 0) - coalesce(ap.total, 0) end as saldo
  from public.comprobantes_venta cv
  join public.clientes cl on cl.id = cv.cliente_id
  join public.tipos_comprobante tc on tc.codigo = cv.tipo_codigo
  left join public.contratos ct on ct.id = cv.contrato_id
  left join public.certificados ce on ce.id = cv.certificado_id
  left join public.comprobantes_venta asoc on asoc.id = cv.comprobante_asociado_id
  left join (select comprobante_asociado_id id, sum(total) total from public.comprobantes_venta
              where clase = 'nota_credito' and estado = 'emitido' group by comprobante_asociado_id) nc on nc.id = cv.id
  left join (select a.comprobante_id id, sum(a.importe) total from public.aplicaciones_cobro a
               join public.cobranzas c on c.id = a.cobranza_id and c.estado = 'registrada' group by a.comprobante_id) ap on ap.id = cv.id;

create view public.v_cobranzas with (security_invoker = true) as
select c.*, cl.razon_social as cliente, cl.cuit as cliente_cuit
  from public.cobranzas c join public.clientes cl on cl.id = c.cliente_id;

create view public.v_fondo_reparo with (security_invoker = true) as
select ct.id as contrato_id, ct.codigo, ct.descripcion, ct.cliente_id, cl.razon_social as cliente,
       ct.fecha_recepcion_definitiva, ct.fecha_recepcion_provisoria, ct.plazo_garantia_dias,
       coalesce(sum(m.importe) filter (where m.tipo = 'retencion'), 0) as retenido,
       coalesce(sum(m.importe) filter (where m.tipo = 'devolucion'), 0) as devuelto,
       coalesce(sum(case when m.tipo = 'retencion' then m.importe else -m.importe end), 0) as saldo
  from public.contratos ct
  join public.clientes cl on cl.id = ct.cliente_id
  left join (select m.* from public.fondo_reparo_movimientos m join public.cobranzas c on c.id = m.cobranza_id and c.estado = 'registrada') m
         on m.contrato_id = ct.id
 group by ct.id, cl.razon_social;

create view public.v_retenciones_sufridas with (security_invoker = true) as
select r.*, c.numero as recibo, c.fecha as fecha_cobranza, c.estado as estado_cobranza, c.cliente_id, cl.razon_social as cliente, cl.cuit as cliente_cuit,
       lpad(cv.punto_venta::text, 5, '0') || '-' || lpad(cv.numero::text, 8, '0') as comprobante_numero
  from public.retenciones_sufridas r
  join public.cobranzas c on c.id = r.cobranza_id
  join public.clientes cl on cl.id = c.cliente_id
  left join public.comprobantes_venta cv on cv.id = r.comprobante_venta_id;

-- =====================================================================
-- Seguridad: lectura para todo usuario activo; escritura solo por las funciones
-- =====================================================================
alter table public.comprobantes_venta          enable row level security;
alter table public.comprobante_venta_alicuotas enable row level security;
alter table public.cobranzas                   enable row level security;
alter table public.cobranza_medios             enable row level security;
alter table public.retenciones_sufridas        enable row level security;
alter table public.aplicaciones_cobro          enable row level security;
alter table public.fondo_reparo_movimientos    enable row level security;

create policy cv_ver  on public.comprobantes_venta          for select to authenticated using (public.fn_rol() is not null);
create policy cva_ver on public.comprobante_venta_alicuotas for select to authenticated using (public.fn_rol() is not null);
create policy cob_ver on public.cobranzas                   for select to authenticated using (public.fn_rol() is not null);
create policy cm_ver  on public.cobranza_medios             for select to authenticated using (public.fn_rol() is not null);
create policy rs_ver  on public.retenciones_sufridas        for select to authenticated using (public.fn_rol() is not null);
create policy ac_ver  on public.aplicaciones_cobro          for select to authenticated using (public.fn_rol() is not null);
create policy fr_ver  on public.fondo_reparo_movimientos    for select to authenticated using (public.fn_rol() is not null);

revoke insert, update, delete, truncate on public.comprobantes_venta, public.comprobante_venta_alicuotas, public.cobranzas,
  public.cobranza_medios, public.retenciones_sufridas, public.aplicaciones_cobro, public.fondo_reparo_movimientos
  from anon, authenticated;
revoke all on public.comprobantes_venta, public.comprobante_venta_alicuotas, public.cobranzas, public.cobranza_medios,
  public.retenciones_sufridas, public.aplicaciones_cobro, public.fondo_reparo_movimientos,
  public.v_comprobantes_venta, public.v_cobranzas, public.v_fondo_reparo, public.v_retenciones_sufridas from anon;

-- Las funciones internas no se llaman desde afuera
revoke execute on function public.fn_sync_certificado(uuid) from public, anon, authenticated;
revoke execute on function public.fn_registrar_comprobante_venta(jsonb), public.fn_actualizar_comprobante_venta(uuid, jsonb),
  public.fn_anular_comprobante_venta(uuid, text), public.fn_registrar_cobranza(jsonb), public.fn_anular_cobranza(uuid, text),
  public.fn_actualizar_cobranza(uuid, text) from public, anon;
grant execute on function public.fn_registrar_comprobante_venta(jsonb), public.fn_actualizar_comprobante_venta(uuid, jsonb),
  public.fn_anular_comprobante_venta(uuid, text), public.fn_registrar_cobranza(jsonb), public.fn_anular_cobranza(uuid, text),
  public.fn_actualizar_cobranza(uuid, text) to authenticated;

-- Archivos: se pueden adjuntar a comprobantes, cobranzas y retenciones
-- (la política de "adjuntos" de la migración 002 ya cubre el alta para administrador, contador y operador)

-- =====================================================================
-- Auditoría
-- =====================================================================
create trigger trg_audit_cv  after insert or update or delete on public.comprobantes_venta          for each row execute function public.fn_auditar();
create trigger trg_audit_cva after insert or update or delete on public.comprobante_venta_alicuotas for each row execute function public.fn_auditar();
create trigger trg_audit_cob after insert or update or delete on public.cobranzas                   for each row execute function public.fn_auditar();
create trigger trg_audit_cm  after insert or update or delete on public.cobranza_medios             for each row execute function public.fn_auditar();
create trigger trg_audit_rs  after insert or update or delete on public.retenciones_sufridas        for each row execute function public.fn_auditar();
create trigger trg_audit_ac  after insert or update or delete on public.aplicaciones_cobro          for each row execute function public.fn_auditar();
create trigger trg_audit_fr  after insert or update or delete on public.fondo_reparo_movimientos    for each row execute function public.fn_auditar();

-- Fin de la migración 003
