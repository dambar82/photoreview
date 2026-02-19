import os
import re
import sqlite3
import smtplib
import uuid
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from threading import Thread
from urllib.parse import quote, unquote
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from PIL import Image, UnidentifiedImageError
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("PHOTO_REVIEW_DB_PATH", str(BASE_DIR / "photoreview.db"))).resolve()
UPLOADS_DIR = Path(os.getenv("PHOTO_REVIEW_UPLOADS_DIR", str(BASE_DIR / "uploads"))).resolve()
THUMBS_DIR = (UPLOADS_DIR / "thumbs").resolve()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
THUMBS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MIN_IMAGE_SIZE_BYTES = 250 * 1024
MIN_IMAGE_WIDTH = 2000
THUMB_MAX_PX = 400
THUMB_QUALITY = 75

ADMIN_USERNAME = os.getenv("PHOTO_REVIEW_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("PHOTO_REVIEW_ADMIN_PASS", "1982@Sd")
SECRET_KEY = os.getenv("PHOTO_REVIEW_SECRET_KEY", "change-me-in-production")
SMTP_HOST = os.getenv("PHOTO_REVIEW_SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("PHOTO_REVIEW_SMTP_PORT", "587"))
SMTP_USER = os.getenv("PHOTO_REVIEW_SMTP_USER", "").strip()
SMTP_PASS = os.getenv("PHOTO_REVIEW_SMTP_PASS", "").strip()
SMTP_USE_TLS = os.getenv("PHOTO_REVIEW_SMTP_USE_TLS", "1").strip() == "1"
SMTP_USE_SSL = os.getenv("PHOTO_REVIEW_SMTP_USE_SSL", "0").strip() == "1"
SMTP_FROM = os.getenv("PHOTO_REVIEW_SMTP_FROM", SMTP_USER).strip()
SMTP_TIMEOUT_SEC = int(os.getenv("PHOTO_REVIEW_SMTP_TIMEOUT_SEC", "8"))
ADMIN_NOTIFY_EMAIL = os.getenv("PHOTO_REVIEW_ADMIN_NOTIFY_EMAIL", "damir-82@bk.ru").strip().lower()
PUBLIC_BASE_URL = os.getenv("PHOTO_REVIEW_BASE_URL", "").strip().rstrip("/")

app = Flask(__name__)
app.config["SECRET_KEY"] = SECRET_KEY
MSK_TZ = ZoneInfo("Europe/Moscow")


def public_url(path: str) -> str:
    if PUBLIC_BASE_URL:
        return f"{PUBLIC_BASE_URL}{path}"
    return path


def send_email_notification(to_email: str, subject: str, body: str) -> bool:
    if not SMTP_HOST or not SMTP_FROM or not to_email:
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(body)

    try:
        if SMTP_USE_SSL:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SEC) as server:
                if SMTP_USER:
                    server.login(SMTP_USER, SMTP_PASS)
                server.send_message(msg)
            return True

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SEC) as server:
            if SMTP_USE_TLS:
                server.starttls()
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        return True
    except Exception:
        app.logger.exception("Failed to send email notification")
        return False


def queue_email_notification(to_email: str, subject: str, body: str) -> None:
    # Do not block API requests on SMTP latency/timeouts.
    Thread(
        target=send_email_notification,
        args=(to_email, subject, body),
        daemon=True,
    ).start()


def photo_status_label_ru(status: str) -> str:
    if status == "approved":
        return "Одобрено"
    if status == "rejected":
        return "Отклонено"
    return "На проверке"


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def now_ru() -> str:
    return datetime.now(MSK_TZ).strftime("%d.%m.%Y, %H:%M:%S")


def now_iso() -> str:
    return datetime.now(MSK_TZ).isoformat(timespec="seconds")


def today_key() -> str:
    return datetime.now(MSK_TZ).strftime("%Y-%m-%d")


PHOTO_ID_RE = re.compile(r"#(\d+)")


