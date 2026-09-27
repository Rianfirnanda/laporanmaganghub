#!/usr/bin/env bash
# Naikkan nomor versi aset (?v=N di semua HTML) sekaligus version.json.
# Jalankan setiap kali CSS/JS diubah, supaya browser pengunjung otomatis
# memuat ulang ke versi terbaru (lihat "Pembaruan otomatis" di assets/common.js).
set -euo pipefail
cd "$(dirname "$0")/.."
cur=$(sed -n 's/.*"v": *\([0-9]*\).*/\1/p' version.json)
next=$((cur + 1))
sed -i "s/?v=[0-9]\+/?v=${next}/g" ./*.html
printf '{ "v": %s }\n' "$next" > version.json
echo "Versi aset: ${cur} -> ${next}"
