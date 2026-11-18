#!/usr/bin/env python3
"""
Meraki Monitor — vigilancia de seguridad y salud del VPS.

Se ejecuta cada 2 minutos (systemd timer). Revisa servicios, recursos, accesos y
cambios en archivos críticos. Avisa por Telegram SOLO cuando algo cambia de estado
(falla → avisa una vez; se recupera → avisa "recuperado"), para no saturar.

Autocorrección (lista cerrada, nada más):
  - reiniciar procesos pm2 caídos de la lista PM2_EXPECTED
  - arrancar el contenedor docker de Gotenberg
  - reiniciar nginx / fail2ban si están inactivos
Máximo 3 intentos por hora por servicio; si sigue fallando, solo avisa.

Uso:
  monitor.py            → una ronda de chequeos
  monitor.py --summary  → resumen diario
  monitor.py --test     → envía un mensaje de prueba
Config: /etc/meraki-monitor.env (TELEGRAM_TOKEN, TELEGRAM_CHAT_ID)
"""
import hashlib
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

STATE_FILE = '/var/lib/meraki-monitor/state.json'
LOG_FILE = '/var/log/meraki-monitor.log'
ENV_FILE = '/etc/meraki-monitor.env'
HOST = socket.gethostname()
TZ = timezone(timedelta(hours=-5))  # Bogotá

PM2_EXPECTED = ['asistente', 'advisor-whatsapp-bridge']
DOCKER_EXPECTED = ['gotenberg']
SYSTEMD_EXPECTED = ['nginx', 'fail2ban', 'ssh', 'docker', 'ufw']
SYSTEMD_AUTOFIX = ['nginx', 'fail2ban']
# nombre → (url, texto que debe aparecer en la página o None)
# Sin texto: vale cualquier respuesta < 500 (404/403/405 = el servicio está vivo).
HTTP_CHECKS = {
    # — Servicios de este VPS —
    'Gotenberg (PDF contratos)': ('http://127.0.0.1:3100/health', None),
    'Puente WhatsApp asesor': ('http://127.0.0.1:3333/', None),
    'Bot asistente (bot.)': ('https://bot.grupoconstructormeraki.com.co/', None),
    # La raíz de app. era el meraki-server (apagado 2026-11-17, da 502 a propósito);
    # lo que el CRM usa de ese dominio son estas dos rutas.
    'app. → puente WhatsApp': ('https://app.grupoconstructormeraki.com.co/advisor-whatsapp/', None),
    'app. → PDF de contratos': ('https://app.grupoconstructormeraki.com.co/docx-pdf/', None),
    # — Sistemas externos (Hostinger + Firebase) —
    'CRM web (crm.)': ('https://crm.grupoconstructormeraki.com.co/', 'Meraki CRM'),
    'Página web (grupoconstructormeraki.com.co)': ('https://grupoconstructormeraki.com.co/', 'Meraki'),
    # Formularios PHP de la página (Hostinger): 405 a un GET = el PHP está vivo; 5xx = roto.
    'Página web → formulario de citas': ('https://grupoconstructormeraki.com.co/enviar-cita-meraki.php', None),
    'Página web → formulario de referidos': ('https://grupoconstructormeraki.com.co/send-referidos.php', None),
    'Página web → conversiones Meta': ('https://grupoconstructormeraki.com.co/meta-conversions.php', None),
    'Solicitudes y Peticiones (web)': ('https://solicitudesypeticiones.grupoconstructormeraki.com.co/', 'Derechos de Petici'),
    'CRM servidor (Firebase Functions)': ('https://us-central1-crm-conversacional.cloudfunctions.net/ycloudWebhook', None),
    'Peticiones servidor (Firebase Functions)': ('https://us-central1-control-derecho-peticiones.cloudfunctions.net/downloadPetitionFile', None),
}
HTTP_FAILS_BEFORE_ALERT = 2   # fallas seguidas antes de avisar (evita falsas alarmas por un parpadeo de red)
CERT_DOMAINS = [
    'bot.grupoconstructormeraki.com.co', 'app.grupoconstructormeraki.com.co',
    'crm.grupoconstructormeraki.com.co', 'grupoconstructormeraki.com.co',
    'solicitudesypeticiones.grupoconstructormeraki.com.co',
]
INTEGRITY_FILES = [
    '/root/.ssh/authorized_keys', '/etc/ssh/sshd_config', '/etc/passwd', '/etc/sudoers',
    '/etc/crontab', '/etc/shadow', '/etc/group',
]
INTEGRITY_DIRS = ['/etc/ssh/sshd_config.d', '/etc/sudoers.d', '/var/spool/cron/crontabs', '/etc/cron.d']
DISK_LIMIT = 85        # % usado
MEM_MIN_AVAIL = 10     # % disponible
LOAD_LIMIT = 3.0       # carga de 5 min (1 CPU)
BANS_PER_HOUR = 30
MAX_FIX_PER_HOUR = 3


