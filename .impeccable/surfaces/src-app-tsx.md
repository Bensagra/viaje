---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles.css","src/components/Summary.tsx","src/components/Wallet.tsx","src/components/Packing.tsx","src/components/ExpenseList.tsx","src/components/Settle.tsx","src/components/AddPanel.tsx","src/components/Receipts.tsx","src/components/Settings.tsx","src/components/Login.tsx"]
---

# Surface: la app completa (shell + 8 pestañas) · modo Operate · celular primero

Visitante: Benyi o Santi, de pie, con el teléfono, con apuro y a veces poca luz. Tarea: saber quién le debe a quién, cargar un ticket, mostrar el pase que toca, armar la valija. Debe quedar igual: las pestañas de siempre (ahora con Equipaje entre Wallet y Gastos), el modo oscuro que sigue al teléfono, la Wallet abriendo sin red.

## Direction contract

THESIS: Cada gasto, pase y bolso lleva la lengüeta de color de su dueño: la app se lee como la cinta de equipaje, no como una planilla. Rechaza la lista de tarjetas blancas con avatares (Splitwise) y la tarjeta hero-métrica de número grande con etiqueta chica.

OWN-WORLD: Stock sintético mate: cobalto #1446d8 (Benyi), naranja seguridad #ff6a13 (Santi), amarillo standby #ffd400 (pendiente), rojo #d7263d (alerta); tinta #0b0b0b sobre gris de piso #eef0f3; de noche, cinta #141517 con tinta #f2f3f4 y ningún blanco salvo el código. En gráficos, las marcas de noche suben un paso (#5a82f0 / #e8661f). Barlow para la interfaz, Barlow Semi Condensed 700 para cifras, códigos y rutas; tabulares solo en columnas. Etiquetas de borde fino con lengüeta (ojal + perforado punteado), banda de código de barras como firma, botones de tinta, foco amarillo, sin degradados.

STORY: Ve al instante quién le debe a quién y cuánto, el ritmo de gasto del viaje sin lo pre-viaje, y los últimos gastos con su dueño; salda, carga un ticket, abre el pase de hoy o tilda lo que ya guardó y dónde.

FIRST VIEWPORT: Barra con el viaje, la línea "Faltan N días / Día N de M" y las 8 pestañas con ícono (fila desplazable en el celular). Si el viaje no tiene fechas, arriba de todo la propuesta de un toque sacada de los pases. La etiqueta del saldo a todo el ancho en el stock de quien debe: ojal, "Benyi le debe a Santi", cifra de 56 px, banda de código, fila [Registrar pago] [Cargar ticket]. Celdas: gasto total, por día, pre-viaje, presupuesto. Después: hoy en la Wallet, "Para revisar" en una sola lista, últimos gastos como etiquetas, y los gráficos (frente a frente, en qué se fue, ritmo por día) con sus tablas plegadas.

FORM: Etiqueta de valija IATA, candidato 3 de 7 en mi lista ordenada; seed:4e178f3c29f1ea74. Movida distintiva: la lengüeta de dueño en todas las pantallas (compartido = lengüeta partida; sin asignar = lengüeta vacía punteada). Interacción firma: en la Wallet los pases del día se apilan como en la billetera del teléfono y el tocado se estira hasta el pase a pantalla completa (View Transitions, 400 ms), se desliza de costado entre pases y "atrás" lo devuelve a su lugar en la pila. En Equipaje cada bolso es una etiqueta con la lengüeta de quien lo lleva y la banda de código es el progreso (una barra por cosa, llena al guardarla). Motion: una etiqueta nueva "cae en la cinta" (desde la derecha, 280 ms); todo respeta reduced-motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
