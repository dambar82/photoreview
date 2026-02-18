import os
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from PIL import Image, UnidentifiedImageError
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("PHOTO_REVIEW_DB_PATH", str(BASE_DIR / "photoreview.db"))).resolve()
UPLOADS_DIR = Path(os.getenv("PHOTO_REVIEW_UPLOADS_DIR", str(BASE_DIR / "uploads"))).resolve()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MIN_IMAGE_SIZE_BYTES = 250 * 1024
MIN_IMAGE_WIDTH = 2000

ADMIN_USERNAME = os.getenv("PHOTO_REVIEW_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("PHOTO_REVIEW_ADMIN_PASS", "1982@Sd")
SECRET_KEY = os.getenv("PHOTO_REVIEW_SECRET_KEY", "change-me-in-production")

app = Flask(__name__)
app.config["SECRET_KEY"] = SECRET_KEY


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def now_ru() -> str:
    return datetime.now().strftime("%d.%m.%Y, %H:%M:%S")


def init_db() -> None:
    with get_db_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                district TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                phone TEXT,
                comment TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                admin_comment TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id INTEGER NOT NULL,
                file_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                is_original INTEGER NOT NULL DEFAULT 0,
                review_status TEXT NOT NULL DEFAULT 'pending',
                review_comment TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
            );
            """
        )
        file_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(files)").fetchall()
        }
        if "review_status" not in file_columns:
            conn.execute(
                "ALTER TABLE files ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'"
            )
        if "review_comment" not in file_columns:
            conn.execute(
                "ALTER TABLE files ADD COLUMN review_comment TEXT NOT NULL DEFAULT ''"
            )
        conn.commit()


def is_admin() -> bool:
    return bool(session.get("is_admin"))


def remove_submission_files(conn: sqlite3.Connection, submission_id: int, originals_only: bool = False) -> None:
    where = "submission_id = ?"
    params = [submission_id]
    if originals_only:
        where += " AND is_original = 1"
    rows = conn.execute(
        f"SELECT file_path FROM files WHERE {where}",
        params,
    ).fetchall()
    for row in rows:
        try:
            file_name = Path(str(row["file_path"]).replace("\\", "/")).name
            (UPLOADS_DIR / file_name).unlink(missing_ok=True)
        except OSError:
            pass
    conn.execute(f"DELETE FROM files WHERE {where}", params)


def file_to_payload(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["file_name"],
        "size": row["file_size"],
        "url": f"/{row['file_path'].replace(os.sep, '/')}",
        "status": row["review_status"] if row["review_status"] else "pending",
        "comment": row["review_comment"] or "",
    }


def recalc_submission_status(conn: sqlite3.Connection, submission_id: int) -> str:
    rows = conn.execute(
        "SELECT review_status FROM files WHERE submission_id = ? AND is_original = 0",
        (submission_id,),
    ).fetchall()
    statuses = [r["review_status"] for r in rows]
    if statuses and all(status == "approved" for status in statuses):
        status = "approved"
    elif any(status == "rejected" for status in statuses):
        status = "rejected"
    else:
        status = "pending"
    conn.execute(
        "UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?",
        (status, now_ru(), submission_id),
    )
    return status


def build_submission_payload(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    files = conn.execute(
        """
        SELECT id, file_name, file_path, file_size, is_original, review_status, review_comment
        FROM files
        WHERE submission_id = ?
        ORDER BY id
        """,
        (row["id"],),
    ).fetchall()
    photos = [file_to_payload(f) for f in files if f["is_original"] == 0]
    originals = [file_to_payload(f) for f in files if f["is_original"] == 1]
    return {
        "id": row["id"],
        "name": row["name"],
        "district": row["district"],
        "email": row["email"],
        "phone": row["phone"] or "",
        "comment": row["comment"] or "",
        "status": row["status"],
        "adminComment": row["admin_comment"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"] or "",
        "photos": photos,
        "originals": originals,
    }


def save_uploaded_file(submission_id: int, storage, is_original: bool) -> tuple[str, int, str]:
    safe_name = secure_filename(storage.filename or "file")
    ext = Path(safe_name).suffix.lower()

    if not is_original and ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError(f"Файл {safe_name}: допустимы JPG, PNG, WEBP")

    raw = storage.read()
    storage.stream.seek(0)
    size = len(raw)

    if not is_original and size < MIN_IMAGE_SIZE_BYTES:
        raise ValueError(f"Файл {safe_name} слишком маленький. Минимум 250 КБ")

    if not is_original:
        try:
            with Image.open(storage.stream) as image:
                if image.width < MIN_IMAGE_WIDTH:
                    raise ValueError(
                        f"Ширина фото {safe_name} слишком маленькая. Минимум {MIN_IMAGE_WIDTH}px"
                    )
        except UnidentifiedImageError as exc:
            raise ValueError(f"Файл {safe_name} не распознан как изображение") from exc
        finally:
            storage.stream.seek(0)

    suffix = ext if ext else ""
    unique_name = f"{submission_id}_{uuid.uuid4().hex}{suffix}"
    save_path = UPLOADS_DIR / unique_name
    storage.save(save_path)

    return safe_name, size, f"uploads/{unique_name}"


def validate_and_store_photo_files(conn: sqlite3.Connection, submission_id: int, files) -> None:
    for storage in files:
        file_name, file_size, file_path = save_uploaded_file(submission_id, storage, is_original=False)
        conn.execute(
            """
            INSERT INTO files (
                submission_id, file_name, file_path, file_size, is_original, review_status, review_comment
            )
            VALUES (?, ?, ?, ?, 0, 'pending', '')
            """,
            (submission_id, file_name, file_path, file_size),
        )


def get_submission_by_email(conn: sqlite3.Connection, email: str):
    return conn.execute(
        "SELECT * FROM submissions WHERE email = ?",
        (email.strip().lower(),),
    ).fetchone()


@app.route("/")
def index():
    return render_template("index.html", admin_mode=False)


@app.route("/admin")
def admin_page():
    return render_template("index.html", admin_mode=True)


@app.route("/user")
def user_cabinet_landing():
    return render_template("cabinet.html", user_email="")


@app.route("/user/<path:user_email>")
def user_cabinet(user_email: str):
    decoded_email = unquote(user_email).strip().lower()
    return render_template("cabinet.html", user_email=decoded_email)


@app.route("/email")
def legacy_user_cabinet_landing():
    return redirect(url_for("user_cabinet_landing"), code=302)


@app.route("/email/<path:user_email>")
def legacy_user_cabinet(user_email: str):
    decoded_email = unquote(user_email).strip().lower()
    return redirect(url_for("user_cabinet", user_email=decoded_email), code=302)


@app.route("/uploads/<path:filename>")
def uploaded_file(filename: str):
    return send_from_directory(UPLOADS_DIR, filename)


@app.post("/api/admin/login")
def admin_login():
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "")
    password = payload.get("password", "")

    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        session["is_admin"] = True
        return jsonify({"ok": True})

    return jsonify({"ok": False, "error": "Неверный логин или пароль"}), 401


@app.post("/api/admin/logout")
def admin_logout():
    session.pop("is_admin", None)
    return jsonify({"ok": True})


@app.get("/api/admin/session")
def admin_session():
    return jsonify({"isAdmin": is_admin()})


@app.post("/api/submissions")
def submit_photos():
    name = request.form.get("name", "").strip()
    district = request.form.get("district", "").strip()
    email = request.form.get("email", "").strip().lower()
    phone = request.form.get("phone", "").strip()
    comment = request.form.get("comment", "").strip()
    files = request.files.getlist("photos")

    if not all([name, district, email]):
        return jsonify({"error": "Заполните обязательные поля"}), 400

    if not files:
        return jsonify({"error": "Добавьте хотя бы одно фото"}), 400

    with get_db_connection() as conn:
        existing = get_submission_by_email(conn, email)

        if existing:
            submission_id = existing["id"]
            conn.execute(
                """
                UPDATE submissions
                SET name = ?, district = ?, phone = ?, comment = ?, status = 'pending',
                    admin_comment = '', updated_at = ?
                WHERE id = ?
                """,
                (name, district, phone, comment, now_ru(), submission_id),
            )
            remove_submission_files(conn, submission_id, originals_only=False)
        else:
            cursor = conn.execute(
                """
                INSERT INTO submissions (name, district, email, phone, comment, status, admin_comment, created_at)
                VALUES (?, ?, ?, ?, ?, 'pending', '', ?)
                """,
                (name, district, email, phone, comment, now_ru()),
            )
            submission_id = int(cursor.lastrowid)

        try:
            validate_and_store_photo_files(conn, submission_id, files)
            recalc_submission_status(conn, submission_id)
            conn.commit()
        except ValueError as exc:
            conn.rollback()
            return jsonify({"error": str(exc)}), 400

    return jsonify({"ok": True, "submissionId": submission_id})


@app.get("/api/submissions")
def get_submissions_by_email():
    email = request.args.get("email", "").strip().lower()
    if not email:
        return jsonify({"error": "Email обязателен"}), 400

    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM submissions WHERE email = ? ORDER BY id DESC",
            (email,),
        ).fetchall()
        payload = [build_submission_payload(conn, row) for row in rows]

    return jsonify(payload)


@app.get("/api/users/<path:user_email>")
def get_user_cabinet(user_email: str):
    email = unquote(user_email).strip().lower()
    if not email:
        return jsonify({"error": "Email обязателен"}), 400

    with get_db_connection() as conn:
        row = get_submission_by_email(conn, email)
        if not row:
            return jsonify({"error": "Пользователь не найден"}), 404
        payload = build_submission_payload(conn, row)

    return jsonify(payload)


@app.put("/api/users/<path:user_email>/profile")
def update_user_profile(user_email: str):
    email = unquote(user_email).strip().lower()
    payload = request.get_json(silent=True) or {}
    name = payload.get("name", "").strip()
    district = payload.get("district", "").strip()
    phone = payload.get("phone", "").strip()
    comment = payload.get("comment", "").strip()

    if not all([email, name, district]):
        return jsonify({"error": "Email, имя и район обязательны"}), 400

    with get_db_connection() as conn:
        row = get_submission_by_email(conn, email)
        if row:
            conn.execute(
                """
                UPDATE submissions
                SET name = ?, district = ?, phone = ?, comment = ?, updated_at = ?
                WHERE id = ?
                """,
                (name, district, phone, comment, now_ru(), row["id"]),
            )
            submission_id = row["id"]
        else:
            cursor = conn.execute(
                """
                INSERT INTO submissions (name, district, email, phone, comment, status, admin_comment, created_at)
                VALUES (?, ?, ?, ?, ?, 'pending', '', ?)
                """,
                (name, district, email, phone, comment, now_ru()),
            )
            submission_id = int(cursor.lastrowid)

        conn.commit()
        updated = conn.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,)).fetchone()
        response_payload = build_submission_payload(conn, updated)

    return jsonify({"ok": True, "user": response_payload})


@app.post("/api/users/<path:user_email>/photos")
def upload_user_photos(user_email: str):
    email = unquote(user_email).strip().lower()
    files = request.files.getlist("photos")
    if not email:
        return jsonify({"error": "Email обязателен"}), 400
    if not files:
        return jsonify({"error": "Добавьте хотя бы одно фото"}), 400

    with get_db_connection() as conn:
        row = get_submission_by_email(conn, email)
        if not row:
            return jsonify({"error": "Сначала заполните профиль пользователя"}), 400

        submission_id = row["id"]
        try:
            validate_and_store_photo_files(conn, submission_id, files)
            recalc_submission_status(conn, submission_id)
            conn.commit()
        except ValueError as exc:
            conn.rollback()
            return jsonify({"error": str(exc)}), 400

        updated = conn.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,)).fetchone()
        response_payload = build_submission_payload(conn, updated)

    return jsonify({"ok": True, "user": response_payload})


@app.post("/api/submissions/<int:submission_id>/originals")
def upload_originals(submission_id: int):
    files = request.files.getlist("originals")
    if not files:
        return jsonify({"error": "Файлы не выбраны"}), 400

    with get_db_connection() as conn:
        submission = conn.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()

        if not submission:
            return jsonify({"error": "Заявка не найдена"}), 404

        if submission["status"] != "approved":
            return jsonify({"error": "Оригиналы можно загружать только для одобренных заявок"}), 400

        remove_submission_files(conn, submission_id, originals_only=True)

        for storage in files:
            file_name, file_size, file_path = save_uploaded_file(submission_id, storage, is_original=True)
            conn.execute(
                """
                INSERT INTO files (submission_id, file_name, file_path, file_size, is_original)
                VALUES (?, ?, ?, ?, 1)
                """,
                (submission_id, file_name, file_path, file_size),
            )

        conn.execute(
            "UPDATE submissions SET updated_at = ? WHERE id = ?",
            (now_ru(), submission_id),
        )
        conn.commit()

        updated = conn.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,)).fetchone()
        payload = build_submission_payload(conn, updated)

    return jsonify({"ok": True, "submission": payload})


@app.get("/api/admin/submissions")
def admin_submissions():
    if not is_admin():
        return jsonify({"error": "Требуется авторизация администратора"}), 401

    status_filter = request.args.get("status", "all").strip().lower()

    query = "SELECT * FROM submissions ORDER BY id DESC"
    params: tuple = ()

    with get_db_connection() as conn:
        rows = conn.execute(query, params).fetchall()
        payload = []
        for row in rows:
            status = recalc_submission_status(conn, row["id"])
            row_payload = build_submission_payload(
                conn,
                conn.execute("SELECT * FROM submissions WHERE id = ?", (row["id"],)).fetchone(),
            )
            row_payload["status"] = status
            if status_filter == "all" or status == status_filter:
                payload.append(row_payload)
        conn.commit()

    return jsonify(payload)


@app.post("/api/admin/submissions/<int:submission_id>/status")
def admin_update_status(submission_id: int):
    if not is_admin():
        return jsonify({"error": "Требуется авторизация администратора"}), 401

    payload = request.get_json(silent=True) or {}
    new_status = payload.get("status", "").strip().lower()
    if new_status not in {"pending", "approved", "rejected"}:
        return jsonify({"error": "Некорректный статус"}), 400

    with get_db_connection() as conn:
        conn.execute(
            "UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?",
            (new_status, now_ru(), submission_id),
        )
        conn.commit()

    return jsonify({"ok": True})


@app.post("/api/admin/photos/<int:file_id>/review")
def admin_review_photo(file_id: int):
    if not is_admin():
        return jsonify({"error": "Требуется авторизация администратора"}), 401

    payload = request.get_json(silent=True) or {}
    new_status = payload.get("status", "").strip().lower()
    comment = payload.get("comment", "")
    if new_status not in {"approved", "rejected"}:
        return jsonify({"error": "Некорректный статус фото"}), 400

    with get_db_connection() as conn:
        file_row = conn.execute(
            "SELECT id, submission_id, is_original FROM files WHERE id = ?",
            (file_id,),
        ).fetchone()
        if not file_row:
            return jsonify({"error": "Фото не найдено"}), 404
        if file_row["is_original"] == 1:
            return jsonify({"error": "Нельзя модерировать оригиналы"}), 400

        conn.execute(
            """
            UPDATE files
            SET review_status = ?, review_comment = ?
            WHERE id = ?
            """,
            (new_status, comment, file_id),
        )
        submission_status = recalc_submission_status(conn, file_row["submission_id"])
        conn.commit()

    return jsonify({"ok": True, "submissionStatus": submission_status})


@app.post("/api/admin/submissions/<int:submission_id>/comment")
def admin_update_comment(submission_id: int):
    if not is_admin():
        return jsonify({"error": "Требуется авторизация администратора"}), 401

    payload = request.get_json(silent=True) or {}
    comment = payload.get("comment", "")

    with get_db_connection() as conn:
        conn.execute(
            "UPDATE submissions SET admin_comment = ?, updated_at = ? WHERE id = ?",
            (comment, now_ru(), submission_id),
        )
        conn.commit()

    return jsonify({"ok": True})


init_db()


if __name__ == "__main__":
    app.run(debug=True)
