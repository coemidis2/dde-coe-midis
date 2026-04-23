# DEE MIDIS - paquete para Cloudflare Pages + Functions + D1

Este proyecto NO es solo un sitio estático.

La versión funcional completa requiere:

FRONTEND
- index.html
- app.js
- app.css
- ubigeoData.js

BACKEND (Cloudflare Pages Functions)
- /functions/api/*
- /functions/_lib/*

BASE DE DATOS D1
- users
- sessions
- decretos
- acciones
- audit_log
- conflictos
- login_attempts

IMPORTANTE
- GitHub Pages puede servir solo para pruebas visuales del frontend.
- La versión operativa completa requiere Cloudflare Pages + Functions + D1.
- El frontend consume endpoints /api/... y por eso no funciona de forma completa como sitio puramente estático.

RUTAS API USADAS POR app.js
- /api/login
- /api/session
- /api/logout
- /api/decretos
- /api/users
- /api/audit-log
- /api/conflicts

ARCHIVOS RAÍZ REQUERIDOS
- index.html
- app.js
- app.css
- ubigeoData.js