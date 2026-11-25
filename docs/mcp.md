# Servidores MCP en Emilia

Emilia puede conectarse a cualquier servidor MCP y sus herramientas aparecen solas como `mcp_<servidor>_<tool>`.

## Agregar uno (por WhatsApp o el panel)
Dile a Emilia o a Sage, por ejemplo:
> conecta el servidor MCP de GitHub para Sage

Ella usa `mcp_agregar` y te pide el OK mostrando exactamente qué programa o URL va a conectar.

## Secretos
Nunca se escriben en la configuración. Ponlos en el `.env` y refiérelos así:
- stdio: `env: { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }`
- http: `headers: { "Authorization": "Bearer ${NOTION_TOKEN}" }`

## Aprobaciones
- `auto` (por defecto): lo que el servidor marca como solo-lectura corre directo; lo demás te pide OK.
- `todas`: todo pide OK.
- `ninguna`: nada pide OK (solo para servidores de confianza y de solo lectura).

## Ejemplos
| Servidor | tipo | comando / url |
|---|---|---|
| GitHub | stdio | `npx -y @modelcontextprotocol/server-github` |
| Sistema de archivos (una carpeta) | stdio | `npx -y @modelcontextprotocol/server-filesystem C:\\Users\\TU_USUARIO\\Documentos` |
| PostgreSQL (solo lectura) | stdio | `npx -y @modelcontextprotocol/server-postgres postgresql://…` |
| Remoto | http | `https://…/mcp` |

Si un servidor se cae, se reconecta solo la próxima vez que se usa. `mcp_servidores` muestra el estado; `mcp_recargar` reconecta.
