// ARCHIVO: src/motor/permisos-pc.ts
// ─────────────────────────────────────────────────────────────────────────────
//  REGLAS DEL USO DEL COMPUTADOR (antes de CADA acción de Claude en tu PC)
//  Perfil = qué apps puede tocar, cómo se tratan los comandos y qué se manda
//  por WhatsApp. Reglas duras (no dependen del modelo):
//   • Solo actúa sobre ventanas de apps del perfil (el clic se juzga por la
//     ventana que está BAJO el punto, el teclado por la que está al frente).
//   • En terminales y escritorios remotos (PuTTY, AnyDesk, cmd…): nada de
//     escribir libre, Enter, pegar ni clic derecho (en PuTTY pega). Los comandos
//     van por terminal_comando, que los valida y pide tu OK.
//   • Solo lectura: lista blanca de comandos (ls, cat, tail, df, systemctl
//     status…); sin redirecciones, sin sudo, sin editores ni clientes de BD.
//   • Nunca: bloquear la sesión de Windows, comandos catastróficos.
// ─────────────────────────────────────────────────────────────────────────────

export type ModoComandos = "riesgo" | "aprobar_todos" | "solo_lectura";

export interface PerfilPc {
  nombre: string;
  descripcion: string;
  /** Procesos permitidos (minúsculas, sin .exe). "*" = todos. */
  apps: string[];
  apps_bloqueadas: string[];
  /** Procesos que son terminal o escritorio remoto. */
  terminales: string[];
  comandos: ModoComandos;
  /** Pedir OK por WhatsApp para cada comando (aunque sea de lectura). */
  aprobar_comandos: boolean;
  /** Pedir OK para texto libre en terminales/remotos (escribir_texto_remoto). */
  aprobar_texto_remoto: boolean;
  /** Mandar capturas por WhatsApp (NO en perfiles con datos sensibles). */
  enviar_capturas: boolean;
  datos_sensibles: boolean;
  /** Credenciales de Windows que este perfil puede escribir. */
  credenciales: string[];
  /** Pedir OK antes de arrancar la sesión. */
  aprobar_inicio: boolean;
  max_pasos: number;
  max_minutos: number;
  presupuesto_usd: number;
  modelo?: string;
  notas: string;
  /** Escritura en apps normales: libre (por defecto), nada (solo mirar: WhatsApp en lectura) o solo_lista (solo textos ya aprobados). */
  escritura?: "libre" | "nada" | "solo_lista";
  /** En tiempo de sesión (no se guarda): los textos exactos que se pueden escribir con escritura = solo_lista. */
  textos_permitidos?: string[];
}

export const TERMINALES_DEFECTO = ["putty", "kitty", "anydesk", "mstsc", "teamviewer", "rustdesk", "vncviewer", "tvnviewer", "mobaxterm", "securecrt", "windowsterminal", "cmd", "powershell", "pwsh", "conhost", "openconsole", "wsl", "bash", "mintty", "winscp"];

export const PERFIL_GENERAL: PerfilPc = {
  nombre: "general", descripcion: "Tu PC, uso general.",
  apps: ["*"], apps_bloqueadas: [], terminales: TERMINALES_DEFECTO,
  comandos: "riesgo", aprobar_comandos: false, aprobar_texto_remoto: false,
  enviar_capturas: true, datos_sensibles: false, credenciales: [], aprobar_inicio: false,
  max_pasos: 120, max_minutos: 30, presupuesto_usd: 3, notas: "",
};

export const PERFIL_HOSPITAL: PerfilPc = {
  nombre: "hospital_lectura",
  descripcion: "Servidor del hospital por AnyDesk + PuTTY. SOLO LECTURA, cada comando con tu OK, sin capturas por WhatsApp (datos de pacientes).",
  apps: ["anydesk", "putty"], apps_bloqueadas: [], terminales: TERMINALES_DEFECTO,
  comandos: "solo_lectura", aprobar_comandos: true, aprobar_texto_remoto: true,
  enviar_capturas: false, datos_sensibles: true, credenciales: [], aprobar_inicio: true,
  max_pasos: 80, max_minutos: 20, presupuesto_usd: 3,
  notas: "Habeas Data: no copies nombres, documentos ni datos de pacientes en el informe; resume con conteos y estados. Contrato Jelcom No. 053-26.",
};

