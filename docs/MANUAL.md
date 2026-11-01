---
title: "Manual de uso"
subtitle: "Sistema contable MADEWORK · Caminos de las Sierras · versión 1.0 · 01/11/2026"
---

# Cómo leer este manual

Cada capítulo es una tarea del día a día, paso a paso. Los nombres en **negrita** son los botones y menús tal como aparecen en la pantalla.

**Quién hace qué:**

| Rol | Qué puede hacer |
|---|---|
| Administrador | Todo: configuración, usuarios, auditoría y operaciones. |
| Contador | Todo lo contable y fiscal: facturas, cobranzas, pagos, tesorería, asientos y cierres. No administra usuarios. |
| Operador | Carga desde la obra: avance de columnas, compras con foto, partes diarios, consumos y combustible. No ve costos ni datos personales. |
| Solo consulta | Ve la información y los reportes; no modifica nada. |

**Reglas que valen para todo el sistema:**

- Nada se borra: lo que está mal se **anula** con un motivo, y queda en la **Auditoría**.
- Con un **mes cerrado** no se puede cargar ni anular nada con fecha de ese mes.
- Los importes se escriben como en la calculadora o con puntos y coma: `172670`, `172.670` o `172.670,50`.
- Cada pantalla de listado tiene botones **Excel** y **PDF** para descargar lo que se ve.

# 1. Cargar un certificado

1. **Contratos y certificados** → abrir el contrato.
2. Si se trabaja con planilla de columnas: **+ Cargar columnas**. Se cargan las columnas pintadas (número o progresiva, tramo, fecha). Cuando la inspección las aprueba, se marcan **aprobadas**.
3. **+ Nuevo certificado**: elegir el período (desde, hasta). El sistema propone las cantidades de las columnas aprobadas sin certificar; se pueden corregir.
4. Revisar **Importes**: bruto, fondo de reparo, descuento de anticipo y multas a descontar.
5. **Presentar** cuando se entrega a la inspección. Si la inspección lo observa, se marca observado y se corrige.
6. Cuando lo aprueban: **Aprobar** (desde el contrato). Desde ese momento se puede facturar.

En el **Inicio** aparece "Certificado N° … aprobado sin factura registrada" hasta que se factura.

# 2. Facturar un certificado

La factura se emite en ARCA, como siempre. El sistema la **registra** con su número y CAE.

1. Desde el certificado aprobado: **Registrar factura**. (También desde **Ventas y cobranzas → Certificados aprobados sin factura**.)
2. El sistema completa cliente, contrato, neto, IVA y total a partir del certificado.
3. Completar **tipo** (Factura A), **punto de venta**, **número**, **fecha**, **vencimiento** y el **CAE** con su vencimiento.
4. **Registrar**. El certificado pasa a *facturado*.

Para una nota de crédito (por ejemplo, una multa): abrir la factura → **Nota de crédito**. Para una factura que no viene de un certificado: **Ventas y cobranzas → + Factura manual**.

# 3. Registrar un cobro con retenciones

1. **Ventas y cobranzas → + Registrar cobranza** (o desde la factura: **Registrar cobranza**).
2. Elegir el cliente y marcar la factura que se cobra.
3. **Medios de cobro**: transferencia (elegir la cuenta del banco), echeq o cheque (número, banco, fecha de pago, librador). **+ Otro medio** si vino en partes.
4. **Retenciones sufridas**: por cada certificado de retención, el tipo (Ganancias, IVA, IIBB Córdoba, SUSS), el **número de certificado**, la base, la alícuota y el importe.
5. **Fondo de reparo retenido**, si el cliente lo retuvo en este pago.
6. Controlar que medios + retenciones + fondo de reparo = total aplicado. **Registrar cobranza**.
7. **Imprimir recibo** si hace falta.

La transferencia entra sola a la cuenta del banco; el echeq queda en **Tesorería → Cheques** hasta que se deposita.

# 4. Cargar una compra desde el celular

1. En el celular, entrar al sistema (conviene guardarlo en la pantalla de inicio del teléfono).
2. **Compras y pagos → + Cargar factura**.
3. **Foto del comprobante**: sacar la foto de la factura.
4. Elegir el proveedor (o **+ Nuevo proveedor** con su CUIT).
5. Tipo, punto de venta, número y fecha, y el **Importe total**. Si es Factura A: neto por alícuota e IVA; percepciones si las tiene.
6. **Imputación a obra**: a qué contrato e ítem va (y el rubro: materiales, mano de obra, equipos…). **+ Repartir en otra línea** si se divide.
7. **Guardar comprobante**.

