FROM python:3.11-slim

WORKDIR /app

# Reproducible install from the fully-resolved lockfile.
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock

# Copy application code (see .dockerignore for what's excluded).
COPY . .

# Persist the SQLite DB on a path that can be backed by a mounted volume.
ENV DATABASE_PATH=/app/data/traumappd.db
RUN mkdir -p /app/data

EXPOSE 8000

# Liveness probe for the container host (no curl in slim images, so use Python).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/health').status==200 else 1)"

CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
