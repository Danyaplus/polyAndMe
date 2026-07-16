(() => {
  "use strict";

  const cfg = window.CHAT_CONFIG;
  const $ = (id) => document.getElementById(id);

  const ui = {
    setupScreen: $("setupScreen"), chatScreen: $("chatScreen"),
    joinForm: $("joinForm"), inviteCode: $("inviteCode"), joinError: $("joinError"),
    connectionStatus: $("connectionStatus"), messages: $("messages"), emptyState: $("emptyState"),
    messageForm: $("messageForm"), messageInput: $("messageInput"), sendButton: $("sendButton"),
    attachButton: $("attachButton"), fileInput: $("fileInput"),
    uploadBar: $("uploadBar"), uploadName: $("uploadName"), cancelFile: $("cancelFile"),
    logoutButton: $("logoutButton"), toast: $("toast")
  };

  let db = null;
  let me = null;
  let selectedFile = null;
  let realtimeChannel = null;
  let toastTimer = null;

  function checkConfig() {
    return cfg &&
      cfg.supabaseUrl?.startsWith("https://") &&
      !cfg.supabaseUrl.includes("PASTE_") &&
      cfg.supabaseKey &&
      !cfg.supabaseKey.includes("PASTE_");
  }

  function showToast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.add("hidden"), 3200);
  }

  function setBusy(busy) {
    ui.messageInput.disabled = busy;
    ui.sendButton.disabled = busy;
    ui.attachButton.disabled = busy;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "";
    const units = ["Б", "КБ", "МБ", "ГБ"];
    let value = bytes, i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit", minute: "2-digit"
    }).format(new Date(value));
  }

  function safeFileName(name) {
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot).replace(/[^a-zA-Z0-9.]/g, "") : "";
    return `${crypto.randomUUID()}${ext.slice(0, 12)}`;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      ui.messages.scrollTop = ui.messages.scrollHeight;
    });
  }

  async function signedAttachmentUrl(path) {
    if (!path) return null;
    const { data, error } = await db.storage.from("chat-files")
      .createSignedUrl(path, 60 * 60);
    if (error) return null;
    return data.signedUrl;
  }

  async function buildMessage(message) {
    const row = document.createElement("div");
    const mine = message.sender_id === me.user_id;
    row.className = `message-row ${mine ? "mine" : "theirs"}`;
    row.dataset.id = message.id;

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    const sender = document.createElement("span");
    sender.className = "sender";
    sender.textContent = message.sender_name || "Собеседник";
    bubble.appendChild(sender);

    if (message.file_path) {
      const url = await signedAttachmentUrl(message.file_path);
      const link = document.createElement("a");
      link.className = "attachment";
      link.href = url || "#";
      link.target = "_blank";
      link.rel = "noopener";
      link.download = message.file_name || "";

      if (url && message.file_type?.startsWith("image/")) {
        const image = document.createElement("img");
        image.src = url;
        image.alt = message.file_name || "Изображение";
        image.loading = "lazy";
        link.appendChild(image);
      } else if (url && message.file_type?.startsWith("video/")) {
        const video = document.createElement("video");
        video.src = url;
        video.controls = true;
        video.preload = "metadata";
        link.appendChild(video);
      } else {
        const card = document.createElement("div");
        card.className = "file-card";
        const icon = document.createElement("span");
        icon.className = "file-icon";
        icon.textContent = "📄";
        const info = document.createElement("span");
        info.className = "file-info";
        const name = document.createElement("span");
        name.className = "file-name";
        name.textContent = message.file_name || "Файл";
        const size = document.createElement("span");
        size.className = "file-size";
        size.textContent = formatBytes(message.file_size);
        info.append(name, size);
        card.append(icon, info);
        link.appendChild(card);
      }
      bubble.appendChild(link);
    }

    if (message.body) {
      const text = document.createElement("div");
      text.className = "message-text";
      text.textContent = message.body;
      bubble.appendChild(text);
    }

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(message.created_at);
    bubble.appendChild(time);
    row.appendChild(bubble);
    return row;
  }

  async function appendMessage(message) {
    if (ui.messages.querySelector(`[data-id="${CSS.escape(message.id)}"]`)) return;
    ui.emptyState.classList.add("hidden");
    ui.messages.appendChild(await buildMessage(message));
    scrollToBottom();
  }

  async function loadMessages() {
    const { data, error } = await db.from("chat_messages")
      .select("*")
      .eq("room_id", cfg.roomId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw error;

    ui.messages.querySelectorAll(".message-row").forEach((node) => node.remove());
    if (!data.length) ui.emptyState.classList.remove("hidden");
    for (const message of data) await appendMessage(message);
    scrollToBottom();
  }

  function subscribeRealtime() {
    if (realtimeChannel) db.removeChannel(realtimeChannel);

    realtimeChannel = db.channel(`room-${cfg.roomId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `room_id=eq.${cfg.roomId}`
      }, (payload) => appendMessage(payload.new))
      .subscribe((status) => {
        ui.connectionStatus.textContent =
          status === "SUBSCRIBED" ? "В сети" :
          status === "CHANNEL_ERROR" ? "Ошибка соединения" : "Подключение…";
      });
  }

  async function getMembership() {
    const { data, error } = await db.rpc("get_my_chat_membership", {
      p_room_id: cfg.roomId
    });
    if (error) throw error;
    return data?.[0] || null;
  }

  async function enterChat() {
    me = await getMembership();
    if (!me) return false;
    ui.setupScreen.classList.add("hidden");
    ui.chatScreen.classList.remove("hidden");
    await loadMessages();
    subscribeRealtime();
    ui.messageInput.focus();
    return true;
  }

  async function ensureAnonymousSession() {
    const { data: sessionData } = await db.auth.getSession();
    if (sessionData.session) return sessionData.session;

    const { data, error } = await db.auth.signInAnonymously();
    if (error) throw error;
    return data.session;
  }

  async function joinByCode(code) {
    const { data, error } = await db.rpc("join_private_chat", {
      p_room_id: cfg.roomId,
      p_invite_code: code
    });
    if (error) throw error;
    return data;
  }

  async function uploadFile(file) {
    const maxBytes = (cfg.maxFileSizeMb || 50) * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`Файл больше ${cfg.maxFileSizeMb || 50} МБ`);
    }

    const path = `${cfg.roomId}/${me.user_id}/${safeFileName(file.name)}`;
    const { error } = await db.storage.from("chat-files")
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
        upsert: false
      });
    if (error) throw error;
    return path;
  }

  async function sendMessage() {
    const body = ui.messageInput.value.trim();
    if (!body && !selectedFile) return;

    setBusy(true);
    let filePath = null;
    try {
      if (selectedFile) {
        ui.connectionStatus.textContent = "Загрузка файла…";
        filePath = await uploadFile(selectedFile);
      }

      const payload = {
        room_id: cfg.roomId,
        body: body || null,
        file_path: filePath,
        file_name: selectedFile?.name || null,
        file_type: selectedFile?.type || null,
        file_size: selectedFile?.size || null
      };

      const { error } = await db.from("chat_messages").insert(payload);
      if (error) throw error;

      ui.messageInput.value = "";
      ui.messageInput.style.height = "auto";
      clearSelectedFile();
      ui.connectionStatus.textContent = "В сети";
    } catch (error) {
      console.error(error);
      showToast(error.message || "Не удалось отправить сообщение");
      if (filePath) {
        await db.storage.from("chat-files").remove([filePath]).catch(() => {});
      }
    } finally {
      setBusy(false);
      ui.messageInput.focus();
    }
  }

  function selectFile(file) {
    selectedFile = file || null;
    if (selectedFile) {
      ui.uploadName.textContent = `${selectedFile.name} · ${formatBytes(selectedFile.size)}`;
      ui.uploadBar.classList.remove("hidden");
    } else {
      clearSelectedFile();
    }
  }

  function clearSelectedFile() {
    selectedFile = null;
    ui.fileInput.value = "";
    ui.uploadBar.classList.add("hidden");
  }

  ui.joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    ui.joinError.textContent = "";
    const button = ui.joinForm.querySelector("button");
    button.disabled = true;
    try {
      await ensureAnonymousSession();
      const joined = await joinByCode(ui.inviteCode.value.trim());
      if (!joined) throw new Error("Неверный или уже использованный код");
      await enterChat();
      ui.inviteCode.value = "";
    } catch (error) {
      console.error(error);
      ui.joinError.textContent =
        error.message?.includes("Anonymous sign-ins are disabled")
          ? "В Supabase нужно включить Anonymous Sign-Ins."
          : (error.message || "Не удалось войти");
    } finally {
      button.disabled = false;
    }
  });

  ui.messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendMessage();
  });

  ui.messageInput.addEventListener("input", () => {
    ui.messageInput.style.height = "auto";
    ui.messageInput.style.height = `${Math.min(ui.messageInput.scrollHeight, 130)}px`;
  });

  ui.messageInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await sendMessage();
    }
  });

  ui.attachButton.addEventListener("click", () => ui.fileInput.click());
  ui.fileInput.addEventListener("change", () => selectFile(ui.fileInput.files?.[0]));
  ui.cancelFile.addEventListener("click", clearSelectedFile);

  ui.logoutButton.addEventListener("click", async () => {
    if (!confirm("Выйти из чата на этом устройстве? Для повторного входа понадобится новый код.")) return;
    if (realtimeChannel) await db.removeChannel(realtimeChannel);
    await db.auth.signOut();
    location.reload();
  });

  async function start() {
    if (!checkConfig()) {
      ui.joinError.textContent = "Сначала заполни файл config.js данными Supabase.";
      ui.inviteCode.disabled = true;
      ui.joinForm.querySelector("button").disabled = true;
      return;
    }

    db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });

    try {
      const { data } = await db.auth.getSession();
      if (data.session && await enterChat()) return;
    } catch (error) {
      console.error(error);
    }
    ui.setupScreen.classList.remove("hidden");
  }

  start();
})();
