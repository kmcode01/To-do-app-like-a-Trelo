import { renderFooter } from "../../components/footer/footer.js";
import { renderHeader } from "../../components/header/header.js";
import { requireAuthenticatedSession, supabase } from "../lib/supabaseClient.js";
import "../theme.css";
import "./index.css";

document.title = "TaskFlow | Dashboard";

const app = document.querySelector("#app");

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

async function fetchUserTasks(userId) {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, description_html, created_at, done, status, priority, stage_id, project_id, projects(title), project_stages(name)"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

function resolveTaskStatus(task) {
  const stageName = String(task.project_stages?.name || "").toLowerCase();
  const status = String(task.status || "").toLowerCase();

  if (status === "done" || status === "in_progress") {
    return status;
  }

  if (status === "todo" || status === "not_started") {
    return "not_started";
  }

  if (task.done) {
    return "done";
  }

  if (stageName.includes("done")) {
    return "done";
  }

  if (stageName.includes("in progress")) {
    return "in_progress";
  }

  return "not_started";
}

function renderTaskCard(task, statusKey) {
  const title = escapeHtml(task.title || "Untitled task");
  const projectTitle = escapeHtml(task.projects?.title || "Project");
  const stageName = escapeHtml(task.project_stages?.name || "Unassigned");
  const priority = escapeHtml(task.priority || "medium");
  const descriptionText = stripHtml(task.description_html || "");
  const description = descriptionText
    ? `<p class="project-description">${escapeHtml(descriptionText)}</p>`
    : '<p class="project-description is-muted">No description yet.</p>';
  const statusLabel =
    statusKey === "done"
      ? "Done"
      : statusKey === "in_progress"
        ? "In Progress"
        : "Not Started";

  return `
    <li class="board-card" draggable="true" data-task-id="${task.id}" data-status="${statusKey}">
      <div class="board-card-body">
        <h3 data-task-title>${title}</h3>
        <div data-task-description>${description}</div>
      </div>
      <div class="board-card-meta">
        <span class="status-pill status-${statusKey}">${statusLabel}</span>
        <span class="meta-text">${projectTitle}</span>
      </div>
      <div class="board-card-meta">
        <span class="meta-text">Stage: ${stageName}</span>
        <span class="meta-text" data-task-priority>Priority: ${priority}</span>
      </div>
      <div class="board-card-meta">
        <span class="meta-text">Created ${formatDate(task.created_at)}</span>
        <span class="meta-text">Task</span>
      </div>
      <div class="project-actions-row board-actions">
        <a class="project-action-btn project-action-primary" href="/project/${task.project_id}">Open project</a>
        <a class="project-action-btn project-action-secondary" href="/project/${task.project_id}/taskboard">Taskboard</a>
        <button
          type="button"
          class="project-action-btn project-action-secondary"
          data-task-edit
          data-task-id="${task.id}"
          data-task-title="${title}"
          data-task-description="${escapeHtml(descriptionText)}"
          data-task-priority="${priority}"
        >
          Edit
        </button>
        <button
          type="button"
          class="project-action-btn project-action-danger"
          data-task-delete
          data-task-id="${task.id}"
        >
          Delete
        </button>
      </div>
    </li>
  `;
}

function statusLabelFor(statusKey) {
  if (statusKey === "done") {
    return "Done";
  }

  if (statusKey === "in_progress") {
    return "In Progress";
  }

  return "Not Started";
}

function updateCardStatus(card, statusKey) {
  if (!card) {
    return;
  }

  const pill = card.querySelector(".status-pill");
  if (!pill) {
    return;
  }

  card.dataset.status = statusKey;
  pill.classList.remove("status-not_started", "status-in_progress", "status-done");
  pill.classList.add(`status-${statusKey}`);
  pill.textContent = statusLabelFor(statusKey);
}

function updateColumnCounts() {
  document.querySelectorAll(".board-column").forEach((column) => {
    const badge = column.querySelector(".board-badge");
    if (!badge) {
      return;
    }

    const count = column.querySelectorAll(".board-card").length;
    badge.textContent = count;
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [
    ...container.querySelectorAll(".board-card:not(.is-dragging)")
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

function setupBoardDragAndDrop() {
  const lists = document.querySelectorAll(".board-card-list");
  const columns = document.querySelectorAll(".board-column");

  document.querySelectorAll(".board-card").forEach((card) => {
    card.addEventListener("dragstart", () => {
      card.classList.add("is-dragging");
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      document.querySelectorAll(".board-column").forEach((column) => {
        column.classList.remove("is-drop-target");
      });
      updateColumnCounts();
    });
  });

  lists.forEach((list) => {
    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      const draggingCard = document.querySelector(".board-card.is-dragging");
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
      const list = column.querySelector(".board-card-list");
      if (!list) {
        return;
      }

      const draggingCard = document.querySelector(".board-card.is-dragging");
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
      const list = column.querySelector(".board-card-list");
      const draggingCard = document.querySelector(".board-card.is-dragging");
      if (!list || !draggingCard) {
        return;
      }

      const emptyPlaceholder = list.querySelector(".empty-projects");
      if (emptyPlaceholder) {
        emptyPlaceholder.remove();
      }

      const statusKey = column.dataset.status;
      if (statusKey) {
        updateCardStatus(draggingCard, statusKey);
      }

      column.classList.remove("is-drop-target");
      updateColumnCounts();

      const taskId = draggingCard.dataset.taskId;
      if (!taskId || !statusKey) {
        return;
      }

      const doneFlag = statusKey === "done";
      const statusValue = statusKey === "not_started" ? "todo" : statusKey;

      const { error } = await supabase
        .from("tasks")
        .update({ done: doneFlag, status: statusValue })
        .eq("id", taskId);

      if (error) {
        console.error(error);
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

  const tasks = await fetchUserTasks(userId);

  const email = session.user?.email ?? "your account";
  const boardColumns = {
    not_started: [],
    in_progress: [],
    done: []
  };

  tasks.forEach((task) => {
    const statusKey = resolveTaskStatus(task);
    boardColumns[statusKey].push(renderTaskCard(task, statusKey));
  });

  const columnCounts = {
    not_started: boardColumns.not_started.length,
    in_progress: boardColumns.in_progress.length,
    done: boardColumns.done.length
  };

  const stats = {
    total: tasks.length,
    notStarted: boardColumns.not_started.length,
    inProgress: boardColumns.in_progress.length,
    done: boardColumns.done.length
  };

  if (tasks.length === 0) {
    boardColumns.not_started.push(
      '<li class="empty-projects">No tasks yet. Create one in your taskboard.</li>'
    );
  }

  app.innerHTML = `
    <div class="page-shell">
      <div data-header></div>
      <main class="page-content">
        <h1>Dashboard</h1>
        <p>
          Signed in as <strong>${email}</strong>.
        </p>

        <section class="summary-grid" aria-label="Dashboard summary">
          <article class="summary-card">
            <p class="summary-label">Total tasks</p>
            <p class="summary-value">${stats.total}</p>
          </article>
          <article class="summary-card">
            <p class="summary-label">Not started</p>
            <p class="summary-value">${stats.notStarted}</p>
          </article>
          <article class="summary-card">
            <p class="summary-label">In progress</p>
            <p class="summary-value">${stats.inProgress}</p>
          </article>
          <article class="summary-card">
            <p class="summary-label">Done</p>
            <p class="summary-value">${stats.done}</p>
          </article>
        </section>

        <section class="projects-section" aria-label="Tasks board">
          <div class="projects-heading-row">
            <h2>Your tasks</h2>
            <a class="secondary-link" href="/projects">Projects</a>
          </div>
          <div class="board-grid" role="list">
            <section class="board-column" aria-label="Not Started" data-status="not_started">
              <div class="board-column-header">
                <h3>Not Started</h3>
                <span class="board-badge">${columnCounts.not_started}</span>
              </div>
              <div class="board-divider" aria-hidden="true"></div>
              <ul class="board-card-list">
                ${boardColumns.not_started.join("")}
              </ul>
            </section>

            <section class="board-column" aria-label="In Progress" data-status="in_progress">
              <div class="board-column-header">
                <h3>In Progress</h3>
                <span class="board-badge">${columnCounts.in_progress}</span>
              </div>
              <div class="board-divider" aria-hidden="true"></div>
              <ul class="board-card-list">
                ${boardColumns.in_progress.join("") || '<li class="empty-projects">No tasks in progress.</li>'}
              </ul>
            </section>

            <section class="board-column" aria-label="Done" data-status="done">
              <div class="board-column-header">
                <h3>Done</h3>
                <span class="board-badge">${columnCounts.done}</span>
              </div>
              <div class="board-divider" aria-hidden="true"></div>
              <ul class="board-card-list">
                ${boardColumns.done.join("") || '<li class="empty-projects">No completed tasks yet.</li>'}
              </ul>
            </section>
          </div>
        </section>

        <div class="actions-row">
          <a class="secondary-link" href="/">Back to Home</a>
          <button type="button" class="danger-btn" data-logout-btn>Logout</button>
        </div>
      </main>
      <div data-footer></div>
    </div>

    <dialog class="task-dialog" data-task-edit-dialog>
      <form class="dialog-body" data-task-edit-form method="dialog">
        <h2>Edit task</h2>
        <div class="field">
          <label for="edit-task-title">Title</label>
          <input id="edit-task-title" name="title" type="text" maxlength="140" required />
        </div>
        <div class="field">
          <label for="edit-task-description">Description</label>
          <textarea id="edit-task-description" name="description" maxlength="1000"></textarea>
        </div>
        <div class="field">
          <label for="edit-task-priority">Priority</label>
          <select id="edit-task-priority" name="priority" required>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
        <p class="message" data-task-edit-message role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button class="btn-secondary" type="button" data-task-edit-cancel>Cancel</button>
          <button class="btn-primary" type="submit" data-task-edit-submit>Save</button>
        </div>
      </form>
    </dialog>

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

  renderHeader(document.querySelector("[data-header]"), "/dashboard");
  renderFooter(document.querySelector("[data-footer]"));

  const logoutButton = document.querySelector("[data-logout-btn]");

  setupBoardDragAndDrop();

  const editDialog = document.querySelector("[data-task-edit-dialog]");
  const editForm = document.querySelector("[data-task-edit-form]");
  const editMessage = document.querySelector("[data-task-edit-message]");
  const editCancel = document.querySelector("[data-task-edit-cancel]");
  const editSubmit = document.querySelector("[data-task-edit-submit]");
  const deleteDialog = document.querySelector("[data-task-delete-dialog]");
  const deleteMessage = document.querySelector("[data-task-delete-message]");
  const deleteCancel = document.querySelector("[data-task-delete-cancel]");
  const deleteConfirm = document.querySelector("[data-task-delete-confirm]");
  const editTitleInput = document.querySelector("#edit-task-title");
  const editDescriptionInput = document.querySelector("#edit-task-description");
  const editPriorityInput = document.querySelector("#edit-task-priority");

  let activeTaskId = null;
  let activeTaskCard = null;

  document.querySelectorAll("[data-task-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTaskId = button.dataset.taskId || null;
      activeTaskCard = button.closest(".board-card");
      editTitleInput.value = button.dataset.taskTitle || "";
      editDescriptionInput.value = button.dataset.taskDescription || "";
      editPriorityInput.value = button.dataset.taskPriority || "medium";
      editMessage.textContent = "";
      editMessage.classList.remove("is-error");
      editDialog.showModal();
    });
  });

  if (editCancel) {
    editCancel.addEventListener("click", () => {
      editDialog.close();
    });
  }

  if (editForm) {
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      editMessage.textContent = "";
      editMessage.classList.remove("is-error");

      if (!activeTaskId) {
        editMessage.textContent = "Missing task id.";
        editMessage.classList.add("is-error");
        return;
      }

      const title = editTitleInput.value.trim();
      const description = editDescriptionInput.value.trim();
      const priority = editPriorityInput.value;

      if (!title) {
        editMessage.textContent = "Title is required.";
        editMessage.classList.add("is-error");
        return;
      }

      editSubmit.disabled = true;
      editSubmit.textContent = "Saving...";

      const descriptionHtml = description ? `<p>${escapeHtml(description)}</p>` : null;
      const { error } = await supabase
        .from("tasks")
        .update({
          title,
          description_html: descriptionHtml,
          description: description || null,
          priority
        })
        .eq("id", activeTaskId);

      editSubmit.disabled = false;
      editSubmit.textContent = "Save";

      if (error) {
        editMessage.textContent = error.message;
        editMessage.classList.add("is-error");
        return;
      }

      if (activeTaskCard) {
        const titleEl = activeTaskCard.querySelector("[data-task-title]");
        const descEl = activeTaskCard.querySelector("[data-task-description]");
        const priorityEl = activeTaskCard.querySelector("[data-task-priority]");
        if (titleEl) {
          titleEl.textContent = title;
        }
        if (descEl) {
          descEl.innerHTML = description
            ? `<p class="project-description">${escapeHtml(description)}</p>`
            : '<p class="project-description is-muted">No description yet.</p>';
        }
        if (priorityEl) {
          priorityEl.textContent = `Priority: ${priority}`;
        }
      }

      editDialog.close();
    });
  }

  document.querySelectorAll("[data-task-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTaskId = button.dataset.taskId || null;
      activeTaskCard = button.closest(".board-card");
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
        const list = activeTaskCard.closest(".board-card-list");
        activeTaskCard.remove();
        if (list && !list.querySelector(".board-card")) {
          list.insertAdjacentHTML(
            "beforeend",
            '<li class="empty-projects">No tasks in this stage.</li>'
          );
        }
      }

      updateColumnCounts();
      deleteDialog.close();
    });
  }

  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";

    await supabase.auth.signOut();
    window.location.replace("/login");
  });
}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${error.message}</p>`;
});