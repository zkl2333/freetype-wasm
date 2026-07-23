# 固定 Emscripten 基础镜像的构建：零本机工具链。
#   docker build -t freetype-wasm .
#   docker run --rm -v "$PWD/dist:/src/dist" freetype-wasm
# 与 GitHub CI 使用同一份 amd64 镜像。
FROM emscripten/emsdk:3.1.74@sha256:af45409f3199d88db4b1b03af0098532c8fb33a375ac257463eeb0a622870d06

RUN apt-get update && apt-get install -y --no-install-recommends cmake ca-certificates curl gnupg gpgv \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .
RUN chmod +x build.sh scripts/gen-exports.sh
ENV OUT_DIR=/src/dist
CMD ["bash", "build.sh"]