export function normalizarPerfil(p: Partial<PerfilPc> & { nombre: string }): PerfilPc {
  const base = p.nombre === PERFIL_HOSPITAL.nombre ? PERFIL_HOSPITAL : p.nombre === PERFIL_WHATSAPP_LECTURA.nombre ? PERFIL_WHATSAPP_LECTURA : p.nombre === PERFIL_WHATSAPP_RESPONDER.nombre ? PERFIL_WHATSAPP_RESPONDER : PERFIL_GENERAL;
  const lista = (x: unknown, d: string[]) => (Array.isArray(x) ? x.map((s) => String(s).toLowerCase().replace(/\.exe$/, "").trim()).filter(Boolean) : d);
  return {
    ...base, ...p,
    apps: lista(p.apps, base.apps), apps_bloqueadas: lista(p.apps_bloqueadas, base.apps_bloqueadas),
    terminales: lista(p.terminales, base.terminales), credenciales: Array.isArray(p.credenciales) ? p.credenciales.map(String) : base.credenciales,
    comandos: (["riesgo", "aprobar_todos", "solo_lectura"] as const).includes(p.comandos as any) ? p.comandos! : base.comandos,
    escritura: (["libre", "nada", "solo_lista"] as const).includes(p.escritura as any) ? p.escritura : base.escritura,
  };
}

const coincide = (proceso: string, lista: string[]) => lista.some((a) => a === "*" || proceso === a || proceso.startsWith(a));
export const esTerminal = (proceso: string, perfil: PerfilPc) => coincide(proceso, perfil.terminales);

export interface Decision { permitir: boolean; motivo: string }
const si = (motivo = ""): Decision => ({ permitir: true, motivo });
const no = (motivo: string): Decision => ({ permitir: false, motivo });

/** ¿Se puede actuar sobre esta ventana con este perfil? */
export const PERFIL_WHATSAPP_LECTURA: PerfilPc = {
  nombre: "whatsapp_lectura",
  descripcion: "Tu WhatsApp de escritorio, SOLO para leer: abrir chats y leer. No escribe, no envía, no borra, no sale de grupos.",
  apps: ["whatsapp"], apps_bloqueadas: [], terminales: [], comandos: "solo_lectura", aprobar_comandos: true, aprobar_texto_remoto: true,
  enviar_capturas: false, datos_sensibles: false, credenciales: [], aprobar_inicio: false,
  max_pasos: 90, max_minutos: 12, presupuesto_usd: 1.5, escritura: "nada",
  notas: "Son chats personales del jefe: lo que leas es solo para su informe. No reacciones, no respondas, no abras enlaces, no descargues archivos, no toques llamadas.",
};
export const PERFIL_WHATSAPP_RESPONDER: PerfilPc = {
  nombre: "whatsapp_responder",
  descripcion: "Tu WhatsApp de escritorio para mandar UNA respuesta ya aprobada por ti: solo puede escribir el texto aprobado (y el nombre del chat para buscarlo).",
  apps: ["whatsapp"], apps_bloqueadas: [], terminales: [], comandos: "solo_lectura", aprobar_comandos: true, aprobar_texto_remoto: true,
  enviar_capturas: false, datos_sensibles: false, credenciales: [], aprobar_inicio: false,
  max_pasos: 40, max_minutos: 6, presupuesto_usd: 0.8, escritura: "solo_lista",
  notas: "Verifica en el encabezado del chat que es el chat correcto ANTES de escribir el mensaje. Escribe el mensaje UNA sola vez. No toques nada más.",
};

export function ventanaPermitida(proceso: string, perfil: PerfilPc): Decision {
  if (!proceso) return no("No sé qué ventana es (¿el escritorio seguro o una ventana de administrador?).");
  if (coincide(proceso, perfil.apps_bloqueadas)) return no(`La app "${proceso}" está bloqueada en el perfil ${perfil.nombre}.`);
  if (!coincide(proceso, perfil.apps)) return no(`La ventana es de "${proceso}", que no está en el perfil ${perfil.nombre} (permitidas: ${perfil.apps.join(", ")}). Usa enfocar_ventana para traer una permitida.`);
  return si();
}

