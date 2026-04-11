import { renderFooter } from "../../../components/footer/footer.js";
import { renderHeader } from "../../../components/header/header.js";
import { requireAuthenticatedSession, supabase } from "../../lib/supabaseClient.js";
import "../../theme.css";
import "../shared.css";

document.title = "TaskFlow | Add Project";

const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

  app.innerHTML = `
    <div class="page-shell">
      <div data-header></div>
      <main class="page-content">
        <div class="page-head">
          <h1>Add Project</h1>
        </div>

        <form class="form-card" data-project-form novalidate>
          <div class="field">
            <label for="title">Title</label>
            <input id="title" name="title" type="text" maxlength="120" required />
          </div>

          <div class="field">
            <label for="description">Description</label>
            <textarea id="description" name="description" maxlength="1000"></textarea>
          </div>

          <div class="form-actions">
            <button class="btn-primary" type="submit" data-submit-btn>Create</button>
            <a class="action-link" href="/projects">Back to Projects</a>
          </div>

          <p class="message" data-message role="status" aria-live="polite"></p>
        </form>
      </main>
      <div data-footer></div>
    </div>
  `;

  renderHeader(document.querySelector("[data-header]"), "/projects");
  renderFooter(document.querySelector("[data-footer]"));

  const form = document.querySelector("[data-project-form]");
  const submitBtn = document.querySelector("[data-submit-btn]");
  const messageEl = document.querySelector("[data-message]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();

    messageEl.classList.remove("is-error");
    messageEl.textContent = "";

    if (!title) {
      messageEl.textContent = "Title is required.";
      messageEl.classList.add("is-error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";

    const { error } = await supabase
      .from("projects")
      .insert({
        owner_user_id: userId,
        title,
        description: description || null
      });

    submitBtn.disabled = false;
    submitBtn.textContent = "Create";

    if (error) {
      messageEl.textContent = error.message;
      messageEl.classList.add("is-error");
      return;
    }

    window.location.replace("/projects?created=1");
  });
}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${escapeHtml(error.message)}</p>`;
});
