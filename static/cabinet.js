let currentUser = null;
let modalScale = 1;
let isProfileOpen = false;
const isAdminView = Boolean(window.CABINET_CONTEXT && window.CABINET_CONTEXT.adminView);

const emailForm = document.getElementById("email-form");
const cabinetContent = document.getElementById("cabinet-content");
const profilePanel = document.getElementById("profile-panel");
const profileToggleBtn = document.getElementById("profile-toggle-btn");
const adminViewTitle = document.getElementById("admin-view-title");
const profileForm = document.getElementById("profile-form");
const uploadForm = document.getElementById("upload-form");
const cabinetFileUpload = document.getElementById("cabinet-file-upload");
const cabinetPhotoInput = document.getElementById("cabinet-photo-input");
const cabinetFilePreview = document.getElementById("cabinet-file-preview");
const photosList = document.getElementById("photos-list");
const photosTitle = document.getElementById("photos-title");
const uploadSection = document.getElementById("upload-section");
const logoutBtn = document.getElementById("logout-btn");

const modal = document.getElementById("photo-modal");
const modalImage = document.getElementById("photo-modal-image");
const modalStage = document.querySelector(".photo-modal-stage");
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

function setProfilePanelOpen(open) {
    isProfileOpen = Boolean(open);
    if (profilePanel) {
        profilePanel.style.display = isProfileOpen ? "block" : "none";
    }
    if (profileToggleBtn) {
        profileToggleBtn.textContent = isProfileOpen ? "Скрыть профиль" : "Профиль пользователя";
    }
}

function applyAdminViewMode(user) {
    if (!isAdminView) return;
    if (adminViewTitle) {
        adminViewTitle.style.display = "block";
    }

    if (uploadSection) {
        uploadSection.style.display = "none";
    }

    const profileSubmitBtn = profileForm?.querySelector('button[type="submit"]');
    if (profileSubmitBtn) {
        profileSubmitBtn.style.display = "none";
    }

    const fields = profileForm?.querySelectorAll("input, select, textarea") || [];
    fields.forEach((el) => {
        if (el.id === "profile-email") return;
        el.setAttribute("disabled", "disabled");
    });

    if (photosTitle) {
        const who = (user && user.name ? user.name.trim() : "") || (user && user.email ? user.email : "");
        photosTitle.textContent = who ? `Фото /${who}/` : "Фото пользователя";
    }
    setProfilePanelOpen(false);
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
        reader.readAsDataURL(file);
    });
}

function loadImageMeta(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.width, height: image.height });
        image.onerror = () => reject(new Error("Файл не является изображением"));
        image.src = src;
    });
}

