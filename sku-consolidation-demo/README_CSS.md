# Guía de Estilos CSS

Este documento explica la estructura y funcionalidad del archivo `style.css` de la aplicación.

## 1. Variables Globales (`:root`)
- Define la paleta de colores (oscuros y premium).
- Variables para bordes, sombras y radios.
- Facilita el cambio de tema en toda la app.

## 2. Reset y Base
- `*`: Reseteo de márgenes y padding.
- `body`: Configuración de fuente, color de fondo oscuro y estructura flex para el layout principal.

## 3. Utilidades (`.btn`, `.hidden`, etc.)
- Clases genéricas reutilizables.
- Botones con diferentes variantes (primary, ghost, success, warning, danger).

## 4. Header (`.app-header`)
- Barra superior con el logo y el perfil de usuario.
- Indicador de "Urgencia" pulzante.

## 5. Layout Principal (`#app-container`)
- Contenedor central que limita el ancho máximo del contenido.
- `.view`: Clases para manejar la transición entre pantallas (Login, Dashboard, Detalle).

## 6. Componentes UI
- **Tarjetas (`.card`)**: Contenedores con fondo oscuro y borde sutil.
- **Tablas (`.data-table`)**: Estilos para la lista de procesos.
- **Badges (`.badge`)**: Etiquetas de estado (Creado, Iniciado, Pausado, Finalizado).
- **Formularios**: Inputs estilizados y mensajes de error.

## 7. Vista de Detalle
- Paneles de información y estado.
- Badges grandes para el estado actual del proceso.

## 8. Vista de Login / Selección de Usuario (Líneas ~700+)
- **`.login-container`**: Centra el título y el subtítulo.
- **`.user-grid`**: Grid flexible para mostrar las opciones de usuario.
- **`.user-card`**: Tarjeta interactiva para cada usuario.
  - Efectos de hover (elevación y brillo).
- **`.avatar-lg`**: Círculo grande con las iniciales del usuario.
- **`#view-login`**: Regla especial para centrar todo el contenido vertical y horizontalmente en la pantalla.

## 9. Modales y Notificaciones
- `modal-overlay`: Fondo oscuro para las alertas de confirmación.
- `snackbar`: Notificaciones flotantes en la esquina superior derecha.
