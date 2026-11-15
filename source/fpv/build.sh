#!/bin/sh
# Builds fpvcore.js: libfpv (real Betaflight 2025.12 + the SimITL flight model) and host.c, compiled
# to WebAssembly and embedded in one JS file. Only needed when host.c or libfpv change; the result
# is checked in, so building the page itself (node build.mjs) needs only Node.
#
#   LIBFPV=/path/to/libfpv ./build.sh       (libfpv cloned with --recursive and built with
#                                            emcmake cmake -S . -B build/web && cmake --build build/web)
# Needs Emscripten 4.0 or newer on PATH (emcc).
set -e
here=$(cd "$(dirname "$0")" && pwd)
LIBFPV=${LIBFPV:?set LIBFPV to a libfpv checkout built for the web}
emcc -O3 "$here/host.c" -I "$LIBFPV/include" "$LIBFPV/build/web/libfpv.a" \
  -fwasm-exceptions -lidbfs.js --js-library "$LIBFPV/src/web/libfpv_web.js" -sDEFAULT_TO_CXX \
  -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web -sMODULARIZE=1 -sEXPORT_NAME=createFpvCore -sSINGLE_FILE=1 \
  -sEXPORTED_FUNCTIONS=_malloc,_free -sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToNewUTF8,HEAPF32,HEAPU8,HEAPU32 \
  -sSTACK_SIZE=1048576 -o "$here/fpvcore.js"
ls -l "$here/fpvcore.js"
