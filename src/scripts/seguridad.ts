// ARCHIVO: src/scripts/seguridad.ts — npm run seguridad: la revisión de seguridad completa.
import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { auditarSeguridad, textoAuditoria } from "../seguridad/auditoria.js";
await iniciarRegistro().catch(() => {});
const cs = await auditarSeguridad();
console.log(textoAuditoria(cs));
process.exit(cs.some((c) => c.nivel === "grave") ? 1 : 0);
