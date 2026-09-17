FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY national/warehouse-requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd -m app && mkdir /app/runtime && chown app:app /app/runtime
COPY national /app/national
USER app
ENV WAREHOUSE_DIR=/app/runtime PORT=8080
CMD ["python", "-m", "national.warehouse"]
