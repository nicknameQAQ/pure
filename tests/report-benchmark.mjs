import { promises as fs } from 'node:fs'
const [baselinePath, currentPath] = process.argv.slice(2)
if (!baselinePath || !currentPath) throw new Error('Usage: node tests/report-benchmark.mjs baseline/results.json final/results.json')
const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'))
const current = JSON.parse(await fs.readFile(currentPath, 'utf8'))
const rows = [
  ['解压版：窗口可连接', baseline.summary.direct.windowMs, current.summary.direct.windowMs],
  ['解压版：正文可输入', baseline.summary.direct.readyMs, current.summary.direct.readyMs],
  ['单 EXE：正文可输入（含解包）', baseline.summary.portable.readyMs, current.summary.portable.readyMs],
  ['首次打开 2 万字文档', baseline.summary[20000].openMs, current.summary[20000].openMs],
  ['随后打开 10 万字文档', baseline.summary[100000].openMs, current.summary[100000].openMs],
  ['2 万字：输入到下一帧', baseline.summary[20000].inputMs, current.summary[20000].inputMs],
  ['10 万字：输入到下一帧', baseline.summary[100000].inputMs, current.summary[100000].inputMs],
  ['2 万字：查找首个结果', baseline.summary[20000].searchMs, current.summary[20000].searchMs],
  ['10 万字：查找首个结果', baseline.summary[100000].searchMs, current.summary[100000].searchMs],
  ['千文件：首次快速打开查询', baseline.summary.quickMs[0], current.summary.quickMs[0]],
  ['千文件：再次快速打开查询', baseline.summary.quickMs[1], current.summary.quickMs[1]],
]
const table = rows.map(([label, old, next]) => `| ${label} | ${old.median.toFixed(1)} / ${old.p95.toFixed(1)} | ${next.median.toFixed(1)} / ${next.p95.toFixed(1)} | ${((next.median / old.median - 1) * 100).toFixed(1)}% |`).join('\n')
const memory = [baseline.summary.direct.memoryMB, current.summary.direct.memoryMB]
await fs.writeFile('docs/PERFORMANCE.md', `# 性能记录\n\n2026-10-18，同机对比 0.2.0 与 pure 0.3.0。${current.platform}；${current.cpu}；内存 ${current.memoryGB.toFixed(0)} GiB。Electron 44.9.0。\n\n## 方法\n\n每版解压程序、单 EXE 各启动 10 次，使用全新独立配置目录。没有清空 Windows 文件缓存，也没有重启系统；因此不是严格的系统冷启动实验。测试期间不运行其他构建任务。\n\n窗口指标是测试工具首次取得窗口连接的时间，正文指标额外等待可编辑正文和两帧渲染。单 EXE 使用相同的 CDP 连接流程，其数值包含解包与测试连接开销；比较软件初始化时应看两版解压程序。\n\n每次解压版运行依次打开 2 万字、10 万字固定文档，各连续输入 10 次，记录输入提交到下一帧的耗时，并测试查找首个结果。千文件测试记录首次及再次快速打开。P95 使用 nearest-rank，启动样本为 10 次、输入样本为 100 次。\n\n## 结果\n\n时间单位为毫秒，每格为 **中位数 / P95**。变化按中位数计算，负数表示耗时降低。\n\n| 指标 | 0.2.0 | pure 0.3.0 | 变化 |\n| --- | ---: | ---: | ---: |\n${table}\n\n正文可输入时全部 Electron 进程工作集：0.2.0 为 ${memory[0].median.toFixed(1)} MiB（P95 ${memory[0].p95.toFixed(1)}），pure 为 ${memory[1].median.toFixed(1)} MiB（P95 ${memory[1].p95.toFixed(1)}）。该值是一个时点的工作集，并非长期内存占用或峰值，不据此承诺内存下降。\n\n## 改动与边界\n\n- 源码编辑器、打印视图按需加载，生产代码压缩，启动入口直接挂载已加载模块，避免等待 Suspense 回退界面。\n- 大目录仅渲染可见文件行；文件树、筛选和快速打开共享目录缓存及后台索引。\n- 长文大纲和统计使用 Worker；查找缓存按文档与查询失效，移动光标不重新扫描全文。\n- 单 EXE 仍需解包，因此默认推荐 ZIP 解压后运行。没有通过关闭安全隔离、公式或图表功能换取速度。\n- 结果只代表本机和固定文档；杀毒软件、磁盘、字体、文档结构及首次资源加载均会影响耗时。首次千文件查询仍有回退，表中如实保留；重复查询改善明显，首次索引与弹窗的开销仍可继续优化。\n\n原始样本见 [performance.json](performance.json)。复测命令：\n\n\`\`\`powershell\nnode tests/benchmark.mjs label path/to/direct.exe path/to/portable.exe\n\`\`\`\n`)
await fs.writeFile('docs/performance.json', JSON.stringify({ baseline, current }, null, 2) + '\n')
console.log('Wrote docs/PERFORMANCE.md and raw samples')