# ── utilidades ──────────────────────────────────────────────────────────────
def now():
    return datetime.now(TZ)


def log(msg):
    line = f"{now():%Y-%m-%d %H:%M:%S} {msg}"
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line + '\n')
    except OSError:
        pass
    if sys.stdout.isatty():
        print(line)


def run(cmd, timeout=30):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or '').strip()
    except Exception as e:  # noqa: BLE001
        return 1, str(e)


def load_env():
    env = {}
    try:
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


def telegram(text):
    env = load_env()
    token, chat = env.get('TELEGRAM_TOKEN'), env.get('TELEGRAM_CHAT_ID')
    if not token or not chat:
        log('[sin Telegram configurado] ' + text.replace('\n', ' | '))
        return False
    data = urllib.parse.urlencode({'chat_id': chat, 'text': text[:4000], 'parse_mode': 'HTML',
                                   'disable_web_page_preview': 'true'}).encode()
    try:
        urllib.request.urlopen(f'https://api.telegram.org/bot{token}/sendMessage', data=data, timeout=15)
        return True
    except Exception as e:  # noqa: BLE001
        log(f'error enviando Telegram: {e}')
        return False


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(st):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(st, f, indent=1)
    os.replace(tmp, STATE_FILE)


def sha(path):
    try:
        with open(path, 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return 'ausente'


def can_fix(st, key):
    hist = [t for t in st.setdefault('fixes', {}).get(key, []) if time.time() - t < 3600]
    st['fixes'][key] = hist
    return len(hist) < MAX_FIX_PER_HOUR


def mark_fix(st, key):
    st.setdefault('fixes', {}).setdefault(key, []).append(time.time())


# ── chequeos: cada uno devuelve {clave: (ok, detalle)} ──────────────────────
def check_pm2(st, fixed):
    out = {}
    code, raw = run('pm2 jlist')
    try:
        procs = {p['name']: p for p in json.loads(raw)} if code == 0 else {}
    except ValueError:
        procs = {}
    restarts = st.setdefault('pm2_restarts', {})
    for name in PM2_EXPECTED:
        p = procs.get(name)
        status = p['pm2_env']['status'] if p else 'no existe'
        ok = status == 'online'
        if not ok and can_fix(st, 'pm2:' + name):
            run(f'pm2 restart {name}')
            mark_fix(st, 'pm2:' + name)
            time.sleep(5)
            code, raw2 = run('pm2 jlist')
            try:
                p2 = {q['name']: q for q in json.loads(raw2)}.get(name)
                if p2 and p2['pm2_env']['status'] == 'online':
                    fixed.append(f'Reinicié <b>{name}</b> (estaba {status}).')
                    ok, status = True, 'online (reiniciado)'
            except ValueError:
                pass
        out['pm2:' + name] = (ok, f'Proceso {name}: {status}')
        if p:
            rt = p['pm2_env'].get('restart_time', 0)
            prev = restarts.get(name, rt)
            restarts[name] = rt
            crash = rt - prev >= 3
            out['pm2crash:' + name] = (not crash, f'{name} se reinició {rt - prev} veces en 2 min (posible bucle de fallos)')
    return out


def check_docker(st, fixed):
    out = {}
    code, raw = run("docker ps --format '{{.Names}}'")
    running = set(raw.split()) if code == 0 else set()
    for name in DOCKER_EXPECTED:
        ok = name in running
        if not ok and can_fix(st, 'docker:' + name):
            run(f'docker start {name}')
            mark_fix(st, 'docker:' + name)
            time.sleep(5)
            if name in set(run("docker ps --format '{{.Names}}'")[1].split()):
                fixed.append(f'Arranqué el contenedor <b>{name}</b>.')
                ok = True
        out['docker:' + name] = (ok, f'Contenedor {name}: {"corriendo" if ok else "detenido"}')
    return out


def check_systemd(st, fixed):
    out = {}
    for svc in SYSTEMD_EXPECTED:
        code, state = run(f'systemctl is-active {svc}')
        ok = state == 'active'
        if not ok and svc in SYSTEMD_AUTOFIX and can_fix(st, 'svc:' + svc):
            run(f'systemctl restart {svc}')
            mark_fix(st, 'svc:' + svc)
            time.sleep(3)
            if run(f'systemctl is-active {svc}')[1] == 'active':
                fixed.append(f'Reinicié el servicio <b>{svc}</b>.')
                ok, state = True, 'active (reiniciado)'
        out['svc:' + svc] = (ok, f'Servicio {svc}: {state}')
    code, ufw = run('ufw status')
    out['ufw:activo'] = ('Status: active' in ufw, 'Firewall (ufw) ' + ('activo' if 'Status: active' in ufw else 'INACTIVO'))
    return out


def check_http(st):
    out = {}
    ctx = ssl.create_default_context()
    fails = st.setdefault('http_fails', {})
    for name, (url, expect) in HTTP_CHECKS.items():
        body = ''
        try:
            req = urllib.request.Request(url, method='GET', headers={'User-Agent': 'meraki-monitor'})
            with urllib.request.urlopen(req, timeout=15, context=ctx if url.startswith('https') else None) as r:
                code = r.status
                if expect:
                    body = r.read(200_000).decode('utf-8', 'ignore')
        except urllib.error.HTTPError as e:
            code = e.code
        except Exception as e:  # noqa: BLE001
            code = str(e)[:80]
        if isinstance(code, int) and code == 429:
            ok, detail = False, f'{name} responde 429 (límite de Google: revisar FACTURACIÓN del proyecto en GCP)'
        elif not isinstance(code, int) or code >= 500:
            ok, detail = False, f'{name} no responde ({code})'
        elif expect and expect not in body:
            ok, detail = False, f'{name} responde {code} pero NO muestra la página esperada (¿sitio suspendido o modificado?)'
        else:
            ok, detail = True, f'{name} responde {code}'
        # Solo se considera caído tras varias fallas seguidas (un parpadeo de red no es una caída).
        fails[name] = 0 if ok else fails.get(name, 0) + 1
        if not ok and fails[name] < HTTP_FAILS_BEFORE_ALERT:
            ok = True
        out['http:' + name] = (ok, detail)
    return out


def check_resources():
    out = {}
    du = shutil.disk_usage('/')
    pct = round(du.used * 100 / du.total)
    out['disco'] = (pct < DISK_LIMIT, f'Disco al {pct}%')
    mem = {}
    with open('/proc/meminfo') as f:
        for line in f:
            k, v = line.split(':', 1)
            mem[k] = int(v.split()[0])
    avail = round(mem['MemAvailable'] * 100 / mem['MemTotal'])
    out['memoria'] = (avail >= MEM_MIN_AVAIL, f'Memoria disponible {avail}%')
    load5 = os.getloadavg()[1]
    out['carga'] = (load5 < LOAD_LIMIT, f'Carga del procesador {load5:.1f}')
    return out


def check_certs():
    out = {}
    for d in CERT_DOMAINS:
        try:
            ctx = ssl.create_default_context()
            with socket.create_connection((d, 443), timeout=10) as s, ctx.wrap_socket(s, server_hostname=d) as ss:
                exp = datetime.strptime(ss.getpeercert()['notAfter'], '%b %d %H:%M:%S %Y %Z')
            days = (exp - datetime.now(timezone.utc).replace(tzinfo=None)).days
            out['cert:' + d] = (days >= 14, f'Certificado de {d} vence en {days} días')
        except Exception as e:  # noqa: BLE001
            out['cert:' + d] = (False, f'Certificado de {d}: error {str(e)[:80]}')
    return out


def check_integrity(st):
    """Avisa cuando cambia un archivo crítico (llaves SSH, usuarios, sudo, cron, sshd)."""
    events = []
    base = st.setdefault('integrity', {})
    files = list(INTEGRITY_FILES)
    for d in INTEGRITY_DIRS:
        if os.path.isdir(d):
            files += [os.path.join(d, n) for n in sorted(os.listdir(d))]
    current = {f: sha(f) for f in files}
    if base:
        for f, h in current.items():
            if f not in base:
                events.append(f'Archivo crítico NUEVO: <code>{f}</code>')
            elif base[f] != h:
                events.append(f'Archivo crítico MODIFICADO: <code>{f}</code>')
        for f in base:
            if f not in current:
                events.append(f'Archivo crítico ELIMINADO: <code>{f}</code>')
    st['integrity'] = current
    return events


def check_ports(st):
    """Avisa si aparece un puerto nuevo escuchando (posible servicio no autorizado)."""
    code, raw = run("ss -H -tlnp")
    ports = set()
    for line in raw.splitlines():
        parts = line.split()
        if len(parts) >= 4:
            m = re.search(r'"([^"]+)"', line)
            ports.add(f"{parts[3]} ({m.group(1) if m else '?'})")
    events = []
    base = st.get('ports')
    if base is not None:
        for p in sorted(ports - set(base)):
            events.append(f'Puerto NUEVO escuchando: <code>{p}</code>')
    st['ports'] = sorted(ports)
    return events


def check_auth(st):
    """Ingresos SSH exitosos (cada uno se avisa) y bloqueos de fail2ban."""
    events = []
    since = st.get('auth_since', int(time.time()) - 180)
    known = {ip.strip() for ip in load_env().get('KNOWN_SSH_IPS', '').split(',') if ip.strip()}
    code, raw = run(f"journalctl -u ssh --since=@{since} --no-pager -o cat 2>/dev/null | grep -E 'Accepted '")
    seen = set()
    for line in raw.splitlines():
        m = re.search(r'Accepted (\S+) for (\S+) from (\S+)', line)
        if not m:
            continue
        user, ip, method = m.group(2), m.group(3), m.group(1)
        st.setdefault('logins_today', {}).setdefault(now().strftime('%Y-%m-%d'), []).append(ip)
        # Ingresos desde IP conocidas (la oficina) solo se registran; los demás se avisan.
        if ip in known or (user, ip) in seen:
            continue
        seen.add((user, ip))
        events.append(f'Ingreso SSH desde IP DESCONOCIDA: usuario <b>{user}</b> desde <code>{ip}</code> ({method}). '
                      f'Si no fuiste tú, avisa de inmediato.')
    st['auth_since'] = int(time.time())
    code, raw = run("fail2ban-client status sshd 2>/dev/null")
    total = int((re.search(r'Total banned:\s*(\d+)', raw) or [0, 0])[1]) if raw else 0
    hist = [x for x in st.get('bans', []) if time.time() - x[0] < 3600] + [[time.time(), total]]
    st['bans'] = hist
    delta = total - hist[0][1]
    st['bans_total'] = total
    return events, delta


# ── Google Cloud (registros y métricas, solo lectura) ───────────────────────
GCP_PROJECTS = {'crm-conversacional': 'CRM', 'control-derecho-peticiones': 'Peticiones'}
CLOUD_EVERY = 300            # segundos entre consultas a Google Cloud
ERR_PER_FN = 10              # errores de una misma función en 10 min
ERR_TOTAL = 25               # errores totales en 10 min
READS_LIMIT = 200_000        # lecturas Firestore en 10 min (normal p99 ≈ 34k)
SPA_SITES = {'CRM web': 'https://crm.grupoconstructormeraki.com.co/',
             'Solicitudes y Peticiones': 'https://solicitudesypeticiones.grupoconstructormeraki.com.co/',
             'Página web': 'https://grupoconstructormeraki.com.co/'}


def _msg(entry):
    return (entry.get('jsonPayload', {}).get('message') or entry.get('textPayload') or '').strip()


def _fn(entry):
    labels = entry.get('resource', {}).get('labels', {})
    return labels.get('service_name') or labels.get('function_name') or entry.get('resource', {}).get('type', '?')


def check_cloud(st):
    """Devuelve (estados, eventos). Estados con transición; eventos se avisan una vez."""
    out, events = {}, []
    if time.time() - st.get('cloud_checked', 0) < CLOUD_EVERY:
        return {k: tuple(v) for k, v in st.get('status', {}).items() if k.startswith('cloud:')}, []
    try:
        import gcp
    except Exception as e:  # noqa: BLE001
        log(f'gcp no disponible: {e}')
        return out, events
    window = min(60, max(10, int((time.time() - st.get("cloud_checked", time.time() - 600)) / 60) + 1))
    seen = set(st.get('cloud_seen', []))
    for proj, label in GCP_PROJECTS.items():
        # 1) Registros de seguridad que dejamos en el código ([SECURITY])
        try:
            sec = gcp.logs(proj, 'textPayload:"[SECURITY]" OR jsonPayload.message:"[SECURITY]"', minutes=window, limit=20)
            for x in sec:
                if x.get('insertId') in seen:
                    continue
                seen.add(x.get('insertId'))
                events.append(f'{label} · alerta de seguridad en <b>{_fn(x)}</b>: {_msg(x)[:200]}')
            out[f'cloud:logs:{proj}'] = (True, f'{label}: lectura de registros OK')
        except urllib.error.HTTPError as e:
            out[f'cloud:logs:{proj}'] = (False, f'{label}: el agente no puede leer los registros (HTTP {e.code}); revisar permisos de meraki-monitor-lector')
            continue
        except Exception as e:  # noqa: BLE001
            log(f'cloud {proj} seguridad: {e}')
            continue
        # 2) Ráfagas de errores y señales de facturación/cuota
        try:
            errs = gcp.logs(proj, 'severity>=ERROR', minutes=10, limit=500)
            per = {}
            for x in errs:
                per[_fn(x)] = per.get(_fn(x), 0) + 1
            top = sorted(per.items(), key=lambda kv: -kv[1])[:3]
            burst = len(errs) >= ERR_TOTAL or (top and top[0][1] >= ERR_PER_FN)
            out[f'cloud:errores:{proj}'] = (not burst, f'{label}: {len(errs)} errores en 10 min'
                                            + (' (más: ' + ', '.join(f'{f} {n}' for f, n in top) + ')' if top else ''))
            quota = sum(1 for x in errs if re.search(r'Rate exceeded|RESOURCE_EXHAUSTED|billing|429', _msg(x), re.I))
            out[f'cloud:cuota:{proj}'] = (quota < 5, f'{label}: {quota} errores de cuota/429 en 10 min (revisar FACTURACIÓN en GCP)')
        except Exception as e:  # noqa: BLE001
            log(f'cloud {proj} errores: {e}')
        # 3) Lecturas de Firestore anormales
        try:
            reads = int(gcp.metric_sum(proj, 'firestore.googleapis.com/document/read_count', minutes=10))
            out[f'cloud:lecturas:{proj}'] = (reads < READS_LIMIT,
                                            f'{label}: {reads:,} lecturas de base de datos en 10 min (lo normal es < 35.000)'.replace(',', '.'))
        except Exception as e:  # noqa: BLE001
            log(f'cloud {proj} lecturas: {e}')
    # 4) Cambios de rol / usuarios nuevos en el CRM (trigger UserClaims)
    try:
        claims = st.setdefault('claims', {})
        baseline = bool(claims)
        for x in reversed(gcp.logs('crm-conversacional', 'jsonPayload.message:"[UserClaims]"', minutes=window, limit=200)):
            ctx = x.get('jsonPayload', {}).get('context', {})
            uid = ctx.get('userId')
            if not uid:
                continue
            cur = {'role': ctx.get('role'), 'admin': bool(ctx.get('platformAdmin')), 'active': ctx.get('active')}
            prev = claims.get(uid)
            if prev != cur and baseline:
                if prev is None:
                    events.append(f'CRM · usuario NUEVO <code>{uid}</code> con rol <b>{cur["role"]}</b>')
                else:
                    cambios = [f'{k}: {prev.get(k)} → {cur[k]}' for k in cur if prev.get(k) != cur[k]]
                    events.append(f'CRM · cambio de permisos de <code>{uid}</code>: ' + ', '.join(cambios))
            if cur['admin'] and (prev is None or not prev.get('admin')):
                events.append(f'🚨 CRM · <code>{uid}</code> tiene permisos de SUPERADMINISTRADOR (platformAdmin). Si no fue autorizado, avisa de inmediato.')
            claims[uid] = cur
    except Exception as e:  # noqa: BLE001
        log(f'cloud claims: {e}')
    # 5) Cambios en los archivos de las apps web (versión nueva o alteración no autorizada).
    #    Huella = página principal + su archivo JavaScript principal: si alguien edita
    #    cualquiera de los dos en Hostinger, la huella cambia.
    builds = st.setdefault('builds', {})
    for name, url in SPA_SITES.items():
        try:
            get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'meraki-monitor'}), timeout=20).read(15_000_000)
            html = get(url)
            m = re.search(rb'/?assets/index-[A-Za-z0-9_-]+\.js', html)
            js = get(urllib.parse.urljoin(url, m.group(0).decode())) if m else b''
            print_ = hashlib.sha256(html + js).hexdigest()[:16]
            prev = builds.get(name)
            if prev and prev != print_:
                events.append(f'Cambiaron los archivos de <b>{name}</b> (versión nueva publicada o modificación). '
                              f'Si nadie del equipo la subió, avisa de inmediato.')
            builds[name] = print_
        except Exception as e:  # noqa: BLE001
            log(f'cloud builds {name}: {e}')
    st['cloud_seen'] = list(seen)[-500:]
    st['cloud_checked'] = time.time()
    return out, events


