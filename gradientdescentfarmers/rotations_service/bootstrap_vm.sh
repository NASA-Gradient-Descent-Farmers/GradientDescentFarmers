#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
exec 9>/var/lock/farm-rotations-bootstrap.lock
flock -n 9 || exit 0
meta() { curl --retry 5 -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
ROT_BASE=/opt/farm-rotations
ROT_STATE=/srv/farm-rotations
ROT_SOURCE_URI=$(meta rotations-source-uri)
ROT_SOURCE_SHA=$(meta rotations-source-sha)
ROT_REFERENCE_URI=$(meta rotations-reference-uri)
ROT_REFERENCE_SHA=$(meta rotations-reference-sha)
ROT_REVISION=$(meta rotations-source-revision)
ROT_BUCKET=$(meta rotations-bucket)
ROT_INPUT_BUCKET=$(meta farm-source-bucket)
ROT_PROJECT=$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/project/project-id)
export ROT_BASE ROT_STATE ROT_SOURCE_URI ROT_SOURCE_SHA ROT_REFERENCE_URI ROT_REFERENCE_SHA
mkdir -p "$ROT_BASE/releases" "$ROT_STATE"
if ! mountpoint -q "$ROT_STATE"; then
  ROT_DEVICE=/dev/disk/by-id/google-farm-rotations-data
  for attempt in $(seq 1 30); do test -b "$ROT_DEVICE" && break; sleep 2; done
  test -b "$ROT_DEVICE"
  if ! blkid "$ROT_DEVICE" >/dev/null; then mkfs.ext4 -m 0 "$ROT_DEVICE"; fi
  ROT_UUID=$(blkid -s UUID -o value "$ROT_DEVICE")
  if ! grep -q "UUID=$ROT_UUID " /etc/fstab; then
    printf 'UUID=%s %s ext4 defaults,nofail 0 2\n' "$ROT_UUID" "$ROT_STATE" >>/etc/fstab
  fi
  mount "$ROT_STATE"
fi
if ! test -x "$ROT_BASE/venv/bin/python"; then
  apt-get update
  apt-get install -y python3-venv python3-pip ca-certificates
  python3 -m venv "$ROT_BASE/venv"
fi
python3 - <<'PY'
import hashlib, json, os, pathlib, tarfile, urllib.parse, urllib.request
req = urllib.request.Request('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', headers={'Metadata-Flavor':'Google'})
with urllib.request.urlopen(req, timeout=30) as response:
    token = json.load(response)['access_token']
for uri, sha, destination in [
    (os.environ['ROT_SOURCE_URI'], os.environ['ROT_SOURCE_SHA'], pathlib.Path(os.environ['ROT_BASE'])/'releases'/os.environ['ROT_SOURCE_SHA']),
    (os.environ['ROT_REFERENCE_URI'], os.environ['ROT_REFERENCE_SHA'], pathlib.Path(os.environ['ROT_STATE'])/'reference'/os.environ['ROT_REFERENCE_SHA']),
]:
    if (destination/'.extracted').exists():
        continue
    parsed = urllib.parse.urlsplit(uri)
    obj = urllib.parse.quote(parsed.path.lstrip('/'), safe='')
    req = urllib.request.Request(f'https://storage.googleapis.com/storage/v1/b/{parsed.netloc}/o/{obj}?alt=media', headers={'Authorization':f'Bearer {token}'})
    archive = pathlib.Path(os.environ['ROT_BASE'])/(sha+'.tar.gz')
    with urllib.request.urlopen(req, timeout=120) as response, archive.open('wb') as output:
        while chunk := response.read(1024*1024):
            output.write(chunk)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != sha:
        raise RuntimeError('deployment archive SHA256 mismatch')
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as package:
        for member in package.getmembers():
            if not member.isfile() or not (destination/member.name).resolve().is_relative_to(destination.resolve()):
                raise RuntimeError('unsafe deployment archive member')
        package.extractall(destination)
    (destination/'.extracted').touch()
PY
if ! test -f "$ROT_BASE/releases/$ROT_SOURCE_SHA/.installed"; then
  "$ROT_BASE/venv/bin/python" -m pip install --upgrade pip
  "$ROT_BASE/venv/bin/python" -m pip install -e "$ROT_BASE/releases/$ROT_SOURCE_SHA[rotations,gcs,source-cloud]"
  "$ROT_BASE/venv/bin/python" -m pip freeze >"$ROT_BASE/releases/$ROT_SOURCE_SHA/installed-requirements.txt"
  touch "$ROT_BASE/releases/$ROT_SOURCE_SHA/.installed"
fi
"$ROT_BASE/venv/bin/python" - <<'PY'
import json
import numpy
import pandas
import pyarrow
assert pyarrow.array(numpy.array([1.0])).to_pylist() == [1.0]
print(json.dumps({'runtime_check': 'ok', 'numpy': numpy.__version__,
                  'pandas': pandas.__version__, 'pyarrow': pyarrow.__version__}))
PY
ln -sfn "$ROT_BASE/releases/$ROT_SOURCE_SHA" "$ROT_BASE/current"
id -u farmrotations >/dev/null 2>&1 || useradd --system --home-dir "$ROT_STATE" --shell /usr/sbin/nologin farmrotations
mkdir -p "$ROT_STATE/profiles" "$ROT_STATE/cache" "$ROT_STATE/runs"
chown -R farmrotations:farmrotations "$ROT_STATE"
chmod 750 "$ROT_STATE"
cat >/etc/farm-rotations.env <<EOF
ROTATIONS_STATE=$ROT_STATE
ROTATIONS_REFERENCE_ROOT=$ROT_STATE/reference/$ROT_REFERENCE_SHA
ROTATIONS_BUCKET=$ROT_BUCKET
FARM_SOURCE_BUCKET=$ROT_INPUT_BUCKET
GOOGLE_CLOUD_PROJECT=$ROT_PROJECT
ROTATIONS_SOURCE_REVISION=$ROT_REVISION
ROTATIONS_SOURCE_SHA256=$ROT_SOURCE_SHA
ROTATIONS_REFERENCE_SHA256=$ROT_REFERENCE_SHA
PYTHONUNBUFFERED=1
EOF
for ROT_ROLE in api worker; do
  if test "$ROT_ROLE" = api; then ROT_ARGS='api --host 0.0.0.0 --port 8081'; else ROT_ARGS='worker'; fi
  cat >"/etc/systemd/system/farm-rotations-$ROT_ROLE.service" <<EOF
[Unit]
Description=Farm rotations $ROT_ROLE
After=network-online.target
Wants=network-online.target
RequiresMountsFor=$ROT_STATE
[Service]
User=farmrotations
Group=farmrotations
WorkingDirectory=$ROT_BASE/current
EnvironmentFile=/etc/farm-rotations.env
ExecStart=$ROT_BASE/venv/bin/python -m gradientdescentfarmers.rotations_service $ROT_ARGS
Restart=always
RestartSec=5
TimeoutStopSec=60
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$ROT_STATE
[Install]
WantedBy=multi-user.target
EOF
done
systemctl daemon-reload
systemctl enable --now farm-rotations-api farm-rotations-worker
touch "$ROT_STATE/bootstrap-ready"
