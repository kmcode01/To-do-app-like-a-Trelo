import { renderFooter } from "../../components/footer/footer.js";
import { renderHeader } from "../../components/header/header.js";
import { requireAuthenticatedSession, supabase } from "../../lib/supabaseClient.js";
import { showToast } from "../../lib/toast.js";
import "../../styles/theme.css";
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

function renderPage(projects, showCreatedNotice, rolesByProject, currentUserId) {
  const cards = projects.length
    ? projects
        .map(
          (project) => {
            const inferredRole = project.owner_user_id ? (project.owner_user_id === currentUserId ? "owner" : "member") : "member";
            const role = rolesByProject?.get(project.id) || inferredRole;
            const isOwner = role === "owner";
            const roleLabel = role === "owner" ? "Owner" : "Member";

            const actionLinks = `
                <a class="icon-link" href="/project/${project.id}" aria-label="View project">
                  ${iconSvg("M12 5c5.5 0 9.6 4.1 10.8 6.4.3.4.3.8 0 1.2C21.6 14.9 17.5 19 12 19S2.4 14.9 1.2 12.6a1 1 0 0 1 0-1.2C2.4 9.1 6.5 5 12 5Zm0 2.2A4.8 4.8 0 1 0 12 17a4.8 4.8 0 0 0 0-9.8Zm0 2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6")}
                </a>
                <a class="icon-link" href="/project/${project.id}/taskboard" aria-label="Open taskboard">
                  ${iconSvg("M4 6h14v2H4V6Zm0 5h14v2H4v-2Zm0 5h9v2H4v-2Z")}
                </a>
                ${
                  isOwner
                    ? `
                      <a class="icon-link" href="/project/${project.id}/edit" aria-label="Edit project">
                        ${iconSvg("M3 17.2V21h3.8l11-11.1-3.8-3.8L3 17.2Zm17.7-10.3a1 1 0 0 0 0-1.4l-2.2-2.2a1 1 0 0 0-1.4 0l-1.7 1.7 3.8 3.8 1.5-1.9Z")}
                      </a>
                      <button class="icon-btn is-danger" type="button" data-delete-project-id="${project.id}" data-delete-project-title="${escapeHtml(project.title)}" aria-label="Delete project">
                        ${iconSvg("M7 4h10l1 2h3v2H3V6h3l1-2Zm1 6h2v8H8v-8Zm6 0h2v8h-2v-8Z")}
                      </button>
                    `
                    : ""
                }
            `;

            return `
            <article class="project-card" data-project-card="${project.id}">
              <div class="project-card-body">
                <h2>${escapeHtml(project.title)}</h2>
                <p class="project-description">
                  ${escapeHtml(project.description || "No description yet.")}
                </p>
              </div>
              <div class="project-meta">
                <span class="meta-label">Created</span>
                <span class="meta-value">${formatDate(project.created_at)}</span>
                <span class="meta-label">Role</span>
                <span class="meta-value">${roleLabel}</span>
              </div>
              <div class="project-card-actions">
                ${actionLinks}
              </div>
            </article>
          `;
          }
        )
        .join("")
    : "";

  app.innerHTML = `
    <div class="page-shell">
      <div data-header></div>
      <main class="page-content">
        <div class="page-head">
          <h1>Projects</h1>
          <input
            type="search"
            class="board-search-input"
            placeholder="Search projects…"
            aria-label="Search projects"
            data-projects-search
          />
          <a class="icon-link" href="/projects/add" aria-label="Create Project" title="Create Project">
            ${iconSvg("M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z")}
          </a>
        </div>

        ${
          showCreatedNotice
            ? '<p class="notice notice-success" role="status">Project created successfully.</p>'
            : ""
        }

        ${
          projects.length
            ? `<section class="projects-grid" aria-label="Project cards">
                ${cards}
              </section>`
            : '<p class="empty-state">No projects found for this user.</p>'
        }
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

function filterProjects(query) {
  const normalized = query.trim().toLowerCase();
  let hasVisible = false;

  document.querySelectorAll("[data-project-card]").forEach((card) => {
    if (!normalized) {
      card.style.display = "";
      hasVisible = true;
      return;
    }
    const title = (card.querySelector("h2")?.textContent || "").toLowerCase();
    const desc = (card.querySelector(".project-description")?.textContent || "").toLowerCase();
    const match = title.includes(normalized) || desc.includes(normalized);
    card.style.display = match ? "" : "none";
    if (match) hasVisible = true;
  });

  const grid = document.querySelector(".projects-grid");
  const existing = document.querySelector(".search-empty-state");
  if (!hasVisible && normalized && grid) {
    if (!existing) {
      grid.insertAdjacentHTML("afterend", '<p class="search-empty-state empty-state">No matching projects.</p>');
    }
  } else if (existing) {
    existing.remove();
  }
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
    .select("id, title, description, created_at, owner_user_id")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const params = new URLSearchParams(window.location.search);
  const showCreatedNotice = params.get("created") === "1";

  const { data: memberships, error: membershipError } = await supabase
    .from("project_members")
    .select("project_id, role")
    .eq("user_id", userId);

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  const rolesByProject = new Map();
  (memberships || []).forEach((membership) => {
    rolesByProject.set(membership.project_id, membership.role);
  });

  const safeProjects = projects ?? [];
  const currentUserId = userId;
  renderPage(safeProjects, showCreatedNotice, rolesByProject, currentUserId);

  const projectsSearchInput = document.querySelector("[data-projects-search]");
  if (projectsSearchInput) {
    projectsSearchInput.addEventListener("input", () => filterProjects(projectsSearchInput.value));
  }

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

    const card = document.querySelector(`[data-project-card=\"${deleteId}\"]`);
    if (card) {
      card.remove();
    }

    pendingDelete = null;
    dialog.close();
    showToast("Project deleted");
    setTimeout(() => window.location.reload(), 1200);
  });
}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${escapeHtml(error.message)}</p>`;
});
