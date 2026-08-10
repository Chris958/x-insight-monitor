# 开发状态

版本：0.1.0 MVP

## 已完成

- Windows/macOS Electron 桌面壳、托盘和登录自启动。
- 设置、概览、账号、帖子报告、运行日志五个页面。
- 操作系统安全存储、普通数据原子写入和本地历史限制。
- Python `twscrape` JSON Lines sidecar 与临时会话库。
- 账号基线、过滤、轮询抖动、指数退避和 X 帖子 ID 去重。
- OpenAI Responses API 翻译、主张拆解、逻辑分析和证据判断。
- DuckDuckGo 免费检索 Provider 与来源初步分级。
- 企业微信群快讯/报告、分段和重试。
- PyInstaller + electron-builder 打包链路和三平台架构 CI。

## 发布前必须完成

1. 使用真实专用 X 账号验证 Cookie 登录与 10 个目标账号连续采集。
2. 使用真实模型 API 和企业微信群 Webhook 完成端到端测试。
3. 在 Windows x64、macOS Intel、macOS Apple Silicon 实机验证安装、托盘、开机启动和休眠恢复。
4. 配置 Windows 代码签名、Apple Developer ID 签名与公证。
5. 运行 72 小时稳定性测试，并按人工标注的 100 条帖子评测分析质量。

这些步骤依赖外部凭据、目标账号和对应操作系统，未在无凭据的开发环境中伪造通过。
