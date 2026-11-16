#!/usr/bin/env bash
# Build and deploy the district engine API to Cloud Run (project gdfarming, us-central1).
#   deploy/district-api/deploy.sh            # from the repository root, with gcloud logged in to the project
# Only the Python package is sent to Cloud Build (a staged copy), never the frontend or the panel.
set -euo pipefail
PROJECT=${PROJECT:-gdfarming}
REGION=${REGION:-us-central1}
SERVICE=${SERVICE:-district-api}
REPO=${REPO:-yolia}
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/$SERVICE:$(git rev-parse --short HEAD)"
RUNTIME_SA="district-api@$PROJECT.iam.gserviceaccount.com"

gcloud artifacts repositories describe "$REPO" --location="$REGION" --project="$PROJECT" >/dev/null 2>&1 ||
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" --project="$PROJECT" \
    --description="YoliA containers"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp deploy/district-api/Dockerfile "$STAGE/"
cp -r gradientdescentfarmers "$STAGE/" && find "$STAGE" -name __pycache__ -prune -exec rm -rf {} +
# --async + polling: accounts without project log access cannot stream build logs, which gcloud treats as a failure
BUILD=$(gcloud builds submit "$STAGE" --tag "$IMAGE" --project="$PROJECT" --region="$REGION" --async --format='value(id)')
echo "build $BUILD"
while true; do
  STATUS=$(gcloud builds describe "$BUILD" --project="$PROJECT" --region="$REGION" --format='value(status)')
  case "$STATUS" in
    SUCCESS) break ;;
    QUEUED|WORKING|PENDING) sleep 10 ;;
    *) echo "build $BUILD: $STATUS" >&2; exit 1 ;;
  esac
done

gcloud run deploy "$SERVICE" --image "$IMAGE" --project="$PROJECT" --region="$REGION" \
  --service-account="$RUNTIME_SA" --allow-unauthenticated \
  --memory=2Gi --cpu=1 --concurrency=4 --min-instances=0 --max-instances=3 --timeout=60 \
  --set-env-vars="YOLIA_DISTRICT_PANEL=gs://gdfarming-farm-data/district_panel"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)'