const ENTER = /^(return|enter|kp_enter|ctrl\+m|ctrl\+j)$/i;
/**
 * Teclas que SÍ se permiten en terminales/remotos: navegar y leer, nunca componer
 * un comando letra por letra (ni ctrl+o, que en bash ejecuta la línea sin Enter).
 */
const TECLA_TERMINAL_OK = /^((shift\+|ctrl\+)?(up|down|left|right|page_up|page_down|prior|next|pageup|pagedown|home|end)|escape|esc|ctrl\+c|ctrl\+l|ctrl\+u|q|space|tab|alt\+tab)$/i;
const PEGAR = /^(ctrl\+v|shift\+insert|ctrl\+shift\+v|super\+v)$/i;
const BLOQUEAR_SESION = /^(super\+l|win\+l|ctrl\+alt\+(delete|del|end))$/i;

/**
 * Regla para una acción del toolset de Claude.
 * `destino` = ventana que la recibiría (bajo el punto para clics; al frente para teclado).
 */
export function decidirAccion(accion: string, input: any, destino: { proceso: string } | null, perfil: PerfilPc): Decision {
  const pasivas = ["screenshot", "zoom", "cursor_position", "wait", "mouse_move"];
  if (pasivas.includes(accion)) return si();
  if (accion === "key" && BLOQUEAR_SESION.test(String(input?.text || "").replace(/\s/g, ""))) return no("No se bloquea ni se cierra la sesión de Windows: sin pantalla no puedo seguir trabajando.");
  if (!destino) return no("No pude saber qué ventana recibiría la acción.");
  const v = ventanaPermitida(destino.proceso, perfil);
  if (!v.permitir) return v;
  // Perfiles de solo mirar (WhatsApp en lectura) o de escribir solo lo aprobado.
  if (perfil.escritura === "nada" || perfil.escritura === "solo_lista") {
    const combo = String(input?.text || "").replace(/\s/g, "");
    if (accion === "hold_key") return no("En este perfil no se mantienen teclas presionadas.");
    if (accion === "key" && PEGAR.test(combo)) return no("En este perfil no se pega nada.");
    if (perfil.escritura === "nada") {
      if (accion === "type") return no(`El perfil ${perfil.nombre} es SOLO de lectura: no se escribe nada.`);
      if (accion === "key" && (ENTER.test(combo) || /^.$/.test(combo) || /^shift\+.$/i.test(combo))) return no(`El perfil ${perfil.nombre} es SOLO de lectura: ni Enter ni letras.`);
    } else if (accion === "type") {
      const t = String(input?.text ?? "");
      if (!(perfil.textos_permitidos || []).some((x) => x === t || x === t.replace(/\n$/, ""))) return no("Solo puedes escribir el texto aprobado por el jefe (exacto) o el nombre del chat. Nada más.");
    }
  }
  if (esTerminal(destino.proceso, perfil)) {
    const combo = String(input?.text || "").replace(/\s/g, "");
    if (accion === "type") return no(`En terminales y escritorios remotos (${destino.proceso}) no se escribe libre: usa terminal_comando para un comando (se valida y te piden OK) o escribir_texto_remoto para texto sin Enter.`);
    if (accion === "key" && ENTER.test(combo)) return no("Enter en una terminal/remoto ejecuta lo que esté escrito: usa terminal_comando (escribe el comando completo y da Enter tras validarlo).");
    if (accion === "key" && PEGAR.test(combo)) return no("Pegar en una terminal/remoto ejecutaría texto sin validar: no permitido.");
    if (accion === "key" && !TECLA_TERMINAL_OK.test(combo)) return no(`La tecla "${combo}" no está permitida en terminales/remotos (solo flechas, Re Pág/Av Pág, Inicio/Fin, Esc, Tab, ctrl+c, ctrl+l, q, espacio). Los comandos van con terminal_comando.`);
    if (accion === "hold_key") return no("No se mantienen teclas presionadas en una terminal/remoto.");
    if (["right_click", "middle_click"].includes(accion)) return no(`Clic ${accion === "right_click" ? "derecho" : "central"} en ${destino.proceso}: en PuTTY/terminales PEGA y ejecuta el portapapeles. No permitido.`);
  }
  return si();
}

// ── Comandos ─────────────────────────────────────────────────────────────────
export interface DecisionComando { decision: "permitir" | "preguntar" | "negar"; motivo: string; lectura: boolean }

