# Instalar pgvector en tu PostgreSQL (Windows)

pgvector hace que la memoria de Emilia (el cerebro de Lara) busque por significado en
milisegundos aunque tenga cientos de miles de recuerdos. Sin él, Emilia funciona igual,
pero la búsqueda se vuelve lenta cuando la memoria crece mucho.

Pasos tomados de la guía oficial de pgvector (v0.8.1).

## 1. Herramientas de compilación (una sola vez)
Instala **Visual Studio Build Tools** con la carga de trabajo **"Desarrollo para el escritorio con C++"**:
https://visualstudio.microsoft.com/es/visual-cpp-build-tools/

## 2. Compilar e instalar
1. Abre el menú Inicio, busca **"x64 Native Tools Command Prompt for VS"**, clic derecho → **Ejecutar como administrador**.
2. Mira qué versión de PostgreSQL tienes (carpeta `C:\Program Files\PostgreSQL\`): 16, 17…
3. Pega esto (cambia el `17` por tu versión):

```cmd
set "PGROOT=C:\Program Files\PostgreSQL\17"
cd %TEMP%
git clone --branch v0.8.1 https://github.com/pgvector/pgvector.git
cd pgvector
nmake /F Makefile.win
nmake /F Makefile.win install
```

## 3. Activarlo en la base de Emilia
En la carpeta de Emilia:

```cmd
npm run migrate
```

La migración crea la extensión (`CREATE EXTENSION vector`), la columna de vectores y su
índice. Para comprobar: pídele a Lara **"cómo está la memoria"**; debe decir `pgvector ✔`.

## Si algo falla
- *`nmake` no se reconoce*: no abriste la consola "x64 Native Tools" (paso 2.1).
- *Permiso denegado al instalar*: la consola no está como administrador.
- *La migración dice "pgvector no está instalado"*: el `PGROOT` no era la versión de PostgreSQL
  que usa Emilia; repite el paso 2 con la carpeta correcta.
- Guía oficial y notas de instalación: https://github.com/pgvector/pgvector#windows
