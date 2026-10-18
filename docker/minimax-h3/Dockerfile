# ComfyUI with MiniMax H3 for SinoBee.ai (the ai-video-production skill renders through it).
# Needs an NVIDIA GPU with a driver for CUDA 13 and the NVIDIA Container Toolkit. `npm run swarm` builds and runs it;
# the model files are not in the image: entrypoint.sh downloads them into the /models volume on the first start.
#
#   docker build -t sinobee-minimax-h3:v0.38.2 --build-arg COMFYUI_REF=v0.38.2 docker/minimax-h3
FROM python:3.12-slim-bookworm
ARG COMFYUI_REF=v0.38.2
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates ffmpeg libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
# PyTorch for CUDA 13 first: the H3 int8_convrot checkpoints want cu130 (ComfyUI's requirements leave torch unpinned)
RUN pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
WORKDIR /opt
RUN git clone --depth 1 --branch "$COMFYUI_REF" https://github.com/comfyanonymous/ComfyUI.git \
 && pip install -r ComfyUI/requirements.txt
COPY extra_model_paths.yaml /opt/ComfyUI/extra_model_paths.yaml
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
VOLUME /models
EXPOSE 8188
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
