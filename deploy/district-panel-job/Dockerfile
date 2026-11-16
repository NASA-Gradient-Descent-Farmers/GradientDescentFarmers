# Monthly district panel refresh (gradientdescentfarmers/model_builder/rotations/monthly.py) as a Cloud Run job.
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml README.md ./
COPY gradientdescentfarmers/ gradientdescentfarmers/
COPY resources/district_national.json resources/
RUN pip install --no-cache-dir ".[source,source-district,gcs]"
ENV PYTHONUNBUFFERED=1 YOLIA_DISTRICT_BUCKET=gdfarming-farm-data YOLIA_WORK=/tmp/yolia-panel
CMD ["python", "-m", "gradientdescentfarmers.model_builder.rotations.monthly"]
