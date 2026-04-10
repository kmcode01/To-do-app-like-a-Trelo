import template from "./header.html?raw";
import "./header.css";

export function renderHeader(target, activeRoute = "/") {
  if (!target) {
    return;
  }

  target.innerHTML = template;

  const activeLink = target.querySelector(`[data-route="${activeRoute}"]`);
  if (activeLink) {
    activeLink.classList.add("is-active");
  }
}