//! XML / XPath / multipart matchers — native port of schemaMatchers.ts + xpathMatcher.ts.

use regex::Regex;
use serde_json::Value;
use sxd_document::parser;
use sxd_xpath::{Context, Factory, Value as XValue};

pub fn match_xpath_exists(body: Option<&str>, expected: Option<&Value>) -> bool {
    let expr = xpath_expr(expected);
    evaluate_xpath(body.unwrap_or(""), &expr).matched
}

pub fn match_xpath_equals(body: Option<&str>, expected: Option<&Value>, match_style: Option<&str>) -> bool {
    let Some(Value::Array(items)) = expected else { return false };
    let expr = items.first().map(xpath_atom).unwrap_or_default();
    let wanted = items.get(1).map(xpath_atom).unwrap_or_default();
    let res = evaluate_xpath(body.unwrap_or(""), &expr);
    if !res.ok || !res.matched {
        return false;
    }
    if match_style == Some("subset") && !wanted.is_empty() {
        res.values.iter().any(|v| v.contains(&wanted))
    } else {
        res.values.iter().any(|v| v == &wanted)
    }
}

pub fn match_xml_schema(body: Option<&str>, expected: Option<&Value>) -> bool {
    let Some(raw) = body.map(str::trim).filter(|s| !s.is_empty()) else { return false };
    let probe = evaluate_xpath(raw, "/*");
    if !probe.ok {
        return false;
    }
    let names = required_xml_names(expected);
    if names.is_empty() {
        return probe.matched;
    }
    names.iter().all(|name| {
        let Some(local) = xml_safe_local_name(name) else { return false };
        evaluate_xpath(raw, &format!("//*[local-name()='{local}']")).matched
    })
}

pub fn match_multipart_field(body: Option<&str>, expected: Option<&Value>, content_type: Option<&str>) -> bool {
    let Some(raw) = body else { return false };
    let Some(spec) = field_spec(expected) else { return false };
    let part = parse_multipart(raw, content_type).into_iter().find(|p| p.name == spec.name);
    let Some(part) = part else { return false };
    match spec.value {
        None => true,
        Some(want) => part.value == want,
    }
}

pub fn match_multipart_file(body: Option<&str>, expected: Option<&Value>, content_type: Option<&str>) -> bool {
    let Some(raw) = body else { return false };
    let Some(spec) = field_spec(expected) else { return false };
    let part = parse_multipart(raw, content_type)
        .into_iter()
        .find(|p| p.name == spec.name && p.filename.is_some());
    let Some(part) = part else { return false };
    match spec.value {
        None => true,
        Some(want) => part.filename.as_deref() == Some(want.as_str()),
    }
}

struct XPathResult {
    ok: bool,
    values: Vec<String>,
    matched: bool,
}

fn evaluate_xpath(body: &str, expression: &str) -> XPathResult {
    if body.trim().is_empty() || expression.trim().is_empty() {
        return XPathResult { ok: false, values: vec![], matched: false };
    }
    let Ok(package) = parser::parse(body) else {
        return XPathResult { ok: false, values: vec![], matched: false };
    };
    let doc = package.as_document();
    let factory = Factory::new();
    let Ok(Some(xpath)) = factory.build(expression) else {
        return XPathResult { ok: false, values: vec![], matched: false };
    };
    let context = Context::new();
    match xpath.evaluate(&context, doc.root()) {
        Ok(XValue::Boolean(b)) => XPathResult { ok: true, values: vec![b.to_string()], matched: b },
        Ok(XValue::Number(n)) => {
            let s = format_xpath_number(n);
            let matched = !s.is_empty();
            XPathResult { ok: true, values: vec![s], matched }
        }
        Ok(XValue::String(s)) => {
            let matched = !s.is_empty();
            XPathResult { ok: true, values: vec![s], matched }
        }
        Ok(XValue::Nodeset(set)) => {
            let values: Vec<String> = set.iter().map(|n| n.string_value()).collect();
            let matched = !values.is_empty();
            XPathResult { ok: true, values, matched }
        }
        Err(_) => XPathResult { ok: false, values: vec![], matched: false },
    }
}

