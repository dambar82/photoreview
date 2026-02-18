let currentUser = null;
let modalScale = 1;

const emailForm = document.getElementById("email-form");
const cabinetContent = document.getElementById("cabinet-content");
const profileForm = document.getElementById("profile-form");
const uploadForm = document.getElementById("upload-form");
const photosInput = document.getElementById("cabinet-photos");
const photosList = document.getElementById("photos-list");
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
        <div class="submission-card">
            <img src="${photo.url}" alt="Photo" class="admin-photo-thumb" onclick="window.openPhotoModal('${photo.url}')">
            <div class="submission-info">
                <strong>Файл:</strong> ${escapeHtml(photo.name)}<br>
                <strong>Статус:</strong> ${photoStatusLabel(photo.status)}
                ${photo.comment ? `<br><strong>Комментарий:</strong> ${escapeHtml(photo.comment)}` : ""}
            </div>
        </div>
    `).join("");
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
    window.location.href = "/user";
});

profileForm.addEventListener("submit", async (e) => {
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
    e.preventDefault();
    const files = Array.from(photosInput.files || []);
    if (!files.length) {
        alert("Выберите фото");
        return;
    }
    for (const file of files) {
        if (file.size < 250 * 1024) {
            alert(`❌ Файл ${file.name} слишком маленький. Минимум 250 КБ`);
            return;
        }
        const imageUrl = URL.createObjectURL(file);
        const img = new Image();
        const dimensionsOk = await new Promise((resolve) => {
            img.onload = () => resolve(img.width >= 2000);
            img.onerror = () => resolve(false);
            img.src = imageUrl;
        });
        URL.revokeObjectURL(imageUrl);
        if (!dimensionsOk) {
            alert(`❌ Ширина фото ${file.name} меньше 2000px`);
            return;
        }
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
        photosInput.value = "";
        alert("✅ Фото загружены");
    } catch (err) {
        alert("❌ " + err.message);
    }
});

window.openPhotoModal = openPhotoModal;

(async function init() {
    const initialEmail = (window.CABINET_CONTEXT && window.CABINET_CONTEXT.userEmail) || "";
    if (!initialEmail) return;
    cabinetContent.style.display = "block";
    emailForm.style.display = "none";
    document.getElementById("profile-email").value = initialEmail;
    await loadUser(initialEmail);
})();