def extract_photo_id(details: str) -> int | None:
    if not details:
        return None
    match = PHOTO_ID_RE.search(details)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


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
                thumb_path TEXT,
                file_size INTEGER NOT NULL,
                is_original INTEGER NOT NULL DEFAULT 0,
                review_status TEXT NOT NULL DEFAULT 'pending',
                review_comment TEXT NOT NULL DEFAULT '',
                parent_photo_id INTEGER,
                FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_email TEXT NOT NULL,
                actor_name TEXT,
                district TEXT,
                action_type TEXT NOT NULL,
                details TEXT,
                created_at_iso TEXT NOT NULL,
                created_day TEXT NOT NULL
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
        if "parent_photo_id" not in file_columns:
            conn.execute("ALTER TABLE files ADD COLUMN parent_photo_id INTEGER")
        if "thumb_path" not in file_columns:
            conn.execute("ALTER TABLE files ADD COLUMN thumb_path TEXT")
        conn.commit()


def log_activity(
    conn: sqlite3.Connection,
    *,
    actor_email: str,
    actor_name: str,
    district: str,
    action_type: str,
    details: str,
) -> None:
    conn.execute(
        """
        INSERT INTO activity_logs (
            actor_email, actor_name, district, action_type, details, created_at_iso, created_day
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            actor_email.strip().lower(),
            actor_name.strip(),
            district.strip(),
            action_type,
            details,
            now_iso(),
            today_key(),
        ),
    )


def is_admin() -> bool:
    return bool(session.get("is_admin"))


def remove_submission_files(conn: sqlite3.Connection, submission_id: int, originals_only: bool = False) -> None:
    where = "submission_id = ?"
    params = [submission_id]
    if originals_only:
        where += " AND is_original = 1"
    rows = conn.execute(
        f"SELECT file_path, thumb_path FROM files WHERE {where}",
        params,
    ).fetchall()
    for row in rows:
        try:
            file_name = Path(str(row["file_path"]).replace("\\", "/")).name
            (UPLOADS_DIR / file_name).unlink(missing_ok=True)
        except OSError:
            pass
        try:
            thumb_raw = row["thumb_path"]
            if thumb_raw:
                thumb_name = Path(str(thumb_raw).replace("\\", "/")).name
                (THUMBS_DIR / thumb_name).unlink(missing_ok=True)
        except OSError:
            pass
    conn.execute(f"DELETE FROM files WHERE {where}", params)


def file_to_payload(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["file_name"],
        "size": row["file_size"],
        "url": f"/{row['file_path'].replace(os.sep, '/')}",
        "thumbUrl": (
            f"/{row['thumb_path'].replace(os.sep, '/')}"
            if row["thumb_path"]
            else f"/{row['file_path'].replace(os.sep, '/')}"
        ),
        "status": row["review_status"] if row["review_status"] else "pending",
        "comment": row["review_comment"] or "",
        "parentPhotoId": row["parent_photo_id"],
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
        SELECT id, file_name, file_path, thumb_path, file_size, is_original, review_status, review_comment
             , parent_photo_id
        FROM files
        WHERE submission_id = ?
        ORDER BY id
        """,
        (row["id"],),
    ).fetchall()
    photos_rows = [f for f in files if f["is_original"] == 0]
    originals_rows = [f for f in files if f["is_original"] == 1]

    originals_by_photo: dict[int, list[dict]] = {}
    submission_originals: list[dict] = []
    for original in originals_rows:
        payload = file_to_payload(original)
        parent_id = original["parent_photo_id"]
        if parent_id:
            originals_by_photo.setdefault(parent_id, []).append(payload)
        else:
            submission_originals.append(payload)

    photos = []
    for photo in photos_rows:
        photo_payload = file_to_payload(photo)
        photo_payload["originals"] = originals_by_photo.get(photo["id"], [])
        photos.append(photo_payload)

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
        "originals": submission_originals,
    }


def save_uploaded_file(submission_id: int, storage, is_original: bool) -> tuple[str, int, str, str | None]:
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
    thumb_rel_path: str | None = None
    if not is_original:
        thumb_name = f"{submission_id}_{uuid.uuid4().hex}_thumb.jpg"
        thumb_path = THUMBS_DIR / thumb_name
        with Image.open(save_path) as src:
            if src.mode not in ("RGB", "L"):
                src = src.convert("RGB")
            src.thumbnail((THUMB_MAX_PX, THUMB_MAX_PX))
            src.save(thumb_path, format="JPEG", quality=THUMB_QUALITY, optimize=True)
        thumb_rel_path = f"uploads/thumbs/{thumb_name}"

    return safe_name, size, f"uploads/{unique_name}", thumb_rel_path


