#!/bin/bash
# Installed as Compute Engine startup-script. No credentials are embedded here.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
exec 9>/var/lock/farm-builder-bootstrap.lock
flock -n 9 || exit 0

metadata() {
  curl --retry 5 -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"
}
BUILDER_STATE=/srv/farm-profile-builder
BUILDER_BASE=/opt/farm-profile-builder
BUILDER_SHA=$(metadata source-bundle-sha256)
BUILDER_RELEASE=$(metadata source-release-uri)
BUILDER_BUCKET=$(metadata farm-builder-bucket)
BUILDER_REVISION=$(metadata source-revision)
BUILDER_SECRET=$(metadata earthdata-secret-version)
BUILDER_PROJECT=$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/project/project-id)
export BUILDER_SHA BUILDER_RELEASE BUILDER_BASE

mkdir -p "$BUILDER_STATE" "$BUILDER_BASE/releases"
if ! mountpoint -q "$BUILDER_STATE"; then
  BUILDER_DEVICE=/dev/disk/by-id/google-farm-builder-data
  for attempt in $(seq 1 30); do
    test -b "$BUILDER_DEVICE" && break
    sleep 2
  done
  test -b "$BUILDER_DEVICE"
  # Format only a newly created, empty disk. Existing scientific data is retained.
  if ! blkid "$BUILDER_DEVICE" >/dev/null; then
    mkfs.ext4 -m 0 "$BUILDER_DEVICE"
  fi
  BUILDER_UUID=$(blkid -s UUID -o value "$BUILDER_DEVICE")
  if ! grep -q "UUID=$BUILDER_UUID " /etc/fstab; then
    printf 'UUID=%s %s ext4 defaults,nofail 0 2\n' "$BUILDER_UUID" "$BUILDER_STATE" >>/etc/fstab
  fi
  mount "$BUILDER_STATE"
fi

if ! test -x "$BUILDER_BASE/venv/bin/python"; then
  apt-get update
  apt-get install -y python3-venv python3-pip build-essential libhdf4-alt-dev ca-certificates
  python3 -m venv "$BUILDER_BASE/venv"
fi
python3 - <<'PY'
import hashlib, json, os, pathlib, tarfile, urllib.parse, urllib.request
base = pathlib.Path(os.environ['BUILDER_BASE'])
sha = os.environ['BUILDER_SHA']
destination = base / 'releases' / sha
if not (destination / 'source_manifest.json').is_file():
    uri = urllib.parse.urlsplit(os.environ['BUILDER_RELEASE'])
    request = urllib.request.Request(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        headers={'Metadata-Flavor': 'Google'})
    with urllib.request.urlopen(request, timeout=30) as response:
        token = json.load(response)['access_token']
    obj = urllib.parse.quote(uri.path.lstrip('/'), safe='')
    request = urllib.request.Request(
        f'https://storage.googleapis.com/storage/v1/b/{uri.netloc}/o/{obj}?alt=media',
        headers={'Authorization': f'Bearer {token}'})
    archive = base / (sha + '.tar.gz')
    with urllib.request.urlopen(request, timeout=120) as response, archive.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != sha:
        raise RuntimeError('source archive checksum mismatch')
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as bundle:
        for member in bundle.getmembers():
            if (not member.isfile() or
                    not (destination / member.name).resolve().is_relative_to(destination.resolve())):
                raise RuntimeError('unsafe source archive member')
        bundle.extractall(destination)
PY

if ! test -f "$BUILDER_BASE/releases/$BUILDER_SHA/.installed"; then
  "$BUILDER_BASE/venv/bin/python" -m pip install --upgrade pip
  "$BUILDER_BASE/venv/bin/python" -m pip install -e "$BUILDER_BASE/releases/$BUILDER_SHA[source,source-modis,gcs,source-cloud]"
  "$BUILDER_BASE/venv/bin/python" -m pip freeze >"$BUILDER_BASE/releases/$BUILDER_SHA/installed-requirements.txt"
  touch "$BUILDER_BASE/releases/$BUILDER_SHA/.installed"
fi
ln -sfn "$BUILDER_BASE/releases/$BUILDER_SHA" "$BUILDER_BASE/current"
id -u farmbuilder >/dev/null 2>&1 || useradd --system --home-dir "$BUILDER_STATE" --shell /usr/sbin/nologin farmbuilder
mkdir -p "$BUILDER_STATE/inputs" "$BUILDER_STATE/profiles" "$BUILDER_STATE/cache"
chown -R farmbuilder:farmbuilder "$BUILDER_STATE"
chmod 750 "$BUILDER_STATE"

cat >/etc/farm-profile-builder.env <<EOF
FARM_BUILDER_STATE=$BUILDER_STATE
FARM_BUILDER_BUCKET=$BUILDER_BUCKET
GOOGLE_CLOUD_PROJECT=$BUILDER_PROJECT
SOURCE_REVISION=$BUILDER_REVISION
SOURCE_BUNDLE_SHA256=$BUILDER_SHA
SOURCE_RELEASE_URI=$BUILDER_RELEASE
EARTHDATA_SECRET_VERSION=$BUILDER_SECRET
PYTHONUNBUFFERED=1
EOF
chmod 644 /etc/farm-profile-builder.env

for BUILDER_ROLE in api worker; do
  if test "$BUILDER_ROLE" = api; then
    BUILDER_ARGS='api --host 0.0.0.0 --port 8080'
  else
    BUILDER_ARGS='worker'
  fi
  cat >"/etc/systemd/system/farm-builder-$BUILDER_ROLE.service" <<EOF
[Unit]
Description=FarmProfileBuilder $BUILDER_ROLE
After=network-online.target
Wants=network-online.target
RequiresMountsFor=$BUILDER_STATE

[Service]
User=farmbuilder
Group=farmbuilder
WorkingDirectory=$BUILDER_BASE/current
EnvironmentFile=/etc/farm-profile-builder.env
ExecStart=$BUILDER_BASE/venv/bin/python -m gradientdescentfarmers.source_builder.cloud $BUILDER_ARGS
Restart=always
RestartSec=5
TimeoutStopSec=60
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$BUILDER_STATE

[Install]
WantedBy=multi-user.target
EOF
done
systemctl daemon-reload
systemctl enable --now farm-builder-api farm-builder-worker
touch "$BUILDER_STATE/bootstrap-ready"
