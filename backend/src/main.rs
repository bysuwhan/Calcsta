mod config;
mod routes;

use axum::routing::get;
use axum::Router;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use config::{Config, LogFormat};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let config = Config::from_env();

    match config.log_format {
        LogFormat::Pretty => {
            tracing_subscriber::fmt()
                .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
                .init();
        }
        LogFormat::Json => {
            tracing_subscriber::fmt()
                .json()
                .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
                .init();
        }
    }

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(
            config
                .allowed_origins
                .iter()
                .filter_map(|origin| origin.parse().ok()),
        ))
        .allow_headers([axum::http::header::CONTENT_TYPE])
        .allow_methods([axum::http::Method::GET]);

    let app = Router::new()
        .route("/health", get(routes::health::health))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(config.addr).await.unwrap();
    tracing::info!("listening on {}", config.addr);
    axum::serve(listener, app).await.unwrap();
}
