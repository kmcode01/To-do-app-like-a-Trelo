import { renderFooter } from "../../../components/footer/footer.js";
import { renderHeader } from "../../../components/header/header.js";
import { requireAuthenticatedSession, supabase } from "../../lib/supabaseClient.js";
import "../../theme.css";
import "../shared.css";

document.title = "TaskFlow | View Project";

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
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function getProjectIdFromPath(pathname) {
  const match = pathname.match(/^\/project\/([^/]+)\/?$/);

  if (!match) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

async function bootstrap() {
  const session = await requireAuthenticatedSession("/login");

  if (!session) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const projectId = getProjectIdFromPath(window.location.pathname) || params.get("id");

  if (!projectId) {
    throw new Error("Missing project id. Open this page from the Projects list.");
  }

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, title, description, owner_user_id, created_at, updated_at")
    .eq("id", projectId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  app.innerHTML = `
    <div class="page-shell">
      <div data-header></div>
      <main class="page-content">
        <div class="page-head">
          <h1>View Project</h1>
        </div>

        <section class="detail-card" aria-label="Project details">
          <div class="detail-grid">
            <span class="detail-label">Title</span>
            <span>${escapeHtml(project.title)}</span>

            <span class="detail-label">Description</span>
            <span>${escapeHtml(project.description || "-")}</span>

            <span class="detail-label">Owner</span>
            <span>${escapeHtml(project.owner_user_id)}</span>

            <span class="detail-label">Created</span>
            <span>${formatDate(project.created_at)}</span>

            <span class="detail-label">Updated</span>
            <span>${formatDate(project.updated_at)}</span>
          </div>

          <div class="form-actions" style="margin-top: 1rem;">
            <a class="action-link" href="/project/${project.id}/edit">Edit</a>
            <a class="action-link" href="/projects">Back to Projects</a>
          </div>
        </section>
      </main>
      <div data-footer></div>
    </div>
  `;

  renderHeader(document.querySelector("[data-header]"), "/projects");
  renderFooter(document.querySelector("[data-footer]"));
}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${escapeHtml(error.message)}</p>`;
});