# ── rondas ──────────────────────────────────────────────────────────────────
def round_checks():
    st = load_state()
    first_run = 'status' not in st
    fixed = []
    results = {}
    for fn in (lambda: check_pm2(st, fixed), lambda: check_docker(st, fixed), lambda: check_systemd(st, fixed),
               lambda: check_http(st), check_resources):
        try:
            results.update(fn())
        except Exception as e:  # noqa: BLE001
            log(f'error en chequeo: {e}')
    if int(time.time()) - st.get('cert_checked', 0) > 6 * 3600:
        results.update(check_certs())
        st['cert_checked'] = int(time.time())
    else:
        results.update({k: tuple(v) for k, v in st.get('status', {}).items() if k.startswith('cert:')})
    cloud_events = []
    try:
        cloud_status, cloud_events = check_cloud(st)
        results.update(cloud_status)
    except Exception as e:  # noqa: BLE001
        log(f'error en chequeo de Google Cloud: {e}')

    prev = st.get('status', {})
    alerts, recovered = [], []
    for k, (ok, detail) in results.items():
        was_ok = prev.get(k, [True])[0]
        if not ok and (was_ok or first_run):
            alerts.append('🔴 ' + detail)
        elif ok and not was_ok and not first_run:
            recovered.append('🟢 ' + detail)
    st['status'] = {k: [ok, d] for k, (ok, d) in results.items()}

    security = list(cloud_events)
    try:
        security += check_integrity(st)
        security += check_ports(st)
        logins, bans = check_auth(st)
        security += logins
        if bans >= BANS_PER_HOUR:
            last = st.get('bans_alerted', 0)
            if time.time() - last > 3600:
                security.append(f'fail2ban bloqueó {bans} IP en la última hora (posible ataque de fuerza bruta; el bloqueo funciona).')
                st['bans_alerted'] = time.time()
    except Exception as e:  # noqa: BLE001
        log(f'error en chequeo de seguridad: {e}')

    save_state(st)
    parts = []
    if security:
        parts.append('🛡️ <b>Seguridad</b>\n' + '\n'.join('• ' + s for s in security))
    if alerts:
        parts.append('<b>Problemas</b>\n' + '\n'.join(alerts))
    if fixed:
        parts.append('🔧 <b>Autocorrección</b>\n' + '\n'.join('• ' + f for f in fixed))
    if recovered:
        parts.append('<b>Recuperado</b>\n' + '\n'.join(recovered))
    if parts:
        msg = f'⚠️ <b>Meraki VPS</b> ({HOST}) · {now():%d/%m %H:%M}\n\n' + '\n\n'.join(parts)
        log(msg.replace('\n', ' | '))
        telegram(msg)
    else:
        log('ok')


