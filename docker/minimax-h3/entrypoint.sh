#!/bin/sh
# Downloads the MiniMax H3 files that are missing from /models (Hugging Face Comfy-Org/MiniMax-H3), then starts
# ComfyUI. H3_FILES (space-separated paths in that repository) replaces the default set; HF_TOKEN is used if set.
set -eu
REPO="https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main"
# default: pruned int8 models (text-to-video / image-to-video and reference-to-video), int8 text encoder, the VAEs and
# the turbo LoRAs — about 76 GB
DEFAULT="diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors
diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors
text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors
vae/minimax_h3_video_vae_int8_convrot.safetensors
vae/minimax_h3_audio_vae_fp32.safetensors
loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors
loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"
FILES="${H3_FILES:-$DEFAULT}"
for f in $FILES; do
  dest="/models/$f"
  [ -s "$dest" ] && continue
  mkdir -p "$(dirname "$dest")"
  echo "downloading $f …"
  if [ -n "${HF_TOKEN:-}" ]; then auth="Authorization: Bearer $HF_TOKEN"; else auth="X-No-Auth: 1"; fi
  # resumable: a restart continues the .part file
  curl -fL --retry 5 --retry-delay 10 -C - -H "$auth" -o "$dest.part" "$REPO/$f"
  mv "$dest.part" "$dest"
done
echo "models ready; starting ComfyUI"
cd /opt/ComfyUI
exec python main.py --listen 0.0.0.0 --port 8188 --extra-model-paths-config /opt/ComfyUI/extra_model_paths.yaml
