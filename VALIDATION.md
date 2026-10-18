# 验收记录

2026-10-18，pure 0.3.0，Windows 11 x64（10.0.26200）、Node.js 24.9.0、Electron 44.9.0。

## 本地通过

- TypeScript 严格类型检查、生产构建、22 项单元测试。
- 文件：UTF-8/BOM/CRLF、中文空格路径、并发新建编号、独占创建、重命名保留草稿和缓冲区、拒绝覆盖/非法名称/只读/陈旧版本、硬链接不可用时回退、配置与草稿迁移。
- 可靠性：保存冲突、写入失败、文件删除恢复、并发重载保护、旧文档释放、目录缓存增量失效、标题和跨格式查找。
- 最终 ZIP 实际解压运行：目录定位、新建高亮、F2 重命名、取消未保存切换、侧栏拖动/边界/键盘/重启保留、千文件目录屏幕外新建与快速打开。
- 最终 ZIP 内程序完整回归：编辑、撤销重做、源码切换、主题、阅读、焦点、打字机、查找替换、目录增删、外部同步、冲突另存、真实 PDF、关闭取消及异常退出恢复。
- 单 EXE 实际解包启动、命令行打开中文路径、编辑保存、公式及 Mermaid；README 截图由正式程序生成。
- PDF：三页长文、屏幕外公式与图表、错误图表源码保留；pypdf 检查中文和图表文字，并渲染全部页面检查排版。
- 性能：两版解压程序和单 EXE 各启动 10 次，并测量 2 万字、10 万字和千文件目录。完整样本在 `docs/performance.json`，解释在性能文档。

## 本地复核位置

这些测试目录是本机生成结果，不提交到公开仓库。

- 文件管理：`test-results/workspace-1792313420755/results.json`
- 编辑功能：`test-results/features-1792313427768/results.json`
- 完整回归：`test-results/e2e-1792313432027/results.json`
- 单 EXE：`test-results/portable-1792313416056/results.json`
- PDF：`test-results/export-1792313418436`、`test-results/pdf-qa.json`
- 性能：`test-results/benchmark-baseline-1792312068404/results.json`、`test-results/benchmark-final-1792313302022/results.json`

公开仓库 Windows Actions 还会从全新检出执行安装、测试和构建；版本标签增加正式程序与单 EXE 验证，运行结果可在仓库 Actions 页面复核。

## 边界

Windows 10 未在实机验证。中文组合输入使用 Chromium composition/commit 事件验证，未逐一人工测试各厂商输入法。性能数据代表同机固定文档，未清空系统文件缓存。首次千文件查询比旧版慢，重复查询、长文和启动指标分别记录，不笼统宣称全部操作提速。
