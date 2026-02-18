let currentFilter = "all";
let modalScale = 1;

const modal = document.getElementById("photo-modal");
const modalImage = document.getElementById("photo-modal-image");
const modalStage = document.getElementById("photo-modal-stage");
const modalClose = document.getElementById("photo-modal-close");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
}

async function api(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || "Ошибка запроса");
    }
    return data;
}

function setModalScale(scale) {
    modalScale = Math.max(0.2, Math.min(4, scale));
    modalImage.style.transform = `scale(${modalScale})`;
    zoomResetBtn.textContent = `${Math.round(modalScale * 100)}%`;
}

function openPhotoModal(src) {
    if (!src) return;
    modalImage.src = src;
    setModalScale(1);
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
}

function closePhotoModal() {
    modal.classList.remove("open");
    modalImage.src = "";
    document.body.style.overflow = "";
}

zoomInBtn.addEventListener("click", () => setModalScale(modalScale + 0.2));
zoomOutBtn.addEventListener("click", () => setModalScale(modalScale - 0.2));
zoomResetBtn.addEventListener("click", () => setModalScale(1));
modalClose.addEventListener("click", closePhotoModal);
modal.addEventListener("click", (e) => {
    if (e.target === modal) closePhotoModal();
});
modalStage?.addEventListener("click", (e) => {
    if (e.target === modalStage) closePhotoModal();
});
document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("open")) return;
    if (e.key === "Escape") {
        closePhotoModal();
        return;
    }
    if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setModalScale(modalScale + 0.2);
        return;
    }
    if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setModalScale(modalScale - 0.2);
    }
});

window.openPhotoModal = openPhotoModal;

async function checkAdminSession() {
    const data = await api("/api/admin/session");
    if (data.isAdmin) {
        document.getElementById("admin-tab-btn").style.display = "block";
        return true;
    }
    return false;
}

async function ensureAdminAccess() {
    const active = await checkAdminSession();
    if (active) return true;

    const username = prompt("Введите логин:");
    const password = prompt("Введите пароль:");
    if (!username || !password) return false;

    try {
        await api("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        });
        document.getElementById("admin-tab-btn").style.display = "block";
        return true;
    } catch (e) {
        alert("❌ " + e.message);
        return false;
    }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
        const tabName = btn.dataset.tab;
        if (tabName === "admin") {
            const ok = await ensureAdminAccess();
            if (!ok) return;
        }

        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

        btn.classList.add("active");
        document.getElementById(`${tabName}-tab`).classList.add("active");

        if (tabName === "admin") {
            await renderAdminList();
        }
    });
});

const fileUpload = document.getElementById("file-upload");
const photoInput = document.getElementById("photo");
const filePreview = document.getElementById("file-preview");

fileUpload.addEventListener("click", () => photoInput.click());

fileUpload.addEventListener("dragover", (e) => {
    e.preventDefault();
    fileUpload.style.borderColor = "var(--color-primary)";
});

fileUpload.addEventListener("dragleave", () => {
    fileUpload.style.borderColor = "var(--color-border)";
});

fileUpload.addEventListener("drop", (e) => {
    e.preventDefault();
    fileUpload.style.borderColor = "var(--color-border)";
    if (e.dataTransfer.files.length) {
        photoInput.files = e.dataTransfer.files;
        validateAndPreviewFiles(e.dataTransfer.files);
    }
});

photoInput.addEventListener("change", (e) => {
    if (e.target.files.length) {
        validateAndPreviewFiles(e.target.files);
    }
});

