FROM python:3.12-slim

# PYTHONUNBUFFERED so logs show up in `docker compose logs` immediately instead of
# sitting in a buffer while you wonder whether the server started.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Copied before the source so this layer caches: editing backend/mcp.py does not
# trigger a reinstall of every dependency.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/

# Documentation only — compose deliberately does not publish this port. Caddy reaches
# it over Docker's internal network, and nothing else can.
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

# `python -m backend.mcp`, NOT `python backend/mcp.py`. The script form puts /app/backend
# at the front of sys.path, where backend/mcp.py shadows the installed `mcp` package that
# fastmcp imports internally, and the container dies on startup with
# "No module named 'mcp.server'; 'mcp' is not a package". See backend/mcp.py's docstring.
CMD ["python", "-m", "backend.mcp"]
