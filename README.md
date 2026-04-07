# Control de Reproceso SKU — Megamarket

Sistema web interno para digitalizar y supervisar el flujo de trabajo de reproceso de SKUs en planta. Permite a los operarios registrar el ciclo de vida de cada proceso (crear, iniciar, pausar, reanudar, finalizar) y al supervisor (Maestro) tener visibilidad total en tiempo real con KPIs, graficos de rendimiento y registro de auditoria.

---

## Descripcion del proyecto

La aplicacion reemplaza el control manual en papel del reproceso de SKUs. Cada operario gestiona sus procesos de forma independiente desde una interfaz web, mientras que el Maestro supervisa el estado global de la planta, consulta estadisticas de rendimiento por operario y administra los usuarios del sistema.

El dato central que se gestiona es el **proceso de reproceso**: asocia un operario con un SKU destino y registra con precision el tiempo activo (descontando pausas), el estado en cada momento y si la tarea es urgente.

La aplicacion es una **SPA (Single Page Application)** construida con Vanilla JS en el frontend y una API REST construida con FastAPI en el backend. Los datos persisten en PostgreSQL (alojado en Railway).

---

## Tecnologias usadas

| Capa | Tecnologia | Version recomendada |
|---|---|---|
| Backend | Python + FastAPI | Python 3.11+, FastAPI 0.100+ |
| Servidor ASGI | Uvicorn | Ultima estable |
| Base de datos | PostgreSQL | 14+ (alojado en Railway) |
| Driver DB | psycopg2-binary | 2.9+ |
| Autenticacion | JWT (python-jose) + bcrypt (passlib) | - |
| Templates HTML | Jinja2 | - |
| Variables de entorno | python-dotenv | - |
| Frontend | Vanilla JS (ES6+), HTML5, CSS3 | Sin framework |
| Graficos | Chart.js | CDN |
| Tipografia | Inter | Google Fonts CDN |

---

## Requisitos previos

- **Python 3.11 o superior** instalado y disponible en el PATH del sistema
- **pip** actualizado (`python -m pip install --upgrade pip`)
- **Acceso a internet** para conectar con la base de datos remota en Railway y cargar fuentes/graficos desde CDN
- Archivo **`.env`** configurado con `DATABASE_URL` y `SECRET_KEY` (ver seccion Variables de entorno)

No se necesita instalar PostgreSQL localmente: la base de datos es completamente remota.

---

## Instalacion paso a paso

### 1. Obtener el proyecto

Asegurarse de tener todos los archivos en la carpeta del proyecto. La estructura esperada es la indicada en la seccion "Estructura del proyecto" mas abajo.

### 2. Crear y activar un entorno virtual (recomendado)

```bash
# Crear el entorno virtual
python -m venv venv

# Activar en Windows (CMD o PowerShell)
venv\Scripts\activate

# Activar en macOS / Linux
source venv/bin/activate
```

### 3. Instalar dependencias

Con el entorno virtual activado:

```bash
pip install -r requirements.txt
```

Las dependencias que se instalan son:

| Paquete | Para que sirve |
|---|---|
| `fastapi` | Framework web del backend |
| `uvicorn` | Servidor ASGI que ejecuta FastAPI |
| `jinja2` | Motor de templates para el HTML |
| `aiofiles` | Lectura de archivos estaticos asincrona |
| `psycopg2-binary` | Driver para conectar con PostgreSQL |
| `python-dotenv` | Carga variables desde el archivo `.env` |
| `passlib[bcrypt]` | Hashing seguro de contrasenas con bcrypt |
| `python-multipart` | Necesario para recibir formularios OAuth2 |
| `python-jose[cryptography]` | Generacion y verificacion de tokens JWT |

### 4. Configurar el archivo `.env`

Crear el archivo `.env` en la raiz del proyecto (misma carpeta que `main.py`) con el siguiente contenido:

```env
DATABASE_URL=postgresql://usuario:contrasena@host:puerto/nombre_bd
SECRET_KEY=una-clave-secreta-muy-larga-y-aleatoria-minimo-32-caracteres
```

Ver la seccion **Variables de entorno** para mas detalles.

