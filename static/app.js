let currentFilter = "all";
let modalScale = 1;
const isAdminRoute = Boolean(window.APP_CONTEXT && window.APP_CONTEXT.adminMode);

const modal = document.getElementById("photo-modal");
const modalImage = document.getElementById("photo-modal-image");
const modalStage = document.getElementById("photo-modal-stage");
const modalClose = document.getElementById("photo-modal-close");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const activityDayFilter = document.getElementById("activity-day-filter");
const activityDistrictFilter = document.getElementById("activity-district-filter");
const activityApplyBtn = document.getElementById("activity-apply-btn");
const activityResetBtn = document.getElementById("activity-reset-btn");
const activityList = document.getElementById("activity-list");
const adminSubmissionsSection = document.getElementById("admin-submissions-section");
const adminActivitySection = document.getElementById("admin-activity-section");
const adminSectionSubmissionsBtn = document.getElementById("admin-section-submissions-btn");
const adminSectionActivityBtn = document.getElementById("admin-section-activity-btn");

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

async function setAdminSection(section) {
    const showSubmissions = section === "submissions";
    if (adminSubmissionsSection) {
        adminSubmissionsSection.style.display = showSubmissions ? "block" : "none";
    }
    if (adminActivitySection) {
        adminActivitySection.style.display = showSubmissions ? "none" : "block";
    }
    if (adminSectionSubmissionsBtn) {
        adminSectionSubmissionsBtn.classList.toggle("active", showSubmissions);
    }
    if (adminSectionActivityBtn) {
        adminSectionActivityBtn.classList.toggle("active", !showSubmissions);
    }
    if (!showSubmissions) {
        await renderActivityList();
    }
}

async function checkAdminSession() {
    const data = await api("/api/admin/session");
    return Boolean(data.isAdmin);
}

async function ensureAdminAccess() {
    if (!isAdminRoute) {
        return false;
    }
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
        return true;
    } catch (e) {
        console.error(e.message);
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
            await setAdminSection("submissions");
            await renderAdminList();
        }
    });
});

const fileUpload = document.getElementById("file-upload");
const photoInput = document.getElementById("photo");
const filePreview = document.getElementById("file-preview");
const submitEmailInput = document.getElementById("email");
const existingCabinetBtn = document.getElementById("existing-cabinet-btn");
let emailCheckTimer = null;

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

function hideExistingCabinetButton() {
    if (!existingCabinetBtn) return;
    existingCabinetBtn.style.display = "none";
    existingCabinetBtn.onclick = null;
}

function showExistingCabinetButton(email) {
    if (!existingCabinetBtn) return;
    existingCabinetBtn.style.display = "block";
    existingCabinetBtn.onclick = () => {
        window.location.href = `/user/${encodeURIComponent(email)}`;
    };
}

async function checkExistingCabinetByEmail() {
    if (!submitEmailInput) return;
    const email = submitEmailInput.value.trim().toLowerCase();
    if (!email || !submitEmailInput.checkValidity()) {
        hideExistingCabinetButton();
        return;
    }

    try {
        await api(`/api/users/${encodeURIComponent(email)}`);
        showExistingCabinetButton(email);
    } catch (err) {
        hideExistingCabinetButton();
    }
}

submitEmailInput?.addEventListener("input", () => {
    hideExistingCabinetButton();
    if (emailCheckTimer) {
        clearTimeout(emailCheckTimer);
    }
    emailCheckTimer = setTimeout(() => {
        checkExistingCabinetByEmail();
    }, 350);
});

submitEmailInput?.addEventListener("blur", () => {
    checkExistingCabinetByEmail();
});

