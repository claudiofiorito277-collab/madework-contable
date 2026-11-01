-- =====================================================================
-- MADEWORK · Sistema contable · Borrado de datos DEMO (Etapa 9)
--
-- Borra TODO lo operativo: clientes, contratos, certificados, facturas,
-- cobranzas, compras, pagos, tesorería, cheques, asientos, ejercicios,
-- personal, equipos, materiales, partes, indirectos, adjuntos (registro) y
-- la auditoría de las pruebas.
--
-- CONSERVA la configuración: empresa, usuarios y sus roles, parámetros
-- fiscales, condiciones de IVA, tipos de comprobante, plan de cuentas,
-- centro de costo de administración y configuración de imputaciones.
--
-- NO SE PUEDE DESHACER. Antes, hacé un respaldo (ver docs/RESPALDOS.md).
--
-- Cómo correrlo (Supabase → SQL Editor):
--   1. Pegá todo el archivo.
--   2. Cambiá 'NO' por 'SI' en la línea marcada con >>> más abajo.
--   3. Run. Tiene que decir Success.
--   4. Los archivos adjuntos (fotos de facturas) quedan en Storage:
--      vaciá el bucket "adjuntos" desde Storage en el panel de Supabase.
-- =====================================================================

begin;

-- >>> Para confirmar el borrado, cambiá 'NO' por 'SI':
select set_config('mw.confirmo_borrar_demo', 'NO', true);

do $$
begin
  if current_setting('mw.confirmo_borrar_demo', true) is distinct from 'SI' then
    raise exception 'No se borró nada. Para confirmar, cambiá NO por SI en la línea marcada con >>>';
  end if;
end $$;

-- Datos operativos (TRUNCATE no dispara los controles fila por fila; numeraciones desde cero)
truncate table
  public.indirecto_porcentajes, public.costos_indirectos,
  public.material_movimientos, public.materiales, public.depositos,
  public.parte_equipos, public.parte_personal, public.partes_diarios,
  public.equipo_gastos, public.equipo_tarifas, public.equipos,
  public.personal_tarifas, public.personal_datos, public.personal,
  public.asiento_lineas, public.asientos, public.ejercicios,
  public.extracto_lineas, public.extractos_bancarios, public.mapeos_extracto,
  public.reversiones_cheque, public.movimientos_tesoreria, public.cheques, public.cuentas_tesoreria,
  public.pago_aplicaciones, public.retenciones_practicadas, public.pago_medios, public.pagos,
  public.comprobante_compra_imputaciones, public.comprobante_compra_percepciones, public.comprobante_compra_alicuotas,
  public.comprobantes_compra, public.ordenes_compra, public.proveedores,
  public.fondo_reparo_movimientos, public.aplicaciones_cobro, public.retenciones_sufridas,
  public.cobranza_medios, public.cobranzas, public.comprobante_venta_alicuotas, public.comprobantes_venta,
  public.adjuntos, public.polizas, public.multas, public.avance_unidades, public.certificado_items, public.certificados,
  public.redeterminacion_precios, public.redeterminaciones, public.contrato_tramos, public.contrato_items, public.contratos,
  public.clientes
  restart identity;

-- Centros de costo que se crearon con los contratos y sus ítems
delete from public.centros_costo where tipo in ('contrato', 'item');

-- Meses: se empieza con el mes actual abierto
truncate table public.periodos;
insert into public.periodos (anio, mes) values (extract(year from current_date)::int, extract(month from current_date)::int);

-- Depósito central de nuevo (para los materiales)
insert into public.depositos (nombre, tipo) values ('Depósito central', 'deposito');

-- Auditoría de las pruebas: se reemplaza por un único registro del borrado
truncate table public.auditoria;
insert into public.auditoria (usuario_id, usuario_email, tabla, registro_id, accion, antes, despues)
values (auth.uid(), coalesce((select email from public.perfiles where id = auth.uid()), 'SQL Editor'), 'sistema', 'borrado-demo', 'BAJA', null,
        jsonb_build_object('descripcion', 'Borrado de datos DEMO para arrancar con datos reales', 'fecha', now()));

commit;

-- Resultado: cantidad de filas que quedaron en cada tabla operativa (todas en 0)
select 'clientes' tabla, count(*) filas from public.clientes union all
select 'contratos', count(*) from public.contratos union all
select 'certificados', count(*) from public.certificados union all
select 'comprobantes_venta', count(*) from public.comprobantes_venta union all
select 'comprobantes_compra', count(*) from public.comprobantes_compra union all
select 'cobranzas', count(*) from public.cobranzas union all
select 'pagos', count(*) from public.pagos union all
select 'movimientos_tesoreria', count(*) from public.movimientos_tesoreria union all
select 'asientos', count(*) from public.asientos union all
select 'partes_diarios', count(*) from public.partes_diarios;