**Importante:** Si `SECRET_KEY` no esta definida, el servidor no arrancara y mostrara un error critico.

---

## Ejecucion

### Opcion rapida en Windows

Hacer doble clic en `INICIAR_CONTROL.bat`. El script automaticamente:
1. Abre el navegador en `http://localhost:8000`
2. Lanza el servidor FastAPI con Uvicorn en el puerto 8000

No cerrar la ventana de consola mientras el sistema este en uso.

### Opcion manual (cualquier sistema operativo)

```bash
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Luego abrir el navegador en: **http://localhost:8000**

### Verificar la conexion a la base de datos (opcional)

Antes de arrancar el servidor, se puede verificar la conexion y el estado de las tablas ejecutando:

```bash
python debug_db.py
```

Este script comprueba que `DATABASE_URL` sea valida, que las tablas existan y que la autenticacion funcione correctamente.

### Documentacion interactiva de la API

Con el servidor corriendo, acceder a **http://localhost:8000/docs** para ver el Swagger UI generado automaticamente por FastAPI, donde se pueden probar todos los endpoints.

---

## Usuarios por defecto del sistema

Al iniciar por primera vez con la base de datos vacia, el sistema crea automaticamente los siguientes usuarios:

| Usuario | Contrasena | Rol | Descripcion |
|---|---|---|---|
| `Maestro` | `1234` | Maestro | Supervisor principal con acceso total |
| `Usuario 1` | `1234` | Operario | Operario de planta |
| `Usuario 2` | `1234` | Operario | Operario de planta |
| `Usuario 3` | `1234` | Operario | Operario de planta |
| `admin` | `admin123` | Maestro | Usuario de administracion alternativo |
| `viewer` | `viewer123` | Operario | Usuario de prueba con rol Operario |

Los usuarios se pueden crear y eliminar desde el panel de **Gestion de Usuarios** del perfil Maestro. Las contrasenas se almacenan hasheadas con bcrypt; no se guardan en texto plano en ningun momento.

---

## Funcionalidades principales

### Perfil Operario

- **Autenticacion con contrasena**: login por usuario y contrasena, token JWT almacenado en sesion del navegador con vigencia de 24 horas.
- **Dashboard de procesos**: vista filtrada mostrando solo los procesos asignados al operario autenticado, ordenados por urgencia y fecha.
- **Crear proceso**: seleccion visual de SKU destino desde una grilla con imagenes reales del producto. Si no existe la imagen, el sistema genera un placeholder con el codigo del SKU.
- **Ciclo de vida del proceso**: cada proceso transita por los estados `CREADO → INICIADO → PAUSADO → INICIADO → FINALIZADO`. Los tiempos de cada pausa se registran individualmente.
- **Urgencia**: un proceso puede marcarse como urgente con un solo clic. Los procesos urgentes aparecen en la parte superior de la tabla con un borde ambar y activan un indicador pulsante en el encabezado de la aplicacion.
- **Conflicto de procesos activos**: el sistema impide que un operario tenga dos procesos en estado `INICIADO` de forma simultanea. Para iniciar o reanudar un proceso se debe primero pausar el que este activo.
- **Vista de detalle del proceso**: estado actual, hora de inicio, operario responsable y botones de accion contextuales segun el estado del proceso.

### Perfil Maestro

Todas las funcionalidades del Operario, mas:

- **Vista global de procesos**: tabla con todos los procesos de todos los operarios sin filtro por usuario.
- **Modulo de rendimiento (Analytics)** — exclusivo del Maestro:
  - KPIs globales: procesos activos, terminados hoy, tiempo promedio de tarea en minutos, urgencias pendientes.
  - Grafico comparativo de eficiencia (minutos por tarea) de cada operario vs. promedio general (Chart.js, tipo barra).
  - Distribucion de SKUs procesados (grafico de dona, top 5 SKUs).
  - Ranking de productividad por operario: procesos completados, porcentaje de rendimiento y tiempo promedio.
  - Drill-down por operario: metricas individuales comparadas contra el promedio global, con desglose por SKU.
- **Gestion de usuarios**: alta y baja de operarios con nombre, contrasena, rol y avatar.
- **Registro de auditoria**: log de las ultimas 100 acciones del sistema con timestamp y usuario responsable. Registra: logins (exitosos y fallidos), creacion y cambio de estado de procesos, alta y baja de usuarios.

---

## Estructura del proyecto

```
sku-consolidation-demo/
├── main.py                  # Punto de entrada: crea la app FastAPI, monta rutas, static files y templates
├── auth.py                  # Seguridad: hashing bcrypt, generacion/validacion JWT, rate limiting por IP
├── db.py                    # Capa de datos: schema PostgreSQL, init_db y todas las funciones de consulta/escritura
├── debug_db.py              # Utilidad de diagnostico: verifica la conexion a la BD y la autenticacion
├── config.json              # Datos mock de referencia (SKUs, usuarios, procesos de ejemplo para desarrollo)
├── requirements.txt         # Dependencias Python del proyecto
├── INICIAR_CONTROL.bat      # Script de inicio rapido para Windows (abre el navegador y lanza el servidor)
├── .env                     # Variables de entorno locales (DATABASE_URL, SECRET_KEY) — NO versionar
├── .gitignore               # Archivos excluidos del control de versiones
│
├── api/
│   ├── __init__.py          # Hace de 'api' un paquete Python
│   └── endpoints.py         # Todos los endpoints REST de la API (/api/login, /api/procesos, /api/users, etc.)
│
├── templates/
│   └── index.html           # Shell HTML de la SPA (servido por Jinja2 al acceder a "/")
│
├── static/
│   ├── app.js               # Logica frontend completa: helper de API, gestion de UI, estado, graficos Chart.js
│   ├── app.css              # Estilos: tema oscuro premium, componentes, layout responsive
│   ├── image.png            # Logo de la aplicacion mostrado en el encabezado
│   └── Imagenes/            # Fotografias de los SKUs (ej: GCMD.jpg, SEKOF.png). El nombre del archivo debe coincidir con el codigo del SKU.
│
├── Imagenes/                # Copia de imagenes en raiz (legacy, se recomienda usar static/Imagenes/)
├── README.md                # Este archivo — documentacion principal del proyecto
├── README_CSS.md            # Guia detallada de la estructura del archivo CSS
└── PITCH_ANALYSIS.md        # Analisis funcional completo de la aplicacion
```

---

## API REST — Resumen de endpoints

Todos los endpoints requieren autenticacion con Bearer JWT en el header `Authorization`, excepto `/api/login`.

| Metodo | Ruta | Descripcion | Rol requerido |
|---|---|---|---|
| `POST` | `/api/login` | Autenticacion, devuelve token JWT y datos del usuario | Todos |
| `GET` | `/api/me` | Datos del usuario autenticado (id, nombre, rol, avatar) | Todos |
| `GET` | `/api/config` | Lista de usuarios y SKUs disponibles para formularios | Todos |
| `GET` | `/api/procesos` | Listar procesos, filtrable con `?operario=<nombre>` | Todos |
| `GET` | `/api/procesos/{id}` | Detalle de un proceso por ID (con historial de pausas) | Todos |
| `POST` | `/api/procesos` | Crear nuevo proceso (operario, sku_destino, es_urgente) | Todos |
| `PUT` | `/api/procesos/{id}` | Cambiar estado del proceso: `start`, `pause`, `resume`, `finish` | Todos |
| `GET` | `/api/performance` | Ranking de rendimiento por operario | Solo Maestro |
| `GET` | `/api/dashboard/kpis` | KPIs globales del dashboard (activos, terminados hoy, etc.) | Solo Maestro |
| `GET` | `/api/dashboard/operator/{id}` | KPIs detallados de un operario especifico vs. promedio global | Solo Maestro |
| `GET` | `/api/users` | Listar todos los usuarios del sistema | Solo Maestro |
| `POST` | `/api/users` | Crear nuevo usuario (nombre, password, rol, avatar) | Solo Maestro |
| `DELETE` | `/api/users/{id}` | Eliminar usuario por ID | Solo Maestro |
| `GET` | `/api/audit` | Registro de auditoria (ultimas 100 acciones) | Solo Maestro |

El endpoint `/api/login` acepta datos en formato `application/x-www-form-urlencoded` (estandar OAuth2), no JSON.

---

## Variables de entorno

El archivo `.env` en la raiz del proyecto debe contener las siguientes variables:

| Variable | Descripcion | Ejemplo |
|---|---|---|
| `DATABASE_URL` | URL de conexion completa a la base de datos PostgreSQL | `postgresql://user:pass@host:5432/dbname` |
| `SECRET_KEY` | Clave secreta para firmar los tokens JWT. Debe ser una cadena larga y aleatoria. | `mi-clave-super-secreta-de-produccion-2024` |