Si la cargó el operador, queda **a revisar**: el administrador o el contador la abren y tocan **Marcar revisado**. Si el mismo comprobante ya estaba cargado, el sistema avisa y no lo duplica.

Si la pintura entra al depósito: **Costos de obra → Materiales y stock → + Ingreso**, eligiendo esa factura (así el costo llega a la obra por lo consumido, sin contarse dos veces).

# 5. Pagar

1. **Compras y pagos → + Registrar pago** (o desde la factura: **Pagar**).
2. Elegir el proveedor y marcar las facturas que se cancelan.
3. **Medios de pago**: transferencia o efectivo (de qué cuenta sale), cheque o echeq propio (número, fecha de pago) o **cheque de terceros** de la cartera (se endosa).
4. Si no se cancela todo, el resto queda como **Anticipo a cuenta**.
5. **Registrar pago** → **Imprimir orden de pago** para que el proveedor firme "Recibí conforme".

Los vencimientos de la semana aparecen en el **Inicio** y en **Compras y pagos → Vencimientos**.

# 6. Conciliar el banco

1. Bajar del home banking el extracto del mes en **CSV o Excel**.
2. **Tesorería y cheques → Conciliación** → elegir la cuenta → **Importar extracto**.
3. La primera vez, indicar qué columna es la fecha, la descripción y el importe (el sistema lo recuerda para ese banco).
4. **Conciliar las coincidencias sugeridas** (mismo importe y fecha cercana).
5. Lo que está en el banco y no en el sistema (comisiones, impuestos): **Cargar**. Lo informativo: **Ignorar**.
6. Escribir el **Saldo según el banco** al cierre del extracto: el **Control de saldos** tiene que decir **Cuadra ✓**. Si no, la diferencia aparece en "Sin explicar".

# 7. Cerrar el mes

Conviene hacerlo con el contador, en los primeros días del mes siguiente.

1. Verificar que estén cargadas todas las facturas, compras, cobranzas, pagos y movimientos del mes, y que el banco esté conciliado.
2. **Contabilidad → Contabilizar → Contabilizar todo**. Tiene que quedar "No hay nada pendiente".
3. Revisar **Sumas y saldos** (tiene que decir **El balance cuadra**) y el **Estado de resultados**.
4. Descargar en PDF lo que se quiera guardar (libro diario, sumas y saldos, IVA Ventas e IVA Compras del mes, retenciones).
5. **Contabilidad → Cierre de meses → Cerrar mes**.

Desde ese momento no se puede cargar ni anular nada con fecha de ese mes. Si hace falta corregir: **Reabrir**, con un motivo (queda registrado).

# 8. Tareas de todos los días en la obra (operador)

- **Parte diario**: **Costos de obra → + Parte diario**. Fecha, contrato, ítem, **Cuadrilla A con 1 jornal** (carga a todos), horas del hidroelevador, columnas pintadas y litros de pintura usados. **Guardar parte**.
- **Combustible**: **Costos de obra → Vehículos y equipos → + Combustible**.
- **Avance de columnas**: en el contrato, **+ Cargar columnas**.

# 9. Reportes y consultas frecuentes

| Necesito saber… | Dónde |
|---|---|
| Cuánto hay en el banco, qué vence esta semana | **Inicio** (panel) |
| Cuánto gano en la obra y cuánto cuesta cada columna | **Reportes → Rentabilidad y costo por unidad** |
| El IVA del mes para el contador | **Reportes → IVA Ventas / IVA Compras** (Excel, PDF y Libro IVA Digital en borrador) |
| Retenciones y percepciones para computar | **Reportes → Retenciones y percepciones** |
| Quién me debe y a quién le debo | **Reportes → Saldos y vencimientos** |
| Si me va a alcanzar la plata | **Tesorería → Flujo de fondos** |
| Quién cambió algo | **Configuración → Auditoría** |

# 10. Si algo sale mal

- **"El período MM/AAAA está cerrado"**: la fecha cae en un mes cerrado. Corregir la fecha o pedir que se reabra el mes.
- **"Comprobante duplicado"**: ese número ya está cargado; buscarlo en el listado.
- **"Stock insuficiente"**: falta hacer el ingreso o la transferencia al obrador.
- **No veo un menú**: tu rol no lo tiene; pedíselo al administrador.
- **La pantalla quedó vieja después de una actualización**: recargar con **Ctrl + F5** (en el celular, cerrar y abrir).
