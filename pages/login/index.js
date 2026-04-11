import { renderFooter } from "../../components/footer/footer.js";
import { renderHeader } from "../../components/header/header.js";
import { getSupabaseConfigError, redirectIfAuthenticated, supabase } from "../lib/supabaseClient.js";
import "../auth/auth.css";

document.title = "TaskFlow | Login";

const app = document.querySelector("#app");

async function bootstrap() {
  const alreadyLoggedIn = await redirectIfAuthenticated("/dashboard");

  if (alreadyLoggedIn) {
    return;
  }

  app.innerHTML = `
    <div class="page-shell">
      <div data-header></div>
      <main class="page-content">
        <section class="auth-grid" aria-label="Login section">
          <article class="auth-panel">
            <p class="auth-kicker">Welcome back</p>
            <h1 class="auth-title">Login to your TaskFlow workspace</h1>
            <p class="auth-subtitle">Use your email and password to continue to your dashboard.</p>

            <form class="auth-form" data-auth-form novalidate>
              <div class="field">
                <label for="email">Email</label>
                <input id="email" name="email" type="email" autocomplete="email" required />
              </div>
              <div class="field">
                <label for="password">Password</label>
                <input id="password" name="password" type="password" autocomplete="current-password" required />
              </div>

              <button type="submit" class="btn-primary" data-submit-btn>Login</button>
              <p class="auth-message" data-message role="status" aria-live="polite"></p>
              <p class="auth-switch">No account yet? <a href="/register">Create one</a>.</p>
            </form>
          </article>

          <aside class="auth-info" aria-label="Why TaskFlow">
            <h2>Track work with confidence</h2>
            <ul>
              <li>View all your projects and tasks in one board-style workflow.</li>
              <li>Keep teams aligned with clear stage progress and ownership.</li>
              <li>Resume exactly where you left off after every sign-in.</li>
            </ul>
          </aside>
        </section>
      </main>
      <div data-footer></div>
    </div>
  `;

  renderHeader(document.querySelector("[data-header]"), "/login");
  renderFooter(document.querySelector("[data-footer]"));

  const form = document.querySelector("[data-auth-form]");
  const messageEl = document.querySelector("[data-message]");
  const submitBtn = document.querySelector("[data-submit-btn]");
  const configError = getSupabaseConfigError();

  if (configError) {
    messageEl.textContent = configError;
    messageEl.classList.add("is-error");
    submitBtn.disabled = true;
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    messageEl.textContent = "";
    messageEl.classList.remove("is-error");

    if (!email || !password) {
      messageEl.textContent = "Please provide both email and password.";
      messageEl.classList.add("is-error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in...";

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    submitBtn.disabled = false;
    submitBtn.textContent = "Login";

    if (error) {
      messageEl.textContent = error.message;
      messageEl.classList.add("is-error");
      return;
    }

    window.location.replace("/dashboard");
  });
}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${error.message}</p>`;
});
