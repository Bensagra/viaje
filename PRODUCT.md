# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dos amigos de Buenos Aires de poco más de veinte años (tarifas joven, carné ISIC): Benyi, que administra, y Santi. Viajan juntos por Europa del 15/01/2027 al 04/02/2027: Roma → Venecia → Berlín → Milán → Génova → Mónaco → Cannes → París → Barcelona → Madrid. Usan la app en el celular y de pie: en un andén a las 05:50 mostrando un QR, en un bar después de pagar sacándole una foto al ticket, de noche en el hostel viendo quién le debe a quién. Antes del viaje la usan sentados, cargando reservas y gastos en dólares con tarjeta argentina. Son exactamente dos; no hay terceros ni grupos.

## Product Purpose

Que los gastos compartidos queden claros sin discutir (quién pagó, cuánto le corresponde a cada uno, quién le debe a quién) y que todos los pases y reservas estén en un solo lugar, ordenados por día y por persona, con el código listo para escanear aun sin conexión. Éxito: al final del viaje saldan con un solo número confiable y nunca buscaron un PDF en el mail en la puerta de embarque.

## Positioning

A diferencia de un divisor de gastos genérico, la app verifica quién pagó con los últimos 4 dígitos de la tarjeta impresos en el ticket, lee tickets y pases (OCR en el dispositivo o Claude), divide un PDF con los pases de los dos en el pase de cada uno reconociendo nombres reales vs. apodos, y junta la cuenta con la Wallet del viaje. Es de dos personas, por diseño.

## Operating Context

- Celular primero (PWA instalable, offline con service worker y caché de documentos); desktop para cargar PDFs y revisar.
- Modo claro y oscuro siguiendo el ajuste del teléfono (requisito del usuario).
- Documentos reales: tarjetas de embarque (BCBP Aztec/PDF417), QR de Trenitalia/Italo/OUIGO/SNCF/ATVO, vouchers de hoteles (Agoda/Booking), entradas (Torre Eiffel), capturas de Ryanair/Wizz Air.
- Moneda base USD; gastos en EUR/ARS con cotización (dólar tarjeta). Español rioplatense (voseo) en toda la interfaz.
- Datos en Supabase (auth, RLS, storage privado, realtime). Fase actual: pre-viaje, con 26 pases cargados y los gastos de las reservas.

## Capabilities and Constraints

- Pestañas fijas (requisito del usuario): Resumen, Wallet, Gastos, Cargar, Facturas, Saldar, Config.
- Gastos: carga por foto/PDF con lectura automática, carga manual, borradores pendientes de revisar, división 50/50 u otra, verificación por tarjeta (coincide / es de la otra persona / no registrada / sin dato), cotizaciones, pagos entre ellos, exportar CSV y backup JSON.
- Resumen: saldo, totales, promedio por día contando solo los días de viaje (lo anterior a la ida es "pre-viaje"), presupuesto, desgloses por categoría, día, moneda y medio de pago.
- Wallet: pases por día y persona, código en pantalla completa siempre sobre blanco, documento original adentro de la app, PDF por persona, releer con IA.
- Dos personas exactamente; una persona = un color estable en toda la app; "ambos" es neutro.
- La Wallet tiene que abrir sin red: fuentes y assets del sistema o servidos por la propia app, nunca de un CDN.
- Terminología: pase, reserva, ticket, comprobante, pendiente, "le corresponde", saldo, "a mano", pre-viaje.

## Brand Commitments

Nombre de la app: "Gastos del viaje" ("Las PU-TITAS" es el nombre del viaje, no de la app). Ícono actual: valija/ticket sobre teal #0f766e, reemplazable. Voz: directa, rioplatense, sin solemnidad ("Están a mano", "Ojo:"). Nada más está fijado; el look actual (system-ui, teal, tarjetas blancas) es evidencia, no autoridad.

## Evidence on Hand

- 26 documentos reales en la base (vuelos, trenes, hoteles, bus, entradas) y 19 gastos confirmados en USD.
- Los PDFs reales están en ~/Downloads/viaje (no se copian al repo).
- No hay logo, fotos ni testimonios: no inventar ninguno.

## Product Principles

1. Útil primero: cada pantalla responde una pregunta concreta (¿quién debe?, ¿qué pase va ahora?).
2. Legible de pie: una mano, poca luz, apuro; lo importante grande, lo secundario se pliega.
3. Honesto con los números: tabulares, moneda siempre visible, nunca ocultar qué entra y qué no en un total.
4. Una persona = un color, siempre.
5. Funciona sin conexión y sin IA; la IA mejora la lectura, no condiciona el uso.

## Accessibility & Inclusion

Contraste AA en ambos temas; códigos siempre sobre blanco; nada se informa solo por color (ícono + texto); targets de 44 px en el celular; respeta prefers-reduced-motion.
