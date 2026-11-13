---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles.css","src/components/Summary.tsx","src/components/Wallet.tsx","src/components/ExpenseList.tsx","src/components/Settle.tsx","src/components/AddPanel.tsx","src/components/Receipts.tsx","src/components/Settings.tsx","src/components/Login.tsx"]
---

# Surface: la app completa (shell + 7 pestañas) · modo Operate · celular primero

Visitante: Benyi o Santi, de pie, con el teléfono, con apuro y a veces poca luz. Tarea: saber quién le debe a quién, cargar un ticket, mostrar el pase que toca. Debe quedar igual: las 7 pestañas, el modo oscuro que sigue al teléfono, la Wallet abriendo sin red.

## Direction contract

THESIS: Cada gasto y cada pase lleva la lengüeta de color de su dueño: la app se lee como la cinta de equipaje, no como una planilla. Rechaza la lista de tarjetas blancas con avatares (Splitwise) y la tarjeta hero-métrica de número grande con etiqueta chica.

OWN-WORLD: Stock sintético mate: cobalto #1446d8 (Benyi), naranja seguridad #ff6a13 (Santi), amarillo standby #ffd400 (pendiente), rojo #d7263d (alerta); tinta #0b0b0b sobre gris de piso #eef0f3; de noche, cinta #141517 con tinta #f2f3f4 y ningún blanco salvo el código. Barlow para la interfaz, Barlow Semi Condensed 700 para cifras, códigos y rutas, numerales tabulares. Etiquetas de borde fino con lengüeta (ojal + perforado punteado), banda de código de barras como firma, botones de tinta, foco amarillo, sin degradados.

STORY: Ve al instante quién le debe a quién y cuánto, el ritmo de gasto del viaje sin lo pre-viaje, y los últimos gastos con su dueño; salda, carga un ticket o abre el pase de hoy.

FIRST VIEWPORT: Barra con el viaje y las 7 pestañas con ícono (fila desplazable en el celular). La etiqueta del saldo a todo el ancho en el stock de quien debe: ojal, "Benyi le debe a Santi", cifra de 56 px, banda de código. Fila [Registrar pago] [Cargar ticket]. Tira de tres celdas: gasto total, pre-viaje, por día. Lista "Últimos gastos" como etiquetas con lengüeta de dueño, fecha, concepto y monto tabular. En desktop la etiqueta y las celdas van lado a lado y abajo siguen la tabla comparativa y los desgloses.

FORM: Etiqueta de valija IATA, candidato 3 de 7 en mi lista ordenada; seed:4e178f3c29f1ea74. Movida distintiva: la lengüeta de dueño en todas las pantallas (compartido = lengüeta partida en los dos colores; sin asignar = lengüeta vacía punteada). Motion: una etiqueta nueva "cae en la cinta" (entra desde la derecha, 240 ms, ease-out); respeta reduced-motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
