#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 mac .app 打成保留符号链接的 zip（Windows 上 Compress-Archive 会丢 symlink）。
用法: python pack_mac_zip.py <app_dir> <out_zip>
zip 内顶层直接是 议迹.app/，解压即得可运行 app。
"""
import os, sys, zipfile

def pack(app_dir, out_zip):
    root = app_dir.rstrip('/\\')
    base = os.path.dirname(root)
    app_name = os.path.basename(root)
    count = {'file': 0, 'dir': 0, 'sym': 0}
    with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as z:
        for dirpath, dirnames, filenames in os.walk(root):
            for name in sorted(dirnames + filenames):
                p = os.path.join(dirpath, name)
                rel = os.path.relpath(p, base).replace('\\', '/')
                if os.path.islink(p):
                    zi = zipfile.ZipInfo(rel)
                    zi.external_attr = (0o120666 << 16)  # symlink 类型
                    zi.create_system = 3
                    z.writestr(zi, os.readlink(p))
                    count['sym'] += 1
                elif os.path.isdir(p):
                    zi = zipfile.ZipInfo(rel + '/')
                    zi.external_attr = (0o40755 << 16)
                    zi.create_system = 3
                    z.writestr(zi, b'')
                    count['dir'] += 1
                else:
                    z.write(p, rel)
                    count['file'] += 1
    print(f'PACK_OK {app_name} files={count["file"]} dirs={count["dir"]} symlinks={count["sym"]} -> {out_zip}')

if __name__ == '__main__':
    pack(sys.argv[1], sys.argv[2])