def validate_and_store_photo_files(conn: sqlite3.Connection, submission_id: int, files) -> None:
    for storage in files:
        file_name, file_size, file_path, thumb_path = save_uploaded_file(submission_id, storage, is_original=False)
        conn.execute(
            """
                INSERT INTO files (
                    submission_id, file_name, file_path, thumb_path, file_size, is_original, review_status, review_comment, parent_photo_id
                )
                VALUES (?, ?, ?, ?, ?, 0, 'pending', '', NULL)
                """,
                (submission_id, file_name, file_path, thumb_path, file_size),
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
    return render_template("cabinet.html", user_email="", admin_view=is_admin())


@app.route("/user/<path:user_email>")
def user_cabinet(user_email: str):
    decoded_email = unquote(user_email).strip().lower()
    return render_template("cabinet.html", user_email=decoded_email, admin_view=is_admin())


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


@app.route("/favicon.ico")
def favicon():
    return "", 204


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
            log_activity(
                conn,
                actor_email=email,
                actor_name=name,
                district=district,
                action_type="submission_updated",
                details=f"Обновил заявку и загрузил {len(files)} фото",
            )
        else:
            cursor = conn.execute(
                """
                INSERT INTO submissions (name, district, email, phone, comment, status, admin_comment, created_at)
                VALUES (?, ?, ?, ?, ?, 'pending', '', ?)
                """,
                (name, district, email, phone, comment, now_ru()),
            )
            submission_id = int(cursor.lastrowid)
            log_activity(
                conn,
                actor_email=email,
                actor_name=name,
                district=district,
                action_type="submission_created",
                details=f"Создал заявку и загрузил {len(files)} фото",
            )

        try:
            validate_and_store_photo_files(conn, submission_id, files)
            recalc_submission_status(conn, submission_id)
            conn.commit()
        except ValueError as exc:
            conn.rollback()
            return jsonify({"error": str(exc)}), 400

    safe_email = quote(email, safe="")
    queue_email_notification(
        ADMIN_NOTIFY_EMAIL,
        "PhotoReview: новая загрузка фото",
        (
            f"Пользователь: {name}\n"
            f"Email: {email}\n"
            f"Район: {district}\n"
            f"Фото: {len(files)}\n"
            f"Кабинет: {public_url(f'/user/{safe_email}')}\n"
        ),
    )

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
            log_activity(
                conn,
                actor_email=email,
                actor_name=name,
                district=district,
                action_type="profile_updated",
                details="Обновил профиль",
            )
        else:
            cursor = conn.execute(
                """
                INSERT INTO submissions (name, district, email, phone, comment, status, admin_comment, created_at)
                VALUES (?, ?, ?, ?, ?, 'pending', '', ?)
                """,
                (name, district, email, phone, comment, now_ru()),
            )
            submission_id = int(cursor.lastrowid)
            log_activity(
                conn,
                actor_email=email,
                actor_name=name,
                district=district,
                action_type="profile_created",
                details="Создал профиль",
            )

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
            log_activity(
                conn,
                actor_email=email,
                actor_name=row["name"] or "",
                district=row["district"] or "",
                action_type="photos_uploaded",
                details=f"Загрузил {len(files)} новых фото",
            )
            conn.commit()
        except ValueError as exc:
            conn.rollback()
            return jsonify({"error": str(exc)}), 400

        updated = conn.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,)).fetchone()
        response_payload = build_submission_payload(conn, updated)

    safe_email = quote(email, safe="")
    queue_email_notification(
        ADMIN_NOTIFY_EMAIL,
        "PhotoReview: пользователь загрузил новые фото",
        (
            f"Пользователь: {row['name'] or ''}\n"
            f"Email: {email}\n"
            f"Район: {row['district'] or ''}\n"
            f"Фото: {len(files)}\n"
            f"Кабинет: {public_url(f'/user/{safe_email}')}\n"
        ),
    )

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
            file_name, file_size, file_path, _ = save_uploaded_file(submission_id, storage, is_original=True)
            conn.execute(
                """
                INSERT INTO files (submission_id, file_name, file_path, thumb_path, file_size, is_original)
                VALUES (?, ?, ?, NULL, ?, 1)
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


@app.post("/api/photos/<int:photo_id>/originals")
def upload_originals_for_photo(photo_id: int):
    files = request.files.getlist("originals")
    if not files:
        return jsonify({"error": "Файлы не выбраны"}), 400

    with get_db_connection() as conn:
        photo = conn.execute(
            """
            SELECT id, submission_id, is_original, review_status
            FROM files
            WHERE id = ?
            """,
            (photo_id,),
        ).fetchone()

        if not photo:
            return jsonify({"error": "Фото не найдено"}), 404
        if photo["is_original"] == 1:
            return jsonify({"error": "Нельзя загружать оригиналы для оригинала"}), 400
        if photo["review_status"] != "approved":
            return jsonify({"error": "Оригиналы можно загрузить только для одобренного фото"}), 400

        existing = conn.execute(
            "SELECT file_path FROM files WHERE parent_photo_id = ? AND is_original = 1",
            (photo_id,),
        ).fetchall()
        for row in existing:
            try:
                file_name = Path(str(row["file_path"]).replace("\\", "/")).name
                (UPLOADS_DIR / file_name).unlink(missing_ok=True)
            except OSError:
                pass
        conn.execute(
            "DELETE FROM files WHERE parent_photo_id = ? AND is_original = 1",
            (photo_id,),
        )

        for storage in files:
            file_name, file_size, file_path, _ = save_uploaded_file(
                photo["submission_id"], storage, is_original=True
            )
            conn.execute(
                """
                INSERT INTO files (
                    submission_id, file_name, file_path, thumb_path, file_size, is_original, parent_photo_id
                )
                VALUES (?, ?, ?, NULL, ?, 1, ?)
                """,
                (photo["submission_id"], file_name, file_path, file_size, photo_id),
            )

        submission_row = conn.execute(
            "SELECT email, name, district FROM submissions WHERE id = ?",
            (photo["submission_id"],),
        ).fetchone()
        log_activity(
            conn,
            actor_email=submission_row["email"],
            actor_name=submission_row["name"] or "",
            district=submission_row["district"] or "",
            action_type="photo_original_uploaded",
            details=f"Загрузил {len(files)} оригинал(ов) для фото #{photo_id}",
        )

        conn.commit()
        submission = conn.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (photo["submission_id"],),
        ).fetchone()
        payload = build_submission_payload(conn, submission)

    return jsonify({"ok": True, "submission": payload})


@app.delete("/api/photos/<int:photo_id>/originals")
def delete_originals_for_photo(photo_id: int):
    with get_db_connection() as conn:
        photo = conn.execute(
            """
            SELECT id, submission_id, is_original
            FROM files
            WHERE id = ?
            """,
            (photo_id,),
        ).fetchone()
        if not photo:
            return jsonify({"error": "Фото не найдено"}), 404
        if photo["is_original"] == 1:
            return jsonify({"error": "Нельзя удалять оригиналы для оригинала"}), 400

        existing = conn.execute(
            "SELECT file_path FROM files WHERE parent_photo_id = ? AND is_original = 1",
            (photo_id,),
        ).fetchall()
        for row in existing:
            try:
                file_name = Path(str(row["file_path"]).replace("\\", "/")).name
                (UPLOADS_DIR / file_name).unlink(missing_ok=True)
            except OSError:
                pass

        conn.execute(
            "DELETE FROM files WHERE parent_photo_id = ? AND is_original = 1",
            (photo_id,),
        )

        submission_row = conn.execute(
            "SELECT email, name, district FROM submissions WHERE id = ?",
            (photo["submission_id"],),
        ).fetchone()
        log_activity(
            conn,
            actor_email=submission_row["email"],
            actor_name=submission_row["name"] or "",
            district=submission_row["district"] or "",
            action_type="photo_original_deleted",
            details=f"Удалил оригиналы для фото #{photo_id}",
        )
        conn.commit()

        submission = conn.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (photo["submission_id"],),
        ).fetchone()
        payload = build_submission_payload(conn, submission)

    return jsonify({"ok": True, "submission": payload})


@app.delete("/api/originals/<int:original_id>")
def delete_single_original(original_id: int):
    with get_db_connection() as conn:
        original = conn.execute(
            """
            SELECT id, submission_id, is_original, parent_photo_id, file_path
            FROM files
            WHERE id = ?
            """,
            (original_id,),
        ).fetchone()
        if not original:
            return jsonify({"error": "Оригинал не найден"}), 404
        if original["is_original"] != 1:
            return jsonify({"error": "Файл не является оригиналом"}), 400

        try:
            file_name = Path(str(original["file_path"]).replace("\\", "/")).name
            (UPLOADS_DIR / file_name).unlink(missing_ok=True)
        except OSError:
            pass

        conn.execute("DELETE FROM files WHERE id = ?", (original_id,))

        submission_row = conn.execute(
            "SELECT email, name, district FROM submissions WHERE id = ?",
            (original["submission_id"],),
        ).fetchone()
        if submission_row:
            log_activity(
                conn,
                actor_email=submission_row["email"],
                actor_name=submission_row["name"] or "",
                district=submission_row["district"] or "",
                action_type="photo_original_deleted",
                details=f"Удалил оригинал #{original_id} для фото #{original['parent_photo_id'] or 0}",
            )
        conn.commit()

        submission = conn.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (original["submission_id"],),
        ).fetchone()
        payload = build_submission_payload(conn, submission)

    return jsonify({"ok": True, "submission": payload})


@app.delete("/api/photos/<int:photo_id>")
def delete_uploaded_photo(photo_id: int):
    with get_db_connection() as conn:
        photo = conn.execute(
            """
            SELECT id, submission_id, is_original
            FROM files
            WHERE id = ?
            """,
            (photo_id,),
        ).fetchone()
        if not photo:
            return jsonify({"error": "Фото не найдено"}), 404
        if photo["is_original"] == 1:
            return jsonify({"error": "Это оригинал, используйте удаление оригинала"}), 400

        # Удаляем привязанные оригиналы
        linked = conn.execute(
            "SELECT file_path FROM files WHERE parent_photo_id = ? AND is_original = 1",
            (photo_id,),
        ).fetchall()
        for row in linked:
            try:
                file_name = Path(str(row["file_path"]).replace("\\", "/")).name
                (UPLOADS_DIR / file_name).unlink(missing_ok=True)
            except OSError:
                pass
        conn.execute(
            "DELETE FROM files WHERE parent_photo_id = ? AND is_original = 1",
            (photo_id,),
        )

        # Удаляем само фото
        photo_path_row = conn.execute(
            "SELECT file_path, thumb_path FROM files WHERE id = ?",
            (photo_id,),
        ).fetchone()
        if photo_path_row:
            try:
                file_name = Path(str(photo_path_row["file_path"]).replace("\\", "/")).name
                (UPLOADS_DIR / file_name).unlink(missing_ok=True)
            except OSError:
                pass
            try:
                thumb_raw = photo_path_row["thumb_path"]
                if thumb_raw:
                    thumb_name = Path(str(thumb_raw).replace("\\", "/")).name
                    (THUMBS_DIR / thumb_name).unlink(missing_ok=True)
            except OSError:
                pass
        conn.execute("DELETE FROM files WHERE id = ?", (photo_id,))

        recalc_submission_status(conn, photo["submission_id"])

        submission_row = conn.execute(
            "SELECT email, name, district FROM submissions WHERE id = ?",
            (photo["submission_id"],),
        ).fetchone()
        if submission_row:
            log_activity(
                conn,
                actor_email=submission_row["email"],
                actor_name=submission_row["name"] or "",
                district=submission_row["district"] or "",
                action_type="photo_deleted",
                details=f"Удалил фото #{photo_id}",
            )

        conn.commit()
        submission = conn.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (photo["submission_id"],),
        ).fetchone()
        payload = build_submission_payload(conn, submission)

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


@app.get("/api/admin/activities")
def admin_activities():
    if not is_admin():
        return jsonify({"error": "Требуется авторизация администратора"}), 401

    day_filter = request.args.get("day", "").strip()
    district_filter = request.args.get("district", "").strip()

    where_parts = []
    params: list[str] = []
    if day_filter:
        where_parts.append("created_day = ?")
        params.append(day_filter)
    if district_filter:
        where_parts.append("district = ?")
        params.append(district_filter)

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    with get_db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT id, actor_email, actor_name, district, action_type, details, created_at_iso
            FROM activity_logs
            {where_sql}
            ORDER BY id DESC
            LIMIT 500
            """,
            tuple(params),
        ).fetchall()

        photo_ids = {
            pid
            for pid in (extract_photo_id(row["details"] or "") for row in rows)
            if pid is not None
        }
        photo_links: dict[int, str] = {}
        if photo_ids:
            placeholders = ",".join(["?"] * len(photo_ids))
            photo_rows = conn.execute(
                f"SELECT id, file_path FROM files WHERE id IN ({placeholders})",
                tuple(photo_ids),
            ).fetchall()
            photo_links = {
                int(photo_row["id"]): f"/{str(photo_row['file_path']).replace(os.sep, '/')}"
                for photo_row in photo_rows
            }

        districts_rows = conn.execute(
            """
            SELECT DISTINCT district
            FROM activity_logs
            WHERE district IS NOT NULL AND district <> ''
            ORDER BY district
            """
        ).fetchall()

    return jsonify(
        {
            "items": [
                {
                    "id": row["id"],
                    "email": row["actor_email"],
                    "name": row["actor_name"] or "",
                    "district": row["district"] or "",
                    "actionType": row["action_type"],
                    "details": row["details"] or "",
                    "createdAt": row["created_at_iso"],
                    "profileUrl": f"/user/{quote(row['actor_email'], safe='')}",
                    "photoUrl": photo_links.get(extract_photo_id(row["details"] or "")),
                }
                for row in rows
            ],
            "districts": [row["district"] for row in districts_rows],
        }
    )


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
            """
            SELECT f.id, f.submission_id, f.is_original, f.file_name, s.email, s.name
            FROM files f
            JOIN submissions s ON s.id = f.submission_id
            WHERE f.id = ?
            """,
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

    user_email = (file_row["email"] or "").strip().lower()
    if user_email:
        safe_email = quote(user_email, safe="")
        comment_part = f"\nКомментарий администратора: {comment.strip()}" if comment.strip() else ""
        queue_email_notification(
            user_email,
            f"PhotoReview: фото #{file_id} — {photo_status_label_ru(new_status)}",
            (
                f"Здравствуйте, {file_row['name'] or 'пользователь'}!\n\n"
                f"Администратор обновил статус вашего фото.\n"
                f"Фото: {file_row['file_name']}\n"
                f"Новый статус: {photo_status_label_ru(new_status)}\n"
                f"Статус заявки: {photo_status_label_ru(submission_status)}"
                f"{comment_part}\n\n"
                f"Личный кабинет: {public_url(f'/user/{safe_email}')}\n"
            ),
        )

    return jsonify({"ok": True, "submissionStatus": submission_status})


