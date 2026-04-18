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
  const projectCards =
    projects.length > 0
      ? projects
          .map((project) => {
            const title = escapeHtml(project.title || "Untitled project");
            const description = project.description
              ? `<p class="project-description">${escapeHtml(project.description)}</p>`
              : '<p class="project-description is-muted">No description yet.</p>';
            const projectStats = taskStats.byProjectId[project.id] ?? {
              total: 0,
              pending: 0,
              done: 0
            };
            const previewId = `preview-${project.id}`;

            return `
              <li class="project-card">
                <h3>${title}</h3>
                ${description}
                <div class="project-actions-row">
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
          })
          .join("")
      : '<li class="empty-projects">No projects yet. Create your first project to start planning tasks.</li>';

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
          <ul class="projects-list">
            ${projectCards}
          </ul>
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