const CATASTROFICO: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|-r\s+-f|-f\s+-r)[a-z-]*\s+(\/|\/\*|~|\$HOME|\/(etc|var|usr|home|boot|root|opt|srv|data)\/?)(\s|$)/i,
  /\bmkfs(\.\w+)?\b/i, /\bdd\b[^|;&]*\bof=\/dev\//i, />\s*\/dev\/(sd|nvme|hd|xvd)/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, /\b(shutdown|poweroff|halt|init\s+0|init\s+6)\b/i, /\breboot\b/i,
  /\bchmod\s+(-R\s+)?[0-7]*777\s+\/(\s|$)/i, /\bchown\s+-R\s+\S+\s+\/(\s|$)/i,
  /\bformat\s+[a-z]:/i, /\bdiskpart\b/i, /\bRemove-Item\b[^|;]*-Recurse[^|;]*\s[a-z]:\\?(\s|$)/i, /\bdel\s+\/[sq].*\s[a-z]:\\\*?/i,
  /\b(DROP\s+(DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i,
];
const RIESGOSO: RegExp[] = [
  /\brm\b/i, /\brmdir\b/i, /\bdel\b/i, /\berase\b/i, /\bRemove-Item\b/i, /\bmv\b/i, /\bmove\b/i, /\bRename-Item\b/i,
  /\b(chmod|chown|chgrp|setfacl|icacls|takeown)\b/i, /\b(kill|pkill|killall|taskkill|Stop-Process)\b/i,
  /\bsystemctl\s+(start|stop|restart|reload|enable|disable|mask|kill)\b/i, /\bservice\s+\S+\s+(start|stop|restart|reload)\b/i,
  /\b(apt|apt-get|yum|dnf|zypper|pacman|snap|pip|npm|choco|winget)\s+(install|remove|purge|update|upgrade|uninstall|erase)\b/i,
  /\bgit\s+(push|reset|clean|checkout|rebase|merge|commit)\b/i, /\bsudo\b/i, /\bsu\b(\s|$)/, /\bcrontab\s+(-e|-r)\b/i,
  /\b(DELETE|UPDATE|INSERT|ALTER|DROP|CREATE|GRANT|REVOKE)\b/, /\b(useradd|userdel|usermod|passwd|net\s+user)\b/i,
  /\breg\s+(add|delete)\b/i, /\bSet-ItemProperty\b/i, /\bNew-Item\b/i, /\bcp\b|\bcopy\b|\bxcopy\b|\brobocopy\b/i,
  /(^|[^<>\d])>{1,2}(?!&)/, /\btee\b/i, /\bsed\b[^|;]*\s-i\b/i, /\btruncate\b/i, /\bmount\b|\bumount\b/i,
  /\biptables\b|\bufw\b|\bfirewall-cmd\b|\bnetsh\b/i, /\bdocker\s+(rm|rmi|stop|kill|restart|run|exec|compose\s+(down|up))\b/i,
];

const LECTURA_SIMPLE = new Set([
  "ls", "ll", "la", "dir", "pwd", "cd", "cat", "head", "tail", "grep", "egrep", "fgrep", "zgrep", "zcat", "wc", "sort", "uniq", "cut", "tr", "column",
  "df", "du", "free", "uptime", "ps", "pgrep", "pstree", "who", "w", "whoami", "id", "groups", "hostname", "uname", "date", "cal", "lsblk", "lscpu", "nproc",
  "stat", "file", "md5sum", "sha1sum", "sha256sum", "last", "lastlog", "dmesg", "vmstat", "iostat", "mpstat", "sar", "lsof", "getenforce", "sestatus",
  "which", "whereis", "type", "echo", "printf", "history", "ss", "netstat", "ifconfig", "nslookup", "dig", "host", "traceroute", "tracepath", "arp", "route",
  "basename", "dirname", "realpath", "readlink", "true", "env", "printenv", "locale", "ulimit", "awk", "sed", "find", "tree", "jq", "nl", "fold", "comm", "diff",
  "clear", "exit", "logout", "top", "htop", "ping", "systemctl", "service", "journalctl", "timedatectl", "hostnamectl", "ip", "curl", "wget", "crontab",
  "docker", "kubectl", "git", "tasklist", "systeminfo", "ipconfig", "Get-Process", "Get-Service", "Get-ChildItem", "Get-Content", "Get-EventLog", "Get-WinEvent",
  "Get-Date", "Get-Location", "Test-Connection", "Get-NetIPAddress", "Get-Volume", "Get-PSDrive",
]);

function partes(cmd: string): string[] | null {
  // Separa por | ; && || respetando comillas. Devuelve null si hay sustitución de comandos.
  if (/\$\(|`|<\(|>\(/.test(cmd)) return null;
  const out: string[] = []; let cur = "", q: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "&" && (cmd[i - 1] === ">" || cmd[i + 1] === ">")) { cur += c; continue; }   // 2>&1, &> no separan
    if (c === "|" || c === ";" || c === "&") { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const sinComillas = (s: string) => s.replace(/'[^']*'|"[^"]*"/g, "''");

/** ¿Este segmento es solo de lectura? Devuelve el motivo si no. */
function segmentoLectura(seg: string): string | null {
  // Solo se aceptan redirecciones inofensivas: 2>/dev/null, >/dev/null, 2>&1.
  const limpio = sinComillas(seg).replace(/\d?>{1,2}\s*\/dev\/null\b/g, "").replace(/\d>&\d/g, "");
  if (/>/.test(limpio)) return "tiene una redirección (>), que escribe archivos";
  const toks = seg.split(/\s+/).filter((t) => !/^\w+=/.test(t));   // quita VAR=valor delante
  const [prog = "", ...args] = toks;
  const p = prog.replace(/^.*\//, "");
  const a = args.join(" "), al = a.toLowerCase();
  if (p === "sudo" || p === "su") return "usa sudo/su (privilegios de administrador)";
  if (["vi", "vim", "nano", "emacs", "ed", "joe", "mcedit", "less", "more", "view", "most"].includes(p)) return `${p} es un editor o visor interactivo (usa cat, head o tail)`;
  if (["mysql", "psql", "sqlplus", "sqlcmd", "mongo", "mongosh", "redis-cli", "isql", "db2", "sqlite3"].includes(p)) return `${p} abre la base de datos (puede leer datos de pacientes o modificarlos); requiere un perfil con escritura y tu OK`;
  if (["xargs", "eval", "exec", "source", ".", "bash", "sh", "zsh", "python", "python3", "perl", "ruby", "node", "php", "nohup", "watch", "timeout", "nice", "env"].includes(p) && !(p === "env" && !a.trim())) return `${p} ejecuta otros programas`;
  if (!LECTURA_SIMPLE.has(p) && !LECTURA_SIMPLE.has(prog)) return `"${p}" no está en la lista de comandos de solo lectura`;
  switch (p) {
    case "find": if (/-(delete|exec|execdir|ok|okdir|fprint\w*|fls)\b/.test(a)) return "find con -delete/-exec modifica o ejecuta"; break;
    case "sed": if (/(^|\s)(-i\S*|--in-place\S*)(\s|$)/.test(a) || /\/w\s+\S|(^|[\s;'"])w\s+\//.test(a)) return "sed con -i o w escribe archivos"; break;
    case "awk": if (/system\s*\(|print\s*>|\|\s*"/.test(a)) return "awk con system() o escritura"; break;
    case "systemctl": if (!/^(status|list-units|list-unit-files|list-timers|list-sockets|is-active|is-enabled|is-failed|show|cat|--failed|--version)\b/.test(args[0] || "status")) return `systemctl ${args[0]} cambia servicios`; break;
    case "service": if (!/\bstatus\b/.test(al) && !/--status-all/.test(al)) return "service solo con status"; break;
    case "journalctl": if (/--(vacuum|rotate|flush|sync|relinquish|setup-keys)/.test(al)) return "journalctl con opciones que modifican el diario"; break;
    case "timedatectl": case "hostnamectl": if (/\bset-/.test(al)) return `${p} set-… cambia la configuración`; break;
    case "ip": if (/\b(add|del|delete|flush|set|change|replace)\b/.test(al)) return "ip con add/del/set cambia la red"; break;
    case "route": if (/\b(add|del|delete|flush)\b/.test(al)) return "route add/del cambia la red"; break;
    case "ifconfig": if (args.length > 1 || /\b(up|down)\b/.test(al)) return "ifconfig solo para ver (sin cambiar interfaces)"; break;
    case "curl": if (/(^|\s)(-X|--request)\s*(?!GET\b)\w+|(^|\s)(-d|--data\S*|-F|--form|-T|--upload-file|-o|-O|--output|--remote-name)\b/i.test(a)) return "curl que envía datos o guarda archivos"; break;
    case "wget": if (!/(--spider|-qO-|-O\s*-|--output-document=-)/.test(a)) return "wget descarga archivos (solo --spider o -qO-)"; break;
    case "crontab": if (!/(^|\s)-l\b/.test(a)) return "crontab solo con -l"; break;
    case "docker": if (!/^(ps|logs|images|inspect|stats|top|version|info|port)\b/.test(args[0] || "")) return `docker ${args[0] || ""} no es de lectura`; if (args[0] === "stats" && !/--no-stream/.test(a)) return "docker stats necesita --no-stream (si no, no termina)"; break;
    case "kubectl": if (!/^(get|describe|logs|top|version|cluster-info|explain|api-resources)\b/.test(args[0] || "")) return `kubectl ${args[0] || ""} no es de lectura`; break;
    case "git": if (!/^(status|log|diff|show|branch|remote|rev-parse|describe|blame|ls-files|shortlog|tag)\b/.test(args[0] || "")) return `git ${args[0] || ""} no es de lectura`; if (/^(branch|tag|remote)\b/.test(args[0]) && /\s-(d|D|m|M|-delete|add|remove|rm)\b|\s(add|remove|rm|rename|set-url)\b/.test(" " + args.slice(1).join(" "))) return "eso modifica ramas/tags/remotos"; break;
    case "top": if (!/(^|\s)-b\b/.test(a)) return "top necesita -b -n 1 (si no, no termina; o usa ps)"; break;
    case "htop": return "htop es interactivo (usa ps o top -b -n 1)";
    case "ping": if (!/(^|\s)-(c|n)\s*\d+/.test(a)) return "ping necesita -c N (si no, no termina)"; break;
    case "tail": if (/(^|\s)(-f|-F|--follow)\b/.test(a)) return "tail -f no termina (usa tail -n 200)"; break;
    case "dmesg": if (/(^|\s)-(c|C|-clear|-read-clear)\b/.test(a)) return "dmesg -c borra el buffer"; break;
    case "history": if (/(^|\s)-(c|d|w|a|r)\b/.test(a)) return "history -c/-d/-w modifica el historial"; break;
  }
  return null;
}

/** Valida un comando según el perfil. */
export function decidirComando(cmd: string, perfil: PerfilPc): DecisionComando {
  const c = cmd.trim();
  if (!c) return { decision: "negar", motivo: "Comando vacío.", lectura: false };
  if (/[\r\n]/.test(c)) return { decision: "negar", motivo: "Un comando por vez, en una sola línea.", lectura: false };
  for (const re of CATASTROFICO) if (re.test(c)) return { decision: "negar", motivo: "Comando catastrófico (borra o apaga el sistema): nunca.", lectura: false };
  const segs = partes(c);
  const motivoNoLectura = segs === null ? "usa sustitución de comandos ($(...) o comillas invertidas)" : segs.map(segmentoLectura).find((m) => m) || null;
  const lectura = !motivoNoLectura;
  if (perfil.comandos === "solo_lectura") {
    if (!lectura) return { decision: "negar", motivo: `Perfil ${perfil.nombre} es de SOLO LECTURA y este comando no lo es: ${motivoNoLectura}. Si hace falta, propónselo al jefe con el comando exacto.`, lectura };
    return { decision: perfil.aprobar_comandos ? "preguntar" : "permitir", motivo: "comando de lectura", lectura };
  }
  if (perfil.comandos === "aprobar_todos" || perfil.aprobar_comandos) return { decision: "preguntar", motivo: lectura ? "comando de lectura" : `cambia algo: ${motivoNoLectura}`, lectura };
  // riesgo: lo de lectura pasa; lo riesgoso pregunta; lo demás pasa.
  if (lectura) return { decision: "permitir", motivo: "comando de lectura", lectura };
  const riesgo = RIESGOSO.find((re) => re.test(c));
  return riesgo ? { decision: "preguntar", motivo: `puede cambiar o borrar algo (${motivoNoLectura})`, lectura } : { decision: "permitir", motivo: "", lectura };
}
