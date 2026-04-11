import { renderFooter } from "../../components/footer/footer.js";
import { renderHeader } from "../../components/header/header.js";
import { getSupabaseConfigError, redirectIfAuthenticated, supabase } from "../lib/supabaseClient.js";
import "../auth/auth.css";

document.title = "TaskFlow | Register";

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
        <section class="auth-grid" aria-label="Register section">
          <article class="auth-panel">
            <p class="auth-kicker">Create account</p>
            <h1 class="auth-title">Register your TaskFlow account</h1>
            <p class="auth-subtitle">Start organizing your projects with a secure Supabase-backed account.</p>

            <form class="auth-form" data-auth-form novalidate>
              <div class="field">
                <label for="email">Email</label>
                <input id="email" name="email" type="email" autocomplete="email" required />
              </div>
              <div class="field">
                <label for="password">Password</label>
                <input id="password" name="password" type="password" autocomplete="new-password" minlength="6" required />
              </div>

              <button type="submit" class="btn-primary" data-submit-btn>Create account</button>
              <p class="auth-message" data-message role="status" aria-live="polite"></p>
              <p class="auth-switch">Already have an account? <a href="/login">Login</a>.</p>
            </form>
          </article>

          <aside class="auth-info" aria-label="What you get">
            <h2>Built for daily execution</h2>
            <ul>
              <li>Create multiple projects and break them down into focused tasks.</li>
              <li>Move work through clear stages to keep momentum visible.</li>
              <li>Use one account to securely access your workspace from anywhere.</li>
            </ul>
          </aside>
        </section>
      </main>
      <div data-footer></div>
    </div>
  `;

  renderHeader(document.querySelector("[data-header]"), "/register");
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
    submitBtn.textContent = "Creating account...";

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`
      }
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Create account";

    if (error) {
      messageEl.textContent = error.message;
      messageEl.classList.add("is-error");
      return;
    }

    if (data.session) {
      window.location.replace("/dashboard");
      return;
    }

    messageEl.textContent = "Account created. Confirm your email, then login.";
    form.reset();
  });
}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${error.message}</p>`;
});