function validateAndPreviewFiles(files) {
    filePreview.innerHTML = "";
    Array.from(files).forEach((file) => {
        if (file.size < 250 * 1024) {
            alert(`❌ Файл ${file.name} слишком маленький. Минимальный размер: 250 КБ`);
            photoInput.value = "";
            filePreview.innerHTML = "";
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                if (img.width < 2000) {
                    alert(`❌ Ширина фото ${file.name} слишком маленькая. Минимум: 2000px. Ширина: ${img.width}px`);
                    photoInput.value = "";
                    filePreview.innerHTML = "";
                    return;
                }

                const imgDiv = document.createElement("div");
                imgDiv.style.marginTop = "15px";
                imgDiv.innerHTML = `
                    <img src="${e.target.result}" alt="Preview" style="max-width: 100%; max-height: 200px; border-radius: 8px; border: 2px solid var(--color-border);">
                    <p style="margin-top: 5px; color: var(--color-text-muted); font-size: 14px;">
                        ${escapeHtml(file.name)} (${(file.size / 1024 / 1024).toFixed(2)} МБ) - ${img.width}x${img.height}px
                    </p>
                `;
                filePreview.appendChild(imgDiv);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

document.getElementById("submit-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!photoInput.files.length) {
        alert("Добавьте хотя бы одно фото");
        return;
    }

    const formData = new FormData();
    formData.append("name", document.getElementById("name").value);
    formData.append("district", document.getElementById("district").value);
    formData.append("email", document.getElementById("email").value);
    formData.append("phone", document.getElementById("phone").value);
    formData.append("comment", document.getElementById("comment").value);
    Array.from(photoInput.files).forEach((file) => formData.append("photos", file));

    try {
        const result = await api("/api/submissions", { method: "POST", body: formData });
        const form = document.getElementById("submit-form");
        form.innerHTML = `
            <div class="success-message">
                <h3>✅ Фото успешно отправлено!</h3>
                <p style="margin-top: 10px;">Статус: <strong>На проверке</strong></p>
                <p>ID заявки: <strong>${result.submissionId}</strong></p>
                <p style="margin-top: 15px;">Проверить статус можно во вкладке "Проверить статус"</p>
                <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: white; color: var(--color-success); border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    Отправить ещё
                </button>
            </div>
        `;
    } catch (err) {
        alert("❌ " + err.message);
    }
});

function statusLabel(status) {
    if (status === "pending") return "⏳ На проверке";
    if (status === "approved") return "✅ Одобрено";
    return "❌ Запросить новое фото";
}

function photoStatusLabel(status) {
    if (status === "approved") return "✅ Одобрено";
    if (status === "rejected") return "❌ Отклонено";
    return "⏳ На проверке";
}

function renderUserCards(submissions) {
    return submissions.map((sub) => `
        <div class="submission-card">
            ${(sub.photos || []).map((photo) => `
                <div style="margin-bottom: 10px;">
                    <img src="${photo.url}" alt="Photo">
                    <div style="font-size: 13px; margin-top: 6px; color: var(--color-text-secondary);">
                        ${photoStatusLabel(photo.status)}
                        ${photo.comment ? `<br><strong>Комментарий:</strong> ${escapeHtml(photo.comment)}` : ""}
                    </div>
                </div>
            `).join("")}
            <div class="submission-info">
                <strong>ID:</strong> ${sub.id}<br>
                <strong>Дата:</strong> ${sub.createdAt}<br>
                <a href="/user/${encodeURIComponent(sub.email)}" style="color: var(--color-primary);">Открыть личный кабинет</a>
            </div>
            <span class="status-badge status-${sub.status}">${statusLabel(sub.status)}</span>

            ${sub.status === "approved" && (!sub.originals || sub.originals.length === 0) ? `
                <div style="margin-top: 15px; padding: 15px; background: var(--color-success); color: white; border-radius: 8px;">
                    <strong>✅ Фото одобрено!</strong>
                    <p style="margin-top: 10px; font-size: 14px;">Теперь вы можете загрузить оригиналы (PSD, RAW и др.)</p>
                    <div style="margin-top: 10px;">
                        <input type="file" id="upload-originals-${sub.id}" multiple style="display: none;">
                        <button onclick="document.getElementById('upload-originals-${sub.id}').click()" style="padding: 8px 16px; background: white; color: var(--color-success); border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                            Загрузить оригиналы
                        </button>
                    </div>
                </div>
            ` : ""}

            ${sub.originals && sub.originals.length > 0 ? `
                <div style="margin-top: 10px; padding: 10px; background: var(--color-bg-muted); border-radius: 6px;">
                    <strong style="color: var(--color-primary);">Оригиналы загружены:</strong><br>
                    ${sub.originals.map((orig) => `
                        <div style="margin-top: 5px; font-size: 14px;">
                            <a href="${orig.url}" target="_blank" rel="noopener">${escapeHtml(orig.name)}</a> (${(orig.size / 1024 / 1024).toFixed(2)} МБ)
                        </div>
                    `).join("")}
                </div>
            ` : ""}
        </div>
    `).join("");
}

document.getElementById("check-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("check-email").value;
    const resultDiv = document.getElementById("status-result");

    try {
        const submissions = await api(`/api/submissions?email=${encodeURIComponent(email)}`);
        if (!submissions.length) {
            resultDiv.innerHTML = `<div class="empty-state"><p>Заявки с таким email не найдены</p></div>`;
            return;
        }

        resultDiv.innerHTML = renderUserCards(submissions);
        submissions.forEach((sub) => {
            if (sub.status === "approved" && (!sub.originals || sub.originals.length === 0)) {
                const uploadInput = document.getElementById(`upload-originals-${sub.id}`);
                if (uploadInput) {
                    uploadInput.addEventListener("change", async (event) => {
                        if (!event.target.files.length) return;
                        const fd = new FormData();
                        Array.from(event.target.files).forEach((file) => fd.append("originals", file));
                        try {
                            await api(`/api/submissions/${sub.id}/originals`, { method: "POST", body: fd });
                            alert("✅ Оригиналы загружены");
                            document.getElementById("check-form").dispatchEvent(new Event("submit", { cancelable: true }));
                        } catch (err) {
                            alert("❌ " + err.message);
                        }
                    });
                }
            }
        });
    } catch (err) {
        alert("❌ " + err.message);
    }
});

document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
        document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        await renderAdminList();
    });
});

