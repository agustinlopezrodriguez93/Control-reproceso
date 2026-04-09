# Diseño: Selector de Usuarios (User Picker) en Login

Este documento describe la especificación para añadir un selector visual de usuarios en la pantalla de inicio de sesión de "Control Megamarket". El objetivo es facilitar el acceso rápido a la aplicación sin necesidad de que los operarios escriban manualmente su nombre cada vez que inicien sesión.

## 1. Cambios en el Backend (API y Base de Datos)

### 1.1 Usuario Admin
- **Nombre:** Se renombrará el usuario `Maestro` a `Admin` en el script de inicialización de la base de datos (`db.py`).
- **Contraseña:** Se asignará `mega123` como la clave por defecto para el usuario `Admin`. El usuario `admin` (alternativo) conservará `admin123`.

### 1.2 Nuevo API Endpoint: Lista Pública de Usuarios
- **Endpoint:** `GET /api/users-public`
- **Autenticación:** Ninguna (Público).
- **Respuesta:** Una lista de objetos de usuario con campos: `id`, `nombre`, `rol`, `avatar`. NO se devolverá `password_hash`.
- **Propósito:** Permitir que la interfaz de inicio de sesión obtenga la lista de usuarios para mostrar en la cuadrícula de avatares antes de iniciar sesión.

## 2. Cambios en el Frontend (IU y Lógica)

### 2.1 Selector de Usuarios (User Picker Grid)
- Se reemplazará el campo de texto de "USUARIO" con una cuadrícula de avatares (`user-picker-grid`).
- Cada tarjeta de usuario mostrará un círculo de color (basado en sus iniciales o rol) y el nombre debajo.
- Al cargar la página de inicio de sesión, se llamará automáticamente a `/api/users-public` para suministrar la lista de usuarios.

### 2.2 Flujo de Interacción
1.  **Selección:** El usuario hace clic en su avatar de usuario en la cuadrícula.
2.  **Transición:** La cuadrícula de usuarios se oculta mediante una transición suave.
3.  **Contraseña:** Se muestra un único campo de contraseña para el usuario seleccionado.
4.  **Indicador de Sesión:** Aparecerá un subtítulo indicando qué usuario está a punto de entrar (ej. "Ingresando como Admin").
5.  **Botón Volver:** Un botón pequeño o flecha permitirá regresar a la selección de usuarios generales si un usuario se equivocó.

### 2.3 Estilos (CSS)
- Añadir estilos para `.user-avatar-grid`, `.user-card`, y estados activados para mejorar la apariencia visual de la cuadrícula.
- Asegurar que la cuadrícula se adapte a dispositivos móviles (responsive).

## 3. Seguridad
- El endpoint público no expondrá campos sensibles.
- El hashing de contraseñas por bcrypt se mantiene igual durante el proceso de login.

## 4. Verificación y Pruebas
- Se creará un agente especializado para implementar los cambios en el código (backend, frontend, estilos).
- Se creará un segundo agente (Independiente) para realizar pruebas de integración:
    - Verificar que los usuarios se carguen correctamente.
    - Probar que el login con Admin/mega123 funcione.
    - Confirmar que la navegación entre selección de usuario y contraseña sea correcta.
