import { renderFooter } from "../../../components/footer/footer.js";
import { renderHeader } from "../../../components/header/header.js";
import { createTaskEditor, renderTaskEditorDialog } from "../../../components/task-editor/task-editor.js";
import { requireAuthenticatedSession, supabase } from "../../lib/supabaseClient.js";
import "../../theme.css";
import "../shared.css";
import "./index.css";

document.title = "TaskFlow | Taskboard";

const app = document.querySelector("#app");
const dragState = { sourceStageId: null };

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, "");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

function isDoneStage(name) {
  return String(name || "").toLowerCase().includes("done");
}

function resolveStageStatus(name) {
  const normalized = String(name || "").toLowerCase();

  if (normalized.includes("done")) {
    return "done";
  }

  if (normalized.includes("in progress")) {
    return "in_progress";
  }

  return "todo";
}

function findStageIdByStatus(stageMeta, desiredStatus) {
  for (const [stageId, info] of stageMeta.entries()) {
    if (resolveStageStatus(info?.name) === desiredStatus) {
      return stageId;
    }
  }

  return null;
}

function findFirstStageIdByDone(stageMeta, doneFlag) {
  for (const [stageId, info] of stageMeta.entries()) {
    if (Boolean(info?.done) === doneFlag) {
      return stageId;
    }
  }

  return null;
}

function formatStageLabel(name, doneFlag) {
  const normalized = String(name || "").toLowerCase();

  if (doneFlag || normalized.includes("done")) {
    return "Done";
  }

  if (normalized.includes("in progress")) {
    return "In Progress";
  }

  if (normalized.includes("not started")) {
    return "Not Started";
  }

  if (!name) {
    return "Active";
  }

  return String(name).replace(/\b\w/g, (char) => char.toUpperCase());
}

const ATTACHMENTS_BUCKET = "task-attachments";
const ATTACHMENT_PREVIEW_TTL_SECONDS = 60 * 60;

function sanitizeFileName(name) {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+/, "")
    .slice(0, 120);
}

function isImageAttachment(mimeType, fileName) {
  if (mimeType && mimeType.startsWith("image/")) {
    return true;
  }

  const extension = String(fileName || "").toLowerCase().split(".").pop();
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(extension);
}

