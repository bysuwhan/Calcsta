use std::net::SocketAddr;

pub struct Config {
    pub addr: SocketAddr,
    pub allowed_origins: Vec<String>,
    pub log_format: LogFormat,
}

pub enum LogFormat {
    Pretty,
    Json,
}

impl Config {
    pub fn from_env() -> Self {
        let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
        let port: u16 = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3001);
        let addr: SocketAddr = format!("{host}:{port}").parse().expect("valid address");

        let allowed_origins = std::env::var("ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "https://calcsta.pages.dev".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();

        let log_format = match std::env::var("LOG_FORMAT").as_deref() {
            Ok("json") => LogFormat::Json,
            _ => LogFormat::Pretty,
        };

        Self { addr, allowed_origins, log_format }
    }
}
