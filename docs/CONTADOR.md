---
title: "Lista para el contador"
subtitle: "Sistema contable MADEWORK · puntos A CONFIRMAR · 01/11/2026"
---

# Para qué es esta lista

Durante la construcción del sistema quedaron marcados **A CONFIRMAR CON CONTADOR** los puntos que dependen de un criterio profesional o de la situación fiscal de MADEWORK. El sistema funciona con valores provisorios o dejando el dato vacío; nada de esto se inventó.

**Datos del contribuyente:** Claudio Esteban Fiorito (MADEWORK), empresa unipersonal, Responsable Inscripto en IVA, contribuyente local de Ingresos Brutos Córdoba. Inicio del sistema: 01/11/2026. Cliente: Caminos de las Sierras S.A., concurso 2026/0115, pintura de columnas RP-E55.

Para cada punto: **qué hace hoy el sistema** y **qué hay que definir**. Al lado hay lugar para anotar la respuesta; después se carga en el sistema (parámetros fiscales, plan de cuentas o configuración de imputaciones) sin tocar el programa.

# 1. IVA

| # | Qué hace hoy el sistema | Qué hay que definir | Respuesta |
|---|---|---|---|
| 1.1 | Facturas A con IVA 21 % (también 10,5 %, 27 % y 0 %). Diferencia de redondeo aceptada: 1 centavo por alícuota. | Confirmar alícuota del servicio de pintura de columnas y la tolerancia. | |
| 1.2 | Las multas se descuentan con nota de crédito; el sistema propone el importe como neto con IVA. | ¿La multa contractual lleva IVA o es no gravada? | |
| 1.3 | El fondo de reparo retenido se registra como crédito a cobrar; no modifica el IVA facturado. | Tratamiento impositivo del fondo de reparo (¿IVA al facturar o al devolver?). | |
| 1.4 | El anticipo financiero se puede facturar y se descuenta en cada certificado. | Si el anticipo se factura con IVA y cómo se descuenta en cada factura (resta en la factura o se compensa aparte). | |
| 1.5 | Factura M cargada como tipo posible, sin régimen especial. | ¿MADEWORK o algún proveedor está en régimen de Factura M? Retención aplicable. | |
| 1.6 | Crédito fiscal: solo de Factura A de Responsables Inscriptos; Factura B, C y monotributistas van al costo. | Confirmar el criterio de crédito fiscal computable. | |

# 2. Retenciones y percepciones

| # | Qué hace hoy el sistema | Qué hay que definir | Respuesta |
|---|---|---|---|
| 2.1 | En cada cobranza se cargan las retenciones que hace Caminos de las Sierras (Ganancias, IVA, IIBB Córdoba, SUSS) con su número de certificado. Los valores de control están vacíos. | Qué retenciones practica el cliente y con qué alícuotas (para controlar los certificados). | |
| 2.2 | SUSS sufrida: cargada como posible. | ¿Corresponde retención de SUSS a esta actividad? | |
| 2.3 | Las percepciones de IVA e IIBB sufridas en compras se registran como crédito a computar. | Tratamiento y cómputo de las percepciones de IVA, IIBB Córdoba y de otras jurisdicciones. | |
| 2.4 | El reporte de retenciones y percepciones lista todo lo sufrido por período. | Formato que necesita para computarlas (SIRE, DDJJ de IIBB). | |

# 3. Ingresos Brutos Córdoba

| # | Qué hace hoy el sistema | Qué hay que definir | Respuesta |
|---|---|---|---|
| 3.1 | La alícuota de la actividad está vacía. | Alícuota de IIBB Córdoba de la actividad. | |
| 3.2 | El pliego (art. 6) dice que la obra está dentro de las excepciones del inc. 31 del art. 242 del Código Tributario de Córdoba (no incluir IIBB en el precio). | Confirmar la exención y cómo se declara. | |
| 3.3 | Contribución municipal (Córdoba Capital): vacía. | Si corresponde y con qué alícuota. | |

# 4. Plan de cuentas

| # | Qué hace hoy el sistema | Qué hay que definir | Respuesta |
|---|---|---|---|
| 4.1 | Plan borrador para una unipersonal RI de servicios viales (activo, pasivo, patrimonio neto, ingresos, costos de obra y gastos). | Plan de cuentas definitivo (se edita desde Configuración, sin tocar el programa). | |
| 4.2 | Una sola cuenta "Banco cuenta corriente" para todos los bancos. | ¿Una subcuenta por banco? | |
| 4.3 | Ejercicio del 1/1 al 31/12. | Fecha de cierre del ejercicio. | |
| 4.4 | Los saldos iniciales al inicio del sistema se cargan con un asiento manual. | Saldos iniciales (bancos, deudas, créditos, capital). | |

