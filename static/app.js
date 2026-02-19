let currentFilter = "pending";
let modalScale = 1;
let modalOffsetX = 0;
let modalOffsetY = 0;
let isModalDragging = false;
let modalDragStartX = 0;
let modalDragStartY = 0;
let modalOriginalUrl = "";
const isAdminRoute = Boolean(window.APP_CONTEXT && window.APP_CONTEXT.adminMode);

const modal = document.getElementById("photo-modal");
const modalImage = document.getElementById("photo-modal-image");
const modalStage = document.getElementById("photo-modal-stage");
const modalClose = document.getElementById("photo-modal-close");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const savePhotoBtn = document.getElementById("save-photo-btn");
const openNewTabBtn = document.getElementById("open-new-tab-btn");
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
    applyModalTransform();
    zoomResetBtn.textContent = `${Math.round(modalScale * 100)}%`;
}

function applyModalTransform() {
    modalImage.style.transform = `translate(${modalOffsetX}px, ${modalOffsetY}px) scale(${modalScale})`;
}

function openPhotoModal(src) {
    if (!src) return;
    modalOriginalUrl = src;
    modalImage.src = src;
    modalOffsetX = 0;
    modalOffsetY = 0;
    setModalScale(1);
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
}

function closePhotoModal() {
    modal.classList.remove("open");
    modalImage.src = "";
    modalOriginalUrl = "";
    document.body.style.overflow = "";
    isModalDragging = false;
}

function beginModalDrag(clientX, clientY) {
    if (!modal.classList.contains("open")) return;
    if (modalScale <= 1) return;
    isModalDragging = true;
    modalDragStartX = clientX - modalOffsetX;
    modalDragStartY = clientY - modalOffsetY;
    modalImage.style.cursor = "grabbing";
}

function moveModalDrag(clientX, clientY) {
    if (!isModalDragging) return;
    modalOffsetX = clientX - modalDragStartX;
    modalOffsetY = clientY - modalDragStartY;
    applyModalTransform();
}

function endModalDrag() {
    if (!isModalDragging) return;
    isModalDragging = false;
    modalImage.style.cursor = modalScale > 1 ? "grab" : "";
}

zoomInBtn.addEventListener("click", () => setModalScale(modalScale + 0.2));
zoomOutBtn.addEventListener("click", () => setModalScale(modalScale - 0.2));
zoomResetBtn.addEventListener("click", () => setModalScale(1));
openNewTabBtn?.addEventListener("click", () => {
    if (!modalOriginalUrl) return;
    window.open(modalOriginalUrl, "_blank", "noopener,noreferrer");
});
savePhotoBtn?.addEventListener("click", () => {
    if (!modalOriginalUrl) return;
    const directUrl = modalOriginalUrl.split("?")[0];
    const fallbackName = "photo.jpg";
    const fileName = decodeURIComponent((directUrl.split("/").pop() || fallbackName).trim()) || fallbackName;
    const link = document.createElement("a");
    link.href = modalOriginalUrl;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
});
modalClose.addEventListener("click", closePhotoModal);
modalImage.addEventListener("mousedown", (e) => {
    beginModalDrag(e.clientX, e.clientY);
});
document.addEventListener("mousemove", (e) => {
    moveModalDrag(e.clientX, e.clientY);
});
document.addEventListener("mouseup", () => {
    endModalDrag();
});
modalImage.addEventListener("touchstart", (e) => {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    beginModalDrag(touch.clientX, touch.clientY);
}, { passive: true });
modalImage.addEventListener("touchmove", (e) => {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    if (isModalDragging) {
        e.preventDefault();
    }
    moveModalDrag(touch.clientX, touch.clientY);
}, { passive: false });
modalImage.addEventListener("touchend", () => {
    endModalDrag();
});
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
modalStage?.addEventListener("wheel", (e) => {
    if (!modal.classList.contains("open")) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    setModalScale(modalScale + delta);
}, { passive: false });

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
const submitForm = document.getElementById("submit-form");
const submitUploadStatus = document.getElementById("submit-upload-status");
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

    const submitBtn = submitForm?.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Загрузка...";
    }
    if (submitUploadStatus) {
        submitUploadStatus.style.display = "block";
    }

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
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Отправить на проверку";
        }
        if (submitUploadStatus) {
            submitUploadStatus.style.display = "none";
        }
    }
});

function statusLabel(status) {
    if (status === "pending") return "⏳ На проверке";
    if (status === "approved") return "✅ Одобрено";
    return "❌ Запросить новое фото";
}

