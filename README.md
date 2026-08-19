# 议迹 MeetingTracker

<p align="center">
  <img src="https://img.shields.io/badge/版本-v1.8.0-blue" alt="v1.8.0"/>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-333333" alt="macOS Apple Silicon"/>
  <img src="https://img.shields.io/badge/Windows-x64-0078d6" alt="Windows x64"/>
  <img src="https://img.shields.io/badge/许可-非商业使用-red" alt="非商业使用"/>
  <img src="https://img.shields.io/badge/隐私-完全本地-green" alt="完全本地"/>
</p>

> 议迹是一款面向「持续跟进型会议」的桌面应用。它以任务为主线，把散落的会议串成一条可回溯的时间线。

## ✨ 功能特性

- 🎙️ **一键录音，自动转写**：开会时一键录音，结束后自动完成本地语音转写（内置 SenseVoiceSmall 模型，完全离线，支持说话人区分与标点恢复）
- 🧠 **AI 结构化纪要**：由 AI 将转写提炼为**议题、决策、待办、遗留问题**四类结构化纪要，可直接修改确认
- 🔍 **跨会议对比**：勾选同一任务下的任意两场会议，自动分析议题如何变化、决策如何演进、待办推进到哪一步、遗留问题是否解决，并生成改进总结
- 🔄 **转折点标记**：相邻会议若出现多处决策调整，时间线会自动标记「转折点」
- 🔒 **隐私优先**：数据只存在本机，无账号、无联网上传；AI 服务可选本地 Ollama（免费离线）或任意兼容端点（DeepSeek、通义、智谱等）

## 🖥️ 平台支持

| 平台 | 架构 | 安装包 |
|---|---|---|
| macOS | Apple Silicon（M 芯片） | `YIJI-1.8.0-mac-arm64.dmg` |
| Windows | x64 | `YIJI-Setup-1.8.0.exe` |

👉 **前往 [Releases](https://github.com/anvictor042-cyber/meeting-summary-YIJI/releases) 下载对应你系统的安装包**

## 🚀 快速上手

1. 下载并安装对应平台的安装包
2. 启动后，首次会弹出「非商业使用声明」，点击 **我已阅读并同意**
3. 创建任务，在会议中点击录音
4. 会议结束后自动转写并生成结构化纪要
5. 在同一任务下勾选两场会议，体验「对比」能力

## 🌐 国内下载说明

GitHub 在国内访问可能不稳定，下载安装包时如果遇到打不开或速度慢，请尝试以下方式：

1. **开启代理/VPN 后下载**（推荐）：代理连上后直接点击 Releases 里的文件即可
2. **使用 GitHub 加速镜像**：将下载链接前缀 `https://github.com/` 替换为加速镜像地址，例如：
   ```
   https://gh-proxy.com/https://github.com/anvictor042-cyber/meeting-summary-YIJI/releases/download/v1.8.0/YIJI-1.8.0-mac-arm64.dmg
   ```
3. **直接使用直链**：
   - macOS（M 芯片）：`https://github.com/anvictor042-cyber/meeting-summary-YIJI/releases/download/v1.8.0/YIJI-1.8.0-mac-arm64.dmg`
   - Windows：`https://github.com/anvictor042-cyber/meeting-summary-YIJI/releases/download/v1.8.0/YIJI-Setup-1.8.0.exe`

> ⚠️ 加速镜像为第三方服务，请自行判断可信度；文件校验信息见安装说明文档。

## 🛠️ 技术栈

- **框架**：Electron
- **语音转写**：SenseVoiceSmall（本地离线，支持说话人区分）
- **AI 纪要**：本地 Ollama 或任意 OpenAI 兼容端点
- **数据存储**：本地数据库（SQLite / sql.js），无云端依赖

## 📁 项目结构

```
├── main.js              # Electron 主进程（窗口、IPC、启动声明弹窗）
├── preload.js           # 预加载脚本（安全桥接）
├── src/                 # 主进程模块（数据库/AI/转写/设置）
├── renderer/            # 前端界面（任务/会议/对比/设置）
├── scripts/             # 构建与辅助脚本（打包/转写/测试）
├── schema.sql           # 数据库表结构
├── build/               # 应用图标
└── package.json
```

## 📜 非商业使用声明

本软件免费提供，**仅限个人学习、研究及个人日常使用**，禁止任何形式的商业使用（包括商业销售、企业内商业化部署、以本软件为卖点的产品化行为等）。详细条款见 [LICENSE](./LICENSE)。

## ⭐ 支持项目

如果议迹对你有帮助，欢迎点个 **Star** 支持一下，让更多需要的人发现它。你的支持是作者持续维护的动力，非常感谢！

## 📬 联系

如需商业合作或授权，请通过 GitHub Issues 联系作者。