# 5. Imputaciones contables

El sistema arma solo los asientos de cada factura, cobranza, compra, pago, movimiento de caja y cheque. Qué cuenta usa cada concepto está en **Contabilidad → Configuración** (38 conceptos).

| # | Qué hace hoy el sistema | Qué hay que definir | Respuesta |
|---|---|---|---|
| 5.1 | Anticipo financiero facturado → "Anticipos de clientes" (pasivo). | Cuenta del anticipo. | |
| 5.2 | Multas descontadas por nota de crédito → "Multas contractuales" (gasto). | Cuenta de las multas. | |
| 5.3 | Fondo de reparo retenido → "Fondo de reparo a cobrar". | Confirmar. | |
| 5.4 | Compras: al costo de obra por rubro (materiales, mano de obra, equipos, subcontratos, otros). Los materiales que entran al stock no tienen asiento de consumo. | ¿Registrar contablemente el stock y los consumos (bienes de cambio)? | |
| 5.5 | Impuesto a los débitos y créditos → gasto; la alícuota está vacía, así que no se calcula. | Alícuota y si se computa como pago a cuenta de Ganancias. | |
| 5.6 | Gastos bancarios por cheques rechazados → gastos bancarios. | Confirmar. | |

# 6. Ajuste por inflación

| # | Qué hace hoy el sistema | Qué hay que definir | Respuesta |
|---|---|---|---|
| 6.1 | **No se calcula.** Los balances lo aclaran en cada reporte y el cierre de ejercicio lo advierte. | Si corresponde el ajuste por inflación contable e impositivo, y cómo se registra (asiento manual al cierre). | |

# 7. Condición de agente de retención

| # | Qué hace hoy el sistema | Qué hay que definir | Respuesta |
|---|---|---|---|
| 7.1 | **Desactivado:** el sistema no deja cargar retenciones en los pagos a proveedores. Las alícuotas (Ganancias, IVA, IIBB Córdoba, SUSS) están vacías. | ¿MADEWORK está designado como agente de retención en algún impuesto? Desde qué fecha y con qué alícuotas. | |
| 7.2 | Si se activa, las retenciones practicadas van a "Retenciones practicadas a depositar". | Cómo y cuándo se depositan (SICORE / SIRCAR). | |

# 8. Libro IVA Digital

| # | Qué hace hoy el sistema | Qué hay que definir | Respuesta |
|---|---|---|---|
| 8.1 | Genera en **borrador** los 4 archivos de ancho fijo (comprobantes y alícuotas de ventas y de compras) para importar en ARCA. | Revisar el borrador del primer mes antes de presentar. | |
| 8.2 | Los códigos de tipo de comprobante son los de ARCA (1 Factura A, 3 Nota de crédito A, 6 Factura B, 11 Factura C, etc.). | Confirmar los códigos que usa MADEWORK. | |
| 8.3 | Operaciones exentas y no gravadas: código de operación E o N cuando no hay IVA. | Confirmar el tratamiento. | |

# 9. Costos de obra (gestión)

No afectan a los impuestos, pero conviene acordarlos.

| # | Qué hace hoy el sistema | Qué hay que definir | Respuesta |
|---|---|---|---|
| 9.1 | El costo por persona es el que se carga por jornal u hora. | Qué incluir: sueldo, cargas sociales, ART, aguinaldo y vacaciones proporcionales. | |
| 9.2 | Costo por hora de los equipos propios: el que se carga. | Amortización, seguro y combustible estimados por hora. | |
| 9.3 | Indirectos prorrateados por costo directo del mes (o por monto del contrato, partes iguales o porcentajes). | Regla para cada tipo de indirecto. | |
| 9.4 | Stock valuado a costo promedio ponderado. | Confirmar (alternativa: último precio de compra). | |
| 9.5 | Fecha de pago del cliente: "primer viernes siguiente a los 15 días" de la factura. | Confirmar la interpretación. | |

# Cómo se cargan las respuestas

- **Valores** (alícuotas, agente de retención): Configuración → Parámetros fiscales → Nueva vigencia.
- **Cuentas**: Configuración → Plan de cuentas.
- **A qué cuenta va cada concepto**: Contabilidad → Configuración. Si se cambia algo con meses abiertos, **Regenerar asientos de un período**.
- **Saldos iniciales y ajuste por inflación**: Contabilidad → + Asiento manual.
