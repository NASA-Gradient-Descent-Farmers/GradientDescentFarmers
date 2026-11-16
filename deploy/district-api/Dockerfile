# YoliA district engine API (gradientdescentfarmers/model_builder/rotations/serve.py) on Cloud Run.
# The panel is not in the image: the service downloads the bucket's latest run at start-up (YOLIA_DISTRICT_PANEL) and
# follows it as the monthly build publishes new runs.
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir "pandas>=2" "numpy>=1.26" "pyarrow>=15" "google-cloud-storage>=2.14"
COPY gradientdescentfarmers/ gradientdescentfarmers/
ENV PYTHONUNBUFFERED=1 HOST=0.0.0.0 YOLIA_GCS_LIBRARY=1 YOLIA_CACHE=/tmp/yolia \
    YOLIA_DISTRICT_PANEL=gs://gdfarming-farm-data/district_panel
CMD ["python", "-m", "gradientdescentfarmers.model_builder.rotations.serve"]