async function fetchTaskAttachments(taskId) {
  const { data, error } = await supabase
    .from("task_attachments")
    .select("id, task_id, file_name, file_path, mime_type, size, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  return data || [];
}

async function addAttachmentPreviewUrls(attachments) {
  const enriched = await Promise.all(
    attachments.map(async (attachment) => {
      const isImage = isImageAttachment(attachment.mime_type, attachment.file_name);
      const { data, error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(attachment.file_path, ATTACHMENT_PREVIEW_TTL_SECONDS);

      if (error) {
        return { ...attachment, isImage, previewUrl: "", downloadUrl: "" };
      }

      return {
        ...attachment,
        isImage,
        previewUrl: isImage ? data?.signedUrl || "" : "",
        downloadUrl: data?.signedUrl || ""
      };
    })
  );

  return enriched;
}

async function refreshAttachmentEditor(taskId, editor) {
  if (!editor) {
    return [];
  }

  const attachments = await fetchTaskAttachments(taskId);
  const enriched = await addAttachmentPreviewUrls(attachments);
  editor.setExistingAttachments(enriched);
  return enriched;
}

async function persistAttachmentChanges(taskId, editor, userId) {
  if (!editor) {
    return [];
  }

  const { uploads, deletions } = editor.getPendingChanges();
  const deletionIds = deletions.map((attachment) => attachment.id);
  const deletionPaths = deletions.map((attachment) => attachment.file_path);

  if (!uploads.length && !deletionPaths.length) {
    editor.reset();
    return [];
  }

  if (deletionPaths.length) {
    const { error: storageDeleteError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove(deletionPaths);

    if (storageDeleteError) {
      throw new Error(storageDeleteError.message);
    }

    const { error: deleteError } = await supabase
      .from("task_attachments")
      .delete()
      .in("id", deletionIds);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  if (uploads.length) {
    const rows = [];
    const uploadedPaths = [];

    for (const upload of uploads) {
      const safeName = sanitizeFileName(upload.file.name || "attachment");
      const filePath = `${taskId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(filePath, upload.file, {
          contentType: upload.file.type || "application/octet-stream",
          upsert: false
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      uploadedPaths.push(filePath);

      rows.push({
        task_id: taskId,
        file_name: upload.file.name,
        file_path: filePath,
        mime_type: upload.file.type || null,
        size: upload.file.size || null,
        created_by_user_id: userId
      });
    }

    if (rows.length) {
      const { error: insertError } = await supabase.from("task_attachments").insert(rows);
      if (insertError) {
        if (uploadedPaths.length) {
          await supabase.storage.from(ATTACHMENTS_BUCKET).remove(uploadedPaths);
        }
        throw new Error(insertError.message);
      }
    }
  }

  return refreshAttachmentEditor(taskId, editor);
}

function renderTaskCard(task, stageId, stageName, doneFlag) {
  const description = stripHtml(task.description_html || "");
  const statusClass = doneFlag ? "task-status is-done" : "task-status";
  const statusLabel = formatStageLabel(stageName, doneFlag);
  const safeTitle = escapeHtml(task.title || "Untitled task");
  const safeDescription = description
    ? `<p class="task-description">${escapeHtml(description)}</p>`
    : '<p class="task-description">No description yet.</p>';
  const position = Number.isFinite(task.position) ? task.position : 0;
  const priority = escapeHtml(task.priority || "medium");

  return `
    <li class="task-card" draggable="true" data-task-id="${task.id}" data-stage-id="${stageId}" data-position="${position}">
      <h3 class="task-title" data-task-title>${safeTitle}</h3>
      ${safeDescription}
      <div class="task-meta">
        <span class="${statusClass}">${statusLabel}</span>
        <span class="task-meta-text">Created ${formatDate(task.created_at)}</span>
      </div>
      <div class="task-actions">
        <button
          type="button"
          class="task-action-btn"
          data-task-edit
          data-task-id="${task.id}"
          data-task-title="${safeTitle}"
          data-task-description="${escapeHtml(description)}"
          data-task-priority="${priority}"
          data-task-done="${task.done ? "true" : "false"}"
          data-task-status="${escapeHtml(task.status || "")}"
        >
          Edit
        </button>
        <button
          type="button"
          class="task-action-btn is-danger"
          data-task-delete
          data-task-id="${task.id}"
        >
          Delete
        </button>
      </div>
    </li>
  `;
}

function getProjectIdFromPath(pathname) {
  const match = pathname.match(/^\/project\/([^/]+)\/taskboard\/?$/);

  if (!match) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

function getDragAfterElement(container, y) {
  const draggableElements = [
    ...container.querySelectorAll(".task-card:not(.is-dragging)")
  ];

  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }

      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function updateColumnCounts() {
  document.querySelectorAll(".taskboard-column").forEach((column) => {
    const badge = column.querySelector(".stage-badge");
    if (!badge) {
      return;
    }

    const count = column.querySelectorAll(".task-card").length;
    badge.textContent = count;
  });
}

function ensureEmptyState(list) {
  const hasCards = list.querySelector(".task-card");
  const empty = list.querySelector(".task-empty");

  if (hasCards && empty) {
    empty.remove();
  }

  if (!hasCards && !empty) {
    list.insertAdjacentHTML("beforeend", '<li class="task-empty">No tasks in this stage.</li>');
  }
}

function updateTaskStatus(card, stageName, doneFlag) {
  const status = card.querySelector(".task-status");
  if (!status) {
    return;
  }

  if (doneFlag) {
    status.classList.add("is-done");
    status.textContent = formatStageLabel(stageName, doneFlag);
  } else {
    status.classList.remove("is-done");
    status.textContent = formatStageLabel(stageName, doneFlag);
  }

  const editBtn = card.querySelector("[data-task-edit]");
  if (editBtn) {
    editBtn.dataset.taskDone = doneFlag ? "true" : "false";
    editBtn.dataset.taskStatus = resolveStageStatus(stageName);
  }
}

function wireTaskCard(card) {
  card.addEventListener("dragstart", () => {
    dragState.sourceStageId = card.dataset.stageId || null;
    card.classList.add("is-dragging");
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("is-dragging");
    document.querySelectorAll(".taskboard-column").forEach((column) => {
      column.classList.remove("is-drop-target");
    });
    updateColumnCounts();
  });
}

async function persistListOrder(list, stageId, doneFlag, statusValue) {
  const cards = [...list.querySelectorAll(".task-card")];
  if (!cards.length) {
    return;
  }

  const taskIds = cards.map((card) => card.dataset.taskId).filter(Boolean);

  const { error } = await supabase.rpc("reorder_tasks", {
    p_stage_id: stageId,
    p_task_ids: taskIds,
    p_done: doneFlag,
    p_status: statusValue
  });

  if (error) {
    throw new Error(error.message);
  }

  cards.forEach((card, index) => {
    card.dataset.position = String(index);
  });
}

function setupTaskDragAndDrop(stageMeta, messageEl) {
  const lists = document.querySelectorAll(".task-list");
  const columns = document.querySelectorAll(".taskboard-column");

  document.querySelectorAll(".task-card").forEach((card) => {
    wireTaskCard(card);
  });

  lists.forEach((list) => {
    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      const draggingCard = document.querySelector(".task-card.is-dragging");
      if (!draggingCard) {
        return;
      }

      const afterElement = getDragAfterElement(list, event.clientY);
      if (afterElement) {
        list.insertBefore(draggingCard, afterElement);
      } else {
        list.appendChild(draggingCard);
      }
    });
  });

  columns.forEach((column) => {
    column.addEventListener("dragover", (event) => {
      event.preventDefault();
      column.classList.add("is-drop-target");
      const list = column.querySelector(".task-list");
      if (!list) {
        return;
      }

      const draggingCard = document.querySelector(".task-card.is-dragging");
      if (!draggingCard) {
        return;
      }

      const afterElement = getDragAfterElement(list, event.clientY);
      if (afterElement) {
        list.insertBefore(draggingCard, afterElement);
      } else {
        list.appendChild(draggingCard);
      }
    });

    column.addEventListener("dragleave", () => {
      column.classList.remove("is-drop-target");
    });

    column.addEventListener("drop", async () => {
      const list = column.querySelector(".task-list");
      const draggingCard = document.querySelector(".task-card.is-dragging");
      if (!list || !draggingCard) {
        return;
      }

      const stageId = column.dataset.stageId || "";
      const stageInfo = stageMeta.get(stageId);
      const doneFlag = Boolean(stageInfo?.done);
      const statusValue = resolveStageStatus(stageInfo?.name);
      const sourceStageId = dragState.sourceStageId;

      draggingCard.dataset.stageId = stageId;
      list.querySelectorAll(".task-card").forEach((card) => {
        card.dataset.stageId = stageId;
        updateTaskStatus(card, stageInfo?.name, doneFlag);
      });
      column.classList.remove("is-drop-target");

      ensureEmptyState(list);
      if (sourceStageId && sourceStageId !== stageId) {
        const sourceColumn = document.querySelector(
          `.taskboard-column[data-stage-id="${sourceStageId}"]`
        );
        const sourceList = sourceColumn?.querySelector(".task-list");
        if (sourceList) {
          const sourceInfo = stageMeta.get(sourceStageId);
          const sourceDone = Boolean(sourceInfo?.done);
          sourceList.querySelectorAll(".task-card").forEach((card) => {
            card.dataset.stageId = sourceStageId;
            updateTaskStatus(card, sourceInfo?.name, sourceDone);
          });
          ensureEmptyState(sourceList);
        }
      }

      updateColumnCounts();

      messageEl.textContent = "";
      messageEl.classList.remove("is-error");
      try {
        if (sourceStageId && sourceStageId !== stageId) {
          const sourceInfo = stageMeta.get(sourceStageId);
          const sourceList = document.querySelector(
            `.taskboard-column[data-stage-id="${sourceStageId}"] .task-list`
          );
          if (sourceList) {
            const sourceStatus = resolveStageStatus(sourceInfo?.name);
            await persistListOrder(
              sourceList,
              sourceStageId,
              Boolean(sourceInfo?.done),
              sourceStatus
            );
          }
        }

        await persistListOrder(list, stageId, doneFlag, statusValue);
      } catch (error) {
        messageEl.textContent = error.message;
        messageEl.classList.add("is-error");
      }
    });
  });
}

async function bootstrap() {
  const session = await requireAuthenticatedSession("/login");

  if (!session) {
    return;
  }

  const userId = session.user?.id;
  if (!userId) {
    throw new Error("Could not resolve the current user.");
  }

  const params = new URLSearchParams(window.location.search);
  const projectId = getProjectIdFromPath(window.location.pathname) || params.get("id");

  if (!projectId) {
    throw new Error("Missing project id. Open this page from the Projects list.");
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, title, description")
    .eq("id", projectId)
    .single();

  if (projectError) {
    throw new Error(projectError.message);
  }

  const { data: stages, error: stageError } = await supabase
    .from("project_stages")
    .select("id, name, position, color")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (stageError) {
    throw new Error(stageError.message);
  }

  let stageList = stages ?? [];

  if (!stageList.length) {
    const defaultStages = [
      { name: "not started", position: 0 },
      { name: "in progress", position: 1 },
      { name: "done", position: 2 }
    ];

    const { data: createdStages, error: createError } = await supabase
      .from("project_stages")
      .insert(
        defaultStages.map((stage) => ({
          project_id: projectId,
          name: stage.name,
          position: stage.position
        }))
      )
      .select("id, name, position, color")
      .order("position", { ascending: true });

    if (createError) {
      throw new Error(createError.message);
    }

    stageList = createdStages ?? [];
  }

  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, description_html, position, stage_id, done, status, priority, created_at")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (taskError) {
    throw new Error(taskError.message);
  }

  const taskList = tasks ?? [];
  const tasksByStage = new Map();
  const stageMeta = new Map();

  stageList.forEach((stage) => {
    tasksByStage.set(stage.id, []);
    stageMeta.set(stage.id, { name: stage.name, done: isDoneStage(stage.name) });
  });

  taskList.forEach((task) => {
    if (!tasksByStage.has(task.stage_id)) {
      tasksByStage.set(task.stage_id, []);
    }

    tasksByStage.get(task.stage_id).push(task);
  });

  const stageOptions = stageList
    .map((stage) => `<option value="${stage.id}">${escapeHtml(stage.name)}</option>`)
    .join("");

  const columns = stageList
    .map((stage) => {
      const stageTasks = tasksByStage.get(stage.id) || [];
      const doneFlag = Boolean(stageMeta.get(stage.id)?.done);
      const cards = stageTasks.length
        ? stageTasks
            .map((task) => renderTaskCard(task, stage.id, stage.name, doneFlag))
            .join("")
        : '<li class="task-empty">No tasks in this stage.</li>';

      return `
        <section class="taskboard-column" data-stage-id="${stage.id}" aria-label="${escapeHtml(stage.name)}">
          <div class="taskboard-column-header">
            <h2>${escapeHtml(stage.name)}</h2>
            <span class="stage-badge">${stageTasks.length}</span>
          </div>
          <div class="taskboard-divider" aria-hidden="true"></div>
          <ul class="task-list">
            ${cards}
          </ul>
        </section>
      `;
    })
    .join("");

  app.innerHTML = `
    <div class="page-shell">
      <div data-header></div>
      <main class="page-content">
        <div class="taskboard-header">
          <div>
            <h1>${escapeHtml(project.title)} Tasks</h1>
            <p class="message">${escapeHtml(project.description || "No description yet.")}</p>
            <p class="message" data-taskboard-message role="status" aria-live="polite"></p>
          </div>
          <div class="form-actions">
            <button class="btn-primary" type="button" data-create-task>Create task</button>
            <a class="action-link" href="/project/${project.id}">Project details</a>
            <a class="action-link" href="/projects">Back to Projects</a>
          </div>
        </div>

        ${
          stageList.length
            ? `<div class="taskboard-grid" role="list">${columns}</div>`
            : '<p class="empty-state">No stages found for this project.</p>'
        }
      </main>
      <div data-footer></div>
    </div>

    ${renderTaskEditorDialog({
      dialogAttr: "data-task-dialog",
      formAttr: "data-task-form",
      title: "Create task",
      submitLabel: "Create",
      messageAttr: "data-task-form-message",
      submitAttr: "data-submit-task",
      cancelAttr: "data-cancel-task",
      mode: "create",
      stageOptions
    })}

    ${renderTaskEditorDialog({
      dialogAttr: "data-task-edit-dialog",
      formAttr: "data-task-edit-form",
      title: "Edit task",
      submitLabel: "Save",
      messageAttr: "data-task-edit-message",
      submitAttr: "data-task-edit-submit",
      cancelAttr: "data-task-edit-cancel",
      mode: "edit"
    })}

    <dialog class="task-dialog" data-task-delete-dialog>
      <div class="dialog-body">
        <h2>Delete task</h2>
        <p data-task-delete-message>Are you sure you want to delete this task?</p>
        <div class="dialog-actions">
          <button class="btn-secondary" type="button" data-task-delete-cancel>Cancel</button>
          <button class="btn-danger" type="button" data-task-delete-confirm>Delete</button>
        </div>
      </div>
    </dialog>
  `;

  renderHeader(document.querySelector("[data-header]"), "/projects");
  renderFooter(document.querySelector("[data-footer]"));

  const messageEl = document.querySelector("[data-taskboard-message]");
  const createButton = document.querySelector("[data-create-task]");
  const dialog = document.querySelector("[data-task-dialog]");
  const editDialog = document.querySelector("[data-task-edit-dialog]");
  const createEditor = dialog ? createTaskEditor(dialog) : null;
  const editEditor = editDialog ? createTaskEditor(editDialog) : null;
  const form = createEditor?.form;
  const formMessage = createEditor?.messageEl;
  const cancelButton = createEditor?.cancelButton;
  const submitButton = createEditor?.submitButton;
  const editForm = editEditor?.form;
  const editMessage = editEditor?.messageEl;
  const editCancel = editEditor?.cancelButton;
  const editSubmit = editEditor?.submitButton;
  const deleteDialog = document.querySelector("[data-task-delete-dialog]");
  const deleteMessage = document.querySelector("[data-task-delete-message]");
  const deleteCancel = document.querySelector("[data-task-delete-cancel]");
  const deleteConfirm = document.querySelector("[data-task-delete-confirm]");
  const createFields = createEditor?.fields;
  const editFields = editEditor?.fields;

  let activeTaskId = null;
  let activeTaskCard = null;

  if (!stageList.length && createButton) {
    createButton.disabled = true;
  }

  if (createButton && dialog) {
    createButton.addEventListener("click", () => {
      if (formMessage) {
        formMessage.textContent = "";
        formMessage.classList.remove("is-error");
      }
      if (form) {
        form.reset();
      }
      if (createEditor?.attachments) {
        createEditor.attachments.clear();
      }
      dialog.showModal();
    });
  }

  if (cancelButton && dialog) {
    cancelButton.addEventListener("click", () => {
      if (createEditor?.attachments) {
        createEditor.attachments.reset();
      }
      dialog.close();
    });
  }

  if (dialog && createEditor?.attachments) {
    dialog.addEventListener("close", () => {
      createEditor.attachments.reset();
    });
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (formMessage) {
        formMessage.textContent = "";
        formMessage.classList.remove("is-error");
      }

      const title = String(createFields?.titleInput?.value || "").trim();
      const description = String(createFields?.descriptionInput?.value || "").trim();
      const stageId = String(createFields?.stageSelect?.value || "");

      if (!title) {
        if (formMessage) {
          formMessage.textContent = "Title is required.";
          formMessage.classList.add("is-error");
        }
        return;
      }

      const targetList = document.querySelector(
        `.taskboard-column[data-stage-id="${stageId}"] .task-list`
      );
      if (!targetList) {
        if (formMessage) {
          formMessage.textContent = "Selected stage is not available.";
          formMessage.classList.add("is-error");
        }
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = "Creating...";

      const stageInfo = stageMeta.get(stageId);
      const doneFlag = Boolean(stageInfo?.done);
      const statusValue = resolveStageStatus(stageInfo?.name);
      const descriptionHtml = description ? `<p>${escapeHtml(description)}</p>` : null;
      const position = targetList.querySelectorAll(".task-card").length;
      const existingPositions = [...targetList.querySelectorAll(".task-card")]
        .map((card) => Number(card.dataset.position))
        .filter((value) => Number.isFinite(value));
      const nextPosition = existingPositions.length
        ? Math.max(...existingPositions) + 1
        : position;

      const { data: newTask, error: insertError } = await supabase
        .from("tasks")
        .insert({
          project_id: projectId,
          stage_id: stageId,
          title,
          description_html: descriptionHtml,
          description: description || null,
          position: nextPosition,
          done: doneFlag,
          status: statusValue,
          priority: "medium",
          user_id: userId,
          created_by_user_id: userId
        })
        .select("id, title, description_html, position, stage_id, done, status, priority, created_at")
        .single();

      submitButton.disabled = false;
      submitButton.textContent = "Create";

      if (insertError) {
        if (formMessage) {
          formMessage.textContent = insertError.message;
          if (insertError.message.includes("row-level security")) {
            formMessage.textContent =
              "You do not have permission to add tasks to this project.";
          }
          formMessage.classList.add("is-error");
        }
        return;
      }

      const cardMarkup = renderTaskCard(newTask, stageId, stageInfo?.name, doneFlag);
      const empty = targetList.querySelector(".task-empty");
      if (empty) {
        empty.remove();
      }

      targetList.insertAdjacentHTML("beforeend", cardMarkup);
      const newCard = targetList.querySelector(`[data-task-id="${newTask.id}"]`);
      if (newCard) {
        wireTaskCard(newCard);
      }

      updateColumnCounts();
      messageEl.textContent = "";

      submitButton.disabled = true;
      submitButton.textContent = "Saving attachments...";

      try {
        await persistAttachmentChanges(newTask.id, createEditor?.attachments, userId);
      } catch (attachmentError) {
        if (messageEl) {
          messageEl.textContent =
            "Task created, but attachments could not be saved. Edit the task to retry.";
          messageEl.classList.add("is-error");
        }
      }

      submitButton.disabled = false;
      submitButton.textContent = "Create";
      dialog.close();
      form.reset();
      if (createEditor?.attachments) {
        createEditor.attachments.clear();
      }
    });
  }

  document.querySelectorAll("[data-task-edit]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeTaskId = button.dataset.taskId || null;
      activeTaskCard = button.closest(".task-card");
      if (editFields?.titleInput) {
        editFields.titleInput.value = button.dataset.taskTitle || "";
      }
      if (editFields?.descriptionInput) {
        editFields.descriptionInput.value = button.dataset.taskDescription || "";
      }
      if (editFields?.prioritySelect) {
        editFields.prioritySelect.value = button.dataset.taskPriority || "medium";
      }
      if (editFields?.statusClosed && editFields?.statusOpen) {
        const closed = button.dataset.taskDone === "true" || button.dataset.taskStatus === "done";
        editFields.statusClosed.checked = closed;
        editFields.statusOpen.checked = !closed;
      }
      if (editMessage) {
        editMessage.textContent = "";
        editMessage.classList.remove("is-error");
      }

      if (activeTaskId && editEditor?.attachments) {
        try {
          await refreshAttachmentEditor(activeTaskId, editEditor.attachments);
        } catch (attachmentError) {
          if (editMessage) {
            editMessage.textContent = attachmentError.message;
            editMessage.classList.add("is-error");
          }
        }
      }

      editDialog.showModal();
    });
  });

  if (editCancel) {
    editCancel.addEventListener("click", () => {
      if (editEditor?.attachments) {
        editEditor.attachments.reset();
      }
      editDialog.close();
    });
  }

  if (editDialog && editEditor?.attachments) {
    editDialog.addEventListener("close", () => {
      editEditor.attachments.reset();
    });
  }

  if (editForm) {
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (editMessage) {
        editMessage.textContent = "";
        editMessage.classList.remove("is-error");
      }

      if (!activeTaskId) {
        if (editMessage) {
          editMessage.textContent = "Missing task id.";
          editMessage.classList.add("is-error");
        }
        return;
      }

      const title = String(editFields?.titleInput?.value || "").trim();
      const description = String(editFields?.descriptionInput?.value || "").trim();
      const priority = String(editFields?.prioritySelect?.value || "medium");
      const done = editFields?.statusClosed?.checked ?? false;

      if (!title) {
        if (editMessage) {
          editMessage.textContent = "Title is required.";
          editMessage.classList.add("is-error");
        }
        return;
      }

      editSubmit.disabled = true;
      editSubmit.textContent = "Saving...";

      const descriptionHtml = description ? `<p>${escapeHtml(description)}</p>` : null;
      const editBtn = activeTaskCard ? activeTaskCard.querySelector('[data-task-edit]') : null;
      const currentStatus = editBtn?.dataset.taskStatus || "";
      const currentStageId = activeTaskCard?.dataset.stageId || "";
      const currentStageInfo = stageMeta.get(currentStageId);
      const currentDoneFlag = Boolean(currentStageInfo?.done);

      const openPreferredStatus = currentStatus === "in_progress" ? "in_progress" : "todo";
      const openStageByStatus = findStageIdByStatus(stageMeta, openPreferredStatus);
      const openFallbackStage = findFirstStageIdByDone(stageMeta, false);
      const doneStage = findFirstStageIdByDone(stageMeta, true);

      const targetStageId = done
        ? currentDoneFlag
          ? currentStageId
          : (doneStage || currentStageId)
        : !currentDoneFlag
          ? currentStageId
          : (openStageByStatus || openFallbackStage || currentStageId);

      const targetStageInfo = stageMeta.get(targetStageId) || currentStageInfo;
      const targetDoneFlag = Boolean(targetStageInfo?.done);
      const statusValue = resolveStageStatus(targetStageInfo?.name);

      const targetList = document.querySelector(
        `.taskboard-column[data-stage-id="${targetStageId}"] .task-list`
      );
      const targetPosition = targetList ? targetList.querySelectorAll(".task-card").length : 0;

      const { error } = await supabase
        .from("tasks")
        .update({
          title,
          description_html: descriptionHtml,
          description: description || null,
          priority,
          stage_id: targetStageId,
          done: targetDoneFlag,
          status: statusValue,
          position: targetPosition
        })
        .eq("id", activeTaskId);

      editSubmit.disabled = false;
      editSubmit.textContent = "Save";

      if (error) {
        if (editMessage) {
          editMessage.textContent = error.message;
          editMessage.classList.add("is-error");
        }
        return;
      }

      editSubmit.disabled = true;
      editSubmit.textContent = "Saving attachments...";

      try {
        await persistAttachmentChanges(activeTaskId, editEditor?.attachments, userId);
      } catch (attachmentError) {
        editSubmit.disabled = false;
        editSubmit.textContent = "Save";
        if (editMessage) {
          editMessage.textContent = attachmentError.message;
          editMessage.classList.add("is-error");
        }
        return;
      }

      editSubmit.disabled = false;
      editSubmit.textContent = "Save";

      if (activeTaskCard) {
        const titleEl = activeTaskCard.querySelector("[data-task-title]");
        const descEl = activeTaskCard.querySelector(".task-description");
        if (titleEl) {
          titleEl.textContent = title;
        }
        if (descEl) {
          descEl.textContent = description || "No description yet.";
        }
        const editBtn = activeTaskCard.querySelector('[data-task-edit]');
        if (editBtn) {
          editBtn.dataset.taskDone = targetDoneFlag ? 'true' : 'false';
          editBtn.dataset.taskStatus = statusValue;
          editBtn.dataset.taskTitle = title;
          editBtn.dataset.taskDescription = description;
          editBtn.dataset.taskPriority = priority;
        }

        const sourceList = activeTaskCard.closest(".task-list");
        if (targetList && sourceList && sourceList !== targetList) {
          const targetEmpty = targetList.querySelector(".task-empty");
          if (targetEmpty) {
            targetEmpty.remove();
          }
          targetList.appendChild(activeTaskCard);
        }

        activeTaskCard.dataset.stageId = targetStageId;
        updateTaskStatus(activeTaskCard, targetStageInfo?.name, targetDoneFlag);

        if (sourceList) {
          ensureEmptyState(sourceList);
        }
        if (targetList) {
          ensureEmptyState(targetList);
        }
        updateColumnCounts();

        messageEl.textContent = "";
        messageEl.classList.remove("is-error");
        try {
          if (sourceList && currentStageId && currentStageId !== targetStageId) {
            const sourceStatus = resolveStageStatus(currentStageInfo?.name);
            await persistListOrder(sourceList, currentStageId, currentDoneFlag, sourceStatus);
          }

          if (targetList) {
            await persistListOrder(targetList, targetStageId, targetDoneFlag, statusValue);
          }
        } catch (persistError) {
          if (editMessage) {
            editMessage.textContent = persistError.message;
            editMessage.classList.add("is-error");
          }
          return;
        }
      }

      editDialog.close();
    });
  }

  document.querySelectorAll("[data-task-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTaskId = button.dataset.taskId || null;
      activeTaskCard = button.closest(".task-card");
      deleteMessage.textContent = "Are you sure you want to delete this task?";
      deleteDialog.showModal();
    });
  });

  if (deleteCancel) {
    deleteCancel.addEventListener("click", () => {
      deleteDialog.close();
    });
  }

  if (deleteConfirm) {
    deleteConfirm.addEventListener("click", async () => {
      if (!activeTaskId) {
        deleteDialog.close();
        return;
      }

      deleteConfirm.disabled = true;
      deleteConfirm.textContent = "Deleting...";

      const { error } = await supabase.from("tasks").delete().eq("id", activeTaskId);

      deleteConfirm.disabled = false;
      deleteConfirm.textContent = "Delete";

      if (error) {
        deleteMessage.textContent = error.message;
        return;
      }

      if (activeTaskCard) {
        const list = activeTaskCard.closest(".task-list");
        activeTaskCard.remove();
        if (list && !list.querySelector(".task-card")) {
          list.insertAdjacentHTML(
            "beforeend",
            '<li class="task-empty">No tasks in this stage.</li>'
          );
        }
      }

      updateColumnCounts();
      deleteDialog.close();
    });
  }

  if (stageList.length) {
    setupTaskDragAndDrop(stageMeta, messageEl);
  }
}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${escapeHtml(error.message)}</p>`;
});
