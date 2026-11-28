use crate::aggregate::number_string;
use crate::catalog::{Point, Resort};
use serde_json::{Value, json};

pub const MODELS: [&str; 12] = [
    "ecmwf_ifs025",
    "gfs_seamless",
    "icon_seamless",
    "ecmwf_aifs025_single",
    "ncep_aigfs025",
    "ncep_nbm_conus",
    "gfs_hrrr",
    "gem_global",
    "gem_regional",
    "gem_hrdps_continental",
    "icon_eu",
    "icon_d2",
];

pub const VARIABLES: [&str; 5] = [
    "snowfall",
    "temperature_2m",
    "wind_gusts_10m",
    "rain",
    "freezing_level_height",
];

pub fn model_members(model: &str) -> &'static [&'static str] {
    match model {
        "ecmwf_ifs025" => &["ecmwf_ifs025"],
        "gfs_seamless" => &["ncep_gfs025", "ncep_hrrr_conus"],
        "icon_seamless" => &["dwd_icon", "dwd_icon_eu", "dwd_icon_d2"],
        "ecmwf_aifs025_single" => &["ecmwf_aifs025_single"],
        "ncep_aigfs025" => &["ncep_aigfs025"],
        "ncep_nbm_conus" => &["ncep_nbm_conus"],
        "gfs_hrrr" => &["ncep_hrrr_conus"],
        "gem_global" => &["cmc_gem_gdps_15km"],
        "gem_regional" => &["cmc_gem_rdps_10km"],
        "gem_hrdps_continental" => &["cmc_gem_hrdps"],
        "icon_eu" => &["dwd_icon_eu"],
        "icon_d2" => &["dwd_icon_d2"],
        _ => panic!("unknown model {model}"),
    }
}

pub fn point_config(resort: &Resort, point: &Point) -> String {
    let members: serde_json::Map<_, _> = MODELS
        .iter()
        .map(|id| (id.to_string(), json!(model_members(id))))
        .collect();
    format!(
        r#"[{{"lat":{},"lon":{}}},{},{},{}]"#,
        number_string(point.lat),
        number_string(point.lon),
        number_string(point.elevation),
        json!(resort.timezone),
        json!(members)
    )
}

pub fn snapshot_units() -> Value {
    json!({
        "snowfall_sum": "cm", "temperature_2m_min": "°C", "temperature_2m_max": "°C",
        "wind_gusts_10m_max": "km/h", "rain_sum": "mm", "wet_snowfall_sum": "cm",
        "freezing_level_height_min": "m", "freezing_level_height_max": "m"
    })
}
