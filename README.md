# Horas Sindicales

App web para llevar la contabilidad mensual de las horas sindicales del comité de empresa:
cupo de 20 h/mes por miembro, anotación por adelantado de día y franja, cesiones de horas entre compañeros,
avisos de límite e histórico anual.

- **Frontend:** HTML + JS (sin compilación), alojado en GitHub Pages.
- **Backend:** Firebase Authentication (correo + contraseña, recuperación por email) y Cloud Firestore.
- **Modo demo:** mientras `firebase-config.js` no tenga claves, la app funciona con datos en el navegador para probar.

## Cómo funciona

| Concepto | Regla |
|---|---|
| Cupo | 20 h por miembro y mes (editable por miembro en Administración). Caduca a fin de mes. |
| Anotación | Quién disfruta, fecha, franja (puede cruzar medianoche) y **de quién salen las horas**: propias, de uno o varios compañeros, o mezcla. |
| Cesión | Las horas que aporta un compañero se restan de *su* cupo de ese mes. |
| Disponible | `cupo − propias usadas − cedidas a otros` |
| Límites | No se puede guardar si alguien quedaría en negativo o si hay solape de franjas. Un administrador puede forzarlo. |
| Avisos | Agotado, superado, o quedan ≤ 4 h (`AVISO_HORAS`), y solapes. |

## Usuarios

1. Comparte el enlace de la app. Cada persona pulsa **Crear cuenta** (nombre, correo, contraseña).
2. Queda **pendiente**; el administrador la activa en *Administración*.
3. Recuperar contraseña: “¿Olvidaste la contraseña?” en la pantalla de acceso (Firebase envía el correo). Cambiarla: *Mi cuenta*.
4. Los administradores pueden activar/bloquear, dar rol de admin y enviar correos de reseteo.

Todos los usuarios activos ven todo y pueden anotar, editar y borrar cualquier anotación.

## Puesta en marcha

1. **Firebase** (console.firebase.google.com): crear proyecto → Authentication → activar *Correo/contraseña* →
   Firestore → crear base de datos (modo producción, `europe-southwest1`) → Reglas: pegar `firestore.rules` y publicar.
2. Authentication → Configuración → **Dominios autorizados** → añadir `charlylopez-png.github.io`.
3. Pegar el `firebaseConfig` de la app web en `firebase-config.js`.
4. GitHub → Settings → Pages → Deploy from branch `main` / root.
5. Entrar con el correo de administrador (`ADMIN_EMAILS`): se crean automáticamente los 9 miembros del comité.

Para añadir otro administrador fijo: añadir su correo en `ADMIN_EMAILS` **y** en `adminEmails()` de `firestore.rules`
(o, más sencillo, darle rol Administrador desde la pantalla de Administración).

## Archivos

```
index.html             estructura
css/styles.css         estilos
js/app.js              lógica e interfaz
js/backend-firebase.js acceso a Firebase
js/backend-demo.js     backend de prueba (localStorage)
firebase-config.js     configuración (claves, admins, cupo, aviso, miembros iniciales)
firestore.rules        reglas de seguridad
```
