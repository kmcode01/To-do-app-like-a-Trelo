import "./attachment-editor.css";

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

const SUPPORTED_EXTENSIONS = new Set(["pdf", "zip", "doc", "docx", "png", "jpg", "jpeg", "webp"]);

const DEFAULT_ACCEPT =
  ".pdf,.zip,.doc,.docx,.png,.jpg,.jpeg,.webp,application/pdf,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "-";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function getExtension(name) {
  const parts = String(name || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function isImageType(mimeType, name) {
  if (mimeType && mimeType.startsWith("image/")) {
    return true;
  }

  const extension = getExtension(name);
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(extension);
}

function isSupportedFile(file) {
  if (file.type && file.type.startsWith("image/")) {
    return true;
  }

  if (SUPPORTED_MIME_TYPES.has(file.type)) {
    return true;
  }

  const extension = getExtension(file.name);
  return SUPPORTED_EXTENSIONS.has(extension);
}

function getFileIconMarkup() {
  return `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="#4d636b"
        d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5"
      />
    </svg>
  `;
}

export function renderAttachmentEditor({
  inputId = "task-attachments",
  label = "Attachments",
  hint = "PDF, DOCX, ZIP, images (PNG, JPG, WEBP)."
} = {}) {
  return `
    <section class="attachment-editor" data-attachment-editor>
      <div class="attachment-header">
        <p class="attachment-title">${escapeHtml(label)}</p>
        <label class="attachment-upload" for="${escapeHtml(inputId)}">
          Attach files
          <input
            id="${escapeHtml(inputId)}"
            type="file"
            multiple
            accept="${DEFAULT_ACCEPT}"
            data-attachment-input
          />
        </label>
      </div>
      <p class="attachment-hint">${escapeHtml(hint)}</p>
      <p class="attachment-message" data-attachment-message role="status" aria-live="polite"></p>
      <div class="attachment-list" data-attachment-list></div>
    </section>
  `;
}

export function createAttachmentEditor(root) {
  if (!root) {
    throw new Error("Attachment editor root element is required.");
  }

  const input = root.querySelector("[data-attachment-input]");
  const list = root.querySelector("[data-attachment-list]");
  const messageEl = root.querySelector("[data-attachment-message]");

  if (!input || !list || !messageEl) {
    throw new Error("Attachment editor markup is missing required elements.");
  }

  let existingAttachments = [];
  let baselineAttachments = [];
  let pendingUploads = [];
  const pendingRemovals = new Set();

  function showMessage(text, isError = false) {
    messageEl.textContent = text || "";
    messageEl.classList.toggle("is-error", isError);
  }

  function revokePreviewUrls(uploads) {
    uploads.forEach((item) => {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
  }

  function renderList() {
    const visibleExisting = existingAttachments.filter(
      (attachment) => !pendingRemovals.has(attachment.id)
    );

    if (!visibleExisting.length && !pendingUploads.length) {
      list.innerHTML = '<p class="attachment-empty">No attachments yet.</p>';
      return;
    }

    const items = [];

    visibleExisting.forEach((attachment) => {
      const isImage = Boolean(attachment.isImage);
      const previewUrl = attachment.previewUrl || attachment.downloadUrl || "";
      const thumb = isImage && previewUrl
        ? `<a class="attachment-thumb" href="${escapeHtml(previewUrl)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(attachment.file_name)} preview" /></a>`
        : `<span class="attachment-icon">${getFileIconMarkup()}</span>`;
      const nameMarkup = previewUrl
        ? `<a class="attachment-name" href="${escapeHtml(previewUrl)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.file_name)}</a>`
        : `<span class="attachment-name">${escapeHtml(attachment.file_name)}</span>`;

      items.push(`
        <div class="attachment-item" data-attachment-id="${escapeHtml(attachment.id)}">
          <div class="attachment-meta">
            ${thumb}
            <div class="attachment-details">
              ${nameMarkup}
              <span class="attachment-size">${escapeHtml(formatFileSize(attachment.size))}</span>
            </div>
          </div>
          <button class="attachment-remove" type="button" data-attachment-remove data-attachment-id="${escapeHtml(attachment.id)}">Remove</button>
        </div>
      `);
    });

    pendingUploads.forEach((upload) => {
      const thumb = upload.isImage
        ? `<span class="attachment-thumb"><img src="${escapeHtml(upload.previewUrl)}" alt="${escapeHtml(upload.file.name)} preview" /></span>`
        : `<span class="attachment-icon">${getFileIconMarkup()}</span>`;

      items.push(`
        <div class="attachment-item" data-upload-id="${escapeHtml(upload.id)}">
          <div class="attachment-meta">
            ${thumb}
            <div class="attachment-details">
              <span class="attachment-name">${escapeHtml(upload.file.name)}</span>
              <span class="attachment-size">${escapeHtml(formatFileSize(upload.file.size))}</span>
            </div>
          </div>
          <button class="attachment-remove" type="button" data-attachment-remove data-upload-id="${escapeHtml(upload.id)}">Remove</button>
        </div>
      `);
    });

    list.innerHTML = items.join("");
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) {
      return;
    }

    const supported = [];
    const unsupported = [];

    files.forEach((file) => {
      if (isSupportedFile(file)) {
        supported.push(file);
      } else {
        unsupported.push(file.name || "Unknown file");
      }
    });

    if (unsupported.length) {
      showMessage(`Unsupported files: ${unsupported.join(", ")}.`, true);
    } else {
      showMessage("");
    }

    supported.forEach((file) => {
      const duplicate = pendingUploads.some(
        (upload) => upload.file.name === file.name && upload.file.size === file.size
      );
      if (duplicate) {
        return;
      }

      const previewUrl = isImageType(file.type, file.name) ? URL.createObjectURL(file) : "";
      pendingUploads.push({
        id: crypto.randomUUID(),
        file,
        previewUrl,
        isImage: isImageType(file.type, file.name)
      });
    });

    renderList();
  }

  input.addEventListener("change", (event) => {
    const target = event.target;
    addFiles(target.files);
    target.value = "";
  });

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-attachment-remove]");
    if (!button) {
      return;
    }

    const attachmentId = button.dataset.attachmentId;
    const uploadId = button.dataset.uploadId;

    if (attachmentId) {
      pendingRemovals.add(attachmentId);
      renderList();
      return;
    }

    if (uploadId) {
      const nextUploads = pendingUploads.filter((upload) => upload.id !== uploadId);
      const removed = pendingUploads.filter((upload) => upload.id === uploadId);
      revokePreviewUrls(removed);
      pendingUploads = nextUploads;
      renderList();
    }
  });

  function setExistingAttachments(attachments) {
    revokePreviewUrls(pendingUploads);
    existingAttachments = Array.isArray(attachments) ? attachments : [];
    baselineAttachments = existingAttachments.map((attachment) => ({ ...attachment }));
    pendingUploads = [];
    pendingRemovals.clear();
    showMessage("");
    renderList();
  }

  function reset() {
    setExistingAttachments(baselineAttachments);
  }

  function clear() {
    setExistingAttachments([]);
  }

  function getPendingChanges() {
    const deletions = existingAttachments.filter((attachment) =>
      pendingRemovals.has(attachment.id)
    );

    return {
      uploads: [...pendingUploads],
      deletions
    };
  }

  renderList();

  return {
    setExistingAttachments,
    reset,
    clear,
    getPendingChanges
  };
}
