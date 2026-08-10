# X Insight Monitor

可安装在 Windows 和 macOS 的 X 大V监控桌面应用。发现新帖后自动完成中文翻译、观点逻辑分析、事实与数值主张拆解、免费网页证据检索，并向企业微信群机器人执行两阶段推送。

## 当前 MVP 能力

- 默认监控 10 个、最多 20 个公开 X 账号，30–600 秒可配置轮询。
- X 官方 API 与 `twscrape` 双采集源。配置 App-only Bearer Token 后默认并仅使用官方渠道；未配置时使用 Cookie 非官方渠道。
- 原创和引用帖默认启用；回复、转发可按账号控制。
- 首次添加账号只建立最新帖子基线，不推送历史帖。
- 官方时间线在建立基线后使用 `since_id` 增量读取，避免重复返回旧帖子造成不必要的资源用量。
- OpenAI Responses API 严格结构化输出；模型和 Base URL 可配置，请填写账户实际可用的模型名称。
- 事实、数值、观点、预测分流；不把观点判成真假。
- DuckDuckGo HTML 免费搜索；失败时降级为“证据不足”。
- 企业微信群机器人快讯 + 深度报告两阶段推送。
- 本地原子化存储、帖子强去重、重试、日志和每日模型额度。
- OS 安全存储加密 API Key、Webhook、X Bearer Token 与 X Cookie。
- 后台运行、系统托盘、开机自启动。

## 用户安装与配置

安装后打开“系统设置”，填写：

1. OpenAI API Key、Base URL、翻译模型和分析模型。
2. 企业微信群机器人 Webhook。
3. X Developer App 的 App-only Bearer Token；若不使用官方 API，再填写专用采集账号的 Cookie Header（必须含 `auth_token` 与 `ct0`）。
4. 时区、调用上限及是否开机自动运行。

分别执行三个“测试”按钮，全部成功后添加监控账号并点击“启动监控”。应用窗口关闭后仍保留在系统托盘运行；通过托盘菜单可退出。

> 官方 API 可能产生用量费用并受应用额度限制。Bearer Token 存在但请求失败时，应用会明确报错，不会静默降级到非官方源。非官方源受 X 页面和内部接口变化、登录验证与风控影响，不保证严格实时或完全不漏帖。请只采集公开内容，并遵守适用条款和法律。

## 本地开发

前置条件：Node.js 22+、Python 3.10+。

```bash
npm install
python -m pip install -r requirements.txt
npm run dev
```

开发模式会启动 Vite、TypeScript 编译监听和 Electron。首次测试采集时，Python 环境必须已安装 `twscrape`。

## 检查与测试

```bash
npm run typecheck
npm test
npm run build
```

## 生成安装包

安装 Python 依赖后，在目标操作系统执行：

```bash
npm run dist:win   # Windows NSIS 安装程序
npm run dist:mac   # macOS DMG 与 ZIP
```

PyInstaller sidecar 必须在目标操作系统及目标 CPU 架构上构建，不能从 Windows 交叉编译 macOS。仓库提供 GitHub Actions 矩阵，可分别生成 Windows x64、macOS Intel 和 Apple Silicon 安装包。

未配置 Apple Developer ID 时，macOS 构建产物不会签名或公证，用户首次打开需要在系统隐私与安全中确认。正式外部分发前应配置签名与 notarization。

## 数据与隐私

- 普通业务数据位于应用的用户数据目录，最多保留 2,000 条帖子和 500 条日志。
- 敏感配置通过 Electron `safeStorage` 使用 Windows DPAPI 或 macOS Keychain 支持的加密能力；Bearer Token 不写入日志或普通数据文件。
- `twscrape` 会话库只在系统临时目录中创建，应用正常退出时清理。
- 日志不会主动输出 API Key、完整 Webhook、Bearer Token 或 Cookie。
- OpenAI 请求设置 `store: false`。

## 已知边界

- 免费检索只读取搜索结果标题、链接和摘要，尚未抓取全文或验证页面发布日期。
- 当前没有图片 OCR、视频字幕分析、人工复核工作台或官方 Filtered Stream；官方渠道当前采用用户帖子时间线轮询。
- macOS/Windows 正式安装包仍需要在对应平台完成签名配置和实机 smoke test。
- `twscrape` 上游变化可能导致采集暂时不可用；出现连续失败时应用会显示账号异常和日志。