function photoStatusLabel(status) {
    if (status === "deleted") return "🗑 В корзине";
    if (status === "approved") return "✅ Одобрено";
    if (status === "rejected") return "❌ Отклонено";
    return "⏳ На проверке";
}

function formatPhotoSize(bytes) {
    const size = Number(bytes || 0);
    if (!size) return "0 МБ";
    return `${(size / 1024 / 1024).toFixed(2)} МБ`;
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
                    <img src="${photo.thumbUrl || photo.url}" alt="Photo" onclick="openPhotoModal('${photo.url}')">
                    <div style="font-size: 13px; margin-top: 6px; color: var(--color-text-secondary);">
                        <div><strong>Размер:</strong> ${formatPhotoSize(photo.size)}</div>
                        <div><strong>Дата:</strong> ${escapeHtml(sub.createdAt || "")}</div>
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
        const adminTab = document.getElementById("admin-tab");
        const isAdminActive = isAdminRoute || Boolean(adminTab && adminTab.classList.contains("active"));
        if (isAdminActive) {
            await renderAdminList();
            return;
        }
        document.getElementById("check-form")?.dispatchEvent(new Event("submit", { cancelable: true }));
    } catch (err) {
        console.error(err.message);
    }
}

window.deleteUploadedPhoto = deleteUploadedPhoto;

async function purgeDeletedPhoto(photoId) {
    try {
        await api(`/api/photos/${photoId}/purge`, {
            method: "POST",
        });
        await renderAdminList();
    } catch (err) {
        console.error(err.message);
    }
}

