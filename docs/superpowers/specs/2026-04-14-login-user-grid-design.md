# Rediseño de Gestión de Usuarios y Login

## 1. Contexto y Objetivos
El objetivo principal es rediseñar y modernizar el menú de selección de operarios (Login) de la aplicación "Control de Reproceso". Las instalaciones utilizan pantallas táctiles, por lo que es vital evitar problemas causados por barras de desplazamiento finas y elementos difíciles de seleccionar con los dedos.

Buscaremos una máxima densidad visual con elementos lo suficientemente grandes para minimizar la necesidad de scroll, y en caso de haber scroll, hacerlo extremadamente notorio y amigable al tacto.

## 2. Decisiones de Diseño

### Pantalla de Login (User Picker)
- **Densidad Optimizada**: Se mostrarán las opciones de usuarios en formato cuadrícula (grid) compacto, logrando hasta 16-20 operarios en pantalla a la vez.
- **Tamaños "Touch-Friendly"**: Cada tarjeta tendrá la altura y anchura suficiente para que sea cómodo presionarlas (Avatares y contenedores grandes, mínimo 60px de alto). 
- **Estética Premium y Moderna**:
  - Bordes redondeados (radius de 14px a 20px).
  - Avatares de 40 a 64px con iniciales y fondos degradados (distintos colores basados en hash del nombre).
  - Efectos visuales de hover (útiles en escritorio, sutiles pulsaciones en táctil) y glassmorphism (transparencias).
- **Control del Scroll**: Modificación visual (CSS) radical de la barra de desplazamiento (`::-webkit-scrollbar`) dentro de `.user-picker-sections` para hacerla mucho más gruesa (ej. 12-16px) y contrastante.
- **Información Prominente**: Solamente Nombre y Rol (Maestro/Operario).

### Opciones y Buscador
- El **buscador** deberá mantenerse igual de accesible y funcional al inicio del menú de usuarios, rediseñado con bordes redondeados y campo de texto grande, para que presionar y usar un teclado virtual sea sencillo.
- En una futura iteración (si la lista crece a cientos de usuarios) se podrían agregar botones de filtrado (Todos, Maestro, Operario). 

## 3. Implementación Propuesta

### CSS (`static/css/login.css`)
- Reemplazar estilos actuales de `.user-picker-grid` para reducir márgenes e `gap`, permitiendo columnas de `minmax(70px, 1fr)` a `minmax(110px, 1fr)` según se adapte a lograr 4-5 columnas.
- Crear/Ajustar `.user-card-picker` (tarjetas pequeñas o medianas compactas).
- Personalizar el `::-webkit-scrollbar` del contenedor `.user-picker-sections` para una barra ancha, color visible (ej. `#6366f1` base oscura y barra de desplazamiento visible).

### JS (`static/js/ui.js` -> `renderUserPicker`)
- Simplificar la generación y aplicar las clases correspondientes acorde a la actualización CSS. No debe haber cambios en la lógica de estados ni roles, únicamente en el renderizado en la página principal.
- Mantener la extracción de colores dinámicos: `getAvatarColor(name)`

## 4. Tareas (Planificación)
- Ajustar `login.css` (añadir scroll táctil grueso y ajustar grilla).
- Ajustar la maqueta base `index.html` (si es necesario por estructura de `.user-picker`).
- Validar las funciones responsivas.
