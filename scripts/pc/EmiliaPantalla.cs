// ARCHIVO: scripts/pc/EmiliaPantalla.cs
// ─────────────────────────────────────────────────────────────────────────────
//  Control de pantalla para el uso del computador con Claude (Windows).
//  Lo compila scripts/pc/trabajador.ps1 al arrancar (Add-Type de Windows
//  PowerShell 5.1 → C# 5: nada de interpolación, "out var", "?." ni "=>").
//  Todo en píxeles FÍSICOS (el proceso se declara consciente del DPI), así la
//  captura y los clics coinciden aunque Windows esté al 125 % o 150 %.
//  Teclado por código virtual + scancode (respeta la distribución del teclado y
//  llega bien a PuTTY y a AnyDesk); Unicode solo para caracteres sin tecla.
// ─────────────────────────────────────────────────────────────────────────────
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class EmiliaPantalla
{
    // ── Win32 ────────────────────────────────────────────────────────────────
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out PUNTO p);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(PUNTO p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
    [DllImport("user32.dll")] static extern short VkKeyScan(char ch);
    [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int clase, out int info, int largo, out int devuelto);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
    [DllImport("advapi32.dll")] static extern void CredFree(IntPtr buffer);

    [StructLayout(LayoutKind.Sequential)] public struct PUNTO { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
    [StructLayout(LayoutKind.Explicit)] struct UNION_ENTRADA { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION_ENTRADA u; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CREDENCIAL
    {
        public int Flags; public int Type; public string TargetName; public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
        public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
    }

    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint MOUSE_LEFTDOWN = 0x0002, MOUSE_LEFTUP = 0x0004, MOUSE_RIGHTDOWN = 0x0008, MOUSE_RIGHTUP = 0x0010;
    const uint MOUSE_MIDDLEDOWN = 0x0020, MOUSE_MIDDLEUP = 0x0040, MOUSE_WHEEL = 0x0800, MOUSE_HWHEEL = 0x1000;
    const uint KEY_EXTENDED = 0x0001, KEY_UP = 0x0002, KEY_UNICODE = 0x0004, KEY_SCANCODE = 0x0008;

    static int ultimoX = -1, ultimoY = -1;

    // ── Inicio ───────────────────────────────────────────────────────────────
    public static string Iniciar()
    {
        bool v2 = false;
        try { v2 = SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { }   // Per-Monitor v2 (Win10 1703+)
        if (!v2) { try { SetProcessDPIAware(); } catch (Exception) { } }
        return Pantalla();
    }

    /** Tamaño físico de la pantalla principal: "ancho alto". */
    public static string Pantalla()
    {
        return GetSystemMetrics(0) + " " + GetSystemMetrics(1);
    }

    // ── Captura ──────────────────────────────────────────────────────────────
    /**
     * Captura un rectángulo (físico) de la pantalla principal y lo guarda como PNG
     * escalado para caber en maxAncho x maxAlto (agrandar solo si se permite: zoom).
     * Devuelve "anchoOrig altoOrig anchoFinal altoFinal". Pantalla bloqueada → excepción clara.
     */
    public static string Capturar(string ruta, int x, int y, int ancho, int alto, int maxAncho, int maxAlto, bool agrandar)
    {
        if (ancho <= 0 || alto <= 0) { ancho = GetSystemMetrics(0); alto = GetSystemMetrics(1); x = 0; y = 0; }
        using (Bitmap origen = new Bitmap(ancho, alto, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(origen))
            {
                try { g.CopyFromScreen(x, y, 0, 0, new Size(ancho, alto), CopyPixelOperation.SourceCopy); }
                catch (Exception e) { throw new Exception("PANTALLA_BLOQUEADA: no se pudo capturar la pantalla (¿Windows bloqueado, suspendido o en el escritorio seguro?). " + e.Message); }
            }
            double escala = Math.Min((double)maxAncho / ancho, (double)maxAlto / alto);
            if (!agrandar && escala > 1.0) escala = 1.0;
            int w = Math.Max(1, (int)Math.Round(ancho * escala)), h = Math.Max(1, (int)Math.Round(alto * escala));
            if (w == ancho && h == alto) { origen.Save(ruta, ImageFormat.Png); }
            else
            {
                using (Bitmap destino = new Bitmap(w, h, PixelFormat.Format24bppRgb))
                using (Graphics g2 = Graphics.FromImage(destino))
                {
                    g2.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g2.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g2.SmoothingMode = SmoothingMode.HighQuality;
                    g2.DrawImage(origen, new Rectangle(0, 0, w, h), new Rectangle(0, 0, ancho, alto), GraphicsUnit.Pixel);
                    destino.Save(ruta, ImageFormat.Png);
                }
            }
            return ancho + " " + alto + " " + w + " " + h;
        }
    }

    // ── Ventanas ─────────────────────────────────────────────────────────────
    /**
     * ¿El proceso corre como administrador? 1 sí, 0 no, -1 no se pudo saber (Windows
     * niega leer el token de procesos elevados desde uno normal: casi siempre es "sí").
     * Importa porque Windows NO deja que un programa normal mande clics/teclas a una
     * ventana de administrador (UIPI) y falla en silencio. AnyDesk suele correr así.
     */
    public static int Elevado(uint pid)
    {
        IntPtr h = OpenProcess(0x1000, false, pid);   // PROCESS_QUERY_LIMITED_INFORMATION
        if (h == IntPtr.Zero) return -1;
        try
        {
            IntPtr t;
            if (!OpenProcessToken(h, 0x0008, out t)) return -1;   // TOKEN_QUERY
            try { int e, r; if (!GetTokenInformation(t, 20, out e, 4, out r)) return -1; return e != 0 ? 1 : 0; }   // TokenElevation
            finally { CloseHandle(t); }
        }
        finally { CloseHandle(h); }
    }

    static string DescribirVentana(IntPtr h)
    {
        if (h == IntPtr.Zero) return "\t0\t0\t";
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(h, sb, 512);
        uint pid; GetWindowThreadProcessId(h, out pid);
        string proceso = "";
        try { proceso = Process.GetProcessById((int)pid).ProcessName; } catch (Exception) { proceso = "desconocido"; }
        return proceso + "\t" + pid + "\t" + Elevado(pid) + "\t" + sb.ToString().Replace("\t", " ").Replace("\n", " ");
    }

    /**
     * Qué hay en pantalla para decidir permisos: ventana al frente, ventana bajo un
     * punto (la que recibiría el clic) y posición del cursor. Tres líneas:
     *   FRENTE\tproceso\tpid\televado\ttitulo · PUNTO\t… · CURSOR\tx\ty\tux\tuy · YO\televado
     */
    public static string Inspeccionar(int x, int y, bool conPunto)
    {
        string r = "FRENTE\t" + DescribirVentana(GetForegroundWindow());
        if (conPunto)
        {
            PUNTO p; p.X = x; p.Y = y;
            IntPtr h = WindowFromPoint(p);
            if (h != IntPtr.Zero) { IntPtr raiz = GetAncestor(h, 2); if (raiz != IntPtr.Zero) h = raiz; }
            r += "\nPUNTO\t" + DescribirVentana(h);
        }
        PUNTO c; GetCursorPos(out c);
        r += "\nCURSOR\t" + c.X + "\t" + c.Y + "\t" + ultimoX + "\t" + ultimoY;
        r += "\nYO\t" + Elevado(GetCurrentProcessId());
        return r;
    }

    // ── Mouse ────────────────────────────────────────────────────────────────
    static void EnviarMouse(uint flags, uint datos)
    {
        INPUT[] e = new INPUT[1];
        e[0].type = INPUT_MOUSE;
        e[0].u.mi.dwFlags = flags;
        e[0].u.mi.mouseData = datos;
        SendInput(1, e, Marshal.SizeOf(typeof(INPUT)));
    }

    public static string Mover(int x, int y)
    {
        SetCursorPos(x, y);
        ultimoX = x; ultimoY = y;
        Thread.Sleep(30);
        return "OK";
    }

    /** boton: izquierdo|derecho|medio · veces: 1, 2 o 3 · mods: "ctrl+shift" o "". */
    public static string Clic(int x, int y, string boton, int veces, string mods)
    {
        uint abajo = MOUSE_LEFTDOWN, arriba = MOUSE_LEFTUP;
        if (boton == "derecho") { abajo = MOUSE_RIGHTDOWN; arriba = MOUSE_RIGHTUP; }
        else if (boton == "medio") { abajo = MOUSE_MIDDLEDOWN; arriba = MOUSE_MIDDLEUP; }
        List<ushort> m = Modificadores(mods);
        if (x >= 0 && y >= 0) Mover(x, y);
        Thread.Sleep(60);
        foreach (ushort vk in m) Tecla(vk, false);
        for (int i = 0; i < Math.Max(1, veces); i++)
        {
            EnviarMouse(abajo, 0); Thread.Sleep(35); EnviarMouse(arriba, 0);
            if (i < veces - 1) Thread.Sleep(70);
        }
        for (int i = m.Count - 1; i >= 0; i--) Tecla(m[i], true);
        Thread.Sleep(80);
        return "OK";
    }

    public static string BotonIzquierdo(bool abajo)
    {
        EnviarMouse(abajo ? MOUSE_LEFTDOWN : MOUSE_LEFTUP, 0);
        Thread.Sleep(40);
        return "OK";
    }

    /** Arrastre suave (en pasos) para que las apps registren el movimiento. */
    public static string Arrastrar(int x1, int y1, int x2, int y2, string mods)
    {
        List<ushort> m = Modificadores(mods);
        Mover(x1, y1); Thread.Sleep(60);
        foreach (ushort vk in m) Tecla(vk, false);
        EnviarMouse(MOUSE_LEFTDOWN, 0); Thread.Sleep(80);
        int pasos = 15;
        for (int i = 1; i <= pasos; i++) { SetCursorPos(x1 + (x2 - x1) * i / pasos, y1 + (y2 - y1) * i / pasos); Thread.Sleep(15); }
        ultimoX = x2; ultimoY = y2;
        Thread.Sleep(60);
        EnviarMouse(MOUSE_LEFTUP, 0);
        for (int i = m.Count - 1; i >= 0; i--) Tecla(m[i], true);
        Thread.Sleep(80);
        return "OK";
    }

    /** direccion: up|down|left|right · cantidad en "clics" de rueda. */
    public static string Scroll(int x, int y, string direccion, int cantidad, string mods)
    {
        if (x >= 0 && y >= 0) Mover(x, y);
        List<ushort> m = Modificadores(mods);
        foreach (ushort vk in m) Tecla(vk, false);
        bool horizontal = direccion == "left" || direccion == "right";
        int signo = (direccion == "up" || direccion == "right") ? 1 : -1;
        for (int i = 0; i < Math.Max(1, cantidad); i++)
        {
            EnviarMouse(horizontal ? MOUSE_HWHEEL : MOUSE_WHEEL, unchecked((uint)(signo * 120)));
            Thread.Sleep(25);
        }
        for (int i = m.Count - 1; i >= 0; i--) Tecla(m[i], true);
        Thread.Sleep(80);
        return "OK";
    }

    // ── Teclado ──────────────────────────────────────────────────────────────
    static bool EsExtendida(ushort vk)
    {
        return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C || vk == 0x5D
            || vk == 0x6F || vk == 0x90 || vk == 0xA3 || vk == 0xA5 || vk == 0x2C;
    }

    static void Tecla(ushort vk, bool arriba)
    {
        INPUT[] e = new INPUT[1];
        e[0].type = INPUT_KEYBOARD;
        e[0].u.ki.wVk = vk;
        e[0].u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
        e[0].u.ki.dwFlags = (arriba ? KEY_UP : 0) | (EsExtendida(vk) ? KEY_EXTENDED : 0);
        SendInput(1, e, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Unicode(char c)
    {
        INPUT[] e = new INPUT[2];
        e[0].type = INPUT_KEYBOARD; e[0].u.ki.wScan = c; e[0].u.ki.dwFlags = KEY_UNICODE;
        e[1].type = INPUT_KEYBOARD; e[1].u.ki.wScan = c; e[1].u.ki.dwFlags = KEY_UNICODE | KEY_UP;
        SendInput(2, e, Marshal.SizeOf(typeof(INPUT)));
    }

    static readonly Dictionary<string, ushort> NOMBRES = CrearNombres();
    static Dictionary<string, ushort> CrearNombres()
    {
        Dictionary<string, ushort> d = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase);
        d["return"] = 0x0D; d["enter"] = 0x0D; d["kp_enter"] = 0x0D; d["tab"] = 0x09; d["iso_left_tab"] = 0x09;
        d["escape"] = 0x1B; d["esc"] = 0x1B; d["backspace"] = 0x08; d["delete"] = 0x2E; d["del"] = 0x2E; d["supr"] = 0x2E;
        d["insert"] = 0x2D; d["home"] = 0x24; d["end"] = 0x23; d["page_up"] = 0x21; d["prior"] = 0x21; d["pageup"] = 0x21;
        d["page_down"] = 0x22; d["next"] = 0x22; d["pagedown"] = 0x22; d["up"] = 0x26; d["down"] = 0x28; d["left"] = 0x25; d["right"] = 0x27;
        d["space"] = 0x20; d["ctrl"] = 0xA2; d["control"] = 0xA2; d["control_l"] = 0xA2; d["control_r"] = 0xA3;
        d["shift"] = 0xA0; d["shift_l"] = 0xA0; d["shift_r"] = 0xA1; d["alt"] = 0xA4; d["alt_l"] = 0xA4; d["alt_r"] = 0xA5; d["altgr"] = 0xA5;
        d["super"] = 0x5B; d["super_l"] = 0x5B; d["super_r"] = 0x5C; d["win"] = 0x5B; d["windows"] = 0x5B; d["meta"] = 0x5B; d["cmd"] = 0x5B;
        d["menu"] = 0x5D; d["print"] = 0x2C; d["caps_lock"] = 0x14; d["num_lock"] = 0x90; d["scroll_lock"] = 0x91; d["pause"] = 0x13;
        d["plus"] = 0xBB; d["minus"] = 0xBD; d["comma"] = 0xBC; d["period"] = 0xBE;
        d["kp_add"] = 0x6B; d["kp_subtract"] = 0x6D; d["kp_multiply"] = 0x6A; d["kp_divide"] = 0x6F; d["kp_decimal"] = 0x6E;
        for (int i = 1; i <= 24; i++) d["f" + i] = (ushort)(0x6F + i);
        for (int i = 0; i <= 9; i++) d["kp_" + i] = (ushort)(0x60 + i);
        return d;
    }

    /** Nombres de símbolos de xdotool → carácter (se busca su tecla en la distribución actual). */
    static readonly Dictionary<string, char> SIMBOLOS = CrearSimbolos();
    static Dictionary<string, char> CrearSimbolos()
    {
        Dictionary<string, char> d = new Dictionary<string, char>(StringComparer.OrdinalIgnoreCase);
        d["slash"] = '/'; d["backslash"] = '\\'; d["semicolon"] = ';'; d["colon"] = ':'; d["apostrophe"] = '\''; d["quotedbl"] = '"';
        d["grave"] = '`'; d["asciitilde"] = '~'; d["bracketleft"] = '['; d["bracketright"] = ']'; d["braceleft"] = '{'; d["braceright"] = '}';
        d["parenleft"] = '('; d["parenright"] = ')'; d["equal"] = '='; d["question"] = '?'; d["exclam"] = '!'; d["at"] = '@';
        d["numbersign"] = '#'; d["dollar"] = '$'; d["percent"] = '%'; d["asciicircum"] = '^'; d["ampersand"] = '&'; d["asterisk"] = '*';
        d["underscore"] = '_'; d["less"] = '<'; d["greater"] = '>'; d["bar"] = '|'; d["ntilde"] = '\u00f1'; d["questiondown"] = '\u00bf'; d["exclamdown"] = '\u00a1';
        return d;
    }

    /** Código virtual de una tecla por nombre (xdotool o común) o por carácter según la distribución actual. */
    static ushort CodigoTecla(string nombre, out bool conShift)
    {
        conShift = false;
        ushort vk;
        if (NOMBRES.TryGetValue(nombre, out vk)) return vk;
        char simbolo;
        if (SIMBOLOS.TryGetValue(nombre, out simbolo)) nombre = simbolo.ToString();
        if (nombre.Length == 1)
        {
            char c = nombre[0];
            if (c >= 'a' && c <= 'z') return (ushort)(0x41 + (c - 'a'));
            if (c >= 'A' && c <= 'Z') return (ushort)(0x41 + (c - 'A'));
            if (c >= '0' && c <= '9') return (ushort)(0x30 + (c - '0'));
            short r = VkKeyScan(c);
            if (r != -1) { conShift = ((r >> 8) & 1) != 0; return (ushort)(r & 0xFF); }
        }
        throw new Exception("Tecla no reconocida: " + nombre);
    }

    static List<ushort> Modificadores(string mods)
    {
        List<ushort> l = new List<ushort>();
        if (string.IsNullOrEmpty(mods)) return l;
        foreach (string p in mods.Split('+'))
        {
            string t = p.Trim();
            if (t.Length == 0) continue;
            bool s; l.Add(CodigoTecla(t, out s));
        }
        return l;
    }

    /** Combinación estilo xdotool: "ctrl+s", "alt+Tab", "Return", "super", "ctrl+shift+t". */
    public static string Teclas(string combo, int repetir)
    {
        string[] partes = combo.Split('+');
        List<ushort> mods = new List<ushort>();
        for (int i = 0; i < partes.Length - 1; i++) { bool s; mods.Add(CodigoTecla(partes[i].Trim(), out s)); }
        bool conShift;
        string ultima = partes[partes.Length - 1].Trim();
        if (ultima.Length == 0 && combo.EndsWith("+")) ultima = "plus";
        ushort vk = CodigoTecla(ultima, out conShift);
        if (conShift && !mods.Contains(0xA0)) mods.Add(0xA0);
        foreach (ushort m in mods) Tecla(m, false);
        for (int i = 0; i < Math.Max(1, Math.Min(100, repetir)); i++) { Tecla(vk, false); Thread.Sleep(15); Tecla(vk, true); Thread.Sleep(25); }
        for (int i = mods.Count - 1; i >= 0; i--) Tecla(mods[i], true);
        Thread.Sleep(60);
        return "OK";
    }

    public static string MantenerTecla(string combo, double segundos)
    {
        string[] partes = combo.Split('+');
        List<ushort> teclas = new List<ushort>();
        foreach (string p in partes) { bool s; teclas.Add(CodigoTecla(p.Trim(), out s)); }
        foreach (ushort t in teclas) Tecla(t, false);
        Thread.Sleep((int)(Math.Max(0.05, Math.Min(60, segundos)) * 1000));
        for (int i = teclas.Count - 1; i >= 0; i--) Tecla(teclas[i], true);
        return "OK";
    }

    /**
     * Teclea texto carácter por carácter con la tecla real de la distribución actual
     * (Shift/AltGr incluidos); lo que no tiene tecla va como Unicode. "\n" = Enter.
     */
    public static string Teclear(string texto, int pausaMs)
    {
        foreach (char c in texto)
        {
            if (c == '\r') continue;
            if (c == '\n') { Tecla(0x0D, false); Tecla(0x0D, true); Thread.Sleep(pausaMs); continue; }
            if (c == '\t') { Tecla(0x09, false); Tecla(0x09, true); Thread.Sleep(pausaMs); continue; }
            short r = VkKeyScan(c);
            int estado = (r >> 8) & 0xFF;
            if (r == -1 || estado > 7) { Unicode(c); Thread.Sleep(pausaMs); continue; }
            ushort vk = (ushort)(r & 0xFF);
            bool shift = (estado & 1) != 0, ctrl = (estado & 2) != 0, alt = (estado & 4) != 0;
            if (ctrl && alt) { Tecla(0xA2, false); Tecla(0xA5, false); }       // AltGr (p. ej. @ en teclado latinoamericano)
            else { if (ctrl) Tecla(0xA2, false); if (alt) Tecla(0xA4, false); }
            if (shift) Tecla(0xA0, false);
            Tecla(vk, false); Tecla(vk, true);
            if (shift) Tecla(0xA0, true);
            if (ctrl && alt) { Tecla(0xA5, true); Tecla(0xA2, true); }
            else { if (alt) Tecla(0xA4, true); if (ctrl) Tecla(0xA2, true); }
            Thread.Sleep(pausaMs);
        }
        return "OK";
    }

    // ── Credenciales (Administrador de credenciales de Windows) ─────────────
    /**
     * Escribe el usuario o la contraseña de una credencial genérica guardada en
     * Windows (cmdkey /generic:NOMBRE /user:U /pass:P). El secreto NUNCA sale de
     * este proceso: no se devuelve, no se registra. campo: "usuario" | "clave".
     */
    public static string EscribirCredencial(string objetivo, string campo, bool enter, int pausaMs)
    {
        IntPtr p;
        if (!CredRead(objetivo, 1, 0, out p)) throw new Exception("No existe la credencial '" + objetivo + "' en el Administrador de credenciales de Windows (créala con: cmdkey /generic:" + objetivo + " /user:USUARIO /pass:CLAVE).");
        try
        {
            CREDENCIAL c = (CREDENCIAL)Marshal.PtrToStructure(p, typeof(CREDENCIAL));
            string valor = campo == "usuario" ? c.UserName : Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
            if (string.IsNullOrEmpty(valor)) throw new Exception("La credencial '" + objetivo + "' no tiene " + campo + ".");
            Teclear(valor, pausaMs);
            valor = null;
            if (enter) { Tecla(0x0D, false); Tecla(0x0D, true); }
        }
        finally { CredFree(p); }
        return "OK";
    }

    public static bool ExisteCredencial(string objetivo)
    {
        IntPtr p;
        if (!CredRead(objetivo, 1, 0, out p)) return false;
        CredFree(p);
        return true;
    }

    // ── Mantener el PC despierto mientras dure la sesión ────────────────────
    public static string Despierto(bool activo)
    {
        // ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED: sin suspensión, sin apagar pantalla
        // (vale mientras viva este proceso, que es el trabajador de la sesión).
        SetThreadExecutionState(activo ? 0x80000003u : 0x80000000u);
        return "OK";
    }
}
