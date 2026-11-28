# RealOpenSnow

开源的雪场降雪追踪站点：多模型降雪预报加权综合、附近测站雪况、收藏对比。线上站点：<https://snow.moderns.dev>。

- 805 个雪场（北美 803 个，来自 OpenSkiMap）与自定义 GPS 地点
- ECMWF、GFS、ICON、NBM 等多模型预报，可调权重，简化/多模型比较两种视图
- 过去 7 天至未来 14 天时间轴，单位可切换
- 测站雪况：USDA NRCS SNOTEL、日本气象厅 AMeDAS、CoCoRaHS
- Google 登录后在设备间同步收藏、地点与设置

技术栈：React 19、TypeScript、Vite；Cloudflare Workers + D1；Better Auth；天气数据来自 [Open-Meteo](https://open-meteo.com/)。

## 本地开发

需要 Node.js 24（见 `.node-version`）。

```sh
npm install
npm run dev      # 纯前端，浏览器直连 Open-Meteo
npm test
npm run lint
npm run build
```

运行含 Worker、D1 和登录的完整站点：在 `.dev.vars` 中写入 `BETTER_AUTH_SECRET` 与 `GOOGLE_CLIENT_SECRET`（见「自行部署」），然后执行

```sh
npm run build:site && npx wrangler d1 migrations apply DB --local && npx wrangler dev --local-upstream localhost:8788 --port 8788
```

## 自行部署

1. 在 Cloudflare 创建 D1 数据库，把 `wrangler.jsonc` 中的 `account_id`、`database_id` 和 `routes` 域名换成你自己的。
2. 在 Google Cloud 创建 OAuth 客户端，回调地址为 `https://<你的域名>/api/auth/callback/google`，把 `GOOGLE_CLIENT_ID` 填入 `wrangler.jsonc` 的 `vars`。
3. 设置 Worker secrets：

   ```sh
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

4. `npm run deploy`：构建、应用 D1 迁移并部署。`npm run deploy:check` 只做打包校验。

`public/privacy.html` 中的联系邮箱与说明针对官方站点，自行部署时请替换。

## 许可

代码以 [MIT](LICENSE) 许可发布。

数据不在 MIT 许可范围内，按各自来源条款使用：

- 雪场目录：© OpenStreetMap contributors，经 OpenSkiMap，[ODbL](https://www.openstreetmap.org/copyright)
- 天气与海拔：Open-Meteo，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)；免费 API 仅限非商业用途，商业使用需另购 API 许可
- 测站：USDA NRCS（公共信息）、日本气象厅（公共数据利用规约 1.0）、CoCoRaHS（[CC BY 3.0](https://www.cocorahs.org/content.aspx?page=datausagepolicy)）
- 手工目录项摘录自雪场运营方公开资料，未确认开放数据许可，仅保留少量事实并链接来源
- IANA 时区资料：public domain

## 实现说明

支持 805 个雪场目录项（北美 803 个）、自定义 GPS 地点、个人追踪清单、多模型十四日预报与时段切换、查询点和单位切换、收藏对比与规则雪报。目录与逐字段证据在 `src/catalog.ts`，界面不显示数据来源、许可、API 链接和获取时间。稳定 ID 沿用原型，`chamonix` 仅代表 Les Grands Montets，不代表全谷；Niseko United 的四个雪场、Stowe 的两座山与天气查询点分别记录。

2026-11-17 核实：六个手工目录项均提供山脚、山腰、山顶各一个代表性缆车站点。运营方雪道图确认站点和分区，© OpenStreetMap contributors（[ODbL](https://www.openstreetmap.org/copyright)）提供站点经纬度。美国点采用 USGS EPQS 3DEP，日本点采用 Copernicus GLO-30 Public 地表模型，法国点采用 IGN RGE ALTI。以相同坐标采样海拔并取整米，逐点来源和精度说明可在界面查看。Niseko United 三档仅覆盖 Grand HIRAFU，Stowe 三档仅覆盖 Mount Mansfield。Alta 附近 Atwater、Snowbird 同名 NRCS SNOTEL 站提供两个可用参考点，明确为附近测站模型预报，不代表全雪场。NRCS 海拔 feet × 0.3048 换算为米；使用雪场民用时区，不使用测站 dataTimeZone。未核实点在请求和报告入口均被阻止。

北美目录由 `node scripts/build-north-america.mjs <数据目录>` 从 OpenSkiMap（© OpenStreetMap contributors，ODbL）生成 `src/northAmerica.ts`，收录标记为运营的高山滑雪场，手工目录项优先。查询点取运营缆车的最低、中间与最高端点，无缆车记录的取雪场位置一个点。时区与该点海拔来自 Open-Meteo。证据状态为 `mapped`，未经运营方逐项核对。目录 ID 用于收藏，重新生成时须保持已发布 ID 不变。

界面支持中文和英文：设置里选过的语言（localStorage `snow-lang`）优先，否则浏览器首选语言为 zh* 时显示中文，其余显示英文。数据内的中文地名和站点名在英文界面按规则换算显示，存储数据不变。

自定义地点保存在浏览器 localStorage，海拔与时区由 Open-Meteo 按坐标解析，海拔可手填。自定义地点不上报 Worker，也不支持测站雪况。

工作台按雪场独立保存当前查询点 ID（仅本页状态），默认选择山脚。390px 下图表和明细在各自区域内滚动，可用键盘操作。请求失败与重试期间保留错误，成功后才清除，取消请求的响应不再写入状态。

当前无自动推送。日期按雪场时区；跨时区对比尚不是相同 UTC 时间窗。缺失数据显示为 `—`，不计入所选时段总量。收藏以稳定雪场 ID 保存在各浏览器的 `snow-favorites` localStorage，旧版 cookie 收藏首次读取时迁移并删除 cookie；保留收藏顺序并去重；旧的重复或失效 ID 会显示整理提示。空收藏不恢复默认列表。记录损坏或存储读写失败会明确提示；保存失败时更改仍在当前页面有效，可重试保存，刷新可能丢失未保存更改。

多模型接入：显式请求 `src/weather.ts` 所列全部模型（全部参与加权，权重和显示可在设置中调整；准确性存档按下标取列，新模型只能追加），当地无数据的模型和列不显示。请求内容为小时降雪（cm）、温度（°C）、阵风（km/h）及 Unix UTC 时间戳。按雪场 IANA 时区汇总含今天的十五个自然日，我的雪场用时间轴在 −7 到 +14 天之间任选连续日期（默认过去 7 天 + 未来 7 天）；接口最多 16 天，降雪按前一小时归日，第 16 天缺最后一小时，故止于 +14；对比、雪报与快照仍用前七日。ICON 约覆盖 7.5 天，降雪/阵风取前一小时，温度取瞬时时刻；跨夏令时包含 23/25 小时。过去七个当地自然日（不含今天）以同一请求的 `past_days` 取得，来自历次模型短时预报拼接，非实测，单独展示且不存入快照。其余额外前后日期仅用于覆盖当地日边界，不展示为更长预报。小时缺测、非法数值或单位异常使对应日字段保持 null，不补零、不插值，也不算所选时段总量。界面仅在模型缺失时显示状态。cm/in 始终从未舍入 cm 换算。HTTP、网络、超时及无效响应明确报错。

预报模式：「简化」（默认）显示加权综合，「多模型比较」并列各模型及降雪范围。默认权重定义在 `src/weather.ts`（ECMWF 50、GFS/ICON/NBM 20–25、其余 10–15，按比例换算），未经实测校准；某地无数据的模型跳过，其余按比例放大。「显示」开关只影响多模型比较、模型范围和对比选项，按浏览器保存在 `snow-hidden` localStorage。用户可在「设置」修改，按浏览器保存在 `snow-weights` localStorage，按比例换算占比，0 表示停用。按日、按字段加权；启用的模型部分缺测时其余权重归一化；当地有数据的启用模型两个及以上而当日可用不足两个为 null；一个都没有时为 null。

雪质与雪线：小时请求另含 `rain`（mm）与 `freezing_level_height`（m），按日汇总为降雨、湿雪（气温高于 −1 °C 时的降雪）与冰冻层高低值。雪质由加权降雪、降雨和湿雪比例按 `src/snowQuality.ts` 的顺序规则分为未知、无、少量、好、极好、湿雪、雨；前一日为湿雪或雨时不评极好。雪线取加权冰冻层高度减 300 m，仅 GFS、ICON、HRRR、ICON-EU、ICON-D2 提供冰冻层，ECMWF 等不参与；冰冻层字段不计入模型完整度。旧快照缺字段时雪质为未知。

雪况区位于雪场详情顶部，合并模型累计与附近测站数据。Alta 与 Snowbird 使用 USDA NRCS AWDB（按 USDA 公共信息政策署名）的直接小时积雪深度。Niseko United 附近的倶知安使用日本气象厅 AMeDAS（公共数据利用规约 1.0）的积雪深度和气象厅发布的 24 小时降雪量，该降雪量采用逐小时积雪增量汇总。Stowe 附近使用 CoCoRaHS Waterbury 3.0 NW 的每日直接观测（[CC BY 3.0](https://www.cocorahs.org/content.aspx?page=datausagepolicy)），保留微量标记。小时观测满三小时、日观测满三十小时即标为过期并隐藏数值。

定时刷新收藏雪场预报时，Worker 同时把七日预报快照写入 D1 `forecast_snapshots`（Waterbury 参考点另存小时降雪），页面不展示。

## 官方站点运维

官方站点 `https://snow.moderns.dev` 通过 GitHub PR 更新，合并到 `main` 后由 Cloudflare Workers Builds 运行 `npm run deploy`。命令构建 Worker、应用 D1 迁移，再部署到自定义域。PR CI 运行测试、lint 和 Wrangler dry-run。`npm run deploy:check` 可在本地执行相同打包校验。排查线上故障时，在 Cloudflare Workers 的部署历史核对 Git 提交和版本；若回滚 Worker，保留已应用的数据库迁移。

账户：Google 登录由 Better Auth 处理。D1 中共享数据为预报缓存、天气配额和预报快照；个人数据按用户存于 `user_settings`（单位、权重、隐藏模型）、`user_favorites`、`user_locations`。cookie 只保存登录会话。未登录时数据只存在本机；首次登录上传本机数据，之后以云端为准。`GOOGLE_CLIENT_ID` 在 `wrangler.jsonc` 的 vars 中（Google Cloud 项目 realopensnow），线上需配置 Worker secrets `BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_SECRET`，Google OAuth 回调地址为 `https://snow.moderns.dev/api/auth/callback/google`。

公开站由浏览器直接请求 Open-Meteo。免费发布不配置 API 密钥。改为商业用途前需获得对应 API 许可与服务端密钥并重新审核发布条件。

客户端以数据获取时间起算六小时或雪场当地换日作为失效边界。刷新失败、限流和过期状态在预报、对比与雪报入口均有明确提示。

Cloudflare Worker 日志按 `forecast_client_error` 查看浏览器报告的上游错误与限流。
