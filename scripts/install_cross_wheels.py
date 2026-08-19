#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把跨平台下载的 wheel / sdist 解压进目标内置 Python 的 site-packages（mac arm64 / x64 通用）。"""
import os, sys, zipfile, tarfile, shutil, glob

def install_wheels(wheel_dir, site_packages):
    os.makedirs(site_packages, exist_ok=True)
    count = 0
    for whl in glob.glob(os.path.join(wheel_dir, '*.whl')):
        with zipfile.ZipFile(whl) as z:
            # 跳过 dist-info 外的文件逐个解压，避免覆盖冲突
            for name in z.namelist():
                # wheel 内所有内容都应进 site-packages（含 .data/purelib 处理）
                z.extract(name, site_packages)
        count += 1
        print('WHEEL_OK', os.path.basename(whl))
    return count

def install_sdist_jieba(tgz, site_packages):
    """jieba 是纯 Python 包，sdist 里 jieba/ 目录直接复制即可。"""
    tmp = os.path.join(os.path.dirname(tgz), '.jieba-src')
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    with tarfile.open(tgz) as t:
        t.extractall(tmp)
    src = glob.glob(os.path.join(tmp, 'jieba-*', 'jieba'))
    if not src:
        raise RuntimeError('jieba sdist 中未找到 jieba/ 目录')
    dst = os.path.join(site_packages, 'jieba')
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(src[0], dst)
    shutil.rmtree(tmp, ignore_errors=True)
    print('SDIST_OK jieba')

if __name__ == '__main__':
    wheel_dir, site_packages = sys.argv[1], sys.argv[2]
    n = install_wheels(wheel_dir, site_packages)
    tgz = glob.glob(os.path.join(wheel_dir, 'jieba-*.tar.gz'))
    if tgz:
        install_sdist_jieba(tgz[0], site_packages)
    print(f'ALL_DONE wheels={n}')
