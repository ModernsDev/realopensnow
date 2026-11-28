use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Debug, Deserialize)]
pub struct Catalog {
    pub digest: String,
    pub resorts: Vec<Resort>,
    pub waterbury: String,
    pub regions: Vec<[f64; 2]>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Resort {
    pub id: String,
    pub timezone: String,
    pub points: Vec<Point>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Point {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    pub elevation: f64,
}

impl Catalog {
    pub fn point(&self, id: &str) -> Option<(&Resort, &Point)> {
        self.resorts
            .iter()
            .find_map(|r| r.points.iter().find(|p| p.id == id).map(|p| (r, p)))
    }
}

pub fn catalog() -> &'static Catalog {
    static CATALOG: LazyLock<Catalog> = LazyLock::new(|| {
        serde_json::from_str(include_str!("../catalog.json"))
            .expect("invalid embedded resort catalog")
    });
    &CATALOG
}
