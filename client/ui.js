(function () {
  const elements = {
    lobby: document.getElementById("lobby"),
    gameArea: document.getElementById("gameArea"),
    createRoomButton: document.getElementById("createRoomButton"),
    nicknameInput: document.getElementById("nicknameInput"),
    panoramaInput: document.getElementById("panoramaInput"),
    panoramaStatus: document.getElementById("panoramaStatus"),
    joinRoomInput: document.getElementById("joinRoomInput"),
    joinRoomButton: document.getElementById("joinRoomButton"),
    refreshSavedRoomsButton: document.getElementById("refreshSavedRoomsButton"),
    savedRoomsList: document.getElementById("savedRoomsList"),
    roomCodeDisplay: document.getElementById("roomCodeDisplay"),
    activeRoomCode: document.getElementById("activeRoomCode"),
    saveStateBadge: document.getElementById("saveStateBadge"),
    saveRoomButton: document.getElementById("saveRoomButton"),
    deleteSavedRoomButton: document.getElementById("deleteSavedRoomButton"),
    errorMessage: document.getElementById("errorMessage"),
    statusMessage: document.getElementById("statusMessage"),
    playerCount: document.getElementById("playerCount"),
    disconnectNotice: document.getElementById("disconnectNotice"),
    chatPanel: document.getElementById("chatPanel"),
    chatMessages: document.getElementById("chatMessages"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    chatSendButton: document.getElementById("chatSendButton"),
    memberList: document.getElementById("memberList"),
    titleLogoButton: document.getElementById("titleLogoButton"),
    titleFriendsFlyer: document.getElementById("titleFriendsFlyer")
  };

  function setError(message) {
    elements.errorMessage.textContent = message || "";
    if (message) {
      elements.statusMessage.textContent = "";
    }
  }

  function setStatus(message) {
    elements.statusMessage.textContent = message || "";
    if (message) {
      elements.errorMessage.textContent = "";
    }
  }

  function showGame(roomCode) {
    elements.lobby.classList.add("hidden");
    elements.gameArea.classList.remove("hidden");
    elements.roomCodeDisplay.textContent = roomCode;
    elements.activeRoomCode.textContent = roomCode;
  }

  function showLobby() {
    elements.gameArea.classList.add("hidden");
    elements.lobby.classList.remove("hidden");
  }

  function setPlayerCount(count) {
    elements.playerCount.textContent = `Players: ${count}`;
  }

  function setRoomSaveState(isSaved, isOwner) {
    elements.saveStateBadge.textContent = isSaved ? "Saved" : "Unsaved";
    elements.saveStateBadge.classList.toggle("saved", isSaved);
    elements.saveStateBadge.classList.toggle("unsaved", !isSaved);

    elements.saveRoomButton.classList.toggle("hidden", !isOwner || isSaved);
    elements.deleteSavedRoomButton.classList.toggle("hidden", !isOwner || !isSaved);
  }

  function showDisconnectNotice(message) {
    elements.disconnectNotice.textContent = message || "";
    if (message) {
      window.clearTimeout(showDisconnectNotice.timeoutId);
      showDisconnectNotice.timeoutId = window.setTimeout(() => {
        elements.disconnectNotice.textContent = "";
      }, 2200);
    }
  }

  function getJoinCode() {
    return elements.joinRoomInput.value.trim().toUpperCase();
  }

  function getNickname() {
    return elements.nicknameInput.value.trim();
  }

  function setNickname(nickname) {
    elements.nicknameInput.value = nickname || "";
  }

  function getPanoramaFile() {
    return elements.panoramaInput.files && elements.panoramaInput.files[0]
      ? elements.panoramaInput.files[0]
      : null;
  }

  function setPanoramaStatus(message) {
    elements.panoramaStatus.textContent = message;
  }

  function addChatMessage(message) {
    const line = document.createElement("div");
    line.className = message.system ? "chat-message system" : "chat-message";

    if (message.system) {
      line.textContent = message.text;
    } else {
      const name = document.createElement("strong");
      name.textContent = message.name;
      const text = document.createElement("span");
      text.textContent = message.text;
      line.append(name, text);
    }

    elements.chatMessages.appendChild(line);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  }

  function clearChat() {
    elements.chatMessages.innerHTML = "";
    elements.chatInput.value = "";
  }

  function renderMembers(players, options) {
    const currentPlayerId = options.currentPlayerId;
    elements.memberList.innerHTML = "";

    players.forEach((player) => {
      const item = document.createElement("div");
      item.className = "member-item";

      const details = document.createElement("div");
      details.className = "member-details";

      const name = document.createElement("strong");
      name.textContent = `${player.name || "Guest"}${player.id === currentPlayerId ? " (You)" : ""}`;

      const role = document.createElement("span");
      const avatarName = player.isHost
        ? "Rabbit"
        : (player.avatar === "cat" ? "Cat" : "Hamster");
      role.textContent = player.isHost ? `Host / ${avatarName}` : `Member / ${avatarName}`;

      details.append(name, role);
      item.appendChild(details);
      elements.memberList.appendChild(item);
    });
  }

  function renderSavedRooms(rooms, handlers) {
    elements.savedRoomsList.innerHTML = "";

    if (!rooms || rooms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "saved-room-empty";
      empty.textContent = "No saved rooms";
      elements.savedRoomsList.appendChild(empty);
      return;
    }

    rooms.forEach((room) => {
      const item = document.createElement("div");
      item.className = "saved-room-item";

      const details = document.createElement("div");
      details.className = "saved-room-details";

      const code = document.createElement("strong");
      code.textContent = room.code;

      const meta = document.createElement("span");
      const playerText = room.isActive ? `${room.playerCount} active` : "offline";
      meta.textContent = playerText;

      details.append(code, meta);

      const actions = document.createElement("div");
      actions.className = "saved-room-actions";

      const joinButton = document.createElement("button");
      joinButton.type = "button";
      joinButton.className = "small-button";
      joinButton.textContent = "Join";
      joinButton.addEventListener("click", () => handlers.onJoin(room.code));

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "small-button danger";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => handlers.onDelete(room.code));

      actions.append(joinButton, deleteButton);
      item.append(details, actions);
      elements.savedRoomsList.appendChild(item);
    });
  }

  elements.joinRoomInput.addEventListener("input", () => {
    elements.joinRoomInput.value = elements.joinRoomInput.value.toUpperCase();
  });

  if (elements.titleLogoButton && elements.titleFriendsFlyer) {
    elements.titleLogoButton.addEventListener("click", () => {
      elements.titleFriendsFlyer.classList.remove("fly");
      void elements.titleFriendsFlyer.offsetWidth;
      elements.titleFriendsFlyer.classList.add("fly");
    });
  }

  window.GameUI = {
    elements,
    setError,
    setStatus,
    showGame,
    showLobby,
    setPlayerCount,
    setRoomSaveState,
    renderSavedRooms,
    showDisconnectNotice,
    getJoinCode,
    getNickname,
    setNickname,
    getPanoramaFile,
    setPanoramaStatus,
    addChatMessage,
    clearChat,
    renderMembers
  };
})();