fn format_xpath_number(n: f64) -> String {
    if n.fract() == 0.0 && n.is_finite() {
        format!("{n:.0}")
    } else {
        n.to_string()
    }
}

fn xpath_expr(expected: Option<&Value>) -> String {
    match expected {
        Some(Value::Array(items)) => items.first().map(xpath_atom).unwrap_or_default(),
        Some(other) => xpath_atom(other),
        None => String::new(),
    }
}

fn xpath_atom(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        other => other.to_string().trim_matches('"').to_string(),
    }
}

fn value_as_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string().trim_matches('"').to_string(),
    }
}

fn names_from_list(list: &Value) -> Option<Vec<String>> {
    match list {
        Value::Array(items) => {
            let names: Vec<String> = items.iter().map(value_as_string).filter(|s| !s.is_empty()).collect();
            if names.is_empty() { None } else { Some(names) }
        }
        Value::String(s) if !s.trim().is_empty() => Some(
            s.split(|c: char| c.is_whitespace() || c == ',')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect(),
        ),
        _ => None,
    }
}

fn names_from_object(rec: &serde_json::Map<String, Value>) -> Option<Vec<String>> {
    rec.get("required")
        .and_then(names_from_list)
        .or_else(|| rec.get("requiredElements").and_then(names_from_list))
        .or_else(|| rec.get("elements").and_then(names_from_list))
}

fn required_xml_names(expected: Option<&Value>) -> Vec<String> {
    let Some(expected) = expected else { return vec![] };
    match expected {
        Value::Array(items) => items.iter().map(value_as_string).filter(|s| !s.is_empty()).collect(),
        Value::Object(rec) => names_from_object(rec).unwrap_or_default(),
        Value::String(s) => names_from_string(s),
        _ => vec![],
    }
}

