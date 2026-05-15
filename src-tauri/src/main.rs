use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

struct HttpTarget {
    host: String,
    port: u16,
    path: String,
}

#[tauri::command]
fn local_llm_chat(url: String, api_key: Option<String>, body: String) -> Result<String, String> {
    let target = parse_local_http_url(&url)?;
    let mut stream = TcpStream::connect((target.host.as_str(), target.port))
        .map_err(|err| format!("connect {}:{} failed: {}", target.host, target.port, err))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(90)))
        .map_err(|err| format!("set read timeout failed: {}", err))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(15)))
        .map_err(|err| format!("set write timeout failed: {}", err))?;

    let host_header = if target.port == 80 {
        target.host.clone()
    } else {
        format!("{}:{}", target.host, target.port)
    };
    let mut request = format!(
        "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        target.path,
        host_header,
        body.as_bytes().len()
    );
    if let Some(key) = api_key.as_deref().map(str::trim).filter(|key| !key.is_empty()) {
        if key.contains('\r') || key.contains('\n') {
            return Err("local LLM API key contains invalid newline".to_string());
        }
        request.push_str("Authorization: Bearer ");
        request.push_str(key);
        request.push_str("\r\n");
    }
    request.push_str("\r\n");

    stream
        .write_all(request.as_bytes())
        .and_then(|_| stream.write_all(body.as_bytes()))
        .map_err(|err| format!("write local LLM request failed: {}", err))?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|err| format!("read local LLM response failed: {}", err))?;

    parse_http_response(response)
}

fn parse_local_http_url(url: &str) -> Result<HttpTarget, String> {
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| "local LLM URL must start with http://".to_string())?;
    let slash = rest.find('/').unwrap_or(rest.len());
    let host_port = &rest[..slash];
    let path = if slash < rest.len() { &rest[slash..] } else { "/" };
    let (host, port) = if let Some((host, port)) = host_port.rsplit_once(':') {
        let parsed_port = port
            .parse::<u16>()
            .map_err(|_| format!("invalid local LLM port: {}", port))?;
        (host.to_string(), parsed_port)
    } else {
        (host_port.to_string(), 80)
    };
    if host != "127.0.0.1" && host != "localhost" {
        return Err("local LLM bridge only permits localhost URLs".to_string());
    }
    Ok(HttpTarget {
        host,
        port,
        path: path.to_string(),
    })
}

fn parse_http_response(response: Vec<u8>) -> Result<String, String> {
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "local LLM response missing HTTP headers".to_string())?;
    let header_text = String::from_utf8_lossy(&response[..split]);
    let status_line = header_text
        .lines()
        .next()
        .ok_or_else(|| "local LLM response missing status line".to_string())?;
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| format!("invalid local LLM status line: {}", status_line))?;
    let mut body = response[split + 4..].to_vec();
    if header_text.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        body = decode_chunked(&body)?;
    }
    let body_text = String::from_utf8_lossy(&body).to_string();
    if !(200..300).contains(&status) {
        return Err(format!("local LLM HTTP {}: {}", status, body_text));
    }
    Ok(body_text)
}

fn decode_chunked(input: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut cursor = 0usize;
    while cursor < input.len() {
        let line_end = find_crlf(&input[cursor..])
            .map(|offset| cursor + offset)
            .ok_or_else(|| "invalid chunked response: missing chunk size".to_string())?;
        let line = std::str::from_utf8(&input[cursor..line_end])
            .map_err(|err| format!("invalid chunk size encoding: {}", err))?;
        let size_text = line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_text, 16)
            .map_err(|_| format!("invalid chunk size: {}", size_text))?;
        cursor = line_end + 2;
        if size == 0 {
            break;
        }
        if cursor + size > input.len() {
            return Err("invalid chunked response: chunk exceeds body length".to_string());
        }
        out.extend_from_slice(&input[cursor..cursor + size]);
        cursor += size;
        if input.get(cursor..cursor + 2) == Some(b"\r\n") {
            cursor += 2;
        }
    }
    Ok(out)
}

fn find_crlf(input: &[u8]) -> Option<usize> {
    input.windows(2).position(|window| window == b"\r\n")
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![local_llm_chat])
        .run(tauri::generate_context!())
        .expect("failed to run Ruby High native shell");
}
