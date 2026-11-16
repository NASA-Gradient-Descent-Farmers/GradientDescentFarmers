#!/usr/bin/env bash
# Build and deploy the monthly district panel job, and schedule it (day 5 of each month, 03:00 Mexico City).
#   deploy/district-panel-job/deploy.sh            # from the repository root
# Run it by hand:  gcloud run jobs execute district-panel-monthly --region us-central1 --project gdfarming
set -euo pipefail
PROJECT=${PROJECT:-gdfarming}
REGION=${REGION:-us-central1}
JOB=${JOB:-district-panel-monthly}
REPO=${REPO:-yolia}
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/$JOB:$(git rev-parse --short HEAD)"
RUNTIME_SA="district-panel-builder@$PROJECT.iam.gserviceaccount.com"
SECRET=${EARTHDATA_SECRET:-farm-builder-earthdata}

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/resources"
cp deploy/district-panel-job/Dockerfile pyproject.toml "$STAGE/"
cp resources/district_national.json "$STAGE/resources/"
cp -r gradientdescentfarmers "$STAGE/" && find "$STAGE" -name __pycache__ -prune -exec rm -rf {} +
[ -f README.md ] && cp README.md "$STAGE/"

BUILD=$(gcloud builds submit "$STAGE" --tag "$IMAGE" --project="$PROJECT" --region="$REGION" --async --format='value(id)')
echo "build $BUILD"
while true; do
  STATUS=$(gcloud builds describe "$BUILD" --project="$PROJECT" --region="$REGION" --format='value(status)')
  case "$STATUS" in
    SUCCESS) break ;;
    QUEUED|WORKING|PENDING) sleep 15 ;;
    *) echo "build $BUILD: $STATUS" >&2; exit 1 ;;
  esac
done

# 4 CPU / 16 GiB: /tmp lives in memory on Cloud Run and holds the download cache during the build
gcloud run jobs deploy "$JOB" --image "$IMAGE" --project="$PROJECT" --region="$REGION" \
  --service-account="$RUNTIME_SA" --cpu=4 --memory=16Gi --task-timeout=24h --max-retries=0 \
  --set-env-vars="YOLIA_DISTRICT_BUCKET=gdfarming-farm-data" \
  --set-secrets="EARTHDATA_TOKEN=$SECRET:latest"

URI="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$JOB:run"
if gcloud scheduler jobs describe "$JOB" --location="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" --location="$REGION" --project="$PROJECT" --schedule="0 3 5 * *" \
    --time-zone="America/Mexico_City" --uri="$URI" --http-method=POST --oauth-service-account-email="$RUNTIME_SA"
else
  gcloud scheduler jobs create http "$JOB" --location="$REGION" --project="$PROJECT" --schedule="0 3 5 * *" \
    --time-zone="America/Mexico_City" --uri="$URI" --http-method=POST --oauth-service-account-email="$RUNTIME_SA"
fi
echo "scheduled: $JOB, 03:00 America/Mexico_City on day 5 of each month"
