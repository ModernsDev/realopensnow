use serde_json::Value;
use std::{fs, path::Path};

pub fn fixture(path: &str) -> Value {
    fn expand(value: &mut Value, columns: &[Value]) {
        match value {
            Value::Object(object) => {
                if let Some(index) = object.get("$column") {
                    *value = columns[index.as_u64().unwrap() as usize].clone();
                } else {
                    for field in object.values_mut() {
                        expand(field, columns);
                    }
                }
            }
            Value::Array(array) => {
                for element in array {
                    expand(element, columns);
                }
            }
            _ => {}
        }
    }
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(path);
    let mut data: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    if let Some(columns) = data
        .as_object_mut()
        .and_then(|m| m.shift_remove("$columns"))
    {
        expand(&mut data, columns.as_array().unwrap());
    }
    data
}

pub fn assert_json(actual: &Value, expected: &Value) {
    fn compare(path: &str, actual: &Value, expected: &Value) {
        match (actual, expected) {
            (Value::Number(a), Value::Number(b)) => {
                if let (Some(a), Some(b)) = (a.as_i64(), b.as_i64()) {
                    assert_eq!(a, b, "{path}");
                } else {
                    assert!(
                        (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() <= 1e-9,
                        "{path}: {a} != {b}"
                    );
                }
            }
            (Value::Object(a), Value::Object(b)) => {
                assert_eq!(
                    a.len(),
                    b.len(),
                    "{path}: keys {:?} vs {:?}",
                    a.keys(),
                    b.keys()
                );
                for (key, value) in b {
                    compare(
                        &format!("{path}.{key}"),
                        a.get(key)
                            .unwrap_or_else(|| panic!("{path}: missing {key}")),
                        value,
                    );
                }
            }
            (Value::Array(a), Value::Array(b)) => {
                assert_eq!(a.len(), b.len(), "{path}");
                for (i, (x, y)) in a.iter().zip(b).enumerate() {
                    compare(&format!("{path}[{i}]"), x, y);
                }
            }
            _ => assert_eq!(actual, expected, "{path}"),
        }
    }
    compare("$", actual, expected);
}
