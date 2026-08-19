#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
议迹 · 本地转写脚本（faster-whisper）
用法：
    python transcribe.py <audio.wav> [--model small]
输出：JSON 到 stdout，格式 {"language": "zh", "segments": [{"start": 0.0, "end": 3.2, "text": "..."}]}
首次运行会自动下载所选 Whisper 模型（small 约 460MB，存于用户目录 ~/.cache/huggingface）。
"""
import argparse
import json
import os
import sys

# 强制 UTF-8 输出（Windows 管道默认 GBK 会导致 Node 端乱码）
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

# 保证能从本目录导入 diarize.py（即使脚本被绝对路径调用）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main():
    parser = argparse.ArgumentParser(description="faster-whisper 本地转写")
    parser.add_argument("audio", help="音频文件路径")
    parser.add_argument("--model", default="small", help="Whisper 模型：tiny/base/small/medium/large-v3")
    parser.add_argument("--language", default=None, help="语言代码，默认自动检测")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--download-root", default=None, help="模型缓存目录（预下载模型时指定，避免重复下载）")
    parser.add_argument("--diarize", action="store_true", help="开启说话人区分（男1/男2/女1/女2 标记）")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.stderr.write(
            "未安装 faster-whisper。请先运行：pip install faster-whisper\n"
            "或使用项目自带的 scripts\\setup_whisper.bat 一键安装。\n"
        )
        sys.exit(2)

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type,
                         download_root=args.download_root)
    segments, info = model.transcribe(
        args.audio,
        language=args.language,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
    )

    out = []
    for seg in segments:
        out.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg.text.strip(),
        })

    if args.diarize:
        try:
            from diarize import diarize as diarize_fn
            speakers = diarize_fn(args.audio, out)
            for seg, sp in zip(out, speakers):
                if sp:
                    seg["speaker"] = sp
        except Exception as e:
            sys.stderr.write(f"说话人区分失败（不影响转写）：{e}\n")

    payload = {"language": info.language, "duration": round(info.duration, 2), "segments": out}
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
