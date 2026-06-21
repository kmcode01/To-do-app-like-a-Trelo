import { renderFooter } from "../../components/footer/footer.js";
import { renderHeader } from "../../components/header/header.js";
import { createTaskEditor, renderTaskEditorDialog } from "../../components/task-editor/task-editor.js";
import { requireAuthenticatedSession, supabase } from "../lib/supabaseClient.js";
import { showToast } from "../lib/toast.js";
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

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, "");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function resolveDisplayName(user) {
  if (!user) {
    return "Unknown";
  }

  return user.display_name || user.email || "Unknown";
}

function getInitials(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "?";
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatSeconds(totalSeconds) {
  const n = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const REACTION_OPTIONS = ["👍", "❤️", "🎉"];

function buildMemberLabel(member) {
  return member?.display_name || member?.email || "";
}

function extractMentions(content, members = []) {
  const normalizedContent = String(content || "").toLowerCase();
  const unique = new Map();

  members.forEach((member) => {
    const label = buildMemberLabel(member);
    if (!label) {
      return;
    }

    const token = `@${label}`.toLowerCase();
    if (normalizedContent.includes(token)) {
      unique.set(member.id, { mentioned_user_id: member.id, mention_text: label });
    }
  });

  return [...unique.values()];
}

function renderCommentContent(value, mentions = []) {
  let safe = escapeHtml(value || "").replace(/\n/g, "<br />");

  if (!mentions.length) {
    return safe;
  }

  const replacements = mentions
    .map((mention) => {
      const original = mention.mention_text || resolveDisplayName(mention.app_users);
      const currentLabel = resolveDisplayName(mention.app_users) || original;
      return {
        original: escapeHtml(original),
        currentLabel: escapeHtml(currentLabel)
      };
    })
    .filter((item) => item.original)
    .sort((a, b) => b.original.length - a.original.length);

  replacements.forEach((item) => {
    const pattern = new RegExp(`@${escapeRegex(item.original)}(?=\\b|$)`, "g");
    safe = safe.replace(
      pattern,
      `<span class="mention">@${item.currentLabel}</span>`
    );
  });

  return safe;
}

function bindAutoResize(textarea) {
  if (!textarea) {
    return;
  }

  const resize = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  };

  textarea.addEventListener("input", resize);
  resize();
}

function createMentionAutocomplete(inputEl, members = []) {
  if (!inputEl) {
    return { setMembers: () => {} };
  }

  const container = inputEl.parentElement;
  const menu = document.createElement("div");
  menu.className = "mention-menu";
  menu.hidden = true;
  menu.innerHTML = "<ul></ul>";
  container?.appendChild(menu);

  let activeIndex = 0;
  let matches = [];
  let lastAtIndex = -1;

  const setMembers = (nextMembers = []) => {
    members = nextMembers;
  };

  const hideMenu = () => {
    menu.hidden = true;
    matches = [];
    activeIndex = 0;
    lastAtIndex = -1;
  };

  const renderMenu = () => {
    const list = menu.querySelector("ul");
    if (!list) {
      return;
    }

    if (!matches.length) {
      hideMenu();
      return;
    }

    list.innerHTML = matches
      .map((member, index) => {
        const label = buildMemberLabel(member);
        const isActive = index === activeIndex;
        return `
          <li>
            <button
              type="button"
              class="mention-option${isActive ? " is-active" : ""}"
              data-mention-index="${index}"
            >
              ${escapeHtml(label)}
            </button>
          </li>
        `;
      })
      .join("");

    menu.hidden = false;
  };

  const updateMatches = () => {
    const cursor = inputEl.selectionStart || 0;
    const prefix = inputEl.value.slice(0, cursor);
    const atIndex = prefix.lastIndexOf("@");
    if (atIndex === -1) {
      hideMenu();
      return;
    }

    const before = atIndex === 0 ? "" : prefix[atIndex - 1];
    if (before && !/\s/.test(before)) {
      hideMenu();
      return;
    }

    const query = prefix.slice(atIndex + 1);
    if (query.includes("\n")) {
      hideMenu();
      return;
    }

    const normalized = query.toLowerCase();
    matches = members
      .map((member) => ({ member, label: buildMemberLabel(member) }))
      .filter((entry) => entry.label && entry.label.toLowerCase().startsWith(normalized))
      .map((entry) => entry.member)
      .slice(0, 6);

    activeIndex = 0;
    lastAtIndex = atIndex;
    renderMenu();
  };

  const applySelection = (member) => {
    if (!member || lastAtIndex < 0) {
      return;
    }

    const label = buildMemberLabel(member);
    const cursor = inputEl.selectionStart || 0;
    const before = inputEl.value.slice(0, lastAtIndex);
    const after = inputEl.value.slice(cursor);
    const insert = `@${label} `;
    inputEl.value = `${before}${insert}${after}`;
    const nextCursor = before.length + insert.length;
    inputEl.setSelectionRange(nextCursor, nextCursor);
    inputEl.focus();
    hideMenu();
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  };

  inputEl.addEventListener("input", updateMatches);
  inputEl.addEventListener("click", updateMatches);
  inputEl.addEventListener("keydown", (event) => {
    if (menu.hidden || !matches.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % matches.length;
      renderMenu();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + matches.length) % matches.length;
      renderMenu();
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applySelection(matches[activeIndex]);
    }

    if (event.key === "Escape") {
      hideMenu();
    }
  });

  menu.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const button = event.target.closest("[data-mention-index]");
    if (!button) {
      return;
    }

    const index = Number(button.dataset.mentionIndex);
    const member = matches[index];
    if (member) {
      applySelection(member);
    }
  });

  inputEl.addEventListener("blur", () => {
    setTimeout(() => hideMenu(), 100);
  });

  return { setMembers };
}

const COMMENT_SELECT =
  "id, content, project_id, task_id, author_id, created_at, updated_at, app_users (display_name, email), comment_reactions (reaction, user_id), comment_mentions (mentioned_user_id, mention_text, app_users (display_name, email))";

function normalizeComment(row) {
  const authorName = resolveDisplayName(row.app_users);
  return {
    ...row,
    authorName,
    authorInitials: getInitials(authorName),
    reactions: row.comment_reactions || [],
    mentions: row.comment_mentions || []
  };
}

function renderCommentItem(comment, currentUserId, canModerate) {
  const canEdit = comment.author_id === currentUserId;
  const canDelete = canEdit || canModerate;
  const updated = comment.updated_at && comment.updated_at !== comment.created_at;
  const timeLabel = `${formatDateTime(comment.created_at)}${updated ? " (edited)" : ""}`;
  const reactions = comment.reactions || [];
  const reactionCounts = REACTION_OPTIONS.reduce((acc, option) => {
    acc[option] = 0;
    return acc;
  }, {});
  const userReactions = new Set();
  reactions.forEach((reaction) => {
    if (reactionCounts[reaction.reaction] !== undefined) {
      reactionCounts[reaction.reaction] += 1;
    }
    if (reaction.user_id === currentUserId) {
      userReactions.add(reaction.reaction);
    }
  });

  return `
    <li class="comment-item" data-comment-id="${comment.id}">
      <div class="comment-meta">
        <div class="comment-author">
          <span class="comment-avatar" aria-hidden="true">${comment.authorInitials}</span>
          <span>${escapeHtml(comment.authorName)}</span>
        </div>
        <span class="comment-time">${escapeHtml(timeLabel)}</span>
      </div>
      <div class="comment-body">${renderCommentContent(comment.content, comment.mentions)}</div>
      <div class="comment-reactions" role="group" aria-label="Reactions">
        ${REACTION_OPTIONS.map((option) => {
          const count = reactionCounts[option];
          const isActive = userReactions.has(option);
          return `
            <button
              class="reaction-btn${isActive ? " is-active" : ""}"
              type="button"
              data-comment-id="${comment.id}"
              data-reaction="${option}"
            >
              <span aria-hidden="true">${option}</span>
              ${count ? `<span class="reaction-count">${count}</span>` : ""}
            </button>
          `;
        }).join("")}
      </div>
      ${
        canEdit || canDelete
          ? `
        <div class="comment-actions">
          ${
            canEdit
              ? `<button class="comment-action-btn" type="button" data-comment-edit data-comment-id="${comment.id}">Edit</button>`
              : ""
          }
          ${
            canDelete
              ? `<button class="comment-action-btn is-danger" type="button" data-comment-delete data-comment-id="${comment.id}">Delete</button>`
              : ""
          }
        </div>`
          : ""
      }
    </li>
  `;
}

