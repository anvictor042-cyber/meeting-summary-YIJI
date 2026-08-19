#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
议迹 · SenseVoiceSmall 本地转写脚本（ONNX int8 / funasr-onnx 运行时，无需 torch）
用法：
    python transcribe_sensevoice.py <audio> --model-dir <dir> [--punc-dir <dir>] [--diarize]
输出：JSON 到 stdout，格式 {"language":"zh","duration":12.3,"segments":[{"start":0.0,"end":3.2,"text":"..."}]}
说话人区分（--diarize）复用 scripts/diarize.py（音高性别 + MFCC 聚类，男1/男2…/女1/女2…）。
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

# 强制 UTF-8 输出（Windows 管道默认 GBK 会导致 Node 端乱码）
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

# 保证能从本目录导入 diarize.py
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SR = 16000
MAX_SEG = 25.0  # 单段最长秒数（超出按 25s 切分，保证 onnx 推理稳定）

TAG_RE = re.compile(r'<\|[^|]*\|>')          # <|zh|> <|NEUTRAL|> <|Speech|> 等富文本标签
LANG_RE = re.compile(r'<\|(zh|en|yue|ja|ko|nospeech)\|>')
EMPTY_TAGS = ('<|nospeech|>', '<|EMO_UNKNOWN|>', '<|Speech|>')


def load_audio(path):
    """PyAV 解码 → 16k 单声道 float32 ndarray"""
    import av
    container = av.open(path)
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format='fltp', layout='mono', rate=SR)
    chunks = []
    for frame in container.decode(stream):
        for rframe in resampler.resample(frame):
            chunks.append(rframe.to_ndarray().reshape(-1))
    container.close()
    if not chunks:
        raise RuntimeError('无法解码音频文件')
    return np.concatenate(chunks).astype(np.float32)


def energy_vad(x, frame_ms=25, min_speech=0.30, min_silence=0.28, pad=0.10):
    """自适应能量 VAD：噪声底 = RMS 第 20 百分位；阈值取噪声底×5 与峰值×0.08 的较大者。
    返回 [(start_sec, end_sec), ...]，带前后 padding 并合并重叠段。"""
    n = len(x)
    frame = int(SR * frame_ms / 1000)
    if n < frame:
        return [(0.0, n / SR)] if n > SR * 0.1 else []
    rms = np.sqrt((x[: n - (n % frame)].reshape(-1, frame) ** 2).mean(axis=1))
    # 每帧 25ms（frame/SR），不能用 hop 步进：否则时间轴被压缩 2.5 倍，
    # 段落在音频前半段，后半段语音永远转不进去
    t = np.arange(len(rms)) * frame / SR
    if len(rms) < 2:
        return []
    noise = float(np.percentile(rms, 20))
    thr = max(noise * 5.0, float(rms.max()) * 0.08, 0.012)

    segs, in_speech, s0, sil = [], False, 0.0, 0.0
    for i, v in enumerate(rms > thr):
        if v:
            if not in_speech:
                in_speech, s0, sil = True, t[i], 0.0
        elif in_speech:
            sil += frame / SR
            if sil >= min_silence:
                e = t[i] + pad
                if e - s0 >= min_speech:
                    segs.append((max(0.0, s0 - pad), min(n / SR, e)))
                in_speech = False
    if in_speech:
        if n / SR - s0 >= min_speech:
            segs.append((max(0.0, s0 - pad), n / SR))
    # 合并 padding 造成的重叠
    merged = []
    for s, e in segs:
        if merged and s <= merged[-1][1] + 0.05:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def strip_tags(text):
    """去掉 <|...|> 标签，返回 (纯文本, 语言代码)"""
    lang = 'zh'
    m = LANG_RE.search(text or '')
    if m and m.group(1) != 'nospeech':
        lang = m.group(1)
    cleaned = TAG_RE.sub('', text or '').replace('<||>', '').strip()
    return cleaned, lang


def ensure_ascii_dir(path):
    r"""Windows C++ 组件（sentencepiece / onnxruntime）用 ANSI 码页打开文件，
    中文路径（如 D:\ClawData\议迹\...）会找不到文件。
    对含非 ASCII 字符的目录创建 ASCII 名的 junction（无需管理员权限）后返回其路径。"""
    p = str(path)
    if p.isascii():
        return p
    h = hashlib.md5(p.encode('utf-8')).hexdigest()[:10]
    link = os.path.join(tempfile.gettempdir(), 'yiji-sv-' + h)
    probe = os.path.join(link, 'model_quant.onnx')
    if not os.path.exists(probe):
        # 清理旧的/失效的 junction（os.path.islink 对 junction 可能返回 False，故按存在性清理）
        try:
            if os.path.exists(link):
                try:
                    os.unlink(link)
                except OSError:
                    try:
                        os.rmdir(link)
                    except OSError:
                        pass
        except Exception:
            pass
        try:
            subprocess.run(['cmd', '/c', 'mklink', '/J', link, p], capture_output=True, timeout=30)
        except Exception:
            pass
    return link if os.path.exists(probe) else p  # junction 失败则退回原路径（尽力而为）


def main():
    parser = argparse.ArgumentParser(description='SenseVoiceSmall 本地转写')
    parser.add_argument('audio', help='音频文件路径')
    parser.add_argument('--model-dir', required=True, help='SenseVoiceSmall onnx 模型目录')
    parser.add_argument('--punc-dir', default=None, help='标点恢复模型目录（可选）')
    parser.add_argument('--diarize', action='store_true', help='开启说话人区分（男1/男2/女1/女2 标记）')
    args = parser.parse_args()

    model_dir = ensure_ascii_dir(args.model_dir)
    punc_dir = ensure_ascii_dir(args.punc_dir) if args.punc_dir else None

    try:
        from funasr_onnx import SenseVoiceSmall
    except ImportError:
        sys.stderr.write('未安装 funasr-onnx 运行时。请在「设置 - SenseVoiceSmall 语音模块」执行一键下载。\n')
        sys.exit(2)

    x = load_audio(args.audio)
    duration = len(x) / SR

    model = SenseVoiceSmall(model_dir, quantize=True, intra_op_num_threads=4)

    punc_model = None
    if punc_dir and os.path.exists(os.path.join(punc_dir, 'model_quant.onnx')):
        try:
            from funasr_onnx import CT_Transformer
            punc_model = CT_Transformer(punc_dir, quantize=True, intra_op_num_threads=4)
        except Exception as e:
            sys.stderr.write(f'标点模型加载失败（不影响转写）：{e}\n')

    # VAD 分段 → 超长切分 → 逐段识别
    raw_segs = energy_vad(x)
    segs = []
    for s, e in raw_segs:
        while e - s > MAX_SEG:
            segs.append((s, s + MAX_SEG))
            s += MAX_SEG
        segs.append((s, e))

    out, lang = [], 'zh'
    for s, e in segs:
        s0, s1 = max(0, int(s * SR)), min(len(x), int(e * SR))
        if s1 - s0 < SR * 0.2:
            continue
        try:
            res = model(x[s0:s1], language='auto', textnorm='woitn')
        except Exception as ex:
            sys.stderr.write(f'段 {s:.1f}s 识别失败：{ex}\n')
            continue
        text = (res[0] if isinstance(res, (list, tuple)) and res else '') or ''
        if not text or any(t in text for t in EMPTY_TAGS) and TAG_RE.sub('', text).strip() == '':
            continue
        cleaned, seg_lang = strip_tags(text)
        if not cleaned:
            continue
        if seg_lang != 'nospeech':
            lang = seg_lang
        out.append({'start': round(s, 2), 'end': round(e, 2), 'text': cleaned})

    # 标点恢复（逐段）
    if punc_model and out:
        try:
            for seg in out:
                pt = punc_model(seg['text'])
                seg['text'] = pt[0] if isinstance(pt, tuple) and pt else (pt or seg['text'])
        except Exception as e:
            sys.stderr.write(f'标点恢复失败（不影响转写）：{e}\n')

    # 说话人区分（复用 diarize.py，与原 faster-whisper 完全一致的算法）
    if args.diarize and out:
        try:
            from diarize import diarize as diarize_fn
            speakers = diarize_fn(args.audio, out)
            for seg, sp in zip(out, speakers):
                if sp:
                    seg['speaker'] = sp
        except Exception as e:
            sys.stderr.write(f'说话人区分失败（不影响转写）：{e}\n')

    payload = {'language': lang, 'duration': round(duration, 2), 'segments': out}
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')


if __name__ == '__main__':
    import numpy as np  # noqa: E402  (延迟导入，避免缺依赖时报错信息不清)
    main()
