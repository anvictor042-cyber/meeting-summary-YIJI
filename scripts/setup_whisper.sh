#!/usr/bin/env bash
# 议迹 - faster-whisper 一键安装（macOS / Linux）
# 用法：bash setup_whisper.sh
set -e

echo "============================================"
echo "  议迹 - faster-whisper 一键安装"
echo "============================================"

# 目标目录：macOS 用 ~/Library/Application Support/议迹/whisper-venv
#           Linux 用 ${XDG_DATA_HOME:-$HOME/.local/share}/议迹/whisper-venv
if [[ "$(uname)" == "Darwin" ]]; then
  VENV_DIR="$HOME/Library/Application Support/议迹/whisper-venv"
else
  VENV_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/议迹/whisper-venv"
fi
echo "目标位置：$VENV_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[错误] 未找到 python3，请先安装 Python 3.10+（macOS 可 brew install python）。"
  exit 1
fi

echo "[1/3] 创建虚拟环境 ..."
if [ ! -f "$VENV_DIR/bin/python" ]; then
  python3 -m venv "$VENV_DIR"
fi

echo "[2/3] 安装 faster-whisper ..."
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install faster-whisper

echo "[3/3] 安装完成。"
echo "首次转写会自动下载模型（默认 small，约 460MB）。"
echo "如需换模型，在应用「设置 - 转写」中修改模型名称即可。"
