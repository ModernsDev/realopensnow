import { northAmerica, type NorthAmericaResort } from './northAmerica.ts'

export const verifiedOn = '2026-11-17'
export type Source = { title: string; url: string; checkedOn: string; license: string; licenseUrl?: string }
const operatorLicense = '未确认开放数据许可；仅人工摘录名称与少量地形事实并链接来源，不复制地图、图片或文案。商业发布许可待确认。'
const source = (title: string, url: string, license = operatorLicense, licenseUrl?: string): Source => ({ title, url, checkedOn: verifiedOn, license, licenseUrl })
export const sources: Record<string, Source> = {
  openskimap: { title: 'OpenSkiMap', url: 'https://openskimap.org/', checkedOn: '2026-11-26', license: '© OpenStreetMap contributors · ODbL', licenseUrl: 'https://www.openstreetmap.org/copyright' },
  openmeteoGeo: { title: 'Open-Meteo · 时区与 Copernicus GLO-90 海拔', url: 'https://open-meteo.com/en/docs/elevation-api', checkedOn: '2026-11-26', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  userInput: { title: '用户输入 · 保存在本机', url: 'https://snow.moderns.dev/', checkedOn: '2026-11-26', license: '用户自建地点，仅保存在本机。' },
  alta: source('Alta Ski Area · About / Mountain Stats', 'https://www.alta.com/about'),
  snowbird: source('Snowbird · 官方网站', 'https://www.snowbird.com/'),
  snowbirdStats: source('Ski Utah · Snowbird 地形资料', 'https://www.skiutah.com/members/snowbird'),
  niseko: source('Niseko United · About（四个雪场）', 'https://www.niseko.ne.jp/en/niseko/'),
  chamonix: source('Mont-Blanc Natural Resort · Grands Montets / Argentière', 'https://api.montblancnaturalresort.com/en/'),
  killington: source('Killington · Mountain Stats', 'https://killington.com/mountain-stats'),
  stowe: source('Stowe · Mountain Information', 'https://www.stowe.com/the-mountain/about-the-mountain/mountain-info.aspx'),
  altaMap: source('Alta · Collins 转角站', 'https://www.alta.com/food-and-drink/watson-cafe'),
  snowbirdMap: source('Snowbird · 冬季雪道图', 'https://www.snowbird.com/the-mountain/maps/winter-trail-map/'),
  hirafuMap: source('Grand HIRAFU · 2026–27 官方雪道图', 'https://www.grand-hirafu.jp/datas/files/2026/10/07/983fbe900f181d7ff43696aacb99e3d429827cbc.pdf'),
  grandsMontetsMap: source('Compagnie du Mont-Blanc · Grands Montets 2026–27 雪道图', 'https://www.compagniedumontblanc.fr/Marketing/plans/hiver/Plan_Hiver_AGM.pdf'),
  killingtonMap: source('Killington · 官方雪道图', 'https://map.killington.com/map/'),
  stoweMap: source('Stowe · 官方雪道图', 'https://www.stowe.com/the-mountain/about-the-mountain/trail-maps.aspx'),
  stations: source('USDA NRCS · AWDB 测站元数据（海拔单位 feet）', 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?stationTriplets=766:UT:SNTL,1308:UT:SNTL', 'USDA 公共信息政策：多数信息属公有领域，署名 U.S. Department of Agriculture；第三方材料可能例外。本目录只取 NRCS 自有测站数值。', 'https://www.usda.gov/about-usda/policies-and-links'),
  atwater: source('USDA NRCS · Atwater 1308 站点说明', 'https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=1308', 'U.S. Department of Agriculture；测站数据为临时数据，可修订。', 'https://www.usda.gov/about-usda/policies-and-links'),
  snowbirdStation: source('USDA NRCS · Snowbird 766 站点说明', 'https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=766', 'U.S. Department of Agriculture；测站数据为临时数据，可修订。', 'https://www.usda.gov/about-usda/policies-and-links'),
  waterbury: source('CoCoRaHS · Waterbury 3.0 NW 测站元数据', 'https://dex.cocorahs.org/stations/VT-WS-19', 'CoCoRaHS · CC BY 3.0', 'https://www.cocorahs.org/content.aspx?page=datausagepolicy'),
  timezone: source('IANA tzdb · 国家与时区标识', 'https://data.iana.org/time-zones/tzdb/zone1970.tab', 'Public domain', 'https://data.iana.org/time-zones/tzdb/LICENSE'),
  timezoneUS: source('IANA tzdb · 北美时区规则', 'https://data.iana.org/time-zones/tzdb/northamerica', 'Public domain', 'https://data.iana.org/time-zones/tzdb/LICENSE'),
}
export type Evidence<T> = { value: T | null; status: 'verified' | 'pending' | 'mapped'; sources: string[]; note?: string }
export type Coordinates = { lat: number; lon: number }
export type QueryPoint = { id: string; kind: 'base' | 'mid' | 'top' | 'reference' | 'site' | 'custom'; name: string; areaId: string | null; coordinates: Evidence<Coordinates>; elevation: Evidence<number>; note: string }
export type Resort = { id: string; name: string; aliases: string[]; website?: string; custom?: true; country: 'US' | 'CA' | 'MX' | 'JP' | 'FR' | ''; region: string; identitySources: string[]; areas: { id: string; name: string }[]; areaNote: string; coordinates: Evidence<Coordinates>; timezone: string; timezoneSources: string[]; points: QueryPoint[]; terrain: string; updatedOn: string }
export const mapped = <T,>(value: T, ...sources: string[]): Evidence<T> => ({ value, status: 'mapped', sources })
const verified = <T,>(value: T, ...refs: string[]): Evidence<T> => ({ value, status: 'verified', sources: refs })
const pending = <T,>(refs: string[], note: string): Evidence<T> => ({ value: null, status: 'pending', sources: refs, note })
const feet = (n: number) => Math.round(n * 0.3048 * 10) / 10
const demSources = {
  usgs: {
    title: 'USGS · 3DEP EPQS',
    url: ({ lat, lon }: Coordinates) => `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&units=Meters&wkid=4326`,
    method: 'USGS EPQS 插值，返回栅格间距 1 m，服务总体垂直 RMSE 0.53 m',
    license: 'U.S. Geological Survey · 3DEP 公有领域',
    licenseUrl: 'https://www.usgs.gov/faqs/are-usgs-data-copyrighted',
  },
  copernicus: {
    title: 'Copernicus WorldDEM-30 · GLO-30 Public',
    url: () => 'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N42_00_E140_00_DEM/Copernicus_DSM_COG_10_N42_00_E140_00_DEM.tif',
    method: 'Copernicus GLO-30 地表模型，取坐标所在 1 角秒栅格',
    license: 'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
    licenseUrl: 'https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf',
  },
  ign: {
    title: 'IGN · RGE ALTI',
    url: ({ lat, lon }: Coordinates) => `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=${lon}&lat=${lat}&resource=ign_rge_alti_wld&measures=true`,
    method: 'IGN RGE ALTI 地形模型点查询，垂直精度随原始资料变化，API 未给出逐点数值',
    license: 'IGN · RGE ALTI · Licence Ouverte 2.0',
    licenseUrl: 'https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_RGE-ALTI',
  },
}
const elevationBands = { base: '山脚', mid: '山腰', top: '山顶' }
function point(id: string, kind: keyof typeof elevationBands, name: string, areaId: string, mapRef: string, coordinates: Coordinates, node: number, rawElevation: number, dem: keyof typeof demSources): QueryPoint {
  const mapId = `osm-${node}`
  sources[mapId] = source(`OpenStreetMap · 节点 ${node}`, `https://www.openstreetmap.org/node/${node}`, '© OpenStreetMap contributors · ODbL', 'https://www.openstreetmap.org/copyright')
  const demId = `${id}-dem`
  const { title, url, method, license, licenseUrl } = demSources[dem]
  sources[demId] = source(title, url(coordinates), license, licenseUrl)
  return {
    id, kind, name: `${elevationBands[kind]} · ${name}`, areaId,
    coordinates: verified(coordinates, mapRef, mapId),
    elevation: verified(Math.round(rawElevation), demId),
    note: `代表性缆车站点，位置取自 OpenStreetMap，站点语义由运营方资料核对。海拔按同坐标采样，${method}，原值 ${rawElevation} m，取整米请求。地图定位误差与坡度会影响实际高程，逐点精度未现场测定。`,
  }
}
const station = (id: string, name: string, lat: number, lon: number, ft: number, ref: string): QueryPoint => ({ id, kind: 'reference', name, areaId: null, coordinates: verified({ lat, lon }, 'stations', ref), elevation: verified(feet(ft), 'stations', ref), note: `附近测站参考点，非雪场山脚/山腰/山顶，也非全山代表点。NRCS 海拔 ${ft} ft × 0.3048 换算为米；此查询点用于模型预报；测站观测在雪况区展示。` })
export const waterburyPoint: QueryPoint = {
  id: 'stowe-waterbury-vt-ws-19', kind: 'reference', name: '附近参考 · Waterbury 3.0 NW',
  areaId: null, coordinates: verified({ lat: 44.3606, lon: -72.8077 }, 'waterbury'),
  elevation: verified(feet(458), 'waterbury'),
  note: 'CoCoRaHS VT-WS-19 测站同址预报。海拔按测站公布的 458 ft 换算。该测站位于 Waterbury，仅用于本站点的准确性验证。',
}
const locationPending = (ref: string) => pending<Coordinates>([ref], '所查官方页面未明确提供雪场目录定位点经纬度；原型手工坐标已停用。')
export const chineseAliases: Record<string, string[]> = {
  'us-co-vail': ['韦尔', '范尔'],
  'ca-bc-whistler-blackcomb': ['惠斯勒'],
  'us-ut-park-city-mountain-resort': ['帕克城'],
  'us-co-aspen-mountain': ['阿斯本'],
  'us-co-aspen-highlands': ['阿斯本高地'],
  'us-co-aspen-snowmass': ['阿斯本雪堆山'],
  'us-wy-jackson-hole-mountain-resort': ['杰克逊霍尔'],
  'us-ca-mammoth-mountain': ['猛犸山'],
  'us-ca-palisades-tahoe-alpine-meadows': ['太浩'],
  'us-ca-palisades-tahoe-olympic-valley': ['太浩'],
  'ca-ab-lake-louise-ski-area': ['露易丝湖'],
  'ca-ab-banff-sunshine-village': ['班夫'],
  'us-mt-big-sky-resort': ['大天空'],
  'us-co-breckenridge-ski-resort': ['布雷肯里奇'],
  'ca-qc-mont-tremblant-resort-station-mont-tremblant': ['蒙特朗布朗'],
  'us-ut-deer-valley-resort': ['鹿谷'],
  'us-co-steamboat-ski-resort': ['汽船泉'],
  'us-co-telluride-ski-area': ['特柳赖德'],
  'ca-bc-revelstoke-mountain-resort': ['雷夫尔斯托克'],
  'us-id-sun-valley-bald-mountain': ['太阳谷'],
  'us-id-sun-valley-dollar-mountain': ['太阳谷'],
  'ca-bc-big-white-ski-resort': ['大白山'],
}

function mappedResort([id, name, country, region, timezone, lat, lon, aliases, website, points]: NorthAmericaResort): Resort {
  return {
    id, name, country, region, timezone, aliases: [...aliases, ...(chineseAliases[id] ?? [])], website: website ?? undefined,
    identitySources: ['openskimap'], timezoneSources: ['openmeteoGeo'], coordinates: mapped({ lat, lon }, 'openskimap'),
    areas: [{ id, name }], areaNote: '目录范围按 OpenSkiMap 雪场条目自动提取，未经运营方逐项核对。',
    terrain: '', updatedOn: '2026-11-26',
    points: points.map(([kind, name, lat, lon, elevation]) => ({
      id: `${id}-${kind}`, kind, name, areaId: id, coordinates: mapped({ lat, lon }, 'openskimap'),
      elevation: mapped(elevation, kind === 'site' ? 'openmeteoGeo' : 'openskimap'),
      note: kind === 'site' ? '取雪场几何首个坐标，海拔由 Open-Meteo 的 Copernicus GLO-90 提供，未经运营方核对。' : '从地图标记为运营的缆车端点自动选取，海拔取自 OpenSkiMap 地形数据，未经运营方核对。',
    })),
  }
}
export const resorts: Resort[] = [
  { id: 'alta', country: 'US', name: 'Alta Ski Area', aliases: ['Alta', '阿尔塔'], region: 'Utah · 美国', identitySources: ['alta'], areas: [{ id: 'alta', name: 'Alta Ski Area' }], areaNote: '三档对应下方列明的缆车站点。', coordinates: locationPending('alta'), timezone: 'America/Denver', timezoneSources: ['timezone', 'timezoneUS'], terrain: '官方山脚 8,530 ft（2600 m，四舍五入），最高地形 11,068 ft（3374 m）；未将最高地形等同于缆车终点。', points: [point('alta-base', 'base', 'Collins 下站', 'alta', 'altaMap', { lat: 40.5879626, lon: -111.637994 }, 12086601660, 2603.462, 'usgs'), point('alta-mid', 'mid', 'Collins 转角站', 'alta', 'altaMap', { lat: 40.5808891, lon: -111.6379664 }, 12086601645, 2833.865, 'usgs'), point('alta-top', 'top', 'Collins 上站', 'alta', 'altaMap', { lat: 40.5725404, lon: -111.6317476 }, 12086601656, 3161.107, 'usgs'), station('alta-atwater-1308', '附近参考 · Atwater SNOTEL 1308', 40.59124, -111.63775, 8750, 'atwater')], updatedOn: verifiedOn },
  { id: 'snowbird', country: 'US', name: 'Snowbird', aliases: ['雪鸟'], region: 'Utah · 美国', identitySources: ['snowbird', 'snowbirdStats'], areas: [{ id: 'snowbird', name: 'Snowbird' }], areaNote: '三档对应下方列明的缆车站点。', coordinates: locationPending('snowbird'), timezone: 'America/Denver', timezoneSources: ['timezone', 'timezoneUS'], terrain: 'Ski Utah 公布山脚 7,760 ft，最高点 11,000 ft；预报点使用缆车站地面高程。', points: [point('snowbird-base', 'base', 'Aerial Tram 下站', 'snowbird', 'snowbirdMap', { lat: 40.5810051, lon: -111.656343 }, 83516850, 2466.737, 'usgs'), point('snowbird-mid', 'mid', 'Mid-Gad 上站', 'snowbird', 'snowbirdMap', { lat: 40.5689114, lon: -111.657787 }, 1510026535, 2806.112, 'usgs'), point('snowbird-top', 'top', 'Hidden Peak · Aerial Tram 上站', 'snowbird', 'snowbirdMap', { lat: 40.5610538, lon: -111.6452194 }, 12099818211, 3342.28, 'usgs'), station('snowbird-snotel-766', '附近参考 · Snowbird SNOTEL 766', 40.56914, -111.65852, 9170, 'snowbirdStation')], updatedOn: verifiedOn },
  { id: 'niseko', country: 'JP', name: 'Niseko United', aliases: ['二世古', 'ニセコ', 'Niseko'], region: 'Hokkaido · 日本', identitySources: ['niseko'], areas: [{ id: 'niseko-annupuri', name: 'Niseko Annupuri' }, { id: 'niseko-village', name: 'Niseko Village' }, { id: 'niseko-grand-hirafu', name: 'Niseko Tokyu Grand HIRAFU' }, { id: 'niseko-hanazono', name: 'Niseko HANAZONO Resort' }], areaNote: '联合雪场目录项，包含四个独立雪场。当前三档预报覆盖 Grand HIRAFU。', coordinates: locationPending('niseko'), timezone: 'Asia/Tokyo', timezoneSources: ['timezone'], terrain: '官方标注 Niseko Annupuri 自然山峰 1,308 m；不等同于四个雪场共同的最高滑雪或预报点。', points: [point('niseko-base', 'base', 'Grand HIRAFU · King Gondola 下站', 'niseko-grand-hirafu', 'hirafuMap', { lat: 42.8645324, lon: 140.7015287 }, 2051054113, 307.00894, 'copernicus'), point('niseko-mid', 'mid', 'Grand HIRAFU · King Gondola 上站', 'niseko-grand-hirafu', 'hirafuMap', { lat: 42.8715587, lon: 140.6817033 }, 2051054582, 758.50696, 'copernicus'), point('niseko-top', 'top', 'Grand HIRAFU · King Lift #4 上站', 'niseko-grand-hirafu', 'hirafuMap', { lat: 42.8716679, lon: 140.6624561 }, 242920762, 1176.9346, 'copernicus')], updatedOn: verifiedOn },
  { id: 'chamonix', country: 'FR', name: 'Les Grands Montets', aliases: ['Grands Montets', 'Chamonix', 'Argentière', 'Argentiere', '夏蒙尼'], region: 'Argentière · Chamonix · 法国', identitySources: ['chamonix'], areas: [{ id: 'grands-montets', name: 'Les Grands Montets · Argentière' }], areaNote: '仅指 Argentière 的 Grands Montets；不代表 Chamonix 全谷、Brévent 或 Flégère。保留原型 ID chamonix 以维持已有收藏。', coordinates: locationPending('chamonix'), timezone: 'Europe/Paris', timezoneSources: ['timezone'], terrain: '运营方雪道图标注 Bochard 2,765 m。三档预报以 Plan Joran 和 Bochard 站点的地面高程为准，缆车开放状态请查看运营方。', points: [point('grands-montets-base', 'base', 'Argentière · Plan Joran 下站', 'grands-montets', 'grandsMontetsMap', { lat: 45.9790112, lon: 6.9282173 }, 251790174, 1242.72, 'ign'), point('grands-montets-mid', 'mid', 'Lognan · Bochard 下站', 'grands-montets', 'grandsMontetsMap', { lat: 45.967907, lon: 6.9429426 }, 9503268066, 1964.14, 'ign'), point('grands-montets-top', 'top', 'Bochard 上站', 'grands-montets', 'grandsMontetsMap', { lat: 45.9480472, lon: 6.9450535 }, 9503268068, 2767.6, 'ign')], updatedOn: verifiedOn },
  { id: 'killington', country: 'US', name: 'Killington Resort', aliases: ['Killington', '基灵顿'], region: 'Vermont · 美国', identitySources: ['killington'], areas: [{ id: 'killington-peak', name: 'Killington Peak' }, { id: 'skye-peak', name: 'Skye Peak' }, { id: 'ramshead', name: 'Ramshead' }, { id: 'snowdon', name: 'Snowdon' }, { id: 'bear-mountain', name: 'Bear Mountain' }, { id: 'sunrise', name: 'Sunrise Mountain' }], areaNote: '与 Pico Mountain 分开；官方统计页含两者，当前目录仅包含 Killington 的六个山地区域。', coordinates: locationPending('killington'), timezone: 'America/New_York', timezoneSources: ['timezone', 'timezoneUS'], terrain: '官方 Skyeship 山脚 1,165 ft，Killington Peak 自然山顶 4,241 ft；自然山顶不是缆车终点。', points: [point('killington-base', 'base', 'Skyeship 下站', 'skye-peak', 'killingtonMap', { lat: 43.614555, lon: -72.7568023 }, 371194239, 355.946, 'usgs'), point('killington-mid', 'mid', 'Skyeship 中站', 'skye-peak', 'killingtonMap', { lat: 43.6152535, lon: -72.7860859 }, 371194240, 714.749, 'usgs'), point('killington-top', 'top', 'Killington Peak · K-1 上站', 'killington-peak', 'killingtonMap', { lat: 43.6047395, lon: -72.8186865 }, 371196658, 1261.561, 'usgs')], updatedOn: verifiedOn },
  { id: 'stowe', country: 'US', name: 'Stowe Mountain Resort', aliases: ['Stowe', '斯托'], region: 'Vermont · 美国', identitySources: ['stowe'], areas: [{ id: 'stowe-mansfield', name: 'Mount Mansfield' }, { id: 'stowe-spruce', name: 'Spruce Peak' }], areaNote: '两座山分开记录。当前三档预报覆盖 Mount Mansfield。', coordinates: locationPending('stowe'), timezone: 'America/New_York', timezoneSources: ['timezone', 'timezoneUS'], terrain: '官方自然山顶 1,340 m（4,395 ft），最高滑雪高度 1,105 m（3,625 ft）。Gondola 上站的预报值取自该地图坐标的地面高程。', points: [point('stowe-base', 'base', 'Mount Mansfield · Toll House 下站', 'stowe-mansfield', 'stoweMap', { lat: 44.5107423, lon: -72.7673803 }, 204614511, 399.805, 'usgs'), point('stowe-mid', 'mid', 'Mount Mansfield · Toll House 上站', 'stowe-mansfield', 'stoweMap', { lat: 44.5190458, lon: -72.7888755 }, 592472361, 672.531, 'usgs'), point('stowe-top', 'top', 'Mount Mansfield · Gondola 上站', 'stowe-mansfield', 'stoweMap', { lat: 44.5376287, lon: -72.8142127 }, 204614449, 1115.723, 'usgs'), waterburyPoint], updatedOn: verifiedOn },
  ...northAmerica.map(mappedResort),
]
const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
const searchIndex = new WeakMap<Resort, { name: string; text: string }>()
export function searchResorts(query: string, list = resorts) {
  const terms = normalize(query).trim().split(/\s+/)
  if (!terms[0]) return list.slice()
  const phrase = terms.join(' ')
  const primary: Resort[] = [], others: Resort[] = []
  for (const r of list) {
    let entry = searchIndex.get(r)
    if (!entry) {
      entry = { name: normalize(r.name), text: normalize([r.id, r.name, r.country, r.region, ...r.aliases, ...r.areas.map(a => a.name)].join(' ')) }
      searchIndex.set(r, entry)
    }
    if (terms.every(term => entry.text.includes(term))) (entry.name.startsWith(phrase) ? primary : others).push(r)
  }
  return primary.concat(others)
}
export function queryBlockReason(resort: Resort, query: QueryPoint | undefined) {
  if (!query || !resort.points.includes(query)) return '查询点不存在，请重新选择。'
  if (query.coordinates.status === 'pending' || query.coordinates.value === null) return '查询点坐标待核实，暂不请求预报或生成雪报。'
  if (query.elevation.status === 'pending' || query.elevation.value === null) return '查询点海拔待核实，暂不请求预报或生成雪报。'
  return null
}
export const elevationLabel = (point: QueryPoint) => point.elevation.value === null ? '海拔待核实' : `${point.elevation.value.toLocaleString('zh-CN')} m${point.elevation.status === 'pending' ? '（待核实）' : ''}`
