@echo off
chcp 65001 >nul
title 议迹 - Whisper 转写环境安装
echo ============================================
echo   议迹 - faster-whisper 一键安装
echo ============================================
echo.

cd /d "%~dp0"

rem 优先使用应用内置 Python（安装包自带，无需用户安装）；找不到时回退系统 python
set "PY=python"
if exist "%~dp0..\..\resources\python\python.exe" set "PY=%~dp0..\..\resources\python\python.exe"
if exist "%~dp0python.exe" set "PY=%~dp0python.exe"
%PY% --version >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Python。请重新安装议迹（新版安装包已内置 Python），或安装 Python 3.10+ 并勾选 "Add to PATH"。
    pause
    exit /b 1
)

echo 使用 Python：%PY%

rem 目标目录：D 盘存在时用 D:\ClawData\议迹\whisper-venv，否则用 %APPDATA%\议迹\whisper-venv
if exist "D:\" (
    set "VENV_DIR=D:\ClawData\议迹\whisper-venv"
) else (
    set "VENV_DIR=%APPDATA%\议迹\whisper-venv"
)
echo 目标位置：%VENV_DIR%

echo [1/3] 创建虚拟环境 ...
if not exist "%VENV_DIR%\Scripts\python.exe" (
    %PY% -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [错误] 创建虚拟环境失败。
        pause
        exit /b 1
    )
)

echo [2/3] 安装 faster-whisper（首次约 200-400MB）...
"%VENV_DIR%\Scripts\python.exe" -m pip install --upgrade pip
"%VENV_DIR%\Scripts\python.exe" -m pip install faster-whisper
if errorlevel 1 (
    echo [错误] 安装失败。若网络受限，可尝试：
    echo   "%VENV_DIR%\Scripts\python.exe" -m pip install faster-whisper -i https://pypi.tuna.tsinghua.edu.cn/simple
    pause
    exit /b 1
)

echo [3/3] 安装完成。
echo.
echo 首次转写时 faster-whisper 会自动下载模型（默认 small，约 460MB）。
echo 如需换模型，在应用「设置 - 转写」中修改模型名称即可。
echo.
pause