window.purgeDeletedPhoto = purgeDeletedPhoto;

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
                const visiblePhotos = photos.filter((photo) => {
                    const isDeleted = Boolean(photo.isDeleted);
                    if (currentFilter === "trash") return isDeleted;
                    if (isDeleted) return false;
                    if (currentFilter === "all") return true;
                    return (photo.status || "pending") === currentFilter;
                });
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

        adminList.innerHTML = submissions.map((sub) => currentFilter === "approved" ? `
            <div class="submission-card submission-card-approved-list" data-photo-count="${(sub.photos || []).length}">
                ${(sub.photos || []).map((photo) => `
                    <div class="approved-photo-row admin-photo-item">
                        <button
                            type="button"
                            class="btn-delete-corner"
                            onclick="${photo.isDeleted ? `purgeDeletedPhoto(${photo.id})` : `deleteUploadedPhoto(${photo.id})`}"
                            title="${photo.isDeleted ? "Удалить навсегда" : "Удалить фото"}"
                        >✕</button>
                        <img
                            src="${photo.thumbUrl || photo.url}"
                            alt="Photo"
                            class="admin-photo-thumb approved-photo-thumb"
                            onclick="openPhotoModal('${photo.url}')"
                        >
                        <div class="approved-photo-meta">
                            <span class="status-badge ${photo.isDeleted ? "status-deleted" : `status-${photo.status}`}">${photoStatusLabel(photo.isDeleted ? "deleted" : photo.status)}</span>
                            <div style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px;">
                                <div><strong>Размер:</strong> ${formatPhotoSize(photo.size)}</div>
                                <div><strong>Дата:</strong> ${escapeHtml(sub.createdAt || "")}</div>
                            </div>
                            ${photo.comment ? `<div class="approved-comment-box">${escapeHtml(photo.comment)}</div>` : ""}
                            ${photo.isDeleted ? `` : `
                                <div class="photo-actions photo-actions-compact">
                                    <button class="btn-reject btn-reject-compact" onclick="reviewPhoto(${photo.id}, 'rejected')">Отклонить</button>
                                </div>
                            `}
                            ${photo.originals && photo.originals.length > 0 ? `
                                <div class="originals-list">
                                    <div class="originals-title">Оригинал:</div>
                                    ${photo.originals.map((orig) => `
                                        <div class="originals-item">
                                            <a href="${orig.url}" target="_blank" rel="noopener" class="original-link">${escapeHtml(orig.name)}</a>
                                            <span class="original-size">(${(orig.size / 1024 / 1024).toFixed(2)} МБ)</span>
                                        </div>
                                    `).join("")}
                                </div>
                            ` : ""}
                        </div>
                        <div class="submission-info">
                            <div class="submission-info-card">
                                <strong>Район:</strong> ${escapeHtml(sub.district)}<br>
                                <strong>Email:</strong> <a class="activity-link-secondary" href="/user/${encodeURIComponent(sub.email)}">${escapeHtml(sub.email)}</a><br>
                                <strong>Дата:</strong> ${escapeHtml(sub.createdAt)}
                            </div>
                        </div>
                    </div>
                `).join("")}
            </div>
        ` : `
            <div class="submission-card" data-photo-count="${(sub.photos || []).length}">
                <div class="submission-main">
                    <div class="submission-photos">
                        ${(sub.photos || []).map((photo) => `
                            <div class="admin-photo-item">
                                <button
                                    type="button"
                                    class="btn-delete-corner"
                                    onclick="${photo.isDeleted ? `purgeDeletedPhoto(${photo.id})` : `deleteUploadedPhoto(${photo.id})`}"
                                    title="${photo.isDeleted ? "Удалить навсегда" : "Удалить фото"}"
                                >✕</button>
                                <img
                                    src="${photo.thumbUrl || photo.url}"
                                    alt="Photo"
                                    class="admin-photo-thumb"
                                    style="margin-bottom: 8px;"
                                    onclick="openPhotoModal('${photo.url}')"
                                >
                                <span class="status-badge ${photo.isDeleted ? "status-deleted" : `status-${photo.status}`}">${photoStatusLabel(photo.isDeleted ? "deleted" : photo.status)}</span>
                                <div style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px;">
                                    <div><strong>Размер:</strong> ${formatPhotoSize(photo.size)}</div>
                                    <div><strong>Дата:</strong> ${escapeHtml(sub.createdAt || "")}</div>
                                    ${photo.isDeleted && photo.deletedAt ? `<div><strong>Удалено:</strong> ${escapeHtml(photo.deletedAt)}</div>` : ""}
                                </div>
                                ${photo.isDeleted ? `
                                    
                                ` : `
                                    <div class="photo-actions">
                                        ${photo.status !== "approved" ? `<button class="btn-approve" onclick="reviewPhoto(${photo.id}, 'approved')">Одобрить</button>` : ""}
                                        ${photo.status !== "rejected" ? `<button class="btn-reject" onclick="reviewPhoto(${photo.id}, 'rejected')">Отклонить</button>` : ""}
                                    </div>
                                    ${photo.status === "approved"
                                        ? (photo.comment
                                            ? `
                                                <textarea class="photo-comment photo-comment-readonly" id="photo-comment-${photo.id}" readonly>${escapeHtml(photo.comment || "")}</textarea>
                                            `
                                            : "")
                                        : `
                                            <textarea
                                                class="photo-comment"
                                                id="photo-comment-${photo.id}"
                                                placeholder="Комментарий по этому фото"
                                            >${escapeHtml(photo.comment || "")}</textarea>
                                        `
                                    }
                                `}
                                ${photo.originals && photo.originals.length > 0 ? `
                                    <div class="originals-list">
                                        <div class="originals-title">Оригинал:</div>
                                        ${photo.originals.map((orig) => `
                                            <div class="originals-item">
                                                <a href="${orig.url}" target="_blank" rel="noopener" class="original-link">${escapeHtml(orig.name)}</a>
                                                <span class="original-size">(${(orig.size / 1024 / 1024).toFixed(2)} МБ)</span>
                                            </div>
                                        `).join("")}
                                    </div>
                                ` : ""}
                            </div>
                        `).join("")}
                    </div>

                    <div class="submission-info">
                        <div class="submission-info-card">
                            <strong>Район:</strong> ${escapeHtml(sub.district)}<br>
                            <strong>Email:</strong> <a class="activity-link-secondary" href="/user/${encodeURIComponent(sub.email)}">${escapeHtml(sub.email)}</a><br>
                            <strong>Дата:</strong> ${escapeHtml(sub.createdAt)}
                        </div>
                    </div>
                </div>

            </div>
        `).join("");
    } catch (err) {
        adminList.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><p>${escapeHtml(err.message)}</p></div>`;
    }
}

(async function init() {
    const shouldOpenAdmin = isAdminRoute || window.location.pathname === "/admin";

    if (shouldOpenAdmin) {
        document.querySelectorAll(".filter-btn[data-filter]").forEach((b) => b.classList.remove("active"));
        const pendingBtn = document.querySelector('.filter-btn[data-filter="pending"]');
        pendingBtn?.classList.add("active");
        currentFilter = "pending";
        const ok = await ensureAdminAccess();
        if (ok) {
            document.getElementById("admin-tab-btn").click();
        }
    }
})();