fn names_from_string(expected: &str) -> Vec<String> {
    let trimmed = expected.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
            return required_xml_names(Some(&parsed));
        }
    }
    if trimmed.contains('<') {
        let re = Regex::new(r#"<(?:xs:|xsd:)?element\b[^>]*\bname=["']([^"']+)["']"#).expect("element name regex");
        return re.captures_iter(trimmed).filter_map(|c| c.get(1).map(|m| m.as_str().to_string())).collect();
    }
    trimmed
        .split(|c: char| c.is_whitespace() || c == ',')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

fn xml_safe_local_name(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    let local = trimmed.rsplit_once(':').map(|(_, l)| l).unwrap_or(trimmed);
    let re = Regex::new(r"^[\p{L}_][\p{L}\p{N}._-]*$").ok()?;
    if re.is_match(local) {
        Some(local.to_string())
    } else {
        None
    }
}

struct MultipartPart {
    name: String,
    filename: Option<String>,
    value: String,
}

struct FieldSpec {
    name: String,
    value: Option<String>,
}

fn field_spec(expected: Option<&Value>) -> Option<FieldSpec> {
    match expected {
        Some(Value::String(s)) if !s.is_empty() => Some(FieldSpec { name: s.clone(), value: None }),
        Some(Value::Array(items)) if items.first().is_some() => {
            let name = value_as_string(&items[0]);
            if name.is_empty() {
                return None;
            }
            let value = items.get(1).and_then(|raw| {
                if raw.is_null() { return None; }
                let s = value_as_string(raw);
                if s.is_empty() { None } else { Some(s) }
            });
            Some(FieldSpec { name, value })
        }
        _ => None,
    }
}

fn parse_boundary<'a>(content_type: Option<&str>, body: &'a str) -> Option<String> {
    if let Some(ct) = content_type {
        let re = Regex::new(r#"(?i)boundary=(?:"([^"]+)"|([^;,\s]+))"#).ok()?;
        if let Some(c) = re.captures(ct) {
            let b = c.get(1).or_else(|| c.get(2)).map(|m| m.as_str().trim().to_string());
            if b.as_ref().is_some_and(|s| !s.is_empty()) {
                return b;
            }
        }
    }
    let re = Regex::new(r"^--([^\r\n]+)").ok()?;
    re.captures(body).and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

fn disposition_param(disp: &str, key: &str) -> Option<String> {
    let double = Regex::new(&format!(r#"(?i)\b{key}="([^"]*)""#)).ok()?;
    if let Some(c) = double.captures(disp) {
        return c.get(1).map(|m| m.as_str().to_string());
    }
    let single = Regex::new(&format!(r"(?i)\b{key}='([^']*)'")).ok()?;
    if let Some(c) = single.captures(disp) {
        return c.get(1).map(|m| m.as_str().to_string());
    }
    let bare = Regex::new(&format!(r"(?i)\b{key}=([^;\s]+)")).ok()?;
    bare.captures(disp).and_then(|c| {
        c.get(1).map(|m| m.as_str().trim_matches(|ch| ch == '\'' || ch == '"').to_string())
    })
}

fn parse_multipart(body: &str, content_type: Option<&str>) -> Vec<MultipartPart> {
    let Some(boundary) = parse_boundary(content_type, body) else { return vec![] };
    if !body.contains(&boundary) {
        return vec![];
    }
    let marker = format!("--{boundary}");
    let mut parts = Vec::new();
    for raw in body.split(&marker).skip(1) {
        let trimmed = raw.trim();
        if trimmed == "--" || trimmed.is_empty() {
            continue;
        }
        let stripped = strip_one_leading_newline(raw);
        let split: Vec<&str> = stripped.splitn(2, "\r\n\r\n").collect();
        let (headers, rest) = if split.len() == 2 {
            (split[0], split[1])
        } else {
            let alt: Vec<&str> = stripped.splitn(2, "\n\n").collect();
            if alt.len() != 2 {
                continue;
            }
            (alt[0], alt[1])
        };
        let value = strip_one_trailing_newline(rest).to_string();
        let disp = Regex::new(r"(?i)content-disposition:\s*form-data;([^\r\n]*)")
            .ok()
            .and_then(|re| re.captures(headers))
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
            .unwrap_or_default();
        let Some(name) = disposition_param(&disp, "name") else { continue };
        let filename = disposition_param(&disp, "filename");
        parts.push(MultipartPart { name, filename, value });
    }
    parts
}

fn strip_one_leading_newline(s: &str) -> &str {
    s.strip_prefix("\r\n").or_else(|| s.strip_prefix('\n')).unwrap_or(s)
}

fn strip_one_trailing_newline(s: &str) -> &str {
    s.strip_suffix("\r\n").or_else(|| s.strip_suffix('\n')).unwrap_or(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SOAP: &str = r#"<?xml version="1.0"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <ns3:ActivateAccountRequest xmlns:ns3="http://example.com/schema/Request.xsd">
      <ns3:VehicleDetails>
        <ns3:vehicleIdentificationNumber>1HGCM82633AFaultCode200</ns3:vehicleIdentificationNumber>
      </ns3:VehicleDetails>
    </ns3:ActivateAccountRequest>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>"#;

    const VIN: &str = "//*[local-name() = 'vehicleIdentificationNumber']/text()";

    #[test]
    fn xpath_exists_and_equals() {
        assert!(match_xpath_exists(Some(SOAP), Some(&json!(VIN))));
        assert!(!match_xpath_exists(Some(SOAP), Some(&json!("//*[local-name() = 'nope']"))));
        assert!(match_xpath_equals(Some(SOAP), Some(&json!([VIN, "1HGCM82633AFaultCode200"])), None));
        assert!(match_xpath_equals(
            Some(SOAP),
            Some(&json!([VIN, "FaultCode200"])),
            Some("subset")
        ));
        assert!(!match_xpath_equals(Some(SOAP), Some(&json!([VIN, ""])), Some("subset")));
        assert!(!match_xpath_equals(Some("not-xml"), Some(&json!([VIN, "x"])), None));
        assert!(!match_xpath_equals(Some(SOAP), Some(&json!([VIN, serde_json::Value::Null])), None));
        assert!(!match_xpath_exists(Some(SOAP), Some(&serde_json::Value::Null)));
        assert_eq!(evaluate_xpath("<root attr=\"v\"/>", "//@attr").values, vec!["v".to_string()]);
        assert!(evaluate_xpath(SOAP, &format!("contains({VIN}, 'FaultCode200')")).matched);
        assert!(!evaluate_xpath(SOAP, "1=2").matched);
        assert_eq!(evaluate_xpath("<root><item/></root>", "count(//missing)").values, vec!["0".to_string()]);
    }

    #[test]
    fn xml_schema_element_presence() {
        let xml = r#"<Order xmlns="urn:ex"><Id>1</Id></Order>"#;
        assert!(match_xml_schema(Some(xml), Some(&json!(""))));
        assert!(match_xml_schema(Some(xml), Some(&json!("Order, Id"))));
        assert!(match_xml_schema(Some(xml), Some(&json!(["Order", "Id"]))));
        assert!(match_xml_schema(Some(xml), Some(&json!({"required":["Order"]}))));
        assert!(!match_xml_schema(Some(xml), Some(&json!({"required":["Missing"]}))));
        assert!(match_xml_schema(Some(xml), Some(&json!("<xs:element name=\"Order\"/>"))));
        assert!(match_xml_schema(Some(r#"<a:Order xmlns:a="urn:ex"/>"#), Some(&json!("a:Order"))));
        assert!(!match_xml_schema(Some("not xml"), Some(&json!("Order"))));
        assert!(!match_xml_schema(None, Some(&json!("Order"))));
        assert!(match_xml_schema(Some(xml), Some(&json!(r#"["Order","Id"]"#))));
        assert!(match_xml_schema(Some(xml), Some(&json!(r#"{"required":["Order"]}"#))));
        assert!(match_xml_schema(Some(xml), Some(&json!({"type":"object"}))));
        assert!(match_xml_schema(Some(xml), Some(&json!({"required":[],"requiredElements":["Order"]}))));
        assert!(match_xml_schema(Some(xml), Some(&json!({"required":"Order"}))));
        assert!(!match_xml_schema(Some(xml), Some(&json!("[not-json"))));
        assert!(!match_xml_schema(Some(xml), Some(&json!("Order'"))));
    }

    #[test]
    fn multipart_field_and_file() {
        let body = [
            "------bound",
            r#"Content-Disposition: form-data; name="note""#,
            "",
            "hello",
            "------bound",
            r#"Content-Disposition: form-data; name="avatar"; filename="a.png""#,
            "Content-Type: image/png",
            "",
            "PNGDATA",
            "------bound--",
            "",
        ]
        .join("\r\n");
        let ct = Some("multipart/form-data; boundary=----bound");
        assert!(match_multipart_field(Some(&body), Some(&json!("note")), ct));
        assert!(match_multipart_field(Some(&body), Some(&json!(["note", "hello"])), ct));
        assert!(!match_multipart_field(Some(&body), Some(&json!(["note", "nope"])), ct));
        assert!(match_multipart_file(Some(&body), Some(&json!(["avatar", "a.png"])), ct));
        assert!(!match_multipart_file(Some(&body), Some(&json!("note")), ct));
        assert!(!match_multipart_field(Some("plain"), Some(&json!("note")), None));
        assert!(match_multipart_field(Some(&body), Some(&json!(["note"])), ct));
        assert!(match_multipart_field(Some(&body), Some(&json!(["note", ""])), ct));
        assert!(match_multipart_file(Some(&body), Some(&json!("avatar")), ct));
        let quoted = Some("multipart/form-data; boundary=\"----bound\"");
        assert!(match_multipart_field(Some(&body), Some(&json!("note")), quoted));
        let unquoted = [
            "--x",
            "Content-Disposition: form-data; name=note; filename=plain.txt",
            "",
            "hi",
            "--x--",
            "",
        ]
        .join("\r\n");
        assert!(match_multipart_file(
            Some(&unquoted),
            Some(&json!(["note", "plain.txt"])),
            Some("multipart/form-data; boundary=x")
        ));
    }
}
