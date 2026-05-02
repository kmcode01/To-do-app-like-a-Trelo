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

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

async function fetchOwnedProjects(userId) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, description, created_at")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function fetchTaskStats(projectIds) {
  if (!projectIds.length) {
    return {
      total: 0,
      pending: 0,
      done: 0,
      byProjectId: {}
    };
  }

  const { data, error } = await supabase
    .from("tasks")
    .select("project_id, done")
    .in("project_id", projectIds);

  if (error) {
    throw new Error(error.message);
  }

  const tasks = data ?? [];
  const done = tasks.filter((task) => task.done).length;
  const byProjectId = {};

  projectIds.forEach((projectId) => {
    byProjectId[projectId] = {
      total: 0,
      pending: 0,
      done: 0
    };
  });

  tasks.forEach((task) => {
    if (!byProjectId[task.project_id]) {
      byProjectId[task.project_id] = {
        total: 0,
        pending: 0,
        done: 0
      };
    }

    byProjectId[task.project_id].total += 1;
    if (task.done) {
      byProjectId[task.project_id].done += 1;
    } else {
      byProjectId[task.project_id].pending += 1;
    }
  });

  return {
    total: tasks.length,
    pending: tasks.length - done,
    done,
    byProjectId
  };
}

function resolveProjectStatus(projectStats) {
  if (!projectStats.total) {
    return "not_started";
  }

  if (projectStats.pending === 0) {
    return "done";
  }

  if (projectStats.done === 0) {
    return "not_started";
  }

  return "in_progress";
}

function renderProjectCard(project, projectStats, statusKey) {
  const title = escapeHtml(project.title || "Untitled project");
  const description = project.description
    ? `<p class="project-description">${escapeHtml(project.description)}</p>`
    : '<p class="project-description is-muted">No description yet.</p>';
  const previewId = `preview-${project.id}`;
  const statusLabel =
    statusKey === "done"
      ? "Done"
      : statusKey === "in_progress"
        ? "In Progress"
        : "Not Started";

  return `
    <li class="board-card" draggable="true" data-project-id="${project.id}" data-status="${statusKey}">
      <div class="board-card-body">
        <h3>${title}</h3>
        ${description}
      </div>
      <div class="board-card-meta">
        <span class="status-pill status-${statusKey}">${statusLabel}</span>
        <span class="meta-text">${projectStats.total} tasks</span>
      </div>
      <div class="board-card-meta">
        <span class="meta-text">${projectStats.pending} pending</span>
        <span class="meta-text">Created ${formatDate(project.created_at)}</span>
      </div>
      <div class="project-actions-row board-actions">
        <a class="project-action-btn project-action-primary" href="/project/${project.id}">View</a>
        <button
          type="button"
          class="project-action-btn project-action-secondary"
          data-preview-btn
          data-preview-target="${previewId}"
          aria-expanded="false"
        >
          Quick preview
        </button>
      </div>
      <div id="${previewId}" class="project-preview" hidden>
        <p><strong>Created:</strong> ${formatDate(project.created_at)}</p>
        <p><strong>Tasks:</strong> ${projectStats.total} total | ${projectStats.pending} pending | ${projectStats.done} done</p>
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

    column.addEventListener("drop", () => {
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

  const projects = await fetchOwnedProjects(userId);
  const projectIds = projects.map((project) => project.id);
  const taskStats = await fetchTaskStats(projectIds);

  const email = session.user?.email ?? "your account";
  const boardColumns = {
    not_started: [],
    in_progress: [],
    done: []
  };

  projects.forEach((project) => {
    const projectStats = taskStats.byProjectId[project.id] ?? {
      total: 0,
      pending: 0,
      done: 0
    };
    const statusKey = resolveProjectStatus(projectStats);
    boardColumns[statusKey].push(renderProjectCard(project, projectStats, statusKey));
  });

  const columnCounts = {
    not_started: boardColumns.not_started.length,
    in_progress: boardColumns.in_progress.length,
    done: boardColumns.done.length
  };

  if (projects.length === 0) {
    boardColumns.not_started.push(
      '<li class="empty-projects">No projects yet. Create your first project to start planning tasks.</li>'
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
            <p class="summary-label">Total projects</p>
            <p class="summary-value">${projects.length}</p>
          </article>
          <article class="summary-card">
            <p class="summary-label">Total tasks</p>
            <p class="summary-value">${taskStats.total}</p>
          </article>
          <article class="summary-card">
            <p class="summary-label">Pending tasks</p>
            <p class="summary-value">${taskStats.pending}</p>
          </article>
          <article class="summary-card">
            <p class="summary-label">Done tasks</p>
            <p class="summary-value">${taskStats.done}</p>
          </article>
        </section>

        <section class="projects-section" aria-label="Projects list">
          <div class="projects-heading-row">
            <h2>Your projects</h2>
            <a class="secondary-link" href="/projects">Manage projects</a>
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
                ${boardColumns.in_progress.join("") || '<li class="empty-projects">No projects in progress.</li>'}
              </ul>
            </section>

            <section class="board-column" aria-label="Done" data-status="done">
              <div class="board-column-header">
                <h3>Done</h3>
                <span class="board-badge">${columnCounts.done}</span>
              </div>
              <div class="board-divider" aria-hidden="true"></div>
              <ul class="board-card-list">
                ${boardColumns.done.join("") || '<li class="empty-projects">No completed projects yet.</li>'}
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
  `;

  renderHeader(document.querySelector("[data-header]"), "/dashboard");
  renderFooter(document.querySelector("[data-footer]"));

  const logoutButton = document.querySelector("[data-logout-btn]");
  document.querySelectorAll("[data-preview-btn]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.getAttribute("data-preview-target");
      if (!targetId) {
        return;
      }

      const previewEl = document.getElementById(targetId);
      if (!previewEl) {
        return;
      }

      const isHidden = previewEl.hasAttribute("hidden");
      if (isHidden) {
        previewEl.removeAttribute("hidden");
        button.setAttribute("aria-expanded", "true");
        button.textContent = "Hide preview";
      } else {
        previewEl.setAttribute("hidden", "");
        button.setAttribute("aria-expanded", "false");
        button.textContent = "Quick preview";
      }
    });
  });

  setupBoardDragAndDrop();

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