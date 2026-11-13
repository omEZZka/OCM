#!/usr/bin/env bash
# Builds everything the APK embeds:
#   jniLibs/arm64-v8a/{libproot.so,libproot-loader.so,libtalloc.so}   proot, as native libs (exec-able on Android 10+)
#   assets/rootfs.tar.xz + rootfs.id                                  Ubuntu 24.04 arm64 with opencode 1.x inside
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIBS="$ROOT/app/src/main/jniLibs/arm64-v8a"
ASSETS="$ROOT/app/src/main/assets"
WORK="$(mktemp -d)"
mkdir -p "$LIBS" "$ASSETS"
sudo apt-get update -qq && sudo apt-get install -y -qq patchelf xz-utils >/dev/null

echo "== 1/3 proot from Termux packages =="
REPO=https://packages.termux.dev/apt/termux-main
curl -fsSL "$REPO/dists/stable/main/binary-aarch64/Packages" -o "$WORK/Packages"
fetch_deb() {
  local file
  file="$(python3 - "$1" "$WORK/Packages" <<'PY'
import sys
name, path = sys.argv[1:3]
for block in open(path, encoding="utf-8").read().split("\n\n"):
    d = {}
    for line in block.splitlines():
        if ": " in line and not line.startswith(" "):
            k, v = line.split(": ", 1)
            d[k] = v
    if d.get("Package") == name:
        print(d["Filename"])
        break
PY
)"
  [ -n "$file" ] || { echo "package $1 not found"; exit 1; }
  curl -fsSL "$REPO/$file" -o "$WORK/$1.deb"
  mkdir -p "$WORK/x/$1"
  dpkg-deb -x "$WORK/$1.deb" "$WORK/x/$1"
}
fetch_deb proot
fetch_deb libtalloc
fetch_deb libandroid-shmem   # proot's --sysvipc support links against it
TP=data/data/com.termux/files/usr
cp "$WORK/x/proot/$TP/bin/proot" "$LIBS/libproot.so"
cp "$WORK/x/proot/$TP/libexec/proot/loader" "$LIBS/libproot-loader.so"
cp -L "$WORK/x/libtalloc/$TP/lib/libtalloc.so.2" "$LIBS/libtalloc.so"
cp -L "$WORK/x/libandroid-shmem/$TP/lib/libandroid-shmem.so" "$LIBS/libandroid-shmem.so"
patchelf --remove-rpath "$LIBS/libproot.so" || true
patchelf --replace-needed libtalloc.so.2 libtalloc.so "$LIBS/libproot.so"
patchelf --set-soname libtalloc.so "$LIBS/libtalloc.so"
patchelf --remove-rpath "$LIBS/libandroid-shmem.so" || true
for n in $(patchelf --print-needed "$LIBS/libproot.so"); do
  case "$n" in
    libc.so|libdl.so|libm.so|liblog.so|libtalloc.so|libandroid-shmem.so) ;;
    *) echo "proot has an unexpected dependency: $n (needs bundling)"; exit 1 ;;
  esac
done

echo "== 2/3 opencode: newest stable v1.* =="
TAG="${OPENCODE_TAG:-}"
if [ -z "$TAG" ]; then
  AUTH=()
  [ -n "${GH_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $GH_TOKEN")
  TAG="$(curl -fsSL "${AUTH[@]}" "https://api.github.com/repos/anomalyco/opencode/releases?per_page=100" | python3 -c '
import json, sys
for r in json.load(sys.stdin):
    if not r["prerelease"] and not r["draft"] and r["tag_name"].startswith("v1."):
        print(r["tag_name"])
        break')"
fi
[ -n "$TAG" ] || { echo "no v1.x release found"; exit 1; }
echo "using $TAG"
mkdir -p "$WORK/oc"
curl -fsSL "https://github.com/anomalyco/opencode/releases/download/$TAG/opencode-linux-arm64.tar.gz" | tar -xz -C "$WORK/oc"
test -f "$WORK/oc/opencode"
echo "$TAG" > "$WORK/oc/version"

echo "== 3/3 rootfs (Ubuntu 24.04 arm64) =="
docker rm -f ocroot >/dev/null 2>&1 || true
# Emulated arm64 containers occasionally lose DNS on GitHub runners ("Could not resolve
# ports.ubuntu.com"). Pin public resolvers and retry the index fetch before giving up.
docker run --platform linux/arm64 --name ocroot --dns 1.1.1.1 --dns 8.8.8.8 -v "$WORK/oc:/oc:ro" ubuntu:24.04 bash -euc '
  export DEBIAN_FRONTEND=noninteractive
  if ! getent hosts ports.ubuntu.com >/dev/null 2>&1; then
    echo "resolv.conf:"; cat /etc/resolv.conf || true
    printf "nameserver 1.1.1.1\nnameserver 8.8.8.8\n" > /etc/resolv.conf
  fi
  apt_ok=0
  for i in 1 2 3 4 5; do
    if apt-get update; then apt_ok=1; break; fi
    echo "apt-get update failed (attempt $i), retrying..."
    printf "nameserver 1.1.1.1\nnameserver 8.8.8.8\n" > /etc/resolv.conf
    sleep "$((i*10))"
  done
  [ "$apt_ok" = "1" ] || { echo "ERROR: apt index unreachable after retries"; exit 1; }
  apt-get install -y --no-install-recommends ca-certificates curl git ripgrep openssh-client \
    python3 nodejs npm unzip zip less nano procps
  install -m755 /oc/opencode /usr/local/bin/opencode
  cp /oc/version /etc/opencode-version
  /usr/local/bin/opencode --version || echo "WARN: smoke test failed under qemu (non-fatal)"

  # Pre-seed official models registry in rootfs for instant offline boot
  mkdir -p /root/.cache/opencode
  for i in 1 2 3; do
    curl -fsSL --retry 2 --connect-timeout 15 "https://models.opencode.ai/api.json" -o /root/.cache/opencode/models.json && break
    sleep 5
  done || true

  apt-get clean
  rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* /var/cache/apt/*
'
docker export ocroot | xz -T0 -6 > "$ASSETS/rootfs.tar.xz"
docker rm -f ocroot >/dev/null
sha256sum "$ASSETS/rootfs.tar.xz" | cut -d' ' -f1 > "$ASSETS/rootfs.id"
# Same hash also shipped as a plain marker so the app can verify the packaged archive before
# extracting it (a partially downloaded APK otherwise fails deep inside the extraction).
sha256sum "$ASSETS/rootfs.tar.xz" | cut -d' ' -f1 > "$ASSETS/rootfs.sha256"
echo "opencode_core=$TAG" > "$ROOT/runtime-info.txt"
ls -lh "$ASSETS/rootfs.tar.xz" "$LIBS"
