#!/usr/bin/env bash
#
# Builds the vendored HEIC codec (vendor/elheif) with quality and speed support.
#
# Upstream elheif only exposes a fixed encoder quality. This build adds:
#   - libheif: a `preset` encoder parameter applied through kvz_config_parse()
#   - elheif: `jsEncodeImage(buf, w, h, quality, preset)`
#
# Pinned versions (matching the known-good elheif build):
#   kvazaar v2.3.1  libde265 v1.0.15  libheif v1.18.2
#   Emscripten SDK 3.1.60  (CMake 3.29; CMake 4 rejects the deps' old
#   cmake_minimum_required)
#
# Usage: EMSDK=/path/to/emsdk ./wasm/heic/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WASM_DIR="$ROOT/wasm/heic"
WORK="${WORK:-/tmp/heic-build}"
EMSDK="${EMSDK:-/tmp/emsdk}"

KVAZAAR_TAG=v2.3.1
LIBDE265_TAG=v1.0.15
LIBHEIF_TAG=v1.18.2

mkdir -p "$WORK"
cd "$WORK"

if [ ! -d elheif/.git ]; then
  git clone https://github.com/hpp2334/elheif.git elheif
fi
git -C elheif checkout -f .
git -C elheif apply "$WASM_DIR/elheif-quality-preset.patch"

cmake_file=elheif/core/CMakeLists.txt
perl -0pi -e "s#(GIT_REPOSITORY https://github.com/ultravideo/kvazaar.git)#\$1\n  GIT_TAG           $KVAZAAR_TAG#" "$cmake_file"
perl -0pi -e "s#(GIT_REPOSITORY https://github.com/strukturag/libde265.git)#\$1\n  GIT_TAG           $LIBDE265_TAG#" "$cmake_file"
perl -0pi -e "s#(GIT_REPOSITORY    https://github.com/strukturag/libheif.git)#\$1\n  GIT_TAG           $LIBHEIF_TAG\n  PATCH_COMMAND     git apply --whitespace=nowarn $WASM_DIR/libheif-kvazaar-preset.patch#" "$cmake_file"

# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null
export EMSCRIPTEN_ROOT="$EMSDK"

cd elheif
emcmake cmake -S . -B build -DEMSCRIPTEN=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --target elheif-wasm -j"$(nproc)"

cp build/wasm/elheif-wasm.js pkg/elheif-wasm.js
node scripts/patch-js.mjs   # wraps the bundle in globalThis.__init__ELHEIF_MODULE

cp pkg/index.js pkg/index.d.ts pkg/elheif-wasm.js "$ROOT/vendor/elheif/pkg/"
echo "Updated $ROOT/vendor/elheif/pkg/"
