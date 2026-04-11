import { renderFooter } from "../../components/footer/footer.js";
import { renderHeader } from "../../components/header/header.js";
import { requireAuthenticatedSession, supabase } from "../lib/supabaseClient.js";
import "../theme.css";
import "./shared.css";

document.title = "TaskFlow | Projects";

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

function iconSvg(path) {
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="${path}" fill="currentColor"></path></svg>`;
}

function renderPage(projects, showCreatedNotice) {
  const rows = projects.length
    ? projects
        .map(
          (project) => `
            <tr data-project-row="${project.id}">
              <td>${escapeHtml(project.title)}</td>
              <td>${escapeHtml(project.description || "-")}</td>
              <td>${formatDate(project.created_at)}</td>
              <td>
                <div class="actions-cell">
                  <a class="icon-link" href="/projects/view?id=${project.id}" aria-label="View project">
                    ${iconSvg("M12 5c5.5 0 9.6 4.1 10.8 6.4.3.4.3.8 0 1.2C21.6 14.9 17.5 19 12 19S2.4 14.9 1.2 12.6a1 1 0 0 1 0-1.2C2.4 9.1 6.5 5 12 5Zm0 2.2A4.8 4.8 0 1 0 12 17a4.8 4.8 0 0 0 0-9.8Zm0 2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6")}
                  </a>
                  <a class="icon-link" href="/projects/edit?id=${project.id}" aria-label="Edit project">
                    ${iconSvg("M3 17.2V21h3.8l11-11.1-3.8-3.8L3 17.2Zm17.7-10.3a1 1 0 0 0 0-1.4l-2.2-2.2a1 1 0 0 0-1.4 0l-1.7 1.7 3.8 3.8 1.5-1.9Z")}
                  </a>
                  <button class="icon-btn is-danger" type="button" data-delete-project-id="${project.id}" data-delete-project-title="${escapeHtml(project.title)}" aria-label="Delete project">
                    ${iconSvg("M7 4h10l1 2h3v2H3V6h3l1-2Zm1 6h2v8H8v-8Zm6 0h2v8h-2v-8Z")}
                  </button>
                </div>
              </td>
            </tr>
          `
        )
        .join("")
    : "";

  app.innerHTML = `
    <div class="page-shell">
      <div data-header></div>
      <main class="page-content">
        <div class="page-head">
          <h1>Projects</h1>
          <a class="icon-link" href="/projects/add" aria-label="Create Project" title="Create Project">
            ${iconSvg("M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z")}
          </a>
        </div>

        ${
          showCreatedNotice
            ? '<p class="notice notice-success" role="status">Project created successfully.</p>'
            : ""
        }

        <div class="table-wrap">
          ${
            projects.length
              ? `<table class="projects-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Description</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows}
                  </tbody>
                </table>`
              : '<p class="empty-state">No projects found for this user.</p>'
          }
        </div>
      </main>
      <div data-footer></div>
    </div>

    <dialog class="delete-dialog" data-delete-dialog>
      <div class="dialog-body">
        <h2>Delete Project</h2>
        <p data-delete-message>Are you sure you want to delete this project?</p>
        <div class="dialog-actions">
          <button class="btn-secondary" type="button" data-cancel-delete>Cancel</button>
          <button class="btn-danger" type="button" data-confirm-delete>Delete</button>
        </div>
      </div>
    </dialog>
  `;

  renderHeader(document.querySelector("[data-header]"), "/projects");
  renderFooter(document.querySelector("[data-footer]"));
}

async function bootstrap() {
  const session = await requireAuthenticatedSession("/login");

  if (!session) {
    return;
  }

  const userId = session.user?.id;
  if (!userId) {
    throw new Error("Could not resolve current user.");
  }

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, title, description, created_at")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const params = new URLSearchParams(window.location.search);
  const showCreatedNotice = params.get("created") === "1";

  const safeProjects = projects ?? [];
  renderPage(safeProjects, showCreatedNotice);

  if (showCreatedNotice) {
    params.delete("created");
    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `/projects?${nextQuery}` : "/projects";
    window.history.replaceState({}, "", nextUrl);
  }

  const dialog = document.querySelector("[data-delete-dialog]");
  const messageEl = document.querySelector("[data-delete-message]");
  const confirmDeleteButton = document.querySelector("[data-confirm-delete]");
  const cancelDeleteButton = document.querySelector("[data-cancel-delete]");

  let pendingDelete = null;

  document.querySelectorAll("[data-delete-project-id]").forEach((button) => {
    button.addEventListener("click", () => {
      pendingDelete = {
        id: button.getAttribute("data-delete-project-id"),
        title: button.getAttribute("data-delete-project-title") || "this project"
      };

      messageEl.textContent = `Are you sure you want to delete ${pendingDelete.title}?`;
      dialog.showModal();
    });
  });

  cancelDeleteButton.addEventListener("click", () => {
    pendingDelete = null;
    dialog.close();
  });

  confirmDeleteButton.addEventListener("click", async () => {
    if (!pendingDelete?.id) {
      dialog.close();
      return;
    }

    confirmDeleteButton.disabled = true;
    confirmDeleteButton.textContent = "Deleting...";

    const deleteId = pendingDelete.id;
    const { error: deleteError } = await supabase
      .from("projects")
      .delete()
      .eq("id", deleteId)
      .eq("owner_user_id", userId);

    confirmDeleteButton.disabled = false;
    confirmDeleteButton.textContent = "Delete";

    if (deleteError) {
      messageEl.textContent = deleteError.message;
      return;
    }

    const row = document.querySelector(`[data-project-row=\"${deleteId}\"]`);
    if (row) {
      row.remove();
    }

    pendingDelete = null;
    dialog.close();
    window.location.reload();
  });
}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${escapeHtml(error.message)}</p>`;
});
