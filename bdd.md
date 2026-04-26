# Documentación de Base de Datos: Ami Florería

Esta documentación describe la estructura de la base de datos `ami_floreria_db` utilizada para el proyecto de catálogo digital de flores. La base de datos está implementada sobre **Cloudflare D1 (SQLite)**.

## 1. Diagrama de Relaciones (Lógica)
La base de datos sigue una estructura relacional para gestionar un catálogo de productos categorizados mediante una relación de muchos a muchos.

- **categoria**: Almacena los nombres de las secciones (ej. Ramos, Arreglos Fúnebres, Box).
- **catalogo**: Almacena los detalles de cada producto individual.
- **catalogo_categoria**: Tabla de unión que permite que un producto pertenezca a múltiples categorías.

---

## 2. Definición de Tablas

### 2.1 Tabla: `categoria`
Almacena las categorías disponibles para clasificar los productos.

| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `nombre` | TEXT | PRIMARY KEY | Identificador único y nombre de la categoría. |
| `orden` | INTEGER | NOT NULL | Define la posición visual en la interfaz. |

### 2.2 Tabla: `catalogo`
Contiene la información detallada de los productos/flores.

| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PK, AUTOINCREMENT | Identificador único del producto. |
| `nombre` | TEXT | NOT NULL | Nombre comercial del producto. |
| `descripcion` | TEXT | - | Detalle o composición del arreglo. |
| `imagen_url` | TEXT | - | URL pública de la imagen (Cloudinary). |
| `imagen_delete_url`| TEXT | DEFAULT '' | URL/Token para eliminación de imagen. |
| `imagen_public_id`| TEXT | DEFAULT '' | ID de referencia en Cloudinary. |
| `precio` | REAL | NOT NULL, DEFAULT 0 | Precio de venta al público. |

### 2.3 Tabla: `catalogo_categoria` (Relación M:N)
Gestiona la asociación entre productos y categorías.

| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `catalogo_id` | INTEGER | FK, PK (Compuesta) | Referencia a `catalogo(id)`. |
| `categoria_nombre`| TEXT | FK, PK (Compuesta) | Referencia a `categoria(nombre)`. |

---

## 3. Integridad Referencial y Comportamiento

La base de datos está configurada con **Eliminación en Cascada (ON DELETE CASCADE)** en la tabla de unión:

1. **Borrado de Categoría:** Si se elimina una fila en la tabla `categoria`, todas las asociaciones correspondientes en `catalogo_categoria` se eliminan automáticamente. El producto en `catalogo` permanece intacto.
2. **Borrado de Producto:** Si se elimina un producto en `catalogo`, sus asociaciones en `catalogo_categoria` se limpian automáticamente, evitando registros huérfanos.

---

## 4. Scripts de Creación (DDL)

```sql
CREATE TABLE categoria (
    nombre TEXT PRIMARY KEY,
    orden INTEGER NOT NULL
);

CREATE TABLE catalogo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    imagen_url TEXT,
    imagen_delete_url TEXT DEFAULT '',
    imagen_public_id TEXT DEFAULT '',
    precio REAL NOT NULL DEFAULT 0
);

CREATE TABLE catalogo_categoria (
    catalogo_id INTEGER,
    categoria_nombre TEXT,
    PRIMARY KEY (catalogo_id, categoria_nombre),
    FOREIGN KEY (catalogo_id) REFERENCES catalogo(id) ON DELETE CASCADE,
    FOREIGN KEY (categoria_nombre) REFERENCES categoria(nombre) ON DELETE CASCADE
);