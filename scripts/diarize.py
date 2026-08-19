#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
议迹 · 说话人区分（说话人标记）
原理：逐段提取音高（自相关法）→ 中位音高判性别（男 <165Hz，女 ≥165Hz）
      + 逐段 MFCC 音色特征 → 同性别内自适应 k-means 聚类（轮廓系数自动选人数）
      → 标号 男1/男2…男n / 女1/女2…女n（不限人数）
依赖：numpy + av（均随 faster-whisper 环境安装），纯本地运行，无需联网。
"""
import numpy as np

SR = 16000


def load_audio(path, sr=SR):
    try:
        import av
    except ImportError:
        return None
    try:
        container = av.open(path)
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format='fltp', layout='mono', rate=sr)
        chunks = []
        for frame in container.decode(stream):
            for rframe in resampler.resample(frame):
                arr = rframe.to_ndarray()
                chunks.append(arr.reshape(-1))
        container.close()
        if not chunks:
            return None
        return np.concatenate(chunks).astype(np.float32)
    except Exception:
        return None


def frame_f0(x, sr=SR, frame_ms=30, hop_ms=10, fmin=70, fmax=400):
    """自相关法逐帧基频（帧长30ms，步进10ms）；无声段返回 0"""
    n = len(x)
    frame = int(sr * frame_ms / 1000)
    hop = int(sr * hop_ms / 1000)
    if n < frame:
        return np.array([])
    f0s = []
    for start in range(0, n - frame, hop):
        seg = x[start:start + frame].astype(np.float64)
        seg = seg - seg.mean()
        rms = np.sqrt((seg ** 2).mean())
        if rms < 1e-4:
            f0s.append(0.0)
            continue
        ac = np.correlate(seg, seg, 'full')[frame - 1:]
        min_lag = int(sr / fmax)
        max_lag = int(sr / fmin)
        if max_lag >= len(ac):
            max_lag = len(ac) - 1
        if min_lag >= max_lag:
            f0s.append(0.0)
            continue
        peak = int(np.argmax(ac[min_lag:max_lag])) + min_lag
        if 0 < peak < len(ac) - 1:
            y0, y1, y2 = ac[peak - 1], ac[peak], ac[peak + 1]
            denom = y0 - 2 * y1 + y2
            if abs(denom) > 1e-12:
                peak = peak + 0.5 * (y0 - y2) / denom
        f0s.append(sr / peak if peak > 0 else 0.0)
    return np.array(f0s)


def _mel_filterbank(sr, n_fft, n_mels):
    fmin, fmax = 0.0, sr / 2.0
    hz2mel = lambda f: 2595.0 * np.log10(1.0 + f / 700.0)
    mel2hz = lambda m: 700.0 * (10.0 ** (m / 2595.0) - 1.0)
    mels = np.linspace(hz2mel(fmin), hz2mel(fmax), n_mels + 2)
    freqs = np.array([mel2hz(m) for m in mels])
    bins = np.floor((n_fft + 1) * freqs / sr).astype(int)
    bins = np.clip(bins, 0, n_fft // 2)
    nf = n_fft // 2 + 1
    fb = np.zeros((n_mels, nf))
    for i in range(1, n_mels + 1):
        l, c, r = bins[i - 1], bins[i], bins[i + 1]
        if c > l:
            for j in range(l, c):
                fb[i - 1, j] = (j - l) / (c - l)
        if r > c:
            for j in range(c, r):
                fb[i - 1, j] = (r - j) / (r - c)
    return fb


def mel_mfcc(x, sr=SR, n_mfcc=13, n_fft=512, n_mels=26, n_frames=40):
    """段内平均 MFCC 向量（简化 mel 滤波器组 + DCT-II）"""
    if len(x) < n_fft:
        return np.zeros(n_mfcc)
    hop = n_fft // 2
    frames = [x[s:s + n_fft].astype(np.float64) for s in range(0, len(x) - n_fft + 1, hop)]
    if not frames:
        return np.zeros(n_mfcc)
    if len(frames) > n_frames:
        idx = np.linspace(0, len(frames) - 1, n_frames).astype(int)
        frames = [frames[i] for i in idx]
    F = np.stack(frames)
    win = np.hanning(n_fft)
    spec = np.abs(np.fft.rfft(F * win, n=n_fft, axis=1)) ** 2
    fb = _mel_filterbank(sr, n_fft, n_mels)
    melspec = spec @ fb.T
    logmel = np.log(melspec + 1e-10)
    n = logmel.shape[1]
    basis = np.cos(np.pi / n * (np.arange(n)[None, :] + 0.5) * np.arange(n_mfcc)[:, None]) * np.sqrt(2.0 / n)
    dct = logmel @ basis.T
    return dct.mean(axis=0)


def kmeans_labels(feats, k):
    """k-means（任意 k，k-means++ 初始化，固定随机种子保证可复现）"""
    feats = np.asarray(feats, dtype=np.float64)
    n = len(feats)
    if n == 0:
        return []
    if k >= n:
        return list(range(n))
    if k == 1:
        return [0] * n
    rng = np.random.RandomState(0)
    cents = [feats[int(rng.randint(n))]]
    for _ in range(1, k):
        d = np.min(np.linalg.norm(feats[:, None, :] - np.stack(cents)[None, :, :], axis=2), axis=1)
        probs = d / d.sum()
        cents.append(feats[int(rng.choice(n, p=probs))])
    cents = np.stack(cents)
    labels = np.zeros(n, dtype=int)
    for _ in range(30):
        dists = np.linalg.norm(feats[:, None, :] - cents[None, :, :], axis=2)
        newl = np.argmin(dists, axis=1)
        if np.array_equal(newl, labels):
            break
        labels = newl
        for c in range(k):
            sel = feats[labels == c]
            if len(sel):
                cents[c] = sel.mean(axis=0)
    return labels.tolist()


def _silhouette(feats, labels):
    """平均轮廓系数（评估聚类质量，用于自动选 k）"""
    n = len(feats)
    if n < 2:
        return 0.0
    ssum, cnt = 0.0, 0
    others = sorted(set(labels))
    for i in range(n):
        li = labels[i]
        same = [j for j in range(n) if j != i and labels[j] == li]
        if not same:
            continue
        a = np.mean(np.linalg.norm(feats[i] - feats[np.array(same)], axis=1))
        bvals = []
        for l2 in others:
            if l2 == li:
                continue
            idx = np.array([j for j in range(n) if labels[j] == l2])
            bvals.append(np.mean(np.linalg.norm(feats[i] - feats[idx], axis=1)))
        if not bvals:
            continue
        b = min(bvals)
        ssum += (b - a) / max(a, b)
        cnt += 1
    return ssum / cnt if cnt else 0.0


def best_k(feats, max_k=8, n_null=5, min_cluster=3):
    """自适应说话人数（gap 统计 + 最小簇约束）：与打乱数据的聚类质量对比，
    只有真实声纹结构才能显著胜出；每个说话人至少 min_cluster 个片段；
    有效片段 <4 视为单说话人。返回 1 到 min(max_k, n)，不限人数"""
    n = len(feats)
    if n < 4:
        return 1
    rng = np.random.RandomState(0)

    best_k, best_gap = 1, -1.0
    for k in range(2, min(max_k, n // min_cluster) + 1):
        lab = kmeans_labels(feats, k)
        counts = np.bincount(lab, minlength=k)
        if np.any(counts < min_cluster):
            continue
        s_real = _silhouette(feats, lab)
        s_null = 0.0
        for _ in range(n_null):
            shuf = feats.copy()
            for c in range(feats.shape[1]):
                shuf[:, c] = feats[rng.permutation(n), c]
            s_null += _silhouette(shuf, kmeans_labels(shuf, k))
        s_null /= n_null
        gap = s_real - s_null
        if gap > best_gap and gap > 0.05:
            best_gap, best_k = gap, k
    return best_k


def merge_close_clusters(feats, labels, thr=0.93):
    """质心平均链接合并：两簇质心余弦相似度 ≥ thr 时合并（每轮重算质心）。
    用于收敛 k-means 对同一声线的过分割（短/噪声片段下 gap 统计易高估人数）。
    返回新标签列表（从 0 连续编号）。"""
    labels = np.array(labels, dtype=int)
    feats = np.asarray(feats, dtype=np.float64)
    while True:
        k = int(labels.max()) + 1
        cents = np.array([feats[labels == c].mean(axis=0) for c in range(k)])
        best_i = best_j = -1
        best_sim = thr
        for i in range(k):
            for j in range(i + 1, k):
                sim = float(np.dot(cents[i], cents[j]) /
                            (np.linalg.norm(cents[i]) * np.linalg.norm(cents[j]) + 1e-9))
                if sim > best_sim:
                    best_sim, best_i, best_j = sim, i, j
        if best_i < 0:
            break
        labels[labels == best_j] = best_i
        labels[labels > best_j] -= 1
    return labels.tolist()


def merge_small_clusters(labels, times, min_size=2):
    """零星小簇（≤ min_size 段）并入时间上最近的同性别簇（说话人持续性假设）。
    段数过少的簇多为噪声/短句误分，宁可归并也不臆造新说话人。原地修改 labels。"""
    while True:
        cnt = {}
        for l in labels:
            cnt[l] = cnt.get(l, 0) + 1
        if len(cnt) <= 1:
            break
        small = sorted([c for c, n in cnt.items() if n <= min_size])
        if not small:
            break
        c = small[0]
        idx = [i for i, l in enumerate(labels) if l == c]
        t_med = float(np.median([times[i] for i in idx]))
        best_c, best_d = None, 1e18
        for other, n in cnt.items():
            if other == c:
                continue
            oidx = [i for i, l in enumerate(labels) if l == other]
            d = min(abs(times[i] - t_med) for i in oidx)
            if d < best_d:
                best_d, best_c = d, other
        for i in idx:
            labels[i] = best_c
        # 重新编号 0..k-1
        remap = {}
        for l in labels:
            if l not in remap:
                remap[l] = len(remap)
        labels[:] = [remap[l] for l in labels]


def diarize(audio_path, segments):
    """segments: [{'start': s, 'end': e, ...}] → 返回与 segments 等长的说话人标签列表（男1/女2 或 None）"""
    x = load_audio(audio_path)
    if x is None or len(x) == 0:
        return [None] * len(segments)
    sr = SR
    feats = []
    for seg in segments:
        s0 = max(0, int(seg['start'] * sr))
        s1 = min(len(x), int(seg['end'] * sr))
        sl = x[s0:s1]
        if len(sl) < sr * 0.25:
            feats.append((0.0, np.zeros(13)))
            continue
        f0s = frame_f0(sl, sr)
        voiced = f0s[f0s > 0]
        f0med = float(np.median(voiced)) if len(voiced) else 0.0
        feats.append((f0med, mel_mfcc(sl, sr)))

    male_idx, female_idx = [], []
    for i, (f0med, _) in enumerate(feats):
        if f0med <= 0:
            continue
        (male_idx if f0med < 165.0 else female_idx).append(i)

    labels = [None] * len(segments)
    for g, idx in (('男', male_idx), ('女', female_idx)):
        if not idx:
            continue
        mf = np.stack([feats[i][1] for i in idx])
        times = np.array([segments[i]['start'] for i in idx])
        k = best_k(mf)  # 自适应说话人数：男1..男n / 女1..女n，不限人数
        cl = kmeans_labels(mf, k)
        cl = merge_close_clusters(mf, cl)   # 收敛同一声线的过分割
        merge_small_clusters(cl, times)     # 零星小簇按时间就近并入
        for j, i in enumerate(idx):
            labels[i] = f'{g}{cl[j] + 1}'

    # 无声段（无音高）：就近借用相邻已标记段
    for i in range(len(labels)):
        if labels[i] is None:
            best, bd = None, 1e18
            for j in range(len(labels)):
                if labels[j] and abs(segments[i]['start'] - segments[j]['start']) < bd:
                    bd = abs(segments[i]['start'] - segments[j]['start'])
                    best = labels[j]
            labels[i] = best
    return labels