async function validateAndPreviewCabinetFiles(files) {
    if (!cabinetFilePreview) return false;
    cabinetFilePreview.innerHTML = "";

    for (const file of Array.from(files)) {
        if (file.size < 250 * 1024) {
            alert(`❌ Файл ${file.name} слишком маленький. Минимум 250 КБ`);
            if (cabinetPhotoInput) cabinetPhotoInput.value = "";
            cabinetFilePreview.innerHTML = "";
            return false;
        }

        try {
            const src = await readFileAsDataUrl(file);
            const meta = await loadImageMeta(src);

            if (meta.width < 2000) {
                alert(`❌ Ширина фото ${file.name} меньше 2000px`);
                if (cabinetPhotoInput) cabinetPhotoInput.value = "";
                cabinetFilePreview.innerHTML = "";
                return false;
            }

            const preview = document.createElement("div");
            preview.style.marginTop = "12px";
            preview.innerHTML = `
                <img src="${src}" alt="Preview" style="max-width: 100%; max-height: 200px; border-radius: 8px; border: 2px solid var(--color-border);">
                <p style="margin-top: 5px; color: var(--color-text-muted); font-size: 14px;">
                    ${escapeHtml(file.name)} (${(file.size / 1024 / 1024).toFixed(2)} МБ) - ${meta.width}x${meta.height}px
                </p>
            `;
            cabinetFilePreview.appendChild(preview);
        } catch (err) {
            alert(`❌ ${file.name}: ${err.message}`);
            if (cabinetPhotoInput) cabinetPhotoInput.value = "";
            cabinetFilePreview.innerHTML = "";
            return false;
        }
    }

    return true;
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

profileToggleBtn?.addEventListener("click", () => {
    setProfilePanelOpen(!isProfileOpen);
});

cabinetFileUpload?.addEventListener("click", () => cabinetPhotoInput?.click());

cabinetFileUpload?.addEventListener("dragover", (e) => {
    e.preventDefault();
    cabinetFileUpload.style.borderColor = "var(--color-primary)";
});

cabinetFileUpload?.addEventListener("dragleave", () => {
    cabinetFileUpload.style.borderColor = "var(--color-border)";
});

cabinetFileUpload?.addEventListener("drop", async (e) => {
    e.preventDefault();
    cabinetFileUpload.style.borderColor = "var(--color-border)";
    if (e.dataTransfer.files.length && cabinetPhotoInput) {
        cabinetPhotoInput.files = e.dataTransfer.files;
        await validateAndPreviewCabinetFiles(e.dataTransfer.files);
    }
});

cabinetPhotoInput?.addEventListener("change", async (e) => {
    if (e.target.files.length) {
        await validateAndPreviewCabinetFiles(e.target.files);
    }
});

function photoStatusLabel(status) {
    if (status === "approved") return "✅ Одобрено";
    if (status === "rejected") return "❌ Отклонено";
    return "⏳ На проверке";
}

function renderPhotos(user) {
    const photos = user.photos || [];
    if (!photos.length) {
        photosList.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><p>Пока нет загруженных фото</p></div>`;
        return;
    }

    photosList.innerHTML = photos.map((photo) => `
        <div class="submission-card user-photo-card">
            <img src="${photo.url}" alt="Photo" class="admin-photo-thumb" onclick="window.openPhotoModal('${photo.url}')">
            <div class="submission-info">
                <strong>Файл:</strong> ${escapeHtml(photo.name)}<br>
                <strong>Статус:</strong>
                <span class="status-badge status-${photo.status || "pending"}">${photoStatusLabel(photo.status)}</span>
                ${photo.comment ? `<br><strong>Комментарий:</strong> ${escapeHtml(photo.comment)}` : ""}
                <div class="photo-actions-title">Действия:</div>
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
                <div class="photo-action-note">Удаление фото удаляет и его оригиналы.</div>
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
    `).join("");

    photos.forEach((photo) => {
        if (photo.status !== "approved") return;
        const uploadInput = document.getElementById(`upload-originals-photo-${photo.id}`);
        if (!uploadInput) return;
        uploadInput.addEventListener("change", async (event) => {
            if (!event.target.files.length) return;
            const fd = new FormData();
            Array.from(event.target.files).forEach((file) => fd.append("originals", file));
            try {
                const result = await api(`/api/photos/${photo.id}/originals`, {
                    method: "POST",
                    body: fd,
                });
                currentUser = result.submission;
                renderPhotos(currentUser);
                alert("✅ Оригиналы загружены");
            } catch (err) {
                alert("❌ " + err.message);
            }
        });
    });
}

function fillProfile(user) {
    document.getElementById("profile-email").value = user.email || "";
    document.getElementById("profile-name").value = user.name || "";
    document.getElementById("profile-district").value = user.district || "";
    document.getElementById("profile-phone").value = user.phone || "";
    document.getElementById("profile-comment").value = user.comment || "";
}

async function loadUser(email) {
    try {
        currentUser = await api(`/api/users/${encodeURIComponent(email)}`);
        fillProfile(currentUser);
        applyAdminViewMode(currentUser);
        renderPhotos(currentUser);
    } catch (err) {
        if (err.message === "Пользователь не найден") {
            currentUser = {
                email,
                name: "",
                district: "",
                phone: "",
                comment: "",
                photos: [],
            };
            fillProfile(currentUser);
            renderPhotos(currentUser);
            setProfilePanelOpen(true);
            return;
        }
        alert("❌ " + err.message);
    }
}

emailForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("cabinet-email-input").value.trim().toLowerCase();
    if (!email) return;
    window.location.href = `/user/${encodeURIComponent(email)}`;
});

logoutBtn?.addEventListener("click", () => {
    closePhotoModal();
    currentUser = null;
    window.location.href = "/";
});

profileForm.addEventListener("submit", async (e) => {
    if (isAdminView) {
        e.preventDefault();
        return;
    }
    e.preventDefault();
    const email = document.getElementById("profile-email").value.trim().toLowerCase();
    const payload = {
        name: document.getElementById("profile-name").value.trim(),
        district: document.getElementById("profile-district").value,
        phone: document.getElementById("profile-phone").value.trim(),
        comment: document.getElementById("profile-comment").value.trim(),
    };

    try {
        const result = await api(`/api/users/${encodeURIComponent(email)}/profile`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        currentUser = result.user;
        fillProfile(currentUser);
        renderPhotos(currentUser);
        alert("✅ Данные сохранены");
    } catch (err) {
        alert("❌ " + err.message);
    }
});

uploadForm.addEventListener("submit", async (e) => {
    if (isAdminView) {
        e.preventDefault();
        return;
    }
    e.preventDefault();
    const files = Array.from(cabinetPhotoInput?.files || []);
    if (!files.length) {
        alert("Выберите фото");
        return;
    }
    const valid = await validateAndPreviewCabinetFiles(files);
    if (!valid) {
        return;
    }

    const email = document.getElementById("profile-email").value.trim().toLowerCase();
    const fd = new FormData();
    files.forEach((f) => fd.append("photos", f));

    try {
        const result = await api(`/api/users/${encodeURIComponent(email)}/photos`, {
            method: "POST",
            body: fd,
        });
        currentUser = result.user;
        renderPhotos(currentUser);
        cabinetPhotoInput.value = "";
        cabinetFilePreview.innerHTML = "";
        alert("✅ Фото загружены");
    } catch (err) {
        alert("❌ " + err.message);
    }
});

window.openPhotoModal = openPhotoModal;

async function deletePhotoOriginals(photoId) {
    try {
        const result = await api(`/api/photos/${photoId}/originals`, {
            method: "DELETE",
        });
        currentUser = result.submission;
        renderPhotos(currentUser);
        alert("✅ Оригинал удален");
    } catch (err) {
        alert("❌ " + err.message);
    }
}

window.deletePhotoOriginals = deletePhotoOriginals;

async function deleteOriginalFile(originalId) {
    try {
        const result = await api(`/api/originals/${originalId}`, {
            method: "DELETE",
        });
        currentUser = result.submission;
        renderPhotos(currentUser);
        alert("✅ Оригинал удален");
    } catch (err) {
        alert("❌ " + err.message);
    }
}

window.deleteOriginalFile = deleteOriginalFile;

async function deleteUploadedPhoto(photoId) {
    if (!confirm("Удалить это фото? Оригиналы, привязанные к фото, тоже будут удалены.")) {
        return;
    }
    try {
        const result = await api(`/api/photos/${photoId}`, {
            method: "DELETE",
        });
        currentUser = result.submission;
        renderPhotos(currentUser);
        alert("✅ Фото удалено");
    } catch (err) {
        alert("❌ " + err.message);
    }
}

window.deleteUploadedPhoto = deleteUploadedPhoto;

(async function init() {
    const initialEmail = (window.CABINET_CONTEXT && window.CABINET_CONTEXT.userEmail) || "";
    if (!initialEmail) return;
    cabinetContent.style.display = "block";
    emailForm.style.display = "none";
    setProfilePanelOpen(false);
    document.getElementById("profile-email").value = initialEmail;
    await loadUser(initialEmail);
})();
