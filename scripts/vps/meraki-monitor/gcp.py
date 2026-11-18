"""
Acceso de SOLO LECTURA a Google Cloud (Logging y Monitoring) para Meraki Monitor.
Sin librerías de Google: firma el JWT con `cryptography` y usa las APIs REST.
Llave: /etc/meraki-monitor-sa.json (cuenta meraki-monitor-lector, roles
Visualizador de registros + Visualizador de Monitoring).
"""
import base64
import json
import time
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

SA_FILE = '/etc/meraki-monitor-sa.json'
SCOPE = 'https://www.googleapis.com/auth/logging.read https://www.googleapis.com/auth/monitoring.read'
_token = {'value': None, 'exp': 0}


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=')


def token():
    if _token['value'] and time.time() < _token['exp'] - 60:
        return _token['value']
    sa = json.load(open(SA_FILE))
    now = int(time.time())
    header = _b64(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
    claims = _b64(json.dumps({'iss': sa['client_email'], 'scope': SCOPE, 'aud': sa['token_uri'],
                              'iat': now, 'exp': now + 3600}).encode())
    key = serialization.load_pem_private_key(sa['private_key'].encode(), password=None)
    sig = _b64(key.sign(header + b'.' + claims, padding.PKCS1v15(), hashes.SHA256()))
    body = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                                   'assertion': (header + b'.' + claims + b'.' + sig).decode()}).encode()
    r = json.load(urllib.request.urlopen(sa['token_uri'], data=body, timeout=15))
    _token.update(value=r['access_token'], exp=now + int(r.get('expires_in', 3600)))
    return _token['value']


def _req(url, payload=None):
    req = urllib.request.Request(url, data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=30))


def logs(project, flt, minutes=5, limit=50):
    """Entradas de Cloud Logging del proyecto en los últimos `minutes`."""
    since = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - minutes * 60))
    r = _req('https://logging.googleapis.com/v2/entries:list', {
        'resourceNames': [f'projects/{project}'],
        'filter': f'timestamp>="{since}" AND ({flt})',
        'orderBy': 'timestamp desc', 'pageSize': limit,
    })
    return r.get('entries', [])


def metric_sum(project, metric_type, minutes=10, extra=''):
    """Suma de una métrica (DELTA/contador) en los últimos `minutes`."""
    end = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    start = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - minutes * 60))
    q = urllib.parse.urlencode({
        'filter': f'metric.type="{metric_type}"' + (f' AND {extra}' if extra else ''),
        'interval.startTime': start, 'interval.endTime': end,
        'aggregation.alignmentPeriod': f'{minutes * 60}s',
        'aggregation.perSeriesAligner': 'ALIGN_SUM',
        'aggregation.crossSeriesReducer': 'REDUCE_SUM',
    })
    r = _req(f'https://monitoring.googleapis.com/v3/projects/{project}/timeSeries?{q}')
    total = 0
    for ts in r.get('timeSeries', []):
        for p in ts.get('points', []):
            v = p['value']
            total += int(v.get('int64Value', 0)) + float(v.get('doubleValue', 0))
    return total