@app.post("/api/admin/photos/<int:file_id>/comment")
def admin_save_photo_comment(file_id: int):
    if not is_admin():
        return jsonify({"error": "Требуется авторизация администратора"}), 401

    payload = request.get_json(silent=True) or {}
    comment = payload.get("comment", "")

    with get_db_connection() as conn:
        file_row = conn.execute(
            """
            SELECT f.id, f.is_original, f.file_name, f.review_status, f.review_comment, s.email, s.name
            FROM files f
            JOIN submissions s ON s.id = f.submission_id
            WHERE f.id = ?
            """,
            (file_id,),
        ).fetchone()
        if not file_row:
            return jsonify({"error": "Фото не найдено"}), 404
        if file_row["is_original"] == 1:
            return jsonify({"error": "Нельзя комментировать оригиналы"}), 400

        conn.execute(
            "UPDATE files SET review_comment = ? WHERE id = ?",
            (comment, file_id),
        )
        conn.commit()

    old_comment = (file_row["review_comment"] or "").strip()
    new_comment = (comment or "").strip()
    user_email = (file_row["email"] or "").strip().lower()
    if user_email and new_comment and new_comment != old_comment:
        safe_email = quote(user_email, safe="")
        queue_email_notification(
            user_email,
            f"PhotoReview: комментарий по фото #{file_id}",
            (
                f"Здравствуйте, {file_row['name'] or 'пользователь'}!\n\n"
                f"Администратор оставил комментарий по вашему фото.\n"
                f"Фото: {file_row['file_name']}\n"
                f"Текущий статус: {photo_status_label_ru(file_row['review_status'])}\n"
                f"Комментарий: {new_comment}\n\n"
                f"Личный кабинет: {public_url(f'/user/{safe_email}')}\n"
            ),
        )

    return jsonify({"ok": True})


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
