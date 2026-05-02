import template from "./header.html?raw";
import "./header.css";
import { getCurrentSession, supabase } from "../../pages/lib/supabaseClient.js";

export function renderHeader(target, activeRoute = "/") {
  if (!target) {
    return;
  }

  target.innerHTML = template;

  const activeLink = target.querySelector(`[data-route="${activeRoute}"]`);
  if (activeLink) {
    activeLink.classList.add("is-active");
  }

  if (!supabase) {
    return;
  }

  getCurrentSession()
    .then((session) => {
      const navList = target.querySelector(".nav-list");
      const loginItem = target.querySelector('[data-route="/login"]')?.closest("li");
      const registerItem = target.querySelector('[data-route="/register"]')?.closest("li");
      const dashboardItem = target.querySelector('[data-route="/dashboard"]')?.closest("li");
      const projectsItem = target.querySelector('[data-route="/projects"]')?.closest("li");

      if (!navList) {
        return;
      }

      if (session) {
        if (loginItem) {
          loginItem.remove();
        }

        if (registerItem) {
          registerItem.remove();
        }

        const logoutItem = document.createElement("li");
        const logoutButton = document.createElement("button");
        logoutButton.type = "button";
        logoutButton.className = "nav-button";
        logoutButton.textContent = "Logout";
        logoutButton.addEventListener("click", async () => {
          logoutButton.disabled = true;
          logoutButton.textContent = "Logging out...";
          await supabase.auth.signOut();
          window.location.replace("/");
        });

        logoutItem.appendChild(logoutButton);
        navList.appendChild(logoutItem);
      } else {
        if (dashboardItem) {
          dashboardItem.remove();
        }

        if (projectsItem) {
          projectsItem.remove();
        }
      }
    })
    .catch(() => {
      return;
    });
}