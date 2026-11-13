# Laboratorio de System: aquí prueba lo que aprende, aislado de tu PC.
#   docker build -t emilia-lab scripts/system/laboratorio   (System lo construye solo la primera vez)
# Corre sin red (salvo instalaciones que él pida), sin root, con memoria/CPU/procesos limitados,
# y solo ve la carpeta del experimento (/lab).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv git ca-certificates curl jq \
  && rm -rf /var/lib/apt/lists/* \
  && npm i -g tsx typescript@5 --no-fund --no-audit \
  && useradd -m -u 1001 lab && mkdir -p /lab && chown lab:lab /lab
ENV PIP_BREAK_SYSTEM_PACKAGES=1 NPM_CONFIG_UPDATE_NOTIFIER=false NO_COLOR=1 CI=1
USER lab
WORKDIR /lab
