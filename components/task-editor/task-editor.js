import { createAttachmentEditor, renderAttachmentEditor } from "../attachment-editor/attachment-editor.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderTaskEditorDialog({
  dialogAttr,
  formAttr,
  title,
  submitLabel,
  cancelLabel = "Cancel",
  messageAttr,
  submitAttr,
  cancelAttr,
  mode,
  stageOptions = ""
} = {}) {
  const prefix = mode === "edit" ? "edit-task" : "task";
  const showStage = mode === "create";
  const showPriority = mode === "edit";
  const showStatus = mode === "edit";

  return `
    <dialog class="task-dialog" ${dialogAttr || ""}>
      <form class="dialog-body" data-task-editor-form ${formAttr || ""} method="dialog">
        <h2>${escapeHtml(title || "Task")}</h2>
        <div class="field">
          <label for="${prefix}-title">Title</label>
          <input
            id="${prefix}-title"
            name="title"
            type="text"
            maxlength="140"
            required
            data-task-editor-title
          />
        </div>
        <div class="field">
          <label for="${prefix}-description">Description</label>
          <textarea
            id="${prefix}-description"
            name="description"
            maxlength="1000"
            data-task-editor-description
          ></textarea>
        </div>
        ${
          showPriority
            ? `
        <div class="field">
          <label for="${prefix}-priority">Priority</label>
          <select id="${prefix}-priority" name="priority" required data-task-editor-priority>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>`
            : ""
        }
        ${
          showStatus
            ? `
        <div class="field">
          <label>Status</label>
          <div class="segmented" role="tablist">
            <input
              type="radio"
              id="${prefix}-status-open"
              name="${prefix}-status"
              value="open"
              data-task-editor-status-open
            >
            <label for="${prefix}-status-open">Open</label>
            <input
              type="radio"
              id="${prefix}-status-closed"
              name="${prefix}-status"
              value="done"
              data-task-editor-status-closed
            >
            <label for="${prefix}-status-closed">Closed</label>
          </div>
        </div>`
            : ""
        }
        ${
          showStage
            ? `
        <div class="field">
          <label for="${prefix}-stage">Stage</label>
          <select id="${prefix}-stage" name="stage" required data-task-editor-stage>
            ${stageOptions}
          </select>
        </div>`
            : ""
        }
        ${renderAttachmentEditor({ inputId: `${prefix}-attachments` })}
        <p class="message" data-task-editor-message ${messageAttr || ""} role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button class="btn-secondary" type="button" data-task-editor-cancel ${cancelAttr || ""}>
            ${escapeHtml(cancelLabel)}
          </button>
          <button class="btn-primary" type="submit" data-task-editor-submit ${submitAttr || ""}>
            ${escapeHtml(submitLabel || "Save")}
          </button>
        </div>
      </form>
    </dialog>
  `;
}

export function createTaskEditor(dialogEl) {
  if (!dialogEl) {
    throw new Error("Task editor dialog is required.");
  }

  const form = dialogEl.querySelector("[data-task-editor-form]");
  const messageEl = dialogEl.querySelector("[data-task-editor-message]");
  const submitButton = dialogEl.querySelector("[data-task-editor-submit]");
  const cancelButton = dialogEl.querySelector("[data-task-editor-cancel]");
  const titleInput = dialogEl.querySelector("[data-task-editor-title]");
  const descriptionInput = dialogEl.querySelector("[data-task-editor-description]");
  const stageSelect = dialogEl.querySelector("[data-task-editor-stage]");
  const prioritySelect = dialogEl.querySelector("[data-task-editor-priority]");
  const statusOpen = dialogEl.querySelector("[data-task-editor-status-open]");
  const statusClosed = dialogEl.querySelector("[data-task-editor-status-closed]");
  const attachmentRoot = dialogEl.querySelector("[data-attachment-editor]");

  if (!form || !messageEl || !submitButton || !cancelButton || !titleInput || !descriptionInput) {
    throw new Error("Task editor dialog is missing required elements.");
  }

  const attachments = attachmentRoot ? createAttachmentEditor(attachmentRoot) : null;

  return {
    form,
    messageEl,
    submitButton,
    cancelButton,
    fields: {
      titleInput,
      descriptionInput,
      stageSelect,
      prioritySelect,
      statusOpen,
      statusClosed
    },
    attachments
  };
}
