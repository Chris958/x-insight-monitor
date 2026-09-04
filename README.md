# X Insight Monitor

可安装在 Windows 和 macOS 的 X 大V监控桌面应用。发现新帖后提炼唯一核心投资观点，核查其可信度，并给出可能利好的行业、上市公司和关键风险。实时快讯、精简投资报告和每日汇总统一通过企业微信群机器人 Webhook 推送。

## 当前 MVP 能力

- 默认监控 10 个、最多 20 个公开 X 账号，30–600 秒可配置轮询。
- X 官方 API 与 `twscrape` 双采集源。配置 App-only Bearer Token 后默认并仅使用官方渠道；未配置时使用 Cookie 非官方渠道。
- 原创和引用帖默认启用；回复、转发可按账号控制。
- 首次添加账号只建立最新帖子基线，不推送历史帖。
- 官方时间线在建立基线后使用 `since_id` 增量读取，避免重复返回旧帖子造成不必要的资源用量。
- OpenAI Responses API 严格结构化输出；模型和 Base URL 可配置，请填写账户实际可用的模型名称。
- 每帖只审查一个核心观点，不再逐条拆解边缘事实或输出冗长推理过程。
- DuckDuckGo HTML 最多执行两条针对性检索；证据不足时明确降级，不编造结论。
- 输出最多3个受益行业、5家上市公司和3条关键风险；公司包含股票代码、市场及确定性等级。
- 企业微信群机器人两阶段实时推送：发现新帖后发送核心观点快讯，分析完成后发送精简投资报告。
- 同一个机器人可按指定时区和时间发送每日汇总；成功日期会去重。
- 推送失败不终止分析，完整报告仍保存到本机，并在帖子详情和日志中显示推送异常。
- 本地原子化存储、帖子强去重、重试、日志和每日模型额度。
- OS 安全存储加密 API Key、Webhook、X Bearer Token 与 X Cookie。
- 后台运行、系统托盘、开机自启动。

## 用户安装与配置

安装后打开“系统设置”，填写：

1. OpenAI API Key、Base URL、翻译模型和分析模型。
2. 企业微信群机器人 Webhook，并选择是否启用实时推送和每日汇总。
3. X Developer App 的 App-only Bearer Token；若不使用官方 API，再填写专用采集账号的 Cookie Header（必须含 `auth_token` 与 `ct0`）。
4. 时区、调用上限及是否开机自动运行。

在目标企业微信群中添加“群机器人”，从机器人详情复制完整 Webhook。无需创建自建应用，也不需要 CorpID、AgentID、Secret 或 UserID。点击“测试企业微信机器人”会发送一条 Markdown 测试消息，用于验证完整链路。

分别执行采集、模型和企业微信机器人测试，全部成功后添加监控账号并点击“启动监控”。应用窗口关闭后仍保留在系统托盘运行；通过托盘菜单可退出。

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
- 敏感配置通过 Electron `safeStorage` 使用 Windows DPAPI 或 macOS Keychain 支持的加密能力；API Key、Webhook、Bearer Token 与 Cookie 不写入日志或普通数据文件。
- `twscrape` 会话库只在系统临时目录中创建，应用正常退出时清理。
- 日志不会主动输出 API Key、完整 Webhook、Bearer Token 或 Cookie。
- OpenAI 请求设置 `store: false`。

## 已知边界

- 免费检索只读取搜索结果标题、链接和摘要，尚未抓取全文或验证页面发布日期；公司受益关系无法确认时不会强行列出。
- 当前没有图片 OCR、视频字幕分析、人工复核工作台或官方 Filtered Stream；官方渠道当前采用用户帖子时间线轮询。
- macOS/Windows 正式安装包仍需要在对应平台完成签名配置和实机 smoke test。
- 企业微信机器人的实时快讯、完整报告及每日汇总必须使用真实 Webhook 做端到端测试；无凭据环境只验证请求结构、字节限制和错误处理。
- `twscrape` 上游变化可能导致采集暂时不可用；出现连续失败时应用会显示账号异常和日志。