async function reviewPhoto(fileId, status) {
    const commentEl = document.getElementById(`photo-comment-${fileId}`);
    const comment = commentEl ? commentEl.value : "";

    try {
        await api(`/api/admin/photos/${fileId}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, comment }),
        });
        await renderAdminList();
    } catch (err) {
        alert("❌ " + err.message);
    }
}

window.reviewPhoto = reviewPhoto;

async function renderAdminList() {
    const adminList = document.getElementById("admin-list");
    try {
        const submissions = await api(`/api/admin/submissions?status=${encodeURIComponent(currentFilter)}`);
        if (!submissions.length) {
            adminList.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <h3>Нет заявок</h3>
                    <p>Заявки с выбранным статусом не найдены</p>
                </div>
            `;
            return;
        }

        adminList.innerHTML = submissions.map((sub) => `
            <div class="submission-card">
                ${(sub.photos || []).map((photo) => `
                    <div class="admin-photo-item">
                        <img
                            src="${photo.url}"
                            alt="Photo"
                            class="admin-photo-thumb"
                            style="margin-bottom: 8px;"
                            onclick="openPhotoModal('${photo.url}')"
                        >
                        <span class="status-badge status-${photo.status}">${photoStatusLabel(photo.status)}</span>
                        <div class="photo-actions">
                            <button class="btn-approve" onclick="reviewPhoto(${photo.id}, 'approved')">Одобрить</button>
                            <button class="btn-reject" onclick="reviewPhoto(${photo.id}, 'rejected')">Отклонить</button>
                        </div>
                        <textarea
                            class="photo-comment"
                            id="photo-comment-${photo.id}"
                            placeholder="Комментарий по этому фото"
                        >${escapeHtml(photo.comment || "")}</textarea>
                    </div>
                `).join("")}

                <div class="submission-info">
                    <strong>Имя:</strong> ${escapeHtml(sub.name)}<br>
                    <strong>Район:</strong> ${escapeHtml(sub.district)}<br>
                    <strong>Email:</strong> ${escapeHtml(sub.email)}<br>
                    ${sub.phone ? `<strong>Телефон:</strong> ${escapeHtml(sub.phone)}<br>` : ""}
                    <strong>Дата:</strong> ${escapeHtml(sub.createdAt)}<br>
                    ${sub.comment ? `<strong>Комментарий:</strong> ${escapeHtml(sub.comment)}<br>` : ""}
                </div>

                <span class="status-badge status-${sub.status}">${statusLabel(sub.status)}</span>

                ${sub.originals && sub.originals.length > 0 ? `
                    <div style="margin-top: 10px; padding: 10px; background: var(--color-bg-muted); border-radius: 6px;">
                        <strong style="color: var(--color-primary);">Оригиналы (${sub.originals.length}):</strong><br>
                        ${sub.originals.map((orig) => `
                            <div style="margin-top: 5px; display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                                <span style="font-size: 14px;">${escapeHtml(orig.name)} (${(orig.size / 1024 / 1024).toFixed(2)} МБ)</span>
                                <a href="${orig.url}" download="${escapeHtml(orig.name)}" style="padding: 4px 8px; background: var(--color-primary); color: white; border-radius: 4px; font-size: 12px; text-decoration: none;">Скачать</a>
                            </div>
                        `).join("")}
                    </div>
                ` : ""}
            </div>
        `).join("");
    } catch (err) {
        adminList.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><p>${escapeHtml(err.message)}</p></div>`;
    }
}

(async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const isAdminMode = Boolean(window.APP_CONTEXT && window.APP_CONTEXT.adminMode);
    const shouldOpenAdmin = isAdminMode || window.location.pathname === "/admin" || urlParams.get("admin") === "true";
    await checkAdminSession();

    if (shouldOpenAdmin) {
        const ok = await ensureAdminAccess();
        if (ok) {
            document.getElementById("admin-tab-btn").click();
        }
    }
})();