def summary():
    st = load_state()
    status = st.get('status', {})
    bad = [d for ok, d in status.values() if not ok]
    du = shutil.disk_usage('/')
    with open('/proc/meminfo') as f:
        mem = {l.split(':')[0]: int(l.split()[1]) for l in f}
    lines = [
        f'📋 <b>Resumen diario · Meraki VPS</b> ({now():%d/%m/%Y})',
        '',
        '✅ Todo en orden' if not bad else '🔴 Pendientes:\n' + '\n'.join('• ' + b for b in bad),
        '🌐 Sistemas: ' + ' · '.join(
            ('✅ ' if status.get('http:' + n, [True])[0] else '🔴 ') + n.split(' (')[0]
            for n in ('CRM web (crm.)', 'Página web (grupoconstructormeraki.com.co)',
                      'Solicitudes y Peticiones (web)', 'CRM servidor (Firebase Functions)',
                      'Peticiones servidor (Firebase Functions)')),
        f'💾 Disco {round(du.used * 100 / du.total)}% · Memoria libre {round(mem["MemAvailable"] * 100 / mem["MemTotal"])}%',
        f'🛡️ fail2ban: {st.get("bans_total", 0)} IP bloqueadas en total',
    ]
    yesterday = (now() - timedelta(days=1)).strftime('%Y-%m-%d')
    logins = st.get('logins_today', {})
    ips = logins.get(yesterday, [])
    if ips:
        lines.append(f'🔑 Ingresos SSH ayer: {len(ips)} (IP: {", ".join(sorted(set(ips)))})')
    st['logins_today'] = {k: v for k, v in logins.items() if k >= yesterday}
    save_state(st)
    certs = [d for k, (ok, d) in status.items() if k.startswith('cert:')]
    if certs:
        lines.append('🔒 ' + ' · '.join(c.replace('Certificado de ', '') for c in certs))
    if os.path.exists('/var/run/reboot-required'):
        lines.append('🔄 Hay actualizaciones del sistema que requieren reiniciar el servidor.')
    telegram('\n'.join(lines))
    log('resumen enviado')


if __name__ == '__main__':
    if '--test' in sys.argv:
        ok = telegram(f'✅ <b>Meraki Monitor</b> conectado en {HOST}. Te avisaré si algo falla o si hay actividad sospechosa.')
        print('enviado' if ok else 'no enviado (revisa token/chat id)')
    elif '--summary' in sys.argv:
        summary()
    else:
        round_checks()
