// ARCHIVO: src/scripts/cerebro-llave.ts
// Muestra la llave que cifra la memoria personal, para guardarla en un lugar
// seguro (un gestor de contraseñas). Si reinstalas Windows o cambias de PC,
// pon esta llave en el .env como CEREBRO_LLAVE=... y Emilia vuelve a leer todo.
//   npm run cerebro:llave
import "dotenv/config";
import { obtenerLlave } from "../motor/cifrado.js";
const k = await obtenerLlave();
if (!k) { console.log("No hay llave (¿CEREBRO_CIFRADO=false?)."); process.exit(1); }
console.log(`\nLlave de la memoria personal (guárdala en un gestor de contraseñas; NO la compartas):\n\nCEREBRO_LLAVE=${k.toString("base64")}\n\nSi un día cambias de PC o reinstalas Windows, pon esa línea en el .env de Emilia.\n`);
process.exit(0);
