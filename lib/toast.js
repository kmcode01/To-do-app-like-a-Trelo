function getContainer() {
  let el = document.getElementById("toast-container");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-container";
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "false");
    document.body.appendChild(el);
  }
  return el;
}

export function showToast(message, type = "success", duration = 4000) {
  const container = getContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", "status");
  toast.innerHTML = `<span class="toast-message">${message}</span><button class="toast-close" type="button" aria-label="Close notification">&times;</button>`;

  const dismiss = () => {
    toast.classList.add("toast--out");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  };

  toast.querySelector(".toast-close").addEventListener("click", dismiss);
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }
}
