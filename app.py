import os
os.environ['HF_HUB_OFFLINE'] = '1'
 
from flask import Flask
from flask_cors import CORS
import config
 
from routes.results_bp import results_status_bp
from routes.upload import upload_bp
 
from routes.process import process_bp
from routes.status_routes import status_bp
from routes.dhrp_routes import dhrp_bp
from routes.delete_routes import delete_bp
from routes.csv_routes import csv_bp
from routes.comment_routes import comment_bp
from routes.download_routes import download_bp
from routes.company_routes import company_bp
 
from routes.upload_csv_routes import upload_csv_bp
from routes.review_route import review_bp
from routes.toc_routes import toc_bp
from routes.toc_questions_routes import toc_questions_bp
from routes.csv_mapper_routes import mapper_bp
from routes.document_type_routes import document_type_bp
 
from models import db
 
 
class _StripPublicApiPrefix:
    """Normalize PATH_INFO when nginx forwards the full public path instead of stripping it."""
 
    def __init__(self, app, prefix: str):
        self.app = app
        self.prefix = (prefix or "").rstrip("/")
 
    def __call__(self, environ, start_response):
        if not self.prefix:
            return self.app(environ, start_response)
        path = environ.get("PATH_INFO", "")
        p = self.prefix
        if path == p or path.startswith(p + "/"):
            new_path = path[len(p):] or "/"
            new_environ = environ.copy()
            new_environ["PATH_INFO"] = new_path
            return self.app(new_environ, start_response)
        return self.app(environ, start_response)
 
 
def create_app():
    app = Flask(__name__)
    app.config.from_object(config)
    CORS(app, resources={r"/*": {"origins": [
        "http://localhost:4200",
        "*"
    ]}}, supports_credentials=True)
 
    db.init_app(app)
 
    # register blueprints
    app.register_blueprint(upload_bp)
    app.register_blueprint(process_bp)
    app.register_blueprint(status_bp)
    app.register_blueprint(dhrp_bp)
    app.register_blueprint(delete_bp)
    app.register_blueprint(csv_bp)
    app.register_blueprint(comment_bp)
    app.register_blueprint(download_bp)
    app.register_blueprint(company_bp)
    app.register_blueprint(upload_csv_bp)
    app.register_blueprint(results_status_bp)
    app.register_blueprint(review_bp)
    app.register_blueprint(toc_bp)
    app.register_blueprint(toc_questions_bp)
    app.register_blueprint(mapper_bp)
    app.register_blueprint(document_type_bp)
 
   
    def init_database():
        """Create tables and seed any required initial data."""
        # this function may be called once at startup or via the CLI
        with app.app_context():
            # log the path so we know which file is being used
            app.logger.info(f"Using database URI: {app.config.get('SQLALCHEMY_DATABASE_URI')}")
            db.create_all()
 
            # seed default document types if none exist
            from models.dhrp_entry import DocumentType
            # if DocumentType.query.count() == 0:
            #     default_names = ["DRHP"]  # adjust or load from file as needed
            #     for name in default_names:
            #         app.logger.info(f"Seeding document type: {name}")
            #         db.session.add(DocumentType(name=name))
            #     db.session.commit()
 
    # initialise database on every startup; running the app twice is idempotent
    init_database()
 
    # add CLI helpers for manual control
    import click
    @app.cli.command("init-db")
    def init_db_command():
        """Create database and apply any seeding."""
        init_database()
        click.echo("Database initialized.")
 
    @app.cli.command("reset-db")
    def reset_db_command():
        """Delete sqlite files so the next run starts fresh."""
        db_path = app.config.get("SQLALCHEMY_DATABASE_URI").replace("sqlite:///", "")
        for suffix in ["", "-wal", "-shm"]:
            try:
                os.remove(db_path + suffix)
                click.echo(f"Removed {db_path + suffix}")
            except FileNotFoundError:
                pass
            except Exception as exc:
                click.echo(f"Failed to remove {db_path + suffix}: {exc}")
        click.echo("Database files deleted; run 'flask init-db' to recreate.")
 
    prefix = getattr(config, "API_PUBLIC_PATH_PREFIX", "")
    if prefix:
        app.wsgi_app = _StripPublicApiPrefix(app.wsgi_app, prefix)
 
    return app
 
 
if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, port=8020)
 

rewrite ^/InfoDocs-AI/api/?(.*)$ /$1 break;
 