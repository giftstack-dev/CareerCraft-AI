"""CareerCraft AI Flask application factory and entrypoint."""

from __future__ import annotations

import logging
from dotenv import load_dotenv
from flask import Flask, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from config import Config
from routes.account import account_bp
from routes.applications import applications_bp
from routes.auth import auth_bp
from routes.cv import cv_bp
from routes.dashboard import dashboard_bp
from routes.documents import documents_bp
from routes.interviews import interviews_bp
from routes.jobs import jobs_bp
from routes.profile import profile_bp
from routes.usage import usage_bp
from utils.errors import AppError, error_response
from utils.security import apply_security_headers

load_dotenv()


def create_app(config_override: Config | None = None) -> Flask:
    """Create and configure the CareerCraft AI Flask application."""
    cfg = config_override or Config()

    app = Flask(__name__)
    app.config["SECRET_KEY"] = cfg.SECRET_KEY
    app.config["MAX_CONTENT_LENGTH"] = cfg.max_content_length_bytes
    app.config["APP_CONFIG"] = cfg

    logging.basicConfig(
        level=logging.INFO if cfg.is_production else logging.DEBUG,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": cfg.ALLOWED_ORIGINS,
                "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                "allow_headers": ["Authorization", "Content-Type"],
                "supports_credentials": False,
            }
        },
    )

    # Register modular REST API Blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(account_bp)
    app.register_blueprint(profile_bp)
    app.register_blueprint(cv_bp)
    app.register_blueprint(jobs_bp)
    app.register_blueprint(documents_bp)
    app.register_blueprint(applications_bp)
    app.register_blueprint(interviews_bp)
    app.register_blueprint(usage_bp)

    @app.after_request
    def _add_security_headers(response):
        return apply_security_headers(response, is_production=cfg.is_production)

    @app.errorhandler(AppError)
    def _handle_app_error(err: AppError):
        return error_response(
            message=err.message,
            status_code=err.status_code,
            error_code=err.error_code,
            details=err.details,
        )

    @app.errorhandler(HTTPException)
    def _handle_http_error(err: HTTPException):
        return error_response(
            message=err.description or "Request could not be processed.",
            status_code=err.code or 400,
            error_code="http_error",
        )

    @app.errorhandler(Exception)
    def _handle_unexpected_error(err: Exception):  # noqa: BLE001
        app.logger.exception("Unhandled error on %s %s", request.method, request.path)
        return error_response(
            message="An unexpected error occurred. Please try again later.",
            status_code=500,
            error_code="internal_server_error",
        )

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=not app.config["APP_CONFIG"].is_production)