Ejemplo de archivo `.env` completo:

```env
DATABASE_URL=postgresql://myuser:mypassword@myhost.railway.app:5432/railway
SECRET_KEY=una-cadena-aleatoria-muy-larga-y-segura-aqui
```

**Notas de seguridad:**
- El archivo `.env` **no debe subirse al repositorio** (debe estar en `.gitignore`).
- Si `SECRET_KEY` no esta definida, el servidor lanza un `RuntimeError` y no arranca. No existe valor por defecto inseguro.
- Si `DATABASE_URL` no esta definida, cualquier operacion que acceda a la base de datos lanzara un `ConnectionError`.
- Los tokens JWT tienen una duracion de **24 horas** (configurable en `auth.py`, constante `ACCESS_TOKEN_EXPIRE_MINUTES`).

---

## Base de datos

La base de datos se inicializa automaticamente al arrancar el servidor (funcion `init_db` en `db.py`). Si las tablas no existen, se crean. Si estan vacias, se insertan datos de ejemplo.

### Tablas

| Tabla | Descripcion |
|---|---|
| `reproceso_usuarios` | Usuarios del sistema: operarios y maestros, con contrasena hasheada y avatar |
| `reproceso_skus` | Catalogo de codigos SKU disponibles para asignar a procesos |
| `reproceso_procesos` | Procesos de reproceso con su estado, timestamps y si es urgente |
| `reproceso_pausas` | Registro individual de cada pausa por proceso (inicio y fin) |
| `reproceso_audit_logs` | Log de auditoria de todas las acciones del sistema |