function validateAndPreviewFiles(files) {
    filePreview.innerHTML = "";
    Array.from(files).forEach((file) => {
        if (file.size < 250 * 1024) {
            console.warn(`Файл ${file.name} слишком маленький. Минимальный размер: 250 КБ`);
            photoInput.value = "";
            filePreview.innerHTML = "";
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                if (img.width < 2000) {
                    console.warn(`Ширина фото ${file.name} слишком маленькая. Минимум: 2000px. Ширина: ${img.width}px`);
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
        console.warn("Добавьте хотя бы одно фото");
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
        console.error(err.message);
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

function activityLabel(actionType) {
    const labels = {
        submission_created: "Создание заявки",
        submission_updated: "Обновление заявки",
        profile_created: "Создание профиля",
        profile_updated: "Редактирование профиля",
        photos_uploaded: "Загрузка фото",
        photo_deleted: "Удаление фото",
        photo_original_uploaded: "Загрузка оригинала",
        photo_original_deleted: "Удаление оригинала",
    };
    return labels[actionType] || actionType;
}

function fillActivityDistricts(districts) {
    if (!activityDistrictFilter) return;
    const selected = activityDistrictFilter.value;
    activityDistrictFilter.innerHTML = `<option value="">Все районы</option>`;
    (districts || []).forEach((district) => {
        const option = document.createElement("option");
        option.value = district;
        option.textContent = district;
        activityDistrictFilter.appendChild(option);
    });
    activityDistrictFilter.value = selected || "";
}

function renderActivityUserCell(item) {
    const profileUrl = item.profileUrl || "";
    const safeName = escapeHtml(item.name || "");
    const safeEmail = escapeHtml(item.email || "");
    if (!profileUrl) {
        return `${safeName}<br><small>${safeEmail}</small>`;
    }
    return `
        <a class="activity-link" href="${profileUrl}">${safeName || safeEmail}</a><br>
        <a class="activity-link-secondary" href="${profileUrl}">${safeEmail}</a>
    `;
}

function renderActivityDetailsCell(item) {
    const safeDetails = escapeHtml(item.details || "");
    if (!item.photoUrl) {
        return safeDetails;
    }
    return `
        ${safeDetails}
        <div class="activity-detail-links">
            <a class="activity-link" href="${item.photoUrl}" target="_blank" rel="noopener">Открыть фото</a>
        </div>
    `;
}

async function renderActivityList() {
    if (!activityList) return;
    try {
        const params = new URLSearchParams();
        if (activityDayFilter?.value) {
            params.set("day", activityDayFilter.value);
        }
        if (activityDistrictFilter?.value) {
            params.set("district", activityDistrictFilter.value);
        }

        const query = params.toString() ? `?${params.toString()}` : "";
        const data = await api(`/api/admin/activities${query}`);
        fillActivityDistricts(data.districts || []);

        const items = data.items || [];
        if (!items.length) {
            activityList.innerHTML = `<tr><td colspan="5">Нет активности по выбранным фильтрам</td></tr>`;
            return;
        }

        activityList.innerHTML = items.map((item) => `
            <tr>
                <td>${escapeHtml(item.createdAt || "")}</td>
                <td>${renderActivityUserCell(item)}</td>
                <td>${escapeHtml(item.district || "")}</td>
                <td>${escapeHtml(activityLabel(item.actionType))}</td>
                <td>${renderActivityDetailsCell(item)}</td>
            </tr>
        `).join("");
    } catch (err) {
        activityList.innerHTML = `<tr><td colspan="5">${escapeHtml(err.message)}</td></tr>`;
    }
}

function renderUserCards(submissions) {
    return submissions.map((sub) => `
        <div class="submission-card">
            <div class="user-photo-grid">
            ${(sub.photos || []).map((photo) => `
                <div class="user-photo-card">
                    <img src="${photo.url}" alt="Photo">
                    <div style="font-size: 13px; margin-top: 6px; color: var(--color-text-secondary);">
                        <span class="status-badge status-${photo.status || "pending"}">${photoStatusLabel(photo.status)}</span>
                        ${photo.comment ? `<div style="margin-top: 6px;"><strong>Комментарий:</strong> ${escapeHtml(photo.comment)}</div>` : ""}
                        <div class="photo-action-group">
                            ${photo.status === "approved" ? `
                                ${(!photo.originals || photo.originals.length === 0) ? `
                                    <input type="file" id="upload-originals-photo-${photo.id}" data-photo-id="${photo.id}" multiple style="display: none;">
                                    <button type="button" class="btn-mini btn-mini-primary" onclick="document.getElementById('upload-originals-photo-${photo.id}').click()">
                                        Загрузить оригинал
                                    </button>
                                ` : ""}
                            ` : ""}
                        </div>
                        ${photo.originals && photo.originals.length > 0 ? `
                            <div class="originals-list">
                                <div class="originals-title">Оригинал:</div>
                                ${photo.originals.map((orig) => `
                                    <div class="originals-item">
                                        <a href="${orig.url}" target="_blank" rel="noopener" class="original-link">${escapeHtml(orig.name)}</a>
                                        <span class="original-size">(${(orig.size / 1024 / 1024).toFixed(2)} МБ)</span>
                                        <button type="button" class="orig-delete-x" onclick="deleteOriginalFile(${orig.id})" title="Удалить оригинал">✕</button>
                                    </div>
                                `).join("")}
                            </div>
                        ` : ""}
                        <div class="photo-delete-row">
                            <button type="button" class="btn-mini btn-mini-muted" onclick="deleteUploadedPhoto(${photo.id})">
                                Удалить фото
                            </button>
                        </div>
                    </div>
                </div>
            `).join("")}
            </div>
            <div class="submission-info">
                <strong>ID:</strong> ${sub.id}<br>
                <strong>Дата:</strong> ${sub.createdAt}
            </div>
        </div>
    `).join("");
}

document.getElementById("check-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("check-email").value;
    const checkForm = document.getElementById("check-form");
    const resultDiv = document.getElementById("status-result");
    const cabinetBtn = document.getElementById("status-cabinet-btn");

    try {
        const submissions = await api(`/api/submissions?email=${encodeURIComponent(email)}`);
        if (!submissions.length) {
            checkForm.style.display = "";
            cabinetBtn.style.display = "none";
            resultDiv.innerHTML = `<div class="empty-state"><p>Заявки с таким email не найдены</p></div>`;
            return;
        }

        checkForm.style.display = "none";
        resultDiv.innerHTML = renderUserCards(submissions);
        cabinetBtn.style.display = "block";
        cabinetBtn.onclick = () => {
            window.location.href = `/user/${encodeURIComponent(email.trim().toLowerCase())}`;
        };
        submissions.forEach((sub) => {
            (sub.photos || []).forEach((photo) => {
                if (photo.status !== "approved") return;
                const uploadInput = document.getElementById(`upload-originals-photo-${photo.id}`);
                if (!uploadInput) return;
                uploadInput.addEventListener("change", async (event) => {
                    if (!event.target.files.length) return;
                    const fd = new FormData();
                    Array.from(event.target.files).forEach((file) => fd.append("originals", file));
                    try {
                        await api(`/api/photos/${photo.id}/originals`, { method: "POST", body: fd });
                        document.getElementById("check-form").dispatchEvent(new Event("submit", { cancelable: true }));
                    } catch (err) {
                        console.error(err.message);
                    }
                });
            });
        });
    } catch (err) {
        console.error(err.message);
    }
});

document.querySelectorAll(".filter-btn[data-filter]").forEach((btn) => {
    btn.addEventListener("click", async () => {
        document.querySelectorAll(".filter-btn[data-filter]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        await renderAdminList();
    });
});

activityApplyBtn?.addEventListener("click", async () => {
    await renderActivityList();
});

activityResetBtn?.addEventListener("click", async () => {
    if (activityDayFilter) activityDayFilter.value = "";
    if (activityDistrictFilter) activityDistrictFilter.value = "";
    await renderActivityList();
});

adminSectionSubmissionsBtn?.addEventListener("click", async () => {
    await setAdminSection("submissions");
});

adminSectionActivityBtn?.addEventListener("click", async () => {
    await setAdminSection("activity");
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
        console.error(err.message);
    }
}

window.reviewPhoto = reviewPhoto;

async function deletePhotoOriginals(photoId) {
    try {
        await api(`/api/photos/${photoId}/originals`, {
            method: "DELETE",
        });
        document.getElementById("check-form").dispatchEvent(new Event("submit", { cancelable: true }));
    } catch (err) {
        console.error(err.message);
    }
}

window.deletePhotoOriginals = deletePhotoOriginals;

async function deleteOriginalFile(originalId) {
    try {
        await api(`/api/originals/${originalId}`, {
            method: "DELETE",
        });
        document.getElementById("check-form").dispatchEvent(new Event("submit", { cancelable: true }));
    } catch (err) {
        console.error(err.message);
    }
}

window.deleteOriginalFile = deleteOriginalFile;

async function deleteUploadedPhoto(photoId) {
    try {
        await api(`/api/photos/${photoId}`, {
            method: "DELETE",
        });
        document.getElementById("check-form").dispatchEvent(new Event("submit", { cancelable: true }));
    } catch (err) {
        console.error(err.message);
    }
}

window.deleteUploadedPhoto = deleteUploadedPhoto;

async function savePhotoComment(fileId) {
    const commentEl = document.getElementById(`photo-comment-${fileId}`);
    const comment = commentEl ? commentEl.value : "";
    try {
        await api(`/api/admin/photos/${fileId}/comment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comment }),
        });
    } catch (err) {
        console.error(err.message);
    }
}

window.savePhotoComment = savePhotoComment;

async function renderAdminList() {
    const adminList = document.getElementById("admin-list");
    try {
        const rawSubmissions = await api("/api/admin/submissions?status=all");
        const submissions = (rawSubmissions || [])
            .map((sub) => {
                const photos = Array.isArray(sub.photos) ? sub.photos : [];
                const visiblePhotos = currentFilter === "all"
                    ? photos
                    : photos.filter((photo) => (photo.status || "pending") === currentFilter);
                return {
                    ...sub,
                    photos: visiblePhotos,
                };
            })
            .filter((sub) => sub.photos.length > 0);

        if (!submissions.length) {
            adminList.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <h3>Нет фото</h3>
                    <p>Фото с выбранным статусом не найдены</p>
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
                        <button class="photo-save" type="button" onclick="savePhotoComment(${photo.id})">Сохранить комментарий</button>
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

                ${currentFilter === "all" ? `<span class="status-badge status-${sub.status}">${statusLabel(sub.status)}</span>` : ""}

                ${sub.originals && sub.originals.length > 0 ? `
                    <div style="margin-top: 10px; padding: 10px; background: var(--color-bg-muted); border-radius: 6px;">
                        <strong style="color: var(--color-primary);">Оригинал (${sub.originals.length}):</strong><br>
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
    const shouldOpenAdmin = isAdminRoute || window.location.pathname === "/admin";

    if (shouldOpenAdmin) {
        const ok = await ensureAdminAccess();
        if (ok) {
            document.getElementById("admin-tab-btn").click();
        }
    }
})();
