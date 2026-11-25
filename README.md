# RealOpenSnow

网页版雪场追踪原型。React、TypeScript、Vite，浏览器查询 Open-Meteo。

```sh
npm install
npm run dev
npm test
npm run build
npm run lint
```

支持 805 个雪场目录项（北美 803 个）、自定义 GPS 地点、本机收藏、三模型七日预报、查询点和单位切换、收藏对比与规则雪报。目录与逐字段证据在 `src/catalog.ts`，界面展示来源、核实日期和许可状态。稳定 ID 沿用原型，`chamonix` 仅代表 Les Grands Montets，不代表全谷；Niseko United 的四个雪场、Stowe 的两座山与天气查询点分别记录。

2026-11-17 核实：六个手工目录项均提供山脚、山腰、山顶各一个代表性缆车站点。运营方雪道图确认站点和分区，© OpenStreetMap contributors（[ODbL](https://www.openstreetmap.org/copyright)）提供站点经纬度。美国点采用 USGS EPQS 3DEP，日本点采用 Copernicus GLO-30 Public 地表模型，法国点采用 IGN RGE ALTI。以相同坐标采样海拔并取整米，逐点来源和精度说明可在界面查看。Niseko United 三档仅覆盖 Grand HIRAFU，Stowe 三档仅覆盖 Mount Mansfield。Alta 附近 Atwater、Snowbird 同名 NRCS SNOTEL 站提供两个可用参考点，明确为附近测站模型预报，不代表全雪场。NRCS 海拔 feet × 0.3048 换算为米；使用雪场民用时区，不使用测站 dataTimeZone。未核实点在请求和报告入口均被阻止。

北美目录由 `node scripts/build-north-america.mjs <数据目录>` 从 OpenSkiMap（© OpenStreetMap contributors，ODbL）生成 `src/northAmerica.ts`，收录标记为运营的高山滑雪场，手工目录项优先。查询点取运营缆车的最低、中间与最高端点，无缆车记录的取雪场位置一个点。时区与该点海拔来自 Open-Meteo。证据状态为 `mapped`，未经运营方逐项核对。目录 ID 用于收藏，重新生成时须保持已发布 ID 不变。

自定义地点保存在浏览器 localStorage，海拔与时区由 Open-Meteo 按坐标解析，海拔可手填。自定义地点不上报 Worker，也不支持快照和测站雪况。

雪场运营方来源未确认开放数据许可，仅摘录少量事实并链接来源；商业发布许可待确认。NRCS 来源按 USDA 公共信息政策署名，IANA 时区资料为 public domain。天气来源：[Open-Meteo](https://open-meteo.com/)，公开站用于非商业评估，天气原始数据按 CC BY 4.0 署名，日值由本站汇总。

工作台按雪场独立保存当前查询点 ID（仅本页状态），默认选择山脚。390px 下图表和明细在各自区域内滚动，可用键盘操作。请求失败与重试期间保留错误，成功后才清除，取消请求的响应不再写入状态。

当前无账号或自动推送。日期按雪场时区；跨时区对比尚不是相同 UTC 时间窗。缺失数据显示为 `—`，不计入七日总量。收藏以稳定雪场 ID 保存在浏览器 localStorage，保留收藏顺序并去重；旧的重复或失效 ID 会显示整理提示。空收藏不恢复默认列表。记录损坏或存储读写失败会明确提示；保存失败时更改仍在当前页面有效，可重试保存，刷新可能丢失未保存更改。

多模型接入：显式请求 ECMWF IFS 0.25°、GFS Seamless、ICON Seamless 的小时降雪（cm）、温度（°C）、阵风（km/h）及 Unix UTC 时间戳。按雪场 IANA 时区汇总含今天的七个自然日，降雪/阵风取前一小时，温度取瞬时时刻；跨夏令时包含 23/25 小时。请求额外前后日期仅用于覆盖当地日边界，不展示为更长预报。小时缺测、非法数值或单位异常使对应日字段保持 null，不补零、不插值，也不算七日总量。界面显示各模型完整状态、真实请求链接、请求/接收时间、查询坐标与 API 网格中心；API 不提供模型起报时间，不把获取时间当起报时间。cm/in 始终从未舍入 cm 换算。HTTP、网络、超时及无效响应明确报错。

预报模式：「简化」（默认）显示加权综合，「多模型比较」并列各模型及降雪范围。权重定义在 `src/weather.ts`：ECMWF 50%、GFS 25%、ICON 25%，为未经实测校准的固定经验值。按日、按字段加权；缺一模型时其余权重归一化并标明缺失模型，不足两个模型为 null。

雪况区独立展示附近测站数据。Alta 与 Snowbird 使用 USDA NRCS AWDB（按 USDA 公共信息政策署名）的直接小时积雪深度。Niseko United 附近的倶知安使用日本气象厅 AMeDAS（公共数据利用规约 1.0）的积雪深度和气象厅发布的 24 小时降雪量，该降雪量采用逐小时积雪增量汇总。Stowe 附近使用 CoCoRaHS Waterbury 3.0 NW 的每日直接观测（[CC BY 3.0](https://www.cocorahs.org/content.aspx?page=datausagepolicy)），保留微量标记。小时观测满三小时、日观测满三十小时即标为过期并隐藏数值。雪道与缆车开放状态未知时链接运营方页面。

历史预报与准确性位于查询点详情。点击「获取并保存快照」由 Worker 从 Open-Meteo 获取并追加到 D1，历史可分页查看。快照保留模型值、获取时间、查询坐标、海拔、单位与当地有效日期。当前接口的模型起报时间为未知。首次保存前无本站快照。

Waterbury 参考点按 CoCoRaHS 公布的同址坐标与 458 ft 海拔（139.6 m）请求预报。仅以最近 30 个当地日期内相邻日测时间明确、整点到整点且恰好相隔 24 小时的直接新雪衡量误差，使用保存的完整小时降雪累计覆盖同一窗口。窗口开始前的快照按获取时间分七个 24 小时提前量档，每 UTC 六小时保留最后一个快照进入统计，每模型每档对同一窗口最多计一次。少于十个窗口标为样本不足。首次同址保存后须等可匹配的观测窗结束并上报，才会出现真实样本。

## 发布

正式站点为 `https://snow.moderns.dev`。通过 GitHub PR 更新，合并到 `main` 后由 Cloudflare Workers Builds 运行 `npm run deploy`。命令构建 Worker、应用 D1 迁移，再部署到自定义域。PR CI 运行测试、lint 和 Wrangler dry-run。`npm run deploy:check` 可在本地执行相同打包校验。排查线上故障时，在 Cloudflare Workers 的部署历史核对 Git 提交和版本；若回滚 Worker，保留已应用的数据库迁移。


公开站由浏览器直接请求 Open-Meteo。免费发布不配置 API 密钥。改为商业用途前需获得对应 API 许可与服务端密钥并重新审核发布条件。

客户端以数据获取时间起算六小时或雪场当地换日作为失效边界。刷新失败、限流和过期状态在预报、对比与雪报入口均有明确提示。

Cloudflare Worker 日志按 `forecast_client_error` 查看浏览器报告的上游错误与限流。
