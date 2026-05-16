# 可复现构建：零本机工具链。
#   docker build -t freetype-wasm .
#   docker run --rm -v "$PWD/dist:/src/dist" freetype-wasm
# 与 GitHub CI 用同一镜像 → 产物字节可复现。
FROM emscripten/emsdk:3.1.74

RUN apt-get update && apt-get install -y --no-install-recommends cmake ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .
RUN chmod +x build.sh scripts/gen-exports.sh
ENV OUT_DIR=/src/dist
CMD ["bash", "build.sh"]
