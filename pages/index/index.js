import { renderFooter } from "../../components/footer/footer.js";
import { renderHeader } from "../../components/header/header.js";
import { getCurrentSession, supabase } from "../lib/supabaseClient.js";
import "../theme.css";
import "./index.css";

document.title = "TaskFlow | Home";

const app = document.querySelector("#app");

async function bootstrap() {
  let session = null;

  if (supabase) {
    session = await getCurrentSession();
  }

  const heroActions = session
    ? `
        <a class="btn btn-primary" href="/dashboard">Dashboard</a>
        <button type="button" class="btn btn-secondary" data-logout-btn>Logout</button>
      `
    : `
        <a class="btn btn-primary" href="/register">Register</a>
        <a class="btn btn-secondary" href="/login">Login</a>
      `;

  app.innerHTML = `
    <div class="page-shell">
      <div data-header></div>
      <main class="page-content">
        <section class="hero" aria-labelledby="hero-title">
          <p class="eyebrow">Plan work without the chaos</p>
          <h1 id="hero-title">Organize projects, tasks, and teams in one visual workflow.</h1>
          <p class="hero-description">
            TaskFlow is a Trello-style productivity app that helps you create projects,
            break work into tasks, and move progress across stages so everyone knows
            what is happening at a glance.
          </p>
          <div class="hero-actions">
            ${heroActions}
          </div>
        </section>

        <section class="benefits" aria-label="Main benefits">
          <article class="benefit-card">
            <h2>Clear project visibility</h2>
            <p>
              Keep every project in one place and instantly see what is queued,
              in progress, or done.
            </p>
          </article>
          <article class="benefit-card">
            <h2>Faster team collaboration</h2>
            <p>
              Share updates in real time so teammates can pick priorities and unblock
              work quickly.
            </p>
          </article>
          <article class="benefit-card">
            <h2>Simple daily execution</h2>
            <p>
              Turn ideas into tasks, assign owners, and track progress with a clean,
              easy-to-use interface.
            </p>
          </article>
        </section>
      </main>
      <div data-footer></div>
    </div>
  `;

  renderHeader(document.querySelector("[data-header]"), "/");
  renderFooter(document.querySelector("[data-footer]"));

  const logoutButton = document.querySelector("[data-logout-btn]");
  if (logoutButton && supabase) {
    logoutButton.addEventListener("click", async () => {
      logoutButton.disabled = true;
      logoutButton.textContent = "Logging out...";
      await supabase.auth.signOut();
      window.location.replace("/");
    });
  }
}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${error.message}</p>`;
});