### Inicializacion automatica

Al arrancar por primera vez con tablas vacias:
- Se crean los **6 usuarios por defecto** (ver tabla en seccion "Usuarios por defecto del sistema").
- Se insertan los **19 SKUs del catalogo base**: GCMD, GGAL070, IMOCA, IMOCP, MCCE, SCCA, SECC090, SECPI, SEKOF, SEKQB, SEKRN, SEPASP, SEPC, SEPEIC, SEPOD, SEPOF, SESCD, SGEP, SKPXL.

Si la tabla ya tiene datos, el sistema solo se asegura de que los usuarios `admin` y `viewer` existan.

### Migracion automatica

Si se detecta que la columna `password_hash` no existe en `reproceso_usuarios` (instalaciones antiguas), se agrega automaticamente mediante `ALTER TABLE`.

---

## Notas de desarrollo

- El frontend es una SPA pura en **Vanilla JS**. No usa ningun framework (React, Vue, etc.). La navegacion entre vistas se realiza mostrando y ocultando secciones HTML.
- El rate limiting de login es **en memoria** (no persistente). Se reinicia al reiniciar el servidor. Configuracion en `auth.py`: `MAX_ATTEMPTS = 10` intentos fallidos en una ventana de `BLOCK_WINDOW_SECONDS = 300` segundos (5 minutos).
- Un operario **no puede tener dos procesos en estado `INICIADO` simultaneamente**. El sistema valida esto en el endpoint `PUT /api/procesos/{id}` antes de permitir `start` o `resume`.
- El selector visual de SKU busca imagenes en `/static/Imagenes/{CODIGO}.jpg` y `/static/Imagenes/{CODIGO}.png`. Si no encuentra la imagen, renderiza un placeholder con el codigo del SKU como texto.
- Los tiempos de pausa se guardan individualmente en `reproceso_pausas`, lo que permite calcular el tiempo efectivo de trabajo descontando cada pausa de forma precisa.