function createCommentManager({
  listEl,
  formEl,
  inputEl,
  messageEl,
  submitButton,
  cancelButton,
  countEl,
  currentUserId,
  targetType
}) {
  let targetId = null;
  let editingId = null;
  let canModerate = false;
  let members = [];
  const comments = new Map();
  const mentionAutocomplete = createMentionAutocomplete(inputEl, members);

  const setMessage = (text, isError = false) => {
    if (!messageEl) {
      return;
    }

    messageEl.textContent = text || "";
    if (isError) {
      messageEl.classList.add("is-error");
    } else {
      messageEl.classList.remove("is-error");
    }
  };

  const setSubmitState = (loading) => {
    if (!submitButton) {
      return;
    }

    submitButton.disabled = loading;
    if (loading) {
      submitButton.textContent = "Saving...";
      return;
    }

    submitButton.textContent = editingId ? "Update" : "Post";
  };

  const renderList = () => {
    if (!listEl) {
      return;
    }

    const ordered = [...comments.values()].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    listEl.innerHTML = ordered.length
      ? ordered.map((comment) => renderCommentItem(comment, currentUserId, canModerate)).join("")
      : '<li class="comment-empty">No comments yet.</li>';

    if (countEl) {
      countEl.textContent = String(ordered.length);
    }
  };

  const resetForm = () => {
    editingId = null;
    if (inputEl) {
      inputEl.value = "";
      inputEl.style.height = "";
    }
    if (cancelButton) {
      cancelButton.hidden = true;
    }
    setMessage("");
    setSubmitState(false);
  };

  const setEditing = (comment) => {
    editingId = comment.id;
    if (inputEl) {
      inputEl.value = comment.content || "";
      inputEl.focus();
    }
    if (cancelButton) {
      cancelButton.hidden = false;
    }
    setSubmitState(false);
  };

  const setTargetId = (id) => {
    targetId = id;
    resetForm();
  };

  const setMembers = (nextMembers = []) => {
    members = nextMembers;
    mentionAutocomplete.setMembers(nextMembers);
  };

  const setModeration = (value) => {
    canModerate = Boolean(value);
    renderList();
  };

  const setComments = (rows = []) => {
    comments.clear();
    rows.forEach((row) => {
      comments.set(row.id, normalizeComment(row));
    });
    renderList();
  };

  const upsertComment = (row) => {
    comments.set(row.id, normalizeComment(row));
    renderList();
  };

  const removeComment = (id) => {
    comments.delete(id);
    if (editingId === id) {
      resetForm();
    }
    renderList();
  };

  const persistMentions = async (commentId, mentions) => {
    const { error: deleteError } = await supabase
      .from("comment_mentions")
      .delete()
      .eq("comment_id", commentId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    if (!mentions.length) {
      return;
    }

    const rows = mentions.map((mention) => ({
      comment_id: commentId,
      mentioned_user_id: mention.mentioned_user_id,
      mention_text: mention.mention_text
    }));

    const { error: insertError } = await supabase.from("comment_mentions").insert(rows);
    if (insertError) {
      throw new Error(insertError.message);
    }
  };

  const submitComment = async (event) => {
    if (event) {
      event.preventDefault();
    }

    if (!targetId) {
      setMessage("Missing comment target.", true);
      return;
    }

    const content = String(inputEl?.value || "").trim();
    if (!content) {
      setMessage("Comment cannot be empty.", true);
      return;
    }

    setMessage("");
    setSubmitState(true);

    const payload = {
      content,
      author_id: currentUserId,
      project_id: targetType === "project" ? targetId : null,
      task_id: targetType === "task" ? targetId : null
    };
    const mentions = extractMentions(content, members);

    try {
      if (editingId) {
        const { error } = await supabase
          .from("comments")
          .update({ content })
          .eq("id", editingId);

        if (error) {
          throw new Error(error.message);
        }

        await persistMentions(editingId, mentions);
        const refreshed = await fetchCommentById(editingId);
        upsertComment(refreshed);
      } else {
        const { data, error } = await supabase
          .from("comments")
          .insert(payload)
          .select("id")
          .single();
        if (error) {
          throw new Error(error.message);
        }

        if (data?.id) {
          await persistMentions(data.id, mentions);
          const refreshed = await fetchCommentById(data.id);
          upsertComment(refreshed);
        }
      }

      resetForm();
    } catch (error) {
      setMessage(error.message, true);
      setSubmitState(false);
    }
  };

  const handleListClick = async (event) => {
    const reactionButton = event.target.closest("[data-reaction]");
    if (reactionButton) {
      const commentId = reactionButton.dataset.commentId;
      const reaction = reactionButton.dataset.reaction;
      const comment = comments.get(commentId);
      if (!comment || !reaction) {
        return;
      }

      const prevReactions = comment.reactions || [];
      const hasReacted = prevReactions.some(
        (entry) => entry.user_id === currentUserId && entry.reaction === reaction
      );

      const nextReactions = hasReacted
        ? prevReactions.filter(
            (r) => !(r.user_id === currentUserId && r.reaction === reaction)
          )
        : [...prevReactions, { user_id: currentUserId, reaction }];

      comments.set(commentId, { ...comment, reactions: nextReactions });
      renderList();

      try {
        if (hasReacted) {
          const { error } = await supabase
            .from("comment_reactions")
            .delete()
            .eq("comment_id", commentId)
            .eq("user_id", currentUserId)
            .eq("reaction", reaction);

          if (error) {
            throw new Error(error.message);
          }
        } else {
          const { error } = await supabase.from("comment_reactions").insert({
            comment_id: commentId,
            user_id: currentUserId,
            reaction
          });

          if (error) {
            throw new Error(error.message);
          }
        }
      } catch (error) {
        comments.set(commentId, comment);
        renderList();
        setMessage(error.message, true);
      }

      return;
    }

    const editButton = event.target.closest("[data-comment-edit]");
    if (editButton) {
      const commentId = editButton.dataset.commentId;
      const comment = comments.get(commentId);
      if (comment) {
        setEditing(comment);
      }
      return;
    }

    const deleteButton = event.target.closest("[data-comment-delete]");
    if (!deleteButton) {
      return;
    }

    const commentId = deleteButton.dataset.commentId;
    const comment = comments.get(commentId);
    if (!comment) {
      return;
    }

    const confirmDelete = window.confirm("Delete this comment?");
    if (!confirmDelete) {
      return;
    }

    try {
      const { error } = await supabase.from("comments").delete().eq("id", commentId);
      if (error) {
        throw new Error(error.message);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  };

  if (formEl) {
    formEl.addEventListener("submit", submitComment);
  }

  if (submitButton && !formEl) {
    submitButton.addEventListener("click", submitComment);
  }

  if (cancelButton) {
    cancelButton.addEventListener("click", () => resetForm());
  }

  if (listEl) {
    listEl.addEventListener("click", handleListClick);
  }

  bindAutoResize(inputEl);

  return {
    setTargetId,
    setMembers,
    setComments,
    upsertComment,
    removeComment,
    resetForm,
    setMessage,
    setModeration,
    hasComment: (id) => comments.has(id)
  };
}

async function fetchCommentsByTask(taskId) {
  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function fetchCommentById(commentId) {
  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("id", commentId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function fetchChecklistItems(taskId) {
  const { data, error } = await supabase
    .from("task_checklist_items")
    .select("id, task_id, text, checked, position, created_at")
    .eq("task_id", taskId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function createChecklistManager({ listEl, inputEl, addBtnEl, progressEl, barFillEl }) {
  let taskId = null;
  let items = [];

  function renderItems() {
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = '<li class="checklist-empty">No items yet.</li>';
      return;
    }
    listEl.innerHTML = items
      .map(
        (item) => `
      <li class="checklist-item" data-checklist-item-id="${item.id}">
        <label class="checklist-item-label">
          <input type="checkbox" class="checklist-item-check" ${item.checked ? "checked" : ""} />
          <span class="checklist-item-text${item.checked ? " is-checked" : ""}">${escapeHtml(item.text)}</span>
        </label>
        <button type="button" class="checklist-item-delete" aria-label="Delete item">&times;</button>
      </li>`
      )
      .join("");
  }

  function updateProgress() {
    const total = items.length;
    const checked = items.filter((i) => i.checked).length;
    if (progressEl) progressEl.textContent = total ? `${checked} / ${total}` : "0 / 0";
    if (barFillEl) barFillEl.style.width = total ? `${Math.round((checked / total) * 100)}%` : "0%";
  }

  function setItems(rows) {
    items = rows || [];
    renderItems();
    updateProgress();
  }

  function setTaskId(id) {
    taskId = id;
    items = [];
    if (inputEl) inputEl.value = "";
    renderItems();
    updateProgress();
  }

  function getChecklistCounts() {
    return { total: items.length, checked: items.filter((i) => i.checked).length };
  }

  async function handleAdd() {
    if (!taskId || !inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;
    const position = items.length;
    const optimistic = {
      id: crypto.randomUUID(),
      task_id: taskId,
      text,
      checked: false,
      position,
      created_at: new Date().toISOString()
    };
    items.push(optimistic);
    inputEl.value = "";
    renderItems();
    updateProgress();
    const { data, error } = await supabase
      .from("task_checklist_items")
      .insert({ task_id: taskId, text, position })
      .select("id, task_id, text, checked, position, created_at")
      .single();
    if (error) {
      items = items.filter((i) => i.id !== optimistic.id);
      renderItems();
      updateProgress();
    } else if (data) {
      const idx = items.findIndex((i) => i.id === optimistic.id);
      if (idx !== -1) items[idx] = data;
      renderItems();
      updateProgress();
    }
  }

  if (listEl) {
    listEl.addEventListener("click", async (e) => {
      const itemEl = e.target.closest("[data-checklist-item-id]");
      if (!itemEl) return;
      const id = itemEl.dataset.checklistItemId;
      if (e.target.classList.contains("checklist-item-check")) {
        const checked = e.target.checked;
        const item = items.find((i) => i.id === id);
        if (!item) return;
        const prev = item.checked;
        item.checked = checked;
        renderItems();
        updateProgress();
        const { error } = await supabase.from("task_checklist_items").update({ checked }).eq("id", id);
        if (error) {
          item.checked = prev;
          renderItems();
          updateProgress();
        }
      } else if (e.target.classList.contains("checklist-item-delete")) {
        const idx = items.findIndex((i) => i.id === id);
        if (idx === -1) return;
        const removed = items.splice(idx, 1)[0];
        renderItems();
        updateProgress();
        const { error } = await supabase.from("task_checklist_items").delete().eq("id", id);
        if (error) {
          items.splice(idx, 0, removed);
          renderItems();
          updateProgress();
        }
      }
    });
  }

  if (addBtnEl) {
    addBtnEl.addEventListener("click", handleAdd);
  }

  if (inputEl) {
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    });
  }

  return { setTaskId, setItems, getChecklistCounts };
}

function updateTaskCardChecklistBadge(card, counts) {
  if (!card) return;
  const existing = card.querySelector("[data-checklist-badge]");
  if (!counts || counts.total === 0) {
    if (existing) existing.remove();
    return;
  }
  const isComplete = counts.checked === counts.total;
  const className = `checklist-badge${isComplete ? " is-complete" : ""}`;
  const content = `☑ ${counts.checked}/${counts.total}`;
  if (existing) {
    existing.className = className;
    existing.textContent = content;
  } else {
    const meta = card.querySelector(".board-card-meta");
    if (meta) meta.insertAdjacentHTML("beforeend", `<span class="${className}" data-checklist-badge>${content}</span>`);
  }
}

function subscribeToComments({ targetType, targetId, manager }) {
  if (!targetId) {
    return null;
  }

  const filterKey = targetType === "project" ? "project_id" : "task_id";
  const channel = supabase
    .channel(`comments:${targetType}:${targetId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "comments",
        filter: `${filterKey}=eq.${targetId}`
      },
      async (payload) => {
        if (payload.eventType === "DELETE") {
          manager.removeComment(payload.old.id);
          return;
        }

        try {
          const comment = await fetchCommentById(payload.new.id);
          manager.upsertComment(comment);
        } catch (error) {
          manager.setMessage(error.message, true);
        }
      }
    )
    .subscribe();

  return channel;
}

function subscribeToCommentReactions(manager) {
  const channel = supabase
    .channel(`comment-reactions:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "comment_reactions"
      },
      async (payload) => {
        const commentId = payload.new?.comment_id || payload.old?.comment_id;
        if (!commentId || !manager.hasComment(commentId)) {
          return;
        }

        try {
          const comment = await fetchCommentById(commentId);
          manager.upsertComment(comment);
        } catch (error) {
          manager.setMessage(error.message, true);
        }
      }
    )
    .subscribe();

  return channel;
}

async function fetchTaskTimerState(taskId) {
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, total_tracked_seconds, timer_running, timer_started_at")
    .eq("id", taskId)
    .single();
  if (error) throw new Error(error.message);

  let openEntryId = null;
  if (task.timer_running) {
    const { data: entry } = await supabase
      .from("task_time_entries")
      .select("id")
      .eq("task_id", taskId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();
    if (entry) openEntryId = entry.id;
  }

  return { ...task, openEntryId };
}

function createTimerManager({ displayEl, toggleEl, messageEl, currentUserId }) {
  let taskId = null;
  let totalSeconds = 0;
  let timerRunning = false;
  let timerStartedAt = null;
  let openEntryId = null;
  let intervalId = null;

  const setMessage = (text, isError = false) => {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.classList.toggle("is-error", isError);
  };

  const updateDisplay = () => {
    if (!displayEl) return;
    const extra =
      timerRunning && timerStartedAt
        ? Math.floor((Date.now() - new Date(timerStartedAt).getTime()) / 1000)
        : 0;
    displayEl.textContent = formatSeconds(totalSeconds + extra);
  };

  const updateToggle = () => {
    if (!toggleEl) return;
    toggleEl.textContent = timerRunning ? "Stop timer" : "Start timer";
    toggleEl.classList.toggle("is-running", timerRunning);
  };

  const stopInterval = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const startInterval = () => {
    stopInterval();
    intervalId = setInterval(updateDisplay, 1000);
  };

  const init = (state) => {
    taskId = state.id;
    totalSeconds = state.total_tracked_seconds || 0;
    timerRunning = state.timer_running || false;
    timerStartedAt = state.timer_started_at || null;
    openEntryId = state.openEntryId || null;
    setMessage("");
    updateDisplay();
    updateToggle();
    if (timerRunning) {
      startInterval();
    } else {
      stopInterval();
    }
  };

  const cleanup = () => {
    stopInterval();
    taskId = null;
    openEntryId = null;
  };

  const handleToggle = async () => {
    if (!taskId || !toggleEl) return;
    toggleEl.disabled = true;

    if (timerRunning) {
      const now = new Date();
      const elapsed =
        timerStartedAt
          ? Math.max(0, Math.floor((now.getTime() - new Date(timerStartedAt).getTime()) / 1000))
          : 0;
      const newTotal = totalSeconds + elapsed;

      try {
        const { error: taskError } = await supabase
          .from("tasks")
          .update({ total_tracked_seconds: newTotal, timer_running: false, timer_started_at: null })
          .eq("id", taskId);
        if (taskError) throw new Error(taskError.message);

        if (openEntryId) {
          const { error: entryError } = await supabase
            .from("task_time_entries")
            .update({ ended_at: now.toISOString(), duration_seconds: elapsed })
            .eq("id", openEntryId);
          if (entryError) throw new Error(entryError.message);
        }

        totalSeconds = newTotal;
        timerRunning = false;
        timerStartedAt = null;
        openEntryId = null;
        stopInterval();
        updateDisplay();
        updateToggle();
      } catch (err) {
        setMessage(err.message, true);
      }
    } else {
      const now = new Date();
      try {
        const { data: entry, error: entryError } = await supabase
          .from("task_time_entries")
          .insert({ task_id: taskId, user_id: currentUserId, started_at: now.toISOString() })
          .select("id")
          .single();
        if (entryError) throw new Error(entryError.message);

        const { error: taskError } = await supabase
          .from("tasks")
          .update({ timer_running: true, timer_started_at: now.toISOString() })
          .eq("id", taskId);
        if (taskError) throw new Error(taskError.message);

        openEntryId = entry?.id || null;
        timerRunning = true;
        timerStartedAt = now.toISOString();
        updateToggle();
        startInterval();
      } catch (err) {
        setMessage(err.message, true);
      }
    }

    toggleEl.disabled = false;
  };

  if (toggleEl) {
    toggleEl.addEventListener("click", handleToggle);
  }

  return { init, cleanup };
}

const ATTACHMENTS_BUCKET = "task-attachments";
const ATTACHMENT_PREVIEW_TTL_SECONDS = 60 * 60;

function sanitizeFileName(name) {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+/, "")
    .slice(0, 120);
}

function isImageAttachment(mimeType, fileName) {
  if (mimeType && mimeType.startsWith("image/")) {
    return true;
  }

  const extension = String(fileName || "").toLowerCase().split(".").pop();
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(extension);
}

async function fetchTaskAttachments(taskId) {
  const { data, error } = await supabase
    .from("task_attachments")
    .select("id, task_id, file_name, file_path, mime_type, size, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function addAttachmentPreviewUrls(attachments) {
  const enriched = await Promise.all(
    attachments.map(async (attachment) => {
      const isImage = isImageAttachment(attachment.mime_type, attachment.file_name);
      const { data, error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(attachment.file_path, ATTACHMENT_PREVIEW_TTL_SECONDS);

      if (error) {
        return { ...attachment, isImage, previewUrl: "", downloadUrl: "" };
      }

      return {
        ...attachment,
        isImage,
        previewUrl: isImage ? data?.signedUrl || "" : "",
        downloadUrl: data?.signedUrl || ""
      };
    })
  );

  return enriched;
}

async function fetchTaskCoverUrls(taskIds) {
  if (!taskIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("task_attachments")
    .select("task_id, file_path, file_name, mime_type, created_at")
    .in("task_id", taskIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const firstImageByTask = new Map();
  (data || []).forEach((attachment) => {
    if (firstImageByTask.has(attachment.task_id)) {
      return;
    }

    if (isImageAttachment(attachment.mime_type, attachment.file_name)) {
      firstImageByTask.set(attachment.task_id, attachment);
    }
  });

  const coverMap = new Map();
  for (const [taskId, attachment] of firstImageByTask.entries()) {
    const { data: signed, error: signedError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(attachment.file_path, ATTACHMENT_PREVIEW_TTL_SECONDS);

    if (!signedError && signed?.signedUrl) {
      coverMap.set(taskId, signed.signedUrl);
    }
  }

  return coverMap;
}

async function fetchTaskCoverUrl(taskId) {
  const coverMap = await fetchTaskCoverUrls([taskId]);
  return coverMap.get(taskId) || "";
}

function updateTaskCardCover(card, coverUrl, title) {
  if (!card) {
    return;
  }

  const existing = card.querySelector(".board-cover");
  if (!coverUrl) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  const safeCoverUrl = escapeHtml(coverUrl);
  const safeTitle = escapeHtml(title || "Task");
  if (existing) {
    existing.src = coverUrl;
    existing.alt = `${safeTitle} cover`;
    return;
  }

  card.insertAdjacentHTML(
    "afterbegin",
    `<img class="board-cover" src="${safeCoverUrl}" alt="${safeTitle} cover" />`
  );
}

async function refreshAttachmentEditor(taskId, editor) {
  if (!editor) {
    return [];
  }

  const attachments = await fetchTaskAttachments(taskId);
  const enriched = await addAttachmentPreviewUrls(attachments);
  editor.setExistingAttachments(enriched);
  return enriched;
}

async function persistAttachmentChanges(taskId, editor, userId) {
  if (!editor) {
    return [];
  }

  const { uploads, deletions } = editor.getPendingChanges();
  const deletionIds = deletions.map((attachment) => attachment.id);
  const deletionPaths = deletions.map((attachment) => attachment.file_path);

  if (!uploads.length && !deletionPaths.length) {
    editor.reset();
    return [];
  }

  if (deletionPaths.length) {
    const { error: storageDeleteError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove(deletionPaths);

    if (storageDeleteError) {
      throw new Error(storageDeleteError.message);
    }

    const { error: deleteError } = await supabase
      .from("task_attachments")
      .delete()
      .in("id", deletionIds);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  if (uploads.length) {
    const rows = [];
    const uploadedPaths = [];

    for (const upload of uploads) {
      const safeName = sanitizeFileName(upload.file.name || "attachment");
      const filePath = `${taskId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(filePath, upload.file, {
          contentType: upload.file.type || "application/octet-stream",
          upsert: false
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      uploadedPaths.push(filePath);

      rows.push({
        task_id: taskId,
        file_name: upload.file.name,
        file_path: filePath,
        mime_type: upload.file.type || null,
        size: upload.file.size || null,
        created_by_user_id: userId
      });
    }

    if (rows.length) {
      const { error: insertError } = await supabase.from("task_attachments").insert(rows);
      if (insertError) {
        if (uploadedPaths.length) {
          await supabase.storage.from(ATTACHMENTS_BUCKET).remove(uploadedPaths);
        }
        throw new Error(insertError.message);
      }
    }
  }

  return refreshAttachmentEditor(taskId, editor);
}

async function fetchUserTasks() {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, description_html, created_at, done, status, priority, stage_id, project_id, total_tracked_seconds, timer_running, timer_started_at, projects(title), project_stages!tasks_project_stage_fk(name)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

function resolveTaskStatus(task) {
  const stageName = String(task.project_stages?.name || "").toLowerCase();
  const status = String(task.status || "").toLowerCase();

  if (status === "done" || status === "in_progress") {
    return status;
  }

  if (status === "todo" || status === "not_started") {
    return "not_started";
  }

  if (task.done) {
    return "done";
  }

  if (stageName.includes("done")) {
    return "done";
  }

  if (stageName.includes("in progress")) {
    return "in_progress";
  }

  return "not_started";
}

function renderTaskCard(task, statusKey, coverUrl, checklistCounts = null) {
  const title = escapeHtml(task.title || "Untitled task");
  const projectTitle = escapeHtml(task.projects?.title || "Project");
  const priority = escapeHtml(task.priority || "medium");
  const timerRunning = Boolean(task.timer_running);
  const timerStartedAt = task.timer_started_at || null;
  const totalSeconds = task.total_tracked_seconds || 0;
  const liveSeconds =
    timerRunning && timerStartedAt
      ? Math.floor((Date.now() - new Date(timerStartedAt).getTime()) / 1000)
      : 0;
  const descriptionText = stripHtml(task.description_html || "");
  const coverMarkup = coverUrl
    ? `<img class="board-cover" src="${escapeHtml(coverUrl)}" alt="${title} cover" />`
    : "";
  const description = descriptionText
    ? `<p class="project-description">${escapeHtml(descriptionText)}</p>`
    : '<p class="project-description is-muted">No description yet.</p>';
  const statusLabel =
    statusKey === "done"
      ? "Done"
      : statusKey === "in_progress"
        ? "In Progress"
        : "Not Started";
  const checklistBadge =
    checklistCounts && checklistCounts.total > 0
      ? `<span class="checklist-badge${checklistCounts.checked === checklistCounts.total ? " is-complete" : ""}" data-checklist-badge>☑ ${checklistCounts.checked}/${checklistCounts.total}</span>`
      : "";

  return `
    <li class="board-card" draggable="true" data-task-id="${task.id}" data-status="${statusKey}">
      ${coverMarkup}
      <div class="board-card-body">
        <h3 data-task-title>${title}</h3>
        <div data-task-description>${description}</div>
      </div>
      <div class="board-card-meta">
        <span class="status-pill status-${statusKey}">${statusLabel}</span>
        <span class="meta-text">${projectTitle}</span>
      </div>
      <div class="board-card-meta">
        <span class="priority-badge priority-${priority}" data-task-priority>${priority}</span>
        <span class="meta-text">Created ${formatDate(task.created_at)}</span>
        ${checklistBadge}
      </div>
      <div class="task-timer">
        <span class="task-timer-display" data-timer-display>${formatSeconds(totalSeconds + liveSeconds)}</span>
        <button
          type="button"
          class="task-timer-btn${timerRunning ? " is-running" : ""}"
          data-timer-toggle
          data-task-id="${task.id}"
        >${timerRunning ? "Stop" : "Start"}</button>
      </div>
      <div class="project-actions-row board-actions">
        <a class="project-action-btn project-action-primary" href="/project/${task.project_id}/taskboard">Taskboard</a>
        <button
          type="button"
          class="project-action-btn project-action-secondary"
          data-task-edit
          data-task-id="${task.id}"
          data-task-project-id="${task.project_id}"
          data-task-title="${title}"
          data-task-description="${escapeHtml(descriptionText)}"
          data-task-priority="${priority}"
          data-task-done="${task.done ? "true" : "false"}"
          data-task-status="${escapeHtml(task.status || "")}"
        >
          Edit
        </button>
        <button
          type="button"
          class="project-action-btn project-action-secondary"
          data-task-open-checklist
          data-task-id="${task.id}"
          data-task-title="${title}"
        >
          Checklist
        </button>
        <button
          type="button"
          class="project-action-btn project-action-danger"
          data-task-delete
          data-task-id="${task.id}"
        >
          Delete
        </button>
      </div>
    </li>
  `;
}

function statusLabelFor(statusKey) {
  if (statusKey === "done") {
    return "Done";
  }

  if (statusKey === "in_progress") {
    return "In Progress";
  }

  return "Not Started";
}

function updateCardStatus(card, statusKey) {
  if (!card) {
    return;
  }

  const pill = card.querySelector(".status-pill");
  if (!pill) {
    return;
  }

  card.dataset.status = statusKey;
  pill.classList.remove("status-not_started", "status-in_progress", "status-done");
  pill.classList.add(`status-${statusKey}`);
  pill.textContent = statusLabelFor(statusKey);

  const stageEl = card.querySelector("[data-task-stage]");
  if (stageEl) {
    stageEl.textContent = `Stage: ${statusLabelFor(statusKey)}`;
  }
}

function moveCardToStatusColumn(card, statusKey) {
  if (!card || !statusKey) {
    return;
  }

  const sourceList = card.closest(".board-card-list");
  const targetList = document.querySelector(
    `.board-column[data-status="${statusKey}"] .board-card-list`
  );

  if (!targetList) {
    return;
  }

  if (sourceList === targetList) {
    updateCardStatus(card, statusKey);
    return;
  }

  const targetEmpty = targetList.querySelector(".empty-projects");
  if (targetEmpty) {
    targetEmpty.remove();
  }

  targetList.prepend(card);
  updateCardStatus(card, statusKey);

  if (sourceList && !sourceList.querySelector(".board-card")) {
    sourceList.insertAdjacentHTML(
      "beforeend",
      '<li class="empty-projects">No tasks in this stage.</li>'
    );
  }

  updateColumnCounts();
}

function updateColumnCounts() {
  document.querySelectorAll(".board-column").forEach((column) => {
    const badge = column.querySelector(".board-badge");
    if (!badge) {
      return;
    }

    const count = column.querySelectorAll(".board-card").length;
    badge.textContent = count;
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [
    ...container.querySelectorAll(".board-card:not(.is-dragging)")
  ];

  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }

      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function setupBoardDragAndDrop() {
  const lists = document.querySelectorAll(".board-card-list");
  const columns = document.querySelectorAll(".board-column");

  document.querySelectorAll(".board-card").forEach((card) => {
    card.addEventListener("dragstart", () => {
      card.classList.add("is-dragging");
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      document.querySelectorAll(".board-column").forEach((column) => {
        column.classList.remove("is-drop-target");
      });
      updateColumnCounts();
    });
  });

  lists.forEach((list) => {
    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      const draggingCard = document.querySelector(".board-card.is-dragging");
      if (!draggingCard) {
        return;
      }

      const afterElement = getDragAfterElement(list, event.clientY);
      if (afterElement) {
        list.insertBefore(draggingCard, afterElement);
      } else {
        list.appendChild(draggingCard);
      }
    });
  });

  columns.forEach((column) => {
    column.addEventListener("dragover", (event) => {
      event.preventDefault();
      column.classList.add("is-drop-target");
      const list = column.querySelector(".board-card-list");
      if (!list) {
        return;
      }

      const draggingCard = document.querySelector(".board-card.is-dragging");
      if (!draggingCard) {
        return;
      }

      const afterElement = getDragAfterElement(list, event.clientY);
      if (afterElement) {
        list.insertBefore(draggingCard, afterElement);
      } else {
        list.appendChild(draggingCard);
      }
    });

    column.addEventListener("dragleave", () => {
      column.classList.remove("is-drop-target");
    });

    column.addEventListener("drop", async () => {
      const list = column.querySelector(".board-card-list");
      const draggingCard = document.querySelector(".board-card.is-dragging");
      if (!list || !draggingCard) {
        return;
      }

      const emptyPlaceholder = list.querySelector(".empty-projects");
      if (emptyPlaceholder) {
        emptyPlaceholder.remove();
      }

      const statusKey = column.dataset.status;
      if (statusKey) {
        updateCardStatus(draggingCard, statusKey);
      }

      column.classList.remove("is-drop-target");
      updateColumnCounts();

      const taskId = draggingCard.dataset.taskId;
      if (!taskId || !statusKey) {
        return;
      }

      const doneFlag = statusKey === "done";
      const statusValue = statusKey === "not_started" ? "todo" : statusKey;

      const { error } = await supabase
        .from("tasks")
        .update({ done: doneFlag, status: statusValue })
        .eq("id", taskId);

      if (error) {
        console.error(error);
      }
    });
  });
}



async function bootstrap() {
  app.innerHTML = `
    <div class="page-shell">
      <div class="skeleton-header-bar"></div>
      <main class="page-content">
        <div class="skeleton skeleton-h1"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="summary-grid">
          <div class="skeleton skeleton-summary-card"></div>
          <div class="skeleton skeleton-summary-card"></div>
          <div class="skeleton skeleton-summary-card"></div>
          <div class="skeleton skeleton-summary-card"></div>
        </div>
        <div class="board-grid">
          <div class="skeleton-board-col">
            <div class="skeleton skeleton-col-head"></div>
            <div class="skeleton skeleton-board-card"></div>
            <div class="skeleton skeleton-board-card"></div>
          </div>
          <div class="skeleton-board-col">
            <div class="skeleton skeleton-col-head"></div>
            <div class="skeleton skeleton-board-card"></div>
          </div>
          <div class="skeleton-board-col">
            <div class="skeleton skeleton-col-head"></div>
            <div class="skeleton skeleton-board-card"></div>
          </div>
        </div>
      </main>
    </div>
  `;

  const session = await requireAuthenticatedSession("/login");

  if (!session) {
    return;
  }

  const userId = session.user?.id;

  if (!userId) {
    throw new Error("Could not resolve the current user.");
  }

  const tasks = await fetchUserTasks();
  const coverMap = await fetchTaskCoverUrls(tasks.map((task) => task.id));

  const checklistCountMap = new Map();
  if (tasks.length) {
    const { data: clData } = await supabase
      .from("task_checklist_items")
      .select("task_id, checked")
      .in("task_id", tasks.map((t) => t.id));
    (clData || []).forEach((row) => {
      const entry = checklistCountMap.get(row.task_id) || { total: 0, checked: 0 };
      entry.total++;
      if (row.checked) entry.checked++;
      checklistCountMap.set(row.task_id, entry);
    });
  }

  const projectIds = [...new Set(tasks.map((task) => task.project_id).filter(Boolean))];
  const ownersByProject = new Map();
  if (projectIds.length) {
    const { data: projects, error: projectError } = await supabase
      .from("projects")
      .select("id, owner_user_id")
      .in("id", projectIds);

    if (!projectError) {
      (projects || []).forEach((project) => {
        ownersByProject.set(project.id, project.owner_user_id);
      });
    }
  }

  const membersByProject = new Map();
  if (projectIds.length) {
    const { data: memberRows, error: memberError } = await supabase
      .from("project_members")
      .select("project_id, user_id")
      .in("project_id", projectIds);

    if (memberError) {
      throw new Error(memberError.message);
    }

    const memberIds = [...new Set((memberRows || []).map((row) => row.user_id).filter(Boolean))];
    const membersById = new Map();
    if (memberIds.length) {
      const { data: userRows, error: userError } = await supabase
        .from("app_users")
        .select("id, display_name, email")
        .in("id", memberIds);

      if (userError) {
        throw new Error(userError.message);
      }

      (userRows || []).forEach((user) => {
        membersById.set(user.id, user);
      });
    }

    (memberRows || []).forEach((row) => {
      const list = membersByProject.get(row.project_id) || [];
      list.push({ id: row.user_id, ...membersById.get(row.user_id) });
      membersByProject.set(row.project_id, list);
    });
  }

  const email = session.user?.email ?? "your account";
  const boardColumns = {
    not_started: [],
    in_progress: [],
    done: []
  };

  tasks.forEach((task) => {
    const statusKey = resolveTaskStatus(task);
    boardColumns[statusKey].push(
      renderTaskCard(task, statusKey, coverMap.get(task.id), checklistCountMap.get(task.id) || null)
    );
  });

  const columnCounts = {
    not_started: boardColumns.not_started.length,
    in_progress: boardColumns.in_progress.length,
    done: boardColumns.done.length
  };

  const stats = {
    total: tasks.length,
    notStarted: boardColumns.not_started.length,
    inProgress: boardColumns.in_progress.length,
    done: boardColumns.done.length
  };

  if (tasks.length === 0) {
    boardColumns.not_started.push(
      '<li class="empty-projects">No tasks yet. Create one in your taskboard.</li>'
    );
  }

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
            <p class="summary-label">Total tasks</p>
            <p class="summary-value">${stats.total}</p>
          </article>
          <article class="summary-card">
            <p class="summary-label">Not started</p>
            <p class="summary-value">${stats.notStarted}</p>
          </article>
          <article class="summary-card">
            <p class="summary-label">In progress</p>
            <p class="summary-value">${stats.inProgress}</p>
          </article>
          <article class="summary-card">
            <p class="summary-label">Done</p>
            <p class="summary-value">${stats.done}</p>
          </article>
        </section>

        <section class="projects-section" aria-label="Tasks board">
          <div class="projects-heading-row">
            <h2>Your tasks</h2>
            <a class="secondary-link" href="/projects">Projects</a>
          </div>
          <div class="board-grid" role="list">
            <section class="board-column" aria-label="Not Started" data-status="not_started">
              <div class="board-column-header">
                <h3>Not Started</h3>
                <span class="board-badge">${columnCounts.not_started}</span>
              </div>
              <div class="board-divider" aria-hidden="true"></div>
              <ul class="board-card-list">
                ${boardColumns.not_started.join("")}
              </ul>
            </section>

            <section class="board-column" aria-label="In Progress" data-status="in_progress">
              <div class="board-column-header">
                <h3>In Progress</h3>
                <span class="board-badge">${columnCounts.in_progress}</span>
              </div>
              <div class="board-divider" aria-hidden="true"></div>
              <ul class="board-card-list">
                ${boardColumns.in_progress.join("") || '<li class="empty-projects">No tasks in progress.</li>'}
              </ul>
            </section>

            <section class="board-column" aria-label="Done" data-status="done">
              <div class="board-column-header">
                <h3>Done</h3>
                <span class="board-badge">${columnCounts.done}</span>
              </div>
              <div class="board-divider" aria-hidden="true"></div>
              <ul class="board-card-list">
                ${boardColumns.done.join("") || '<li class="empty-projects">No completed tasks yet.</li>'}
              </ul>
            </section>
          </div>
        </section>

      </main>
      <div data-footer></div>
    </div>

    ${renderTaskEditorDialog({
      dialogAttr: "data-task-edit-dialog",
      formAttr: "data-task-edit-form",
      title: "Edit task",
      submitLabel: "Save",
      messageAttr: "data-task-edit-message",
      submitAttr: "data-task-edit-submit",
      cancelAttr: "data-task-edit-cancel",
      mode: "edit"
    })}

    <dialog class="task-dialog" data-task-delete-dialog>
      <div class="dialog-body">
        <h2>Delete task</h2>
        <p data-task-delete-message>Are you sure you want to delete this task?</p>
        <div class="dialog-actions">
          <button class="btn-secondary" type="button" data-task-delete-cancel>Cancel</button>
          <button class="btn-danger" type="button" data-task-delete-confirm>Delete</button>
        </div>
      </div>
    </dialog>

    <dialog class="checklist-dialog" data-checklist-dialog>
      <div class="checklist-panel">
        <div class="checklist-header">
          <h2 class="checklist-dialog-title" data-checklist-dialog-title>Checklist</h2>
          <button type="button" class="btn-secondary" data-checklist-dialog-close>Close</button>
        </div>
        <div class="checklist-progress-text" data-checklist-progress>0 / 0</div>
        <div class="checklist-bar">
          <div class="checklist-bar-fill" data-checklist-bar-fill style="width:0%"></div>
        </div>
        <ul class="checklist-list" data-checklist-list></ul>
        <div class="checklist-add">
          <input
            type="text"
            class="checklist-add-input"
            placeholder="Add an item…"
            maxlength="200"
            data-checklist-input
          />
          <button type="button" class="checklist-add-btn" data-checklist-add-btn>Add</button>
        </div>
      </div>
    </dialog>
  `;

  renderHeader(document.querySelector("[data-header]"), "/dashboard");
  renderFooter(document.querySelector("[data-footer]"));

  setupBoardDragAndDrop();

  // ── Card timers ──────────────────────────────────────────────────────────
  const taskTimers = new Map();
  tasks.forEach((task) => {
    taskTimers.set(task.id, {
      totalSeconds: task.total_tracked_seconds || 0,
      timerRunning: Boolean(task.timer_running),
      timerStartedAt: task.timer_started_at || null,
      intervalId: null
    });
  });

  function stopCardTimerInterval(taskId) {
    const state = taskTimers.get(taskId);
    if (!state || state.intervalId === null) return;
    clearInterval(state.intervalId);
    state.intervalId = null;
  }

  function startCardTimerInterval(taskId) {
    stopCardTimerInterval(taskId);
    const state = taskTimers.get(taskId);
    if (!state) return;
    state.intervalId = setInterval(() => {
      const card = document.querySelector(`.board-card[data-task-id="${taskId}"]`);
      const displayEl = card?.querySelector("[data-timer-display]");
      if (!displayEl) return;
      const extra =
        state.timerRunning && state.timerStartedAt
          ? Math.floor((Date.now() - new Date(state.timerStartedAt).getTime()) / 1000)
          : 0;
      displayEl.textContent = formatSeconds(state.totalSeconds + extra);
    }, 1000);
  }

  function updateCardTimerUI(taskId) {
    const state = taskTimers.get(taskId);
    if (!state) return;
    const card = document.querySelector(`.board-card[data-task-id="${taskId}"]`);
    if (!card) return;
    const displayEl = card.querySelector("[data-timer-display]");
    const toggleBtn = card.querySelector("[data-timer-toggle]");
    if (displayEl) {
      const extra =
        state.timerRunning && state.timerStartedAt
          ? Math.floor((Date.now() - new Date(state.timerStartedAt).getTime()) / 1000)
          : 0;
      displayEl.textContent = formatSeconds(state.totalSeconds + extra);
    }
    if (toggleBtn) {
      toggleBtn.textContent = state.timerRunning ? "Stop" : "Start";
      toggleBtn.classList.toggle("is-running", state.timerRunning);
    }
  }

  taskTimers.forEach((state, taskId) => {
    if (state.timerRunning) startCardTimerInterval(taskId);
  });

  const boardGrid = document.querySelector(".board-grid");
  if (boardGrid) {
    boardGrid.addEventListener("click", async (event) => {
      const toggleBtn = event.target.closest("[data-timer-toggle]");
      if (!toggleBtn || toggleBtn.disabled) return;

      const taskId = toggleBtn.dataset.taskId;
      if (!taskId) return;

      const state = taskTimers.get(taskId);
      if (!state) return;

      toggleBtn.disabled = true;

      try {
        if (state.timerRunning) {
          const now = new Date();
          const elapsed = state.timerStartedAt
            ? Math.max(
                0,
                Math.floor((now.getTime() - new Date(state.timerStartedAt).getTime()) / 1000)
              )
            : 0;
          const newTotal = state.totalSeconds + elapsed;

          const { error: taskError } = await supabase
            .from("tasks")
            .update({
              total_tracked_seconds: newTotal,
              timer_running: false,
              timer_started_at: null
            })
            .eq("id", taskId);
          if (taskError) throw new Error(taskError.message);

          const { data: openEntry } = await supabase
            .from("task_time_entries")
            .select("id")
            .eq("task_id", taskId)
            .is("ended_at", null)
            .order("started_at", { ascending: false })
            .limit(1)
            .single();

          if (openEntry?.id) {
            await supabase
              .from("task_time_entries")
              .update({ ended_at: now.toISOString(), duration_seconds: elapsed })
              .eq("id", openEntry.id);
          }

          stopCardTimerInterval(taskId);
          state.totalSeconds = newTotal;
          state.timerRunning = false;
          state.timerStartedAt = null;
          updateCardTimerUI(taskId);
        } else {
          const now = new Date();

          const { data: entry, error: entryError } = await supabase
            .from("task_time_entries")
            .insert({ task_id: taskId, user_id: userId, started_at: now.toISOString() })
            .select("id")
            .single();
          if (entryError) throw new Error(entryError.message);

          const { error: taskError } = await supabase
            .from("tasks")
            .update({ timer_running: true, timer_started_at: now.toISOString() })
            .eq("id", taskId);
          if (taskError) throw new Error(taskError.message);

          state.timerRunning = true;
          state.timerStartedAt = now.toISOString();
          updateCardTimerUI(taskId);
          startCardTimerInterval(taskId);
        }
      } catch (err) {
        console.error(err);
      }

      toggleBtn.disabled = false;
    });
  }
  // ── End card timers ──────────────────────────────────────────────────────

  const editDialog = document.querySelector("[data-task-edit-dialog]");
  const editEditor = editDialog ? createTaskEditor(editDialog) : null;
  const editForm = editEditor?.form;
  const editMessage = editEditor?.messageEl;
  const editCancel = editEditor?.cancelButton;
  const editSubmit = editEditor?.submitButton;
  const deleteDialog = document.querySelector("[data-task-delete-dialog]");
  const deleteMessage = document.querySelector("[data-task-delete-message]");
  const deleteCancel = document.querySelector("[data-task-delete-cancel]");
  const deleteConfirm = document.querySelector("[data-task-delete-confirm]");
  const editFields = editEditor?.fields;
  const taskCommentElements = editEditor?.comments;

  let activeTaskId = null;
  let activeTaskCard = null;
  let taskCommentChannel = null;
  let taskReactionChannel = null;

  const taskComments = taskCommentElements?.listEl
    ? createCommentManager({
        listEl: taskCommentElements.listEl,
        formEl: null,
        inputEl: taskCommentElements.inputEl,
        messageEl: taskCommentElements.messageEl,
        submitButton: taskCommentElements.submitButton,
        cancelButton: taskCommentElements.cancelButton,
        countEl: taskCommentElements.countEl,
        currentUserId: userId,
        targetType: "task"
      })
    : null;

  const timerManager = editEditor?.timer
    ? createTimerManager({
        displayEl: editEditor.timer.display,
        toggleEl: editEditor.timer.toggle,
        messageEl: editEditor.timer.message,
        currentUserId: userId
      })
    : null;

  const checklistDialog = document.querySelector("[data-checklist-dialog]");
  const checklistDialogTitle = document.querySelector("[data-checklist-dialog-title]");
  const checklistDialogClose = document.querySelector("[data-checklist-dialog-close]");
  const checklistManager = checklistDialog
    ? createChecklistManager({
        listEl: checklistDialog.querySelector("[data-checklist-list]"),
        inputEl: checklistDialog.querySelector("[data-checklist-input]"),
        addBtnEl: checklistDialog.querySelector("[data-checklist-add-btn]"),
        progressEl: checklistDialog.querySelector("[data-checklist-progress]"),
        barFillEl: checklistDialog.querySelector("[data-checklist-bar-fill]")
      })
    : null;

  let checklistActiveCard = null;

  app.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-task-open-checklist]");
    if (!btn) return;
    const taskId = btn.dataset.taskId || null;
    const title = btn.dataset.taskTitle || "Checklist";
    checklistActiveCard = btn.closest(".board-card");
    if (checklistDialogTitle) checklistDialogTitle.textContent = title;
    if (checklistManager && taskId) {
      checklistManager.setTaskId(taskId);
      try {
        const items = await fetchChecklistItems(taskId);
        checklistManager.setItems(items);
      } catch (_) {}
    }
    checklistDialog?.showModal();
  });

  if (checklistDialogClose) {
    checklistDialogClose.addEventListener("click", () => checklistDialog?.close());
  }

  if (checklistDialog) {
    checklistDialog.addEventListener("close", () => {
      if (checklistActiveCard && checklistManager) {
        updateTaskCardChecklistBadge(checklistActiveCard, checklistManager.getChecklistCounts());
      }
      checklistManager?.setTaskId(null);
      checklistActiveCard = null;
    });
  }

  const loadTaskComments = async (taskId, projectId) => {
    if (!taskComments) {
      return;
    }

    taskComments.setTargetId(taskId);
    taskComments.setMessage("");
    taskComments.setModeration(ownersByProject.get(projectId) === userId);
    taskComments.setMembers(membersByProject.get(projectId) || []);

    try {
      const rows = await fetchCommentsByTask(taskId);
      taskComments.setComments(rows);
    } catch (error) {
      taskComments.setMessage(error.message, true);
    }

    if (taskCommentChannel) {
      supabase.removeChannel(taskCommentChannel);
    }

    taskCommentChannel = subscribeToComments({
      targetType: "task",
      targetId: taskId,
      manager: taskComments
    });

    if (taskReactionChannel) {
      supabase.removeChannel(taskReactionChannel);
    }

    taskReactionChannel = subscribeToCommentReactions(taskComments);
  };

  document.querySelectorAll("[data-task-edit]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeTaskId = button.dataset.taskId || null;
      activeTaskCard = button.closest(".board-card");
      const activeProjectId = button.dataset.taskProjectId || null;
      if (editFields?.titleInput) {
        editFields.titleInput.value = button.dataset.taskTitle || "";
      }
      if (editFields?.descriptionInput) {
        editFields.descriptionInput.value = button.dataset.taskDescription || "";
      }
      if (editFields?.prioritySelect) {
        editFields.prioritySelect.value = button.dataset.taskPriority || "medium";
      }
      if (editFields?.statusClosed && editFields?.statusOpen) {
        const closed = button.dataset.taskDone === "true" || button.dataset.taskStatus === "done";
        editFields.statusClosed.checked = closed;
        editFields.statusOpen.checked = !closed;
      }
      if (editMessage) {
        editMessage.textContent = "";
        editMessage.classList.remove("is-error");
      }

      if (activeTaskId && editEditor?.attachments) {
        try {
          await refreshAttachmentEditor(activeTaskId, editEditor.attachments);
        } catch (attachmentError) {
          if (editMessage) {
            editMessage.textContent = attachmentError.message;
            editMessage.classList.add("is-error");
          }
        }
      }

      if (activeTaskId && activeProjectId) {
        await loadTaskComments(activeTaskId, activeProjectId);
      }

      if (activeTaskId && timerManager) {
        try {
          const timerState = await fetchTaskTimerState(activeTaskId);
          timerManager.init(timerState);
        } catch (_timerErr) {
          // non-critical
        }
      }

      editDialog.showModal();
    });
  });

  if (editCancel) {
    editCancel.addEventListener("click", () => {
      if (timerManager) {
        timerManager.cleanup();
      }
      if (editEditor?.attachments) {
        editEditor.attachments.reset();
      }
      if (taskComments) {
        taskComments.setComments([]);
        taskComments.resetForm();
      }
      if (taskCommentChannel) {
        supabase.removeChannel(taskCommentChannel);
        taskCommentChannel = null;
      }
      if (taskReactionChannel) {
        supabase.removeChannel(taskReactionChannel);
        taskReactionChannel = null;
      }
      editDialog.close();
    });
  }

  if (editDialog && editEditor?.attachments) {
    editDialog.addEventListener("close", async () => {
      if (timerManager) {
        timerManager.cleanup();
      }
      editEditor.attachments.reset();
      if (taskComments) {
        taskComments.setComments([]);
        taskComments.resetForm();
      }
      if (taskCommentChannel) {
        supabase.removeChannel(taskCommentChannel);
        taskCommentChannel = null;
      }
      if (taskReactionChannel) {
        supabase.removeChannel(taskReactionChannel);
        taskReactionChannel = null;
      }

      if (activeTaskId) {
        try {
          const freshState = await fetchTaskTimerState(activeTaskId);
          const cardState = taskTimers.get(activeTaskId);
          if (cardState) {
            stopCardTimerInterval(activeTaskId);
            cardState.totalSeconds = freshState.total_tracked_seconds || 0;
            cardState.timerRunning = freshState.timer_running || false;
            cardState.timerStartedAt = freshState.timer_started_at || null;
            updateCardTimerUI(activeTaskId);
            if (cardState.timerRunning) startCardTimerInterval(activeTaskId);
          }
        } catch (_) {
          // non-critical
        }
      }
    });
  }

  if (editForm) {
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (editMessage) {
        editMessage.textContent = "";
        editMessage.classList.remove("is-error");
      }

      if (!activeTaskId) {
        if (editMessage) {
          editMessage.textContent = "Missing task id.";
          editMessage.classList.add("is-error");
        }
        return;
      }

      const title = String(editFields?.titleInput?.value || "").trim();
      const description = String(editFields?.descriptionInput?.value || "").trim();
      const priority = String(editFields?.prioritySelect?.value || "medium");
      const done = editFields?.statusClosed?.checked ?? false;

      if (!title) {
        if (editMessage) {
          editMessage.textContent = "Title is required.";
          editMessage.classList.add("is-error");
        }
        return;
      }

      editSubmit.disabled = true;
      editSubmit.textContent = "Saving...";

      const descriptionHtml = description ? `<p>${escapeHtml(description)}</p>` : null;
      const editBtn = activeTaskCard ? activeTaskCard.querySelector('[data-task-edit]') : null;
      const currentStatus = editBtn?.dataset.taskStatus || "";
      const openStatusValue = currentStatus === "in_progress" ? "in_progress" : "todo";
      const statusValue = done ? "done" : openStatusValue;

      const { error } = await supabase
        .from("tasks")
        .update({
          title,
          description_html: descriptionHtml,
          description: description || null,
          priority,
          done,
          status: statusValue
        })
        .eq("id", activeTaskId);

      editSubmit.disabled = false;
      editSubmit.textContent = "Save";

      if (error) {
        if (editMessage) {
          editMessage.textContent = error.message;
          editMessage.classList.add("is-error");
        }
        return;
      }

      editSubmit.disabled = true;
      editSubmit.textContent = "Saving attachments...";

      try {
        await persistAttachmentChanges(activeTaskId, editEditor?.attachments, userId);
        if (activeTaskCard) {
          const coverUrl = await fetchTaskCoverUrl(activeTaskId);
          updateTaskCardCover(activeTaskCard, coverUrl, title);
        }
      } catch (attachmentError) {
        editSubmit.disabled = false;
        editSubmit.textContent = "Save";
        if (editMessage) {
          editMessage.textContent = attachmentError.message;
          editMessage.classList.add("is-error");
        }
        return;
      }

      editSubmit.disabled = false;
      editSubmit.textContent = "Save";

      if (activeTaskCard) {
        const titleEl = activeTaskCard.querySelector("[data-task-title]");
        const descEl = activeTaskCard.querySelector("[data-task-description]");
        const priorityEl = activeTaskCard.querySelector("[data-task-priority]");
        if (titleEl) {
          titleEl.textContent = title;
        }
        if (descEl) {
          descEl.innerHTML = description
            ? `<p class="project-description">${escapeHtml(description)}</p>`
            : '<p class="project-description is-muted">No description yet.</p>';
        }
        if (priorityEl) {
          priorityEl.textContent = priority;
          priorityEl.className = `priority-badge priority-${priority}`;
        }

        if (editBtn) {
          editBtn.dataset.taskDone = done ? "true" : "false";
          editBtn.dataset.taskStatus = statusValue;
        }

        const newKey =
          statusValue === "done"
            ? "done"
            : statusValue === "in_progress"
              ? "in_progress"
              : "not_started";
        moveCardToStatusColumn(activeTaskCard, newKey);
      }

      editDialog.close();
      showToast("Task saved");
    });
  }

  document.querySelectorAll("[data-task-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTaskId = button.dataset.taskId || null;
      activeTaskCard = button.closest(".board-card");
      deleteMessage.textContent = "Are you sure you want to delete this task?";
      deleteDialog.showModal();
    });
  });

  if (deleteCancel) {
    deleteCancel.addEventListener("click", () => {
      deleteDialog.close();
    });
  }

  if (deleteConfirm) {
    deleteConfirm.addEventListener("click", async () => {
      if (!activeTaskId) {
        deleteDialog.close();
        return;
      }

      deleteConfirm.disabled = true;
      deleteConfirm.textContent = "Deleting...";

      const { error } = await supabase.from("tasks").delete().eq("id", activeTaskId);

      deleteConfirm.disabled = false;
      deleteConfirm.textContent = "Delete";

      if (error) {
        deleteMessage.textContent = error.message;
        return;
      }

      if (activeTaskCard) {
        const list = activeTaskCard.closest(".board-card-list");
        activeTaskCard.remove();
        if (list && !list.querySelector(".board-card")) {
          list.insertAdjacentHTML(
            "beforeend",
            '<li class="empty-projects">No tasks in this stage.</li>'
          );
        }
      }

      stopCardTimerInterval(activeTaskId);
      taskTimers.delete(activeTaskId);
      updateColumnCounts();
      showToast("Task deleted");
      deleteDialog.close();
    });
  }

}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${error.message}</p>`;
});