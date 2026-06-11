import * as THREE from "three";
import { GLTFLoader } from "/vendor/GLTFLoader.js";

const socket = io();
const ui = window.GameUI;

const WORLD_SCALE = 0.0425;
const PLAYER_HEIGHT = 1.55;
const PLAYER_RADIUS = 0.34;
const PLAYER_CONTACT_SCALE = 14 / 22;
const CORRIDOR_WALL_HEIGHT = 5.95;
const CORRIDOR_CEILING_Y = 6.05;
const CORRIDOR_CEILING_THICKNESS = 0.16;
const SEATED_PLAYER_Y = 0.58;
const SEATED_PLAYER_CLEARANCE = 0.08;
const JUMP_DURATION_MS = 650;
const JUMP_HEIGHT = 0.75;
const POSITION_SMOOTHING_SPEED = 18;
const ROTATION_SMOOTHING_SPEED = 16;
const VISUAL_PLAYER_SPEED = 230 * WORLD_SCALE;
const LOCAL_POSITION_SMOOTHING_SPEED = 10;
const LOCAL_CORRECTION_DEAD_ZONE = 0.12;
const LOCAL_SERVER_SNAP_DISTANCE = 2.1;
const CAMERA_POSITION_SMOOTHING_SPEED = 7;
const CAMERA_TARGET_SMOOTHING_SPEED = 10;

let renderer = null;
let scene = null;
let camera = null;
let animationFrameId = null;
let players = new Map();
let localPlayerId = null;
let activeRoomCode = null;
let mapData = null;
let isRoomOwner = false;
let lastSentInput = "";
let lastInputSentAt = 0;
let latestMovementVector = new THREE.Vector3();
let cameraYaw = 0;
let cameraPitch = 0.55;
let cameraDistance = 8.5;
let smoothedCameraTarget = new THREE.Vector3();
let hasSmoothedCameraTarget = false;
let lastFrameTime = 0;
let isDraggingCamera = false;
let lastMouseX = 0;
let lastMouseY = 0;
let touchCameraPointerId = null;
let lastTouchX = 0;
let lastTouchY = 0;
let touchStartX = 0;
let touchStartY = 0;
let hasTouchCameraMoved = false;
let lastCanvasTapTime = 0;
let lastCanvasTapX = 0;
let lastCanvasTapY = 0;
let isJumpHeld = false;
let joystickPointerId = null;
const joystickVector = new THREE.Vector2();
const modelTemplates = new Map();
const modelLoadPromises = new Map();
const chairMeshes = new Map();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const cameraDesiredPosition = new THREE.Vector3();
const cameraSafePosition = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
const ceilingMeshes = [];

const keys = {
  w: false,
  a: false,
  s: false,
  d: false
};

function isMobileControlsDevice() {
  return Boolean(
    window.matchMedia("(pointer: coarse)").matches
    || navigator.maxTouchPoints > 0
    || "ontouchstart" in window
  );
}

function applyMobileControlsClass() {
  document.body.classList.toggle("mobile-controls", isMobileControlsDevice());
}

function getRendererPixelRatio() {
  const maxPixelRatio = isMobileControlsDevice() ? 0.9 : 1.35;
  return Math.min(window.devicePixelRatio || 1, maxPixelRatio);
}

function resetMovementInput() {
  Object.keys(keys).forEach((key) => {
    keys[key] = false;
  });
  latestMovementVector.set(0, 0, 0);
  joystickVector.set(0, 0);
  updateJoystickKnob();
  lastSentInput = "";
  socket.emit("input", {
    up: false,
    down: false,
    left: false,
    right: false,
    xAxis: 0,
    yAxis: 0
  });
}

function stopJumpHold() {
  if (isJumpHeld) {
    isJumpHeld = false;
    socket.emit("jumpHold", false);
  }

  const jumpButton = document.getElementById("mobileJumpButton");
  if (jumpButton) {
    jumpButton.classList.remove("pressed");
  }
}

function startJumpHold() {
  if (isJumpHeld) {
    return;
  }

  isJumpHeld = true;
  socket.emit("jump");
  socket.emit("jumpHold", true);

  const jumpButton = document.getElementById("mobileJumpButton");
  if (jumpButton) {
    jumpButton.classList.add("pressed");
  }
}

function getOwnerToken() {
  const storageKey = "local-multiplayer-owner-token";
  let token = window.localStorage.getItem(storageKey);

  if (!token) {
    token = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(storageKey, token);
  }

  return token;
}

function getSavedNickname() {
  return window.localStorage.getItem("local-multiplayer-nickname") || "";
}

function getJoinNickname() {
  const nickname = ui.getNickname().trim() || "Guest";
  window.localStorage.setItem("local-multiplayer-nickname", nickname);
  return nickname;
}

function getRoomCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const queryCode = params.get("room");
  const pathMatch = window.location.pathname.match(/^\/join\/([A-Z0-9]{6})\/?$/i);
  const roomCode = queryCode || (pathMatch ? pathMatch[1] : "");

  return roomCode.trim().toUpperCase();
}

function emitWithAck(eventName, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        ok: false,
        message: "The server did not respond. Check that the host game is still running."
      });
    }, timeoutMs);

    socket.emit(eventName, ...args, (response) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      resolve(response);
    });
  });
}

function rgbToHex(r, g, b) {
  return (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b);
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function averageRegion(data, width, startX, endX, startY, endY) {
  let r = 0;
  let g = 0;
  let b = 0;
  let brightness = 0;
  let samples = 0;

  for (let y = startY; y < endY; y += 2) {
    for (let x = startX; x < endX; x += 2) {
      const index = (y * width + x) * 4;
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
      brightness += (data[index] + data[index + 1] + data[index + 2]) / 3;
      samples += 1;
    }
  }

  return {
    r: r / samples,
    g: g / samples,
    b: b / samples,
    brightness: brightness / samples
  };
}

function buildPanoramaObstacles(imageData, width, height) {
  const obstacles = [];
  const sectors = 8;
  const center = 1000;
  const radius = 590;
  const lowerStart = Math.floor(height * 0.48);
  const lowerEnd = Math.floor(height * 0.86);

  for (let sector = 0; sector < sectors; sector += 1) {
    const startX = Math.floor((width / sectors) * sector);
    const endX = Math.floor((width / sectors) * (sector + 1));
    const middle = averageRegion(imageData.data, width, startX, endX, lowerStart, lowerEnd);
    const floor = averageRegion(imageData.data, width, startX, endX, Math.floor(height * 0.82), height);
    const contrast = Math.abs(middle.brightness - floor.brightness);

    if (middle.brightness < 150 || contrast > 34) {
      const angle = (sector / sectors) * Math.PI * 2;
      const x = center + Math.cos(angle) * radius;
      const y = center + Math.sin(angle) * radius;
      const objectType = sector % 3 === 0 ? "chair" : "object";
      obstacles.push({
        id: `${objectType}-${sector + 1}`,
        type: objectType,
        x: Math.max(80, Math.min(1840, x - 75)),
        y: Math.max(80, Math.min(1840, y - 75)),
        width: objectType === "chair" ? 90 : 150,
        height: objectType === "chair" ? 90 : 150,
        visualHeight: objectType === "chair" ? 0.55 : 1.05,
        color: rgbToHex(middle.r, middle.g, middle.b)
      });
    }
  }

  return obstacles.length > 0
    ? obstacles
    : [
      { id: "object-1", type: "object", x: 560, y: 610, width: 180, height: 120, visualHeight: 0.9, color: 0x8b735f },
      { id: "chair-1", type: "chair", x: 1220, y: 760, width: 90, height: 90, visualHeight: 0.55, color: 0x60758c }
    ];
}

function colorFromRegion(imageData, width, height, xStartRatio, xEndRatio, yStartRatio, yEndRatio) {
  const region = averageRegion(
    imageData.data,
    width,
    Math.floor(width * xStartRatio),
    Math.floor(width * xEndRatio),
    Math.floor(height * yStartRatio),
    Math.floor(height * yEndRatio)
  );

  return rgbToHex(region.r, region.g, region.b);
}

function createThirdFloorCorridorMap() {
  const greenWall = 0x8fa995;
  const whiteWall = 0xe8ece8;
  const woodFloor = 0xb99164;
  const darkDoor = 0x111111;
  const wallHeight = CORRIDOR_WALL_HEIGHT;

  return {
    theme: "corridor-3f",
    floorColor: woodFloor,
    wallColor: greenWall,
    panoramaImage: "",
    spawnPoints: [
      { x: 560, y: 1140 },
      { x: 560, y: 1280 },
      { x: 700, y: 1280 },
      { x: 980, y: 1400 },
      { x: 1180, y: 1400 },
      { x: 1380, y: 1400 },
      { x: 560, y: 1680 },
      { x: 700, y: 1680 }
    ],
    obstacles: [
      { id: "corridor-a-left-wall", type: "wall", x: 400, y: 40, width: 40, height: 960, visualHeight: wallHeight, color: greenWall },
      { id: "corridor-a-right-wall", type: "wall", x: 660, y: 40, width: 40, height: 900, visualHeight: wallHeight, color: whiteWall },
      { id: "corridor-a-right-gap-fill", type: "wall", x: 660, y: 940, width: 40, height: 60, visualHeight: wallHeight, color: whiteWall },
      { id: "corridor-a-end-door", type: "door", x: 400, y: 0, width: 300, height: 40, visualHeight: wallHeight, color: darkDoor },
      { id: "lounge-left-wall", type: "wall", x: 400, y: 1000, width: 40, height: 520, visualHeight: wallHeight, color: greenWall },
      { id: "lounge-bottom-wall-left", type: "wall", x: 400, y: 1520, width: 120, height: 40, visualHeight: wallHeight, color: greenWall },
      { id: "lounge-elevator-gap-fill", type: "wall", x: 520, y: 1520, width: 40, height: 80, visualHeight: wallHeight, color: greenWall },
      { id: "junction-short-wall", type: "wall", x: 820, y: 1520, width: 140, height: 40, visualHeight: wallHeight, color: greenWall },
      { id: "shelf-sofa-back-wall", type: "wall", x: 700, y: 1000, width: 320, height: 40, visualHeight: wallHeight, color: greenWall },
      { id: "stair-top-wall", type: "wall", x: 1020, y: 1000, width: 300, height: 40, visualHeight: wallHeight, color: greenWall },
      { id: "stair-right-wall", type: "wall", x: 1280, y: 1000, width: 40, height: 360, visualHeight: wallHeight, color: greenWall },
      { id: "stair-corridor-divider", type: "wall", x: 1020, y: 1360, width: 260, height: 40, visualHeight: wallHeight, color: greenWall },
      { id: "corridor-b-top-wall", type: "wall", x: 1280, y: 1360, width: 600, height: 40, visualHeight: wallHeight, color: greenWall },
      { id: "elevator-lobby-left-return-wall", type: "wall", x: 560, y: 1560, width: 40, height: 40, visualHeight: wallHeight, color: greenWall },
      { id: "elevator-lobby-right-return-wall", type: "wall", x: 820, y: 1560, width: 40, height: 40, visualHeight: wallHeight, color: greenWall },
      { id: "corridor-b-bottom-wall", type: "wall", x: 860, y: 1560, width: 1020, height: 40, visualHeight: wallHeight, color: whiteWall },
      { id: "corridor-b-end-door", type: "door", x: 1880, y: 1360, width: 40, height: 240, visualHeight: wallHeight, color: darkDoor },
      { id: "elevator-left-wall", type: "wall", x: 560, y: 1600, width: 40, height: 300, visualHeight: wallHeight, color: greenWall },
      { id: "elevator-right-wall", type: "wall", x: 820, y: 1600, width: 40, height: 300, visualHeight: wallHeight, color: greenWall },
      { id: "elevator-bottom-wall", type: "wall", x: 560, y: 1900, width: 300, height: 40, visualHeight: wallHeight, color: greenWall },
      { id: "lounge-wall-sofa-2", type: "sofa", x: 440, y: 1040, width: 86, height: 260, visualHeight: 0.55, collisionInset: 14, color: 0xf8fafc },
      { id: "lounge-wall-sofa", type: "sofa", x: 440, y: 1230, width: 86, height: 260, visualHeight: 0.55, collisionInset: 14, color: 0xf8fafc },
      { id: "shelf-side-sofa", type: "sofa", x: 720, y: 1040, width: 180, height: 82, visualHeight: 0.55, collisionInset: 14, color: 0xf8fafc },
      { id: "shelf-area", type: "shelf", x: 930, y: 1070, width: 10, height: 250, visualHeight: 2.05, color: 0xc49a61 },
      { id: "stairs-up-to-fourth", type: "stairs", x: 1080, y: 1040, width: 200, height: 150, visualHeight: 1.35, color: 0xb8b8b8 },
      { id: "stairs-down-to-second", type: "stairs", x: 1080, y: 1210, width: 200, height: 150, visualHeight: 1.35, color: 0x999999 },
      { id: "stair-up-blocker", type: "blocker", x: 1280, y: 1040, width: 40, height: 150, visualHeight: wallHeight, color: 0x000000 },
      { id: "stair-down-blocker", type: "blocker", x: 1280, y: 1210, width: 40, height: 150, visualHeight: wallHeight, color: 0x000000 },
      { id: "elevator-object", type: "elevator", x: 625, y: 1840, width: 130, height: 60, visualHeight: 2.8, color: 0xbfc5c9 },
      { id: "water-dispenser", type: "water", x: 780, y: 1720, width: 80, height: 80, visualHeight: 1.45, color: 0x1f2937 }
    ]
  };
}

async function createPanoramaMapFromFile(file) {
  if (!file) {
    return null;
  }

  ui.setPanoramaStatus("Checking supported beta map photo...");
  const supportedPanoramaName = "3\uce35 \ubcf5\ub3c4.jpg";
  if (file.name.normalize("NFC") !== supportedPanoramaName) {
    throw new Error("This panorama is not supported in the current prototype.");
  }

  const map = createThirdFloorCorridorMap();
  ui.setPanoramaStatus(`Loaded ${file.name}. Using fixed 3\uCE35 \uBCF5\uB3C4 beta map with ${map.obstacles.length} collision objects.`);
  return map;
}
async function requestCreateRoom() {
  ui.setStatus("Creating room...");
  try {
    const mapConfig = await createPanoramaMapFromFile(ui.getPanoramaFile());
    socket.emit("createRoom", getOwnerToken(), getJoinNickname(), mapConfig, handleJoinResponse);
  } catch (error) {
    const message = error.message || "This panorama is not supported in the current prototype.";
    ui.setError(message);
    ui.setPanoramaStatus(message);
  }
}

function requestJoinRoom() {
  const roomCode = ui.getJoinCode();
  if (roomCode.length !== 6) {
    ui.setError("Enter a 6-character room code.");
    return;
  }

  ui.setStatus("Joining room...");
  joinRoomByCode(roomCode);
}

function joinRoomByCode(roomCode) {
  ui.setStatus("Joining room...");
  socket.emit("joinRoom", roomCode, getOwnerToken(), getJoinNickname(), handleJoinResponse);
}

function autoJoinRoomFromUrl() {
  const roomCode = getRoomCodeFromUrl();
  if (!roomCode) {
    return;
  }

  if (roomCode.length !== 6) {
    ui.setError("The shared room link is invalid.");
    return;
  }

  ui.elements.joinRoomInput.value = roomCode;
  ui.setStatus("Joining shared room...");
  joinRoomByCode(roomCode);
}

function refreshSavedRooms() {
  socket.emit("listSavedRooms", getOwnerToken(), (response) => {
    if (!response || !response.ok) {
      ui.renderSavedRooms([], {
        onJoin: joinRoomByCode,
        onDelete: deleteSavedRoomFromLobby
      });
      return;
    }

    ui.renderSavedRooms(response.rooms, {
      onJoin: joinRoomByCode,
      onDelete: deleteSavedRoomFromLobby
    });
  });
}

function deleteSavedRoomFromLobby(roomCode) {
  ui.setStatus("Deleting saved room...");
  socket.emit("deleteSavedRoomByCode", roomCode, getOwnerToken(), (response) => {
    if (!response || !response.ok) {
      ui.setError(response && response.message ? response.message : "Could not delete saved room.");
      return;
    }

    ui.setStatus(response.message || "Saved room deleted.");
    refreshSavedRooms();
  });
}

function requestSaveRoom() {
  ui.setStatus("Saving room...");
  socket.emit("saveRoom", (response) => {
    if (!response || !response.ok) {
      ui.setError(response && response.message ? response.message : "Could not save room.");
      return;
    }

      ui.setRoomSaveState(Boolean(response.isSaved), isRoomOwner);
      ui.setStatus(response.message || "Room saved.");
      refreshSavedRooms();
    });
}

function requestDeleteSavedRoom() {
  ui.setStatus("Deleting saved room...");
  socket.emit("deleteSavedRoom", (response) => {
    if (!response || !response.ok) {
      ui.setError(response && response.message ? response.message : "Could not delete saved room.");
      return;
    }

      ui.setRoomSaveState(Boolean(response.isSaved), isRoomOwner);
      ui.setStatus(response.message || "Saved room deleted.");
      refreshSavedRooms();
    });
}

function handleJoinResponse(response) {
  if (!response || !response.ok) {
    ui.setError(response && response.message ? response.message : "Could not join room.");
    return;
  }

  localPlayerId = response.playerId;
  activeRoomCode = response.roomCode;
  mapData = response.map;
  isRoomOwner = Boolean(response.isOwner);
  ui.showGame(activeRoomCode);
  ui.setRoomSaveState(Boolean(response.isSaved), isRoomOwner);
  ui.clearChat();
  if (document.activeElement) {
    document.activeElement.blur();
  }
  ui.setStatus("");
  startGame(response.players);
}

function startGame(initialPlayers) {
  destroyCurrentScene();
  applyMobileControlsClass();

  const container = document.getElementById("gameContainer");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfd5e8);
  scene.fog = new THREE.Fog(0xbfd5e8, 35, 75);

  camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 120);
  cameraPitch = mapData.theme === "corridor-3f" ? 0.24 : 0.55;
  cameraDistance = mapData.theme === "corridor-3f" ? 9.8 : 8.8;

  renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(getRendererPixelRatio());
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.innerHTML = "";
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);
  renderer.domElement.focus();

  players = new Map();
  lastSentInput = "";
  lastInputSentAt = 0;
  latestMovementVector.set(0, 0, 0);
  hasSmoothedCameraTarget = false;
  lastFrameTime = performance.now();
  buildHouseScene();
  applyPlayers(initialPlayers);
  setupCameraControls(renderer.domElement);
  setupMobileJoystick();
  setupMobileJumpButton();
  animate();
}

function destroyCurrentScene() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
  }

  renderer = null;
  scene = null;
  camera = null;
  players = new Map();
  chairMeshes.clear();
  ceilingMeshes.length = 0;
  hasSmoothedCameraTarget = false;
}

function mapToWorld(x, y) {
  const halfSize = (mapData.size * WORLD_SCALE) / 2;
  return {
    x: x * WORLD_SCALE - halfSize,
    z: y * WORLD_SCALE - halfSize
  };
}

function getPlayerHalfSizeWorld() {
  return ((mapData?.playerSize || 32) * WORLD_SCALE) / 2;
}

function getObstacleCollisionInset(obstacle) {
  if (Number.isFinite(obstacle.collisionInset)) {
    return obstacle.collisionInset;
  }

  const insetsByType = {
    sofa: 14,
    table: 8,
    chair: 7,
    water: 6,
    elevator: 5,
    shelf: 4,
    stairs: 4,
    "orange-tree": 0,
    "orange-tree-trunk": 0,
    "orange-tree-canopy": 4,
    "orange-basket": 5,
    "picnic-mat": 0,
    object: 6
  };

  return insetsByType[obstacle.type] || 0;
}

function isInsideWorldBounds(position) {
  const halfMap = (mapData.size * WORLD_SCALE) / 2;
  const halfPlayer = getPlayerHalfSizeWorld();

  return position.x >= -halfMap + halfPlayer
    && position.x <= halfMap - halfPlayer
    && position.z >= -halfMap + halfPlayer
    && position.z <= halfMap - halfPlayer;
}

function boxesOverlap(a, b) {
  return a.left < b.right
    && a.right > b.left
    && a.top < b.bottom
    && a.bottom > b.top;
}

function isClimbableObstacle(obstacle) {
  return obstacle.type === "sofa" && (obstacle.visualHeight || 1) <= JUMP_HEIGHT + 0.05;
}

function getPlayerBoxWorld(position) {
  const halfPlayer = getPlayerHalfSizeWorld();
  return {
    left: position.x - halfPlayer,
    right: position.x + halfPlayer,
    top: position.z - halfPlayer,
    bottom: position.z + halfPlayer
  };
}

function getObstacleCollisionBoxWorld(obstacle) {
  if (obstacle.type === "stone-wall") {
    const isHorizontal = obstacle.width >= obstacle.height;
    const lengthInset = 8 * WORLD_SCALE;
    const targetThickness = 16;
    const thicknessInsetMap = Math.max(0, ((isHorizontal ? obstacle.height : obstacle.width) - targetThickness) / 2);
    const thicknessInset = thicknessInsetMap * WORLD_SCALE;
    const min = mapToWorld(obstacle.x, obstacle.y);
    const max = mapToWorld(obstacle.x + obstacle.width, obstacle.y + obstacle.height);

    return {
      left: Math.min(min.x, max.x) + (isHorizontal ? lengthInset : thicknessInset),
      right: Math.max(min.x, max.x) - (isHorizontal ? lengthInset : thicknessInset),
      top: Math.min(min.z, max.z) + (isHorizontal ? thicknessInset : lengthInset),
      bottom: Math.max(min.z, max.z) - (isHorizontal ? thicknessInset : lengthInset)
    };
  }

  const inset = getObstacleCollisionInset(obstacle) * WORLD_SCALE;
  const safeInset = Math.max(0, Math.min(inset, (obstacle.width * WORLD_SCALE) / 2 - 0.01, (obstacle.height * WORLD_SCALE) / 2 - 0.01));
  const min = mapToWorld(obstacle.x, obstacle.y);
  const max = mapToWorld(obstacle.x + obstacle.width, obstacle.y + obstacle.height);

  return {
    left: Math.min(min.x, max.x) + safeInset,
    right: Math.max(min.x, max.x) - safeInset,
    top: Math.min(min.z, max.z) + safeInset,
    bottom: Math.max(min.z, max.z) - safeInset
  };
}

function isOverlappingObstacleWorld(position, climbHeight = 0, currentPosition = null) {
  const playerBox = getPlayerBoxWorld(position);
  const currentPlayerBox = currentPosition ? getPlayerBoxWorld(currentPosition) : null;
  return mapData.obstacles.some((obstacle) => {
    if (obstacle.collisionDisabled) {
      return false;
    }

    if ((obstacle.visualHeight || 1) <= climbHeight) {
      return false;
    }

    const obstacleBox = getObstacleCollisionBoxWorld(obstacle);

    if (currentPlayerBox && isClimbableObstacle(obstacle) && boxesOverlap(currentPlayerBox, obstacleBox)) {
      return false;
    }

    return boxesOverlap(playerBox, obstacleBox);
  });
}

function isOverlappingOtherPlayerWorld(position) {
  const minimumDistance = getPlayerHalfSizeWorld() * 2 * PLAYER_CONTACT_SCALE;

  for (const [playerId, model] of players.entries()) {
    if (playerId === localPlayerId || model.userData.seatedChairId) {
      continue;
    }

    const otherPosition = model.userData.targetPosition || model.position;
    const distance = Math.hypot(otherPosition.x - position.x, otherPosition.z - position.z);
    if (distance < minimumDistance) {
      return true;
    }
  }

  return false;
}

function isCloseToOtherPlayerWorld(position, padding = 0.18) {
  const minimumDistance = (getPlayerHalfSizeWorld() * 2 * PLAYER_CONTACT_SCALE) + padding;

  for (const [playerId, model] of players.entries()) {
    if (playerId === localPlayerId || model.userData.seatedChairId) {
      continue;
    }

    const otherPosition = model.userData.targetPosition || model.position;
    const distance = Math.hypot(otherPosition.x - position.x, otherPosition.z - position.z);
    if (distance < minimumDistance) {
      return true;
    }
  }

  return false;
}

function canPlaceLocalPlayer(position) {
  const localPlayer = players.get(localPlayerId);
  const climbHeight = localPlayer ? getJumpOffset(localPlayer) : 0;

  return isInsideWorldBounds(position)
    && !isOverlappingObstacleWorld(position, climbHeight, localPlayer ? localPlayer.position : null)
    && !isOverlappingOtherPlayerWorld(position);
}

function createMaterial(color, roughness = 0.8) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.02
  });
}

function buildHouseScene() {
  const roomSize = mapData.size * WORLD_SCALE;
  const half = roomSize / 2;

  if (mapData.theme === "grass-field") {
    buildGrassFieldScene(roomSize);
    return;
  }

  scene.add(new THREE.HemisphereLight(0xf7fbff, 0x667085, 1.2));

  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-12, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  scene.add(sun);

  if (mapData.theme === "corridor-3f") {
    buildThirdFloorCorridorScene();
    return;
  }

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(roomSize, 0.18, roomSize),
    createMaterial(mapData.floorColor || 0xd7c1a5)
  );
  floor.position.y = -0.09;
  floor.receiveShadow = true;
  scene.add(floor);

  addFloorGrid(roomSize);
  addOuterHouseWalls(roomSize);
  addFurnitureAndWalls();
  if (mapData.theme !== "corridor-3f") {
    addHouseDetails(half);
  }
}

function buildGrassFieldScene(roomSize) {
  scene.background = new THREE.Color(0x45cfff);
  scene.fog = new THREE.Fog(0x8eeaff, 62, 145);

  scene.add(new THREE.HemisphereLight(0xfff0c7, 0x82b964, 2.15));

  const sun = new THREE.DirectionalLight(0xffc879, 3.15);
  sun.position.set(-18, 28, 12);
  sun.castShadow = false;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(roomSize, 0.14, roomSize),
    createMaterial(mapData.floorColor || 0x9ee85f, 0.95)
  );
  floor.position.y = -0.07;
  floor.receiveShadow = true;
  scene.add(floor);

  addJejuSkyBackdrop(roomSize);
  addGrassFieldDirtPaths();
  addGrassFieldTexture(roomSize);
  addFurnitureAndWalls();
}

function addJejuSkyBackdrop(roomSize) {
  const radius = roomSize * 1.28;
  const geometry = new THREE.SphereGeometry(radius, 96, 40, 0, Math.PI * 2, 0, Math.PI * 0.72);
  const fallbackMaterial = new THREE.MeshBasicMaterial({
    color: 0x45cfff,
    side: THREE.BackSide,
    depthWrite: false
  });
  const backdrop = new THREE.Mesh(geometry, fallbackMaterial);
  backdrop.position.y = -roomSize * 0.08;
  backdrop.rotation.y = Math.PI * 0.08;
  backdrop.renderOrder = -10;
  scene.add(backdrop);

  new THREE.TextureLoader().load(
    "/assets/jeju-sky-dome.png",
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      backdrop.material.dispose();
      backdrop.material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide,
        depthWrite: false
      });
    },
    undefined,
    () => {
      console.warn("Failed to load jeju-sky-dome.png; using fallback sky color.");
    }
  );
}

function addGrassFieldDirtPaths() {
  const dirtMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9bd83,
    roughness: 0.98,
    metalness: 0
  });
  const lightDirtMaterial = new THREE.MeshStandardMaterial({
    color: 0xead39d,
    roughness: 0.98,
    metalness: 0
  });

  const size = mapData.size;
  const pathSegments = [
    { from: [size * 0.05, size * 0.52], to: [size * 0.31, size * 0.49], width: size * 0.078 },
    { from: [size * 0.31, size * 0.49], to: [size * 0.52, size * 0.52], width: size * 0.088 },
    { from: [size * 0.52, size * 0.52], to: [size * 0.75, size * 0.49], width: size * 0.08 },
    { from: [size * 0.75, size * 0.49], to: [size * 0.96, size * 0.51], width: size * 0.07 },
    { from: [size * 0.47, size * 0.51], to: [size * 0.34, size * 0.28], width: size * 0.056 },
    { from: [size * 0.55, size * 0.52], to: [size * 0.69, size * 0.72], width: size * 0.058 }
  ];

  pathSegments.forEach((segment) => {
    addDirtPathSegment(segment.from, segment.to, segment.width, dirtMaterial);
  });

  addDirtPatch(size * 0.05, size * 0.52, size * 0.065, lightDirtMaterial);

  addDirtPebbles();
  addPathStoneBorders(pathSegments);
}

function addDirtPathSegment(fromMap, toMap, widthMap, material) {
  const from = mapToWorld(fromMap[0], fromMap[1]);
  const to = mapToWorld(toMap[0], toMap[1]);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const path = new THREE.Mesh(
    new THREE.BoxGeometry(widthMap * WORLD_SCALE, 0.035, length),
    material
  );

  path.position.set((from.x + to.x) / 2, 0.006, (from.z + to.z) / 2);
  path.rotation.y = Math.atan2(dx, dz);
  path.receiveShadow = true;
  scene.add(path);
}

function addDirtPatch(mapX, mapY, radiusMap, material) {
  const center = mapToWorld(mapX, mapY);
  const patch = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusMap * WORLD_SCALE, radiusMap * WORLD_SCALE, 0.038, 36),
    material
  );

  patch.position.set(center.x, 0.012, center.z);
  patch.receiveShadow = true;
  scene.add(patch);
}

function addDirtPebbles() {
  const pebbleMaterial = new THREE.MeshStandardMaterial({
    color: 0x6f4a28,
    roughness: 0.95,
    metalness: 0
  });

  const pebbleCount = 36;
  for (let index = 0; index < pebbleCount; index += 1) {
    const along = mapData.size * (0.08 + index * 0.024);
    const side = index % 2 === 0 ? -1 : 1;
    const jitter = (((index * 37) % 83) - 41) * (mapData.size / 2000);
    const point = mapToWorld(
      along,
      mapData.size * 0.505 + side * (mapData.size * (0.04 + (index % 4) * 0.006)) + jitter
    );
    const pebble = new THREE.Mesh(
      new THREE.BoxGeometry(0.09 + (index % 3) * 0.025, 0.018, 0.05 + (index % 4) * 0.02),
      pebbleMaterial
    );

    pebble.position.set(point.x, 0.04, point.z);
    pebble.rotation.y = index * 0.41;
    pebble.receiveShadow = true;
    scene.add(pebble);
  }
}

function addPathStoneBorders(pathSegments) {
  const stoneMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xa8a29e, roughness: 0.9, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0xc9c1b4, roughness: 0.92, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0x8f8a83, roughness: 0.94, metalness: 0 })
  ];

  pathSegments.forEach((segment, segmentIndex) => {
    addStoneBorderSegment(segment.from, segment.to, segment.width, -1, segmentIndex, stoneMaterials);
    addStoneBorderSegment(segment.from, segment.to, segment.width, 1, segmentIndex, stoneMaterials);
  });
}

function addStoneBorderSegment(fromMap, toMap, widthMap, side, segmentIndex, stoneMaterials) {
  const from = { x: fromMap[0], y: fromMap[1] };
  const to = { x: toMap[0], y: toMap[1] };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const normalX = (-dy / length) * side;
  const normalY = (dx / length) * side;
  const stoneCount = Math.max(5, Math.floor(length / 95));
  const borderOffset = widthMap / 2 + 34;

  for (let index = 0; index <= stoneCount; index += 1) {
    if ((index + segmentIndex) % 4 === 0) {
      continue;
    }

    const t = index / stoneCount;
    const wobble = (((index * 29 + segmentIndex * 17) % 31) - 15) * 0.8;
    const mapX = from.x + dx * t + normalX * (borderOffset + wobble);
    const mapY = from.y + dy * t + normalY * (borderOffset - wobble);
    const point = mapToWorld(mapX, mapY);
    const material = stoneMaterials[(index + segmentIndex) % stoneMaterials.length];
    const stone = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.22 + ((index + segmentIndex) % 3) * 0.045,
        0.13 + (index % 2) * 0.035,
        0.18 + ((index + 2) % 3) * 0.04
      ),
      material
    );

    stone.position.set(point.x, 0.08, point.z);
    stone.rotation.y = Math.atan2(dx, dy) + (index % 5) * 0.11;
    stone.castShadow = true;
    stone.receiveShadow = true;
    scene.add(stone);
  }
}

function addGrassFieldTexture(roomSize) {
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0x5fbf3a,
    roughness: 0.95,
    metalness: 0
  });
  const lightBladeMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8f06f,
    roughness: 0.95,
    metalness: 0
  });
  const half = roomSize / 2;

  const bladeCount = 180;
  for (let index = 0; index < bladeCount; index += 1) {
    const xSeed = Math.sin(index * 12.9898) * 43758.5453;
    const zSeed = Math.sin(index * 78.233) * 24634.6345;
    const x = (xSeed - Math.floor(xSeed)) * roomSize - half;
    const z = (zSeed - Math.floor(zSeed)) * roomSize - half;
    const length = 0.22 + ((index % 5) * 0.035);
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.018, length),
      index % 3 === 0 ? lightBladeMaterial : bladeMaterial
    );
    blade.position.set(x, 0.018, z);
    blade.rotation.y = (index % 12) * 0.26;
    blade.receiveShadow = true;
    scene.add(blade);
  }
}

function buildThirdFloorCorridorScene() {
  scene.background = new THREE.Color(0xf2f4f5);

  const floorColor = mapData.floorColor || 0xb99164;
  const ceilingColor = 0xf7f7f2;

  // Changed: the prototype corridor uses connected architectural floor plates, not one square play base.
  const floorAreas = [
    { x: 550, y: 520, width: 220, height: 960 },
    { x: 660, y: 1260, width: 520, height: 520 },
    { x: 760, y: 1180, width: 320, height: 360 },
    { x: 1320, y: 1480, width: 1120, height: 160 },
    { x: 710, y: 1560, width: 300, height: 80 },
    { x: 710, y: 1750, width: 300, height: 300 }
  ];

  floorAreas.forEach((area) => {
    addArchitecturalSlab(area.x, area.y, area.width, area.height, -0.06, 0.12, floorColor);
    addWoodFloorPlanks(area);
    addArchitecturalSlab(area.x, area.y, area.width, area.height, CORRIDOR_CEILING_Y, CORRIDOR_CEILING_THICKNESS, ceilingColor);
    addCeilingPanelLines(area);
  });

  addCeilingLight(550, 260, 42, 170);
  addCeilingLight(550, 540, 42, 170);
  addCeilingLight(550, 820, 42, 170);
  addCeilingLight(660, 1260, 105, 24);
  addCeilingLight(760, 1180, 105, 24);
  addCeilingLight(1080, 1480, 115, 24);
  addCeilingLight(1400, 1480, 115, 24);
  addCeilingLight(1720, 1480, 115, 24);
  addCeilingLight(710, 1750, 105, 24);

  addFurnitureAndWalls();
  addLongCorridorDoorPanels();
  addCorridorBaseboards();
}

function addArchitecturalSlab(mapX, mapY, mapWidth, mapHeight, y, height, color) {
  const center = mapToWorld(mapX, mapY);
  const material = createMaterial(color, 0.8);
  if (y > 2) {
    material.transparent = true;
    material.opacity = 0.12;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = THREE.DoubleSide;
  }
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(mapWidth * WORLD_SCALE, height, mapHeight * WORLD_SCALE),
    material
  );
  slab.position.set(center.x, y, center.z);
  slab.receiveShadow = true;
  slab.renderOrder = y > 2 ? -20 : 0;
  scene.add(slab);
  if (y > 2) {
    slab.userData.ceilingKind = "ceiling";
    ceilingMeshes.push(slab);
  }
}

function addWoodFloorPlanks(area) {
  const center = mapToWorld(area.x, area.y);
  const width = area.width * WORLD_SCALE;
  const depth = area.height * WORLD_SCALE;
  const plankCount = Math.max(4, Math.floor(area.width / 55));
  const spacing = width / plankCount;

  for (let index = 1; index < plankCount; index += 1) {
    const x = center.x - width / 2 + spacing * index;
    addBox(x, 0.012, center.z, 0.018, 0.018, depth, 0x7b5b3d);
  }
}

function addCeilingPanelLines(area) {
  const center = mapToWorld(area.x, area.y);
  const width = area.width * WORLD_SCALE;
  const depth = area.height * WORLD_SCALE;
  const columns = Math.max(2, Math.floor(area.width / 160));
  const rows = Math.max(2, Math.floor(area.height / 160));

  for (let index = 1; index < columns; index += 1) {
    const x = center.x - width / 2 + (width / columns) * index;
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.014, depth),
      new THREE.MeshBasicMaterial({ color: 0xd7d9d6, transparent: true, opacity: 0.28, depthWrite: false })
    );
    line.position.set(x, CORRIDOR_CEILING_Y - 0.07, center.z);
    line.renderOrder = -18;
    scene.add(line);
    ceilingMeshes.push(line);
  }

  for (let index = 1; index < rows; index += 1) {
    const z = center.z - depth / 2 + (depth / rows) * index;
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.014, 0.018),
      new THREE.MeshBasicMaterial({ color: 0xd7d9d6, transparent: true, opacity: 0.28, depthWrite: false })
    );
    line.position.set(center.x, CORRIDOR_CEILING_Y - 0.07, z);
    line.renderOrder = -18;
    scene.add(line);
    ceilingMeshes.push(line);
  }
}

function addCeilingLight(mapX, mapY, mapWidth, mapHeight) {
  const center = mapToWorld(mapX, mapY);
  const lightPanel = new THREE.Mesh(
    new THREE.BoxGeometry(mapWidth * WORLD_SCALE, 0.035, mapHeight * WORLD_SCALE),
    new THREE.MeshBasicMaterial({
      color: 0xfffff1,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      depthTest: false
    })
  );
  lightPanel.position.set(center.x, CORRIDOR_CEILING_Y - 0.11, center.z);
  lightPanel.userData.ceilingKind = "light";
  lightPanel.renderOrder = -19;
  scene.add(lightPanel);
  ceilingMeshes.push(lightPanel);

  const light = new THREE.PointLight(0xffffff, 0.65, 7);
  light.position.set(center.x, CORRIDOR_CEILING_Y - 0.28, center.z);
  scene.add(light);
}

function addLongCorridorDoorPanels() {
  const doorRows = [250, 500, 750];
  doorRows.forEach((mapY) => {
    addWallDoorPanel(444, mapY, "left");
    addWallDoorPanel(656, mapY, "right");
  });
}

function addWallDoorPanel(mapX, mapY, side) {
  const center = mapToWorld(mapX, mapY);
  const panelColor = 0xf4f6f3;
  const frameColor = 0xd7ddd8;
  const handleColor = 0xd7a94a;
  const width = 8 * WORLD_SCALE;
  const depth = 122 * WORLD_SCALE;
  const height = 5.1;
  const frameDepth = depth + 0.16;
  const faceOffset = side === "left" ? 0.018 : -0.018;
  const handleOffset = side === "left" ? width / 2 + 0.018 : -width / 2 - 0.018;

  addBox(center.x, height / 2, center.z, width, height, depth, frameColor);
  addBox(center.x + faceOffset, height / 2, center.z, width * 0.45, height * 0.9, depth * 0.84, panelColor);
  addBox(center.x + handleOffset, 1.55, center.z - depth * 0.18, 0.035, 0.12, 0.12, handleColor);
  addBox(center.x + faceOffset, height / 2, center.z, width * 0.48, height * 0.9, 0.025, 0xe7ebe7);
  addBox(center.x, height + 0.04, center.z, width * 1.2, 0.08, frameDepth, frameColor);
}

function addElevatorLobbyDetails() {
  const clockCenter = mapToWorld(690, 1892);
  const clock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.28, 0.04, 32),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 })
  );
  clock.rotation.x = Math.PI / 2;
  clock.position.set(clockCenter.x, 2.55, clockCenter.z);
  clock.castShadow = true;
  scene.add(clock);

  addBox(clockCenter.x, 2.55, clockCenter.z - 0.035, 0.03, 0.22, 0.02, 0x111827);
  addBox(clockCenter.x + 0.06, 2.59, clockCenter.z - 0.04, 0.16, 0.025, 0.02, 0x111827);
}

function addCorridorBaseboards() {
  const trimColor = 0x111827;
  mapData.obstacles
    .filter((obstacle) => obstacle.type === "wall" || obstacle.type === "door")
    .forEach((obstacle) => {
      const center = mapToWorld(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2);
      const width = obstacle.width * WORLD_SCALE;
      const depth = obstacle.height * WORLD_SCALE;
      addBox(center.x, 0.08, center.z, width + 0.03, 0.16, depth + 0.03, trimColor);
    });
}

function addFloorGrid(roomSize) {
  const grid = new THREE.GridHelper(roomSize, 20, 0x9b856d, 0xcab8a1);
  grid.position.y = 0.012;
  scene.add(grid);
}

function getObstacleVisualHeight(obstacle, fallbackHeight) {
  if (mapData.theme === "corridor-3f" && ["wall", "door", "blocker"].includes(obstacle.type)) {
    return CORRIDOR_WALL_HEIGHT;
  }

  return obstacle.visualHeight || fallbackHeight;
}

function addOuterHouseWalls(roomSize) {
  const wallMaterial = createMaterial(mapData.wallColor || 0xf4eee4);
  const trimMaterial = createMaterial(0x6b7280);
  const half = roomSize / 2;
  const wallThickness = 0.35;
  const wallHeight = 3.2;

  const wallSpecs = [
    { x: 0, z: -half, width: roomSize, depth: wallThickness },
    { x: 0, z: half, width: roomSize, depth: wallThickness },
    { x: -half, z: 0, width: wallThickness, depth: roomSize },
    { x: half, z: 0, width: wallThickness, depth: roomSize }
  ];

  wallSpecs.forEach((spec) => {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width, wallHeight, spec.depth),
      wallMaterial
    );
    wall.position.set(spec.x, wallHeight / 2, spec.z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  });

  const baseboard = new THREE.Mesh(
    new THREE.BoxGeometry(roomSize + 0.2, 0.16, 0.16),
    trimMaterial
  );
  [-half + 0.25, half - 0.25].forEach((z) => {
    const front = baseboard.clone();
    front.position.set(0, 0.12, z);
    scene.add(front);
  });
}

function addFurnitureAndWalls() {
  const orangeTreeObstacles = [];
  const stoneWallObstacles = [];

  mapData.obstacles.forEach((obstacle) => {
    if (obstacle.type === "orange-tree-trunk" || obstacle.type === "orange-tree-canopy") {
      return;
    }

    if (obstacle.type === "orange-tree") {
      orangeTreeObstacles.push(obstacle);
      return;
    }

    if (obstacle.type === "stone-wall") {
      stoneWallObstacles.push(obstacle);
      return;
    }

    const center = mapToWorld(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2);
    const width = obstacle.width * WORLD_SCALE;
    const depth = obstacle.height * WORLD_SCALE;
    const visualHeight = getObstacleVisualHeight(obstacle, obstacle.type === "wall" ? 2.9 : 1);

    if (obstacle.type === "wall") {
      addBox(center.x, visualHeight / 2, center.z, width, visualHeight, depth, obstacle.color || 0xe8dfd2);
    } else if (obstacle.type === "table") {
      addTable(center.x, center.z, width, depth, obstacle.id, obstacle.color || 0xf8fafc);
    } else if (obstacle.type === "chair") {
      addChair(obstacle.id, center.x, center.z, width, depth);
    } else if (obstacle.type === "sofa") {
      addSofa(obstacle.id, center.x, center.z, width, depth, obstacle.color || 0xd8dde5);
    } else if (obstacle.type === "door") {
      addDoor(center.x, center.z, width, depth, visualHeight, obstacle.color || 0x111111);
    } else if (obstacle.type === "elevator") {
      addElevator(center.x, center.z, width, depth, obstacle.visualHeight || 2.4, obstacle.color || 0x8a8f94);
    } else if (obstacle.type === "stairs") {
      addStairs(center.x, center.z, width, depth, obstacle.color || 0x999999);
    } else if (obstacle.type === "poster") {
      addPoster(center.x, center.z, width, depth, obstacle.color || 0x8ecae6);
    } else if (obstacle.type === "bulletin") {
      addBulletinBoard(center.x, center.z, width, depth, obstacle.color || 0xc9a66b);
    } else if (obstacle.type === "water") {
      addWaterDispenser(center.x, center.z, width, depth);
    } else if (obstacle.type === "window") {
      addWindowArea(center.x, center.z, width, depth, obstacle.color || 0x2f3b31);
    } else if (obstacle.type === "shelf") {
      addShelving(center.x, center.z, width, depth, obstacle.color || 0xb48a5a);
    } else if (obstacle.type === "column") {
      addColumn(center.x, center.z, width, depth, visualHeight, obstacle.color || 0x8fa995);
    } else if (obstacle.type === "stone-guardian") {
      addStoneGuardian(center.x, center.z, width, depth, visualHeight, obstacle.rotationY || 0);
    } else if (obstacle.type === "bush") {
      addBush(center.x, center.z, width, depth, visualHeight, obstacle.rotationY || 0, obstacle.color || 0x3f9f35);
    } else if (obstacle.type === "bench") {
      addBench(obstacle.id, center.x, center.z, width, depth, visualHeight, obstacle.rotationY || 0);
    } else if (obstacle.type === "picnic-mat") {
      addPicnicMat(center.x, center.z, width, depth, obstacle.rotationY || 0, obstacle.color || 0x73d7ff);
    } else if (obstacle.type === "orange-basket") {
      addOrangeBasket(center.x, center.z, width, depth, visualHeight, obstacle.rotationY || 0);
    } else if (obstacle.type === "blocker") {
      // Invisible collision volume used to keep the prototype inside the designed space.
    } else {
      addBox(center.x, visualHeight / 2, center.z, width, visualHeight, depth, obstacle.color || 0x8b735f);
    }
  });

  addOrangeTreeInstances(orangeTreeObstacles);
  addStoneWallInstances(stoneWallObstacles);
}

function addBox(x, y, z, width, height, depth, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    createMaterial(color)
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addBush(x, z, width, depth, height, rotationY, color) {
  const group = new THREE.Group();
  const leafMaterial = createMaterial(color, 0.92);
  const darkLeafMaterial = createMaterial(0x2f7d32, 0.95);
  const berriesMaterial = createMaterial(0xf97316, 0.8);
  const lumps = [
    { x: -width * 0.18, z: 0, r: Math.max(width, depth) * 0.34, h: height * 0.58 },
    { x: width * 0.16, z: -depth * 0.05, r: Math.max(width, depth) * 0.30, h: height * 0.66 },
    { x: 0, z: depth * 0.18, r: Math.max(width, depth) * 0.27, h: height * 0.52 }
  ];

  lumps.forEach((lump, index) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(lump.r, 12, 8),
      index % 2 === 0 ? leafMaterial : darkLeafMaterial
    );
    mesh.scale.y = 0.72;
    mesh.position.set(lump.x, lump.h, lump.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  for (let index = 0; index < 3; index += 1) {
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), berriesMaterial);
    berry.position.set((index - 1) * width * 0.16, height * (0.62 + index * 0.04), -depth * 0.24);
    berry.castShadow = true;
    group.add(berry);
  }

  group.rotation.y = rotationY;
  group.position.set(x, 0, z);
  scene.add(group);
}

function addPicnicMat(x, z, width, depth, rotationY, color) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.026, depth),
    createMaterial(color, 0.92)
  );
  base.position.y = 0.018;
  base.receiveShadow = true;
  group.add(base);

  const stripeMaterial = createMaterial(0xffffff, 0.9);
  [-0.24, 0.24].forEach((offset) => {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.12, 0.03, depth * 0.98),
      stripeMaterial
    );
    stripe.position.set(width * offset, 0.036, 0);
    stripe.receiveShadow = true;
    group.add(stripe);
  });

  const borderMaterial = createMaterial(0x2bb8e8, 0.9);
  [-0.5, 0.5].forEach((offset) => {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.98, 0.034, 0.035),
      borderMaterial
    );
    edge.position.set(0, 0.04, depth * offset);
    edge.receiveShadow = true;
    group.add(edge);
  });

  group.rotation.y = rotationY;
  group.position.set(x, 0, z);
  scene.add(group);
}

function addOrangeBasket(x, z, width, depth, visualHeight, rotationY) {
  loadModelTemplate("orange-basket")
    .then((template) => {
      if (!scene) {
        return;
      }

      const group = new THREE.Group();
      const visual = template.clone(true);
      fitModelToHeightAndFootprint(
        visual,
        visualHeight || 0.62,
        Math.max(width, 0.9),
        Math.max(depth, 0.76)
      );
      group.rotation.y = rotationY;
      group.position.set(x, 0, z);
      group.add(visual);
      scene.add(group);
    })
    .catch((error) => {
      console.error("Failed to load orange-basket.glb:", error);
      addBox(x, (visualHeight || 0.62) / 2, z, width, visualHeight || 0.62, depth, 0xf28c28);
    });
}

function addBench(benchId, x, z, width, depth, height, rotationY) {
  const group = new THREE.Group();
  const wood = 0x9a6a3a;
  const darkWood = 0x6f4425;

  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.16, depth * 0.65),
    createMaterial(wood, 0.82)
  );
  seat.position.y = 0.46;
  seat.userData.chairId = benchId;
  seat.castShadow = true;
  seat.receiveShadow = true;
  group.add(seat);
  chairMeshes.set(benchId, seat);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(width, height * 0.5, 0.13),
    createMaterial(wood, 0.82)
  );
  back.position.set(0, 0.78, depth * 0.34);
  back.rotation.x = -0.12;
  back.castShadow = true;
  back.receiveShadow = true;
  group.add(back);

  [-0.38, 0.38].forEach((xOffset) => {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.08, 0.44, depth * 0.12),
      createMaterial(darkWood, 0.85)
    );
    leg.position.set(width * xOffset, 0.22, -depth * 0.14);
    leg.castShadow = true;
    leg.receiveShadow = true;
    group.add(leg);
  });

  group.rotation.y = rotationY;
  group.position.set(x, 0, z);
  scene.add(group);
}

function addStoneWallInstances(obstacles) {
  if (!obstacles || obstacles.length === 0) {
    return;
  }

  loadModelTemplate("dry-stone-wall")
    .then((template) => {
      if (!scene) {
        return;
      }

      const sourceRoot = template.clone(true);
      sourceRoot.scale.setScalar(1);
      sourceRoot.updateMatrixWorld(true);

      const sourceBox = new THREE.Box3().setFromObject(sourceRoot);
      const sourceSize = sourceBox.getSize(new THREE.Vector3());
      const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
      const sourceMeshes = [];

      sourceRoot.traverse((child) => {
        if (child.isMesh && child.geometry && child.material) {
          sourceMeshes.push(child);
        }
      });

      if (sourceMeshes.length === 0) {
        obstacles.forEach((obstacle) => {
          const center = mapToWorld(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2);
          addBox(center.x, (obstacle.visualHeight || 1.55) / 2, center.z, obstacle.width * WORLD_SCALE, obstacle.visualHeight || 1.55, obstacle.height * WORLD_SCALE, obstacle.color || 0x9a9487);
        });
        return;
      }

      const group = new THREE.Group();
      const wallMatrix = new THREE.Matrix4();
      const normalizeMatrix = new THREE.Matrix4();
      const scaleMatrix = new THREE.Matrix4();
      const offsetMatrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scaleVector = new THREE.Vector3(1, 1, 1);

      sourceMeshes.forEach((sourceMesh) => {
        const instance = new THREE.InstancedMesh(
          sourceMesh.geometry,
          sourceMesh.material,
          obstacles.length
        );

        obstacles.forEach((obstacle, index) => {
          const center = mapToWorld(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2);
          const targetWidth = obstacle.width * WORLD_SCALE;
          const targetDepth = obstacle.height * WORLD_SCALE;
          const targetHeight = obstacle.visualHeight || 1.55;
          const isHorizontal = targetWidth >= targetDepth;
          const targetLength = Math.max(targetWidth, targetDepth);
          const targetThickness = Math.min(targetWidth, targetDepth);
          const scale = Math.min(
            sourceSize.x > 0 ? targetLength / sourceSize.x : 1,
            sourceSize.y > 0 ? targetHeight / sourceSize.y : 1,
            sourceSize.z > 0 ? targetThickness / sourceSize.z : 1
          );

          position.set(center.x, 0, center.z);
          quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), isHorizontal ? 0 : Math.PI / 2);
          wallMatrix.compose(position, quaternion, scaleVector);

          scaleMatrix.makeScale(scale, scale, scale);
          offsetMatrix.makeTranslation(-sourceCenter.x * scale, -sourceBox.min.y * scale, -sourceCenter.z * scale);
          normalizeMatrix.multiplyMatrices(offsetMatrix, scaleMatrix);
          instance.setMatrixAt(index, wallMatrix.clone().multiply(normalizeMatrix).multiply(sourceMesh.matrixWorld));
        });

        instance.castShadow = false;
        instance.receiveShadow = false;
        instance.instanceMatrix.needsUpdate = true;
        group.add(instance);
      });

      scene.add(group);
    })
    .catch((error) => {
      console.error("Failed to load dry-stone-wall.glb:", error);
      obstacles.forEach((obstacle) => {
        const center = mapToWorld(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2);
        addBox(center.x, (obstacle.visualHeight || 1.55) / 2, center.z, obstacle.width * WORLD_SCALE, obstacle.visualHeight || 1.55, obstacle.height * WORLD_SCALE, obstacle.color || 0x9a9487);
      });
    });
}

function addStoneGuardian(x, z, width, depth, visualHeight, rotationY) {
  loadModelTemplate("stone-guardian")
    .then((template) => {
      if (!scene) {
        return;
      }

      const group = new THREE.Group();
      const visual = template.clone(true);
      fitModelToHeightAndFootprint(
        visual,
        visualHeight || 1.65,
        Math.max(width * 1.5, 1.1),
        Math.max(depth * 1.5, 1.1)
      );
      group.rotation.y = rotationY;
      group.position.set(x, 0, z);
      group.add(visual);
      scene.add(group);
    })
    .catch((error) => {
      console.error("Failed to load stone-guardian.glb:", error);
      addColumn(x, z, width * 0.8, depth * 0.8, visualHeight || 1.65, 0x77736b);
    });
}

function addTable(x, z, width, depth, tableId = "", color = 0xf8fafc) {
  if (tableId.includes("round") || tableId.includes("white") || tableId.includes("coffee")) {
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.max(width, depth) / 2, Math.max(width, depth) / 2, 0.16, 32),
      createMaterial(color)
    );
    top.position.set(x, 0.46, z);
    top.castShadow = true;
    top.receiveShadow = true;
    scene.add(top);
    addBox(x, 0.22, z, 0.08, 0.44, 0.08, 0xf8fafc);
    addBox(x, 0.03, z, width * 0.5, 0.06, depth * 0.5, 0xf8fafc);
    return;
  }

  addBox(x, 0.72, z, width, 0.18, depth, color);
  const legPositions = [
    [-width / 2 + 0.18, -depth / 2 + 0.18],
    [width / 2 - 0.18, -depth / 2 + 0.18],
    [-width / 2 + 0.18, depth / 2 - 0.18],
    [width / 2 - 0.18, depth / 2 - 0.18]
  ];

  legPositions.forEach(([dx, dz]) => {
    addBox(x + dx, 0.34, z + dz, 0.18, 0.68, 0.18, 0x6f4425);
  });
}

function addSofa(sofaId, x, z, width, depth, color) {
  // Changed: 3F corridor sofas use the provided GLB visual while the obstacle footprint remains the collider.
  loadModelTemplate("sofa")
    .then((template) => {
      if (!scene) {
        return;
      }

      const group = new THREE.Group();
      const visual = template.clone(true);
      const rotateAlongWall = sofaId.startsWith("lounge-wall-sofa");
      fitModelToFootprint(visual, rotateAlongWall ? depth : width, rotateAlongWall ? width : depth);
      group.rotation.y = rotateAlongWall ? Math.PI / 2 : 0;
      group.position.set(x, 0, z);
      group.add(visual);
      scene.add(group);
    })
    .catch((error) => {
      console.error("Failed to load sofa.glb:", error);
      addBox(x, 0.34, z, width, 0.68, depth, color);
    });
}

function fitModelToFootprint(visual, targetWidth, targetDepth) {
  visual.scale.setScalar(1);
  visual.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(visual);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scaleX = size.x > 0 ? targetWidth / size.x : 1;
  const scaleZ = size.z > 0 ? targetDepth / size.z : 1;
  const scale = Math.min(scaleX, scaleZ);

  visual.scale.setScalar(scale);
  visual.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
}

function fitModelToHeightAndFootprint(visual, targetHeight, targetWidth, targetDepth) {
  visual.scale.setScalar(1);
  visual.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(visual);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const heightScale = size.y > 0 ? targetHeight / size.y : 1;
  const widthScale = size.x > 0 ? targetWidth / size.x : heightScale;
  const depthScale = size.z > 0 ? targetDepth / size.z : heightScale;
  const scale = Math.min(heightScale, widthScale, depthScale);

  visual.scale.setScalar(scale);
  visual.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
}

function addOrangeTreeInstances(obstacles) {
  if (!obstacles || obstacles.length === 0) {
    return;
  }

  loadModelTemplate("orange-tree")
    .then((template) => {
      if (!scene) {
        return;
      }

      const sourceRoot = template.clone(true);
      sourceRoot.scale.setScalar(1);
      sourceRoot.updateMatrixWorld(true);

      const sourceBox = new THREE.Box3().setFromObject(sourceRoot);
      const sourceSize = sourceBox.getSize(new THREE.Vector3());
      const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
      const sourceMeshes = [];

      sourceRoot.traverse((child) => {
        if (child.isMesh && child.geometry && child.material) {
          sourceMeshes.push(child);
        }
      });

      if (sourceMeshes.length === 0) {
        obstacles.forEach((obstacle) => {
          const center = mapToWorld(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2);
          addFallbackOrangeTree(
            center.x,
            center.z,
            obstacle.width * WORLD_SCALE,
            obstacle.height * WORLD_SCALE,
            obstacle.visualHeight || 2.1
          );
        });
        return;
      }

      const group = new THREE.Group();
      const treeMatrix = new THREE.Matrix4();
      const normalizeMatrix = new THREE.Matrix4();
      const scaleMatrix = new THREE.Matrix4();
      const offsetMatrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scaleVector = new THREE.Vector3(1, 1, 1);

      sourceMeshes.forEach((sourceMesh) => {
        const instance = new THREE.InstancedMesh(
          sourceMesh.geometry,
          sourceMesh.material,
          obstacles.length
        );

        obstacles.forEach((obstacle, index) => {
          const center = mapToWorld(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2);
          const targetWidth = Math.max(obstacle.width * WORLD_SCALE * 1.65, 1.75);
          const targetDepth = Math.max(obstacle.height * WORLD_SCALE * 1.65, 1.75);
          const targetHeight = obstacle.visualHeight || 2.1;
          const scale = Math.min(
            sourceSize.x > 0 ? targetWidth / sourceSize.x : 1,
            sourceSize.y > 0 ? targetHeight / sourceSize.y : 1,
            sourceSize.z > 0 ? targetDepth / sourceSize.z : 1
          );

          position.set(center.x, 0, center.z);
          quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), obstacle.rotationY || 0);
          treeMatrix.compose(position, quaternion, scaleVector);

          scaleMatrix.makeScale(scale, scale, scale);
          offsetMatrix.makeTranslation(-sourceCenter.x * scale, -sourceBox.min.y * scale, -sourceCenter.z * scale);
          normalizeMatrix.multiplyMatrices(offsetMatrix, scaleMatrix);
          instance.setMatrixAt(index, treeMatrix.clone().multiply(normalizeMatrix).multiply(sourceMesh.matrixWorld));
        });

        instance.castShadow = true;
        instance.receiveShadow = true;
        instance.instanceMatrix.needsUpdate = true;
        group.add(instance);
      });

      scene.add(group);
    })
    .catch((error) => {
      console.error("Failed to load orange-tree.glb:", error);
      obstacles.forEach((obstacle) => {
        const center = mapToWorld(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2);
        addFallbackOrangeTree(
          center.x,
          center.z,
          obstacle.width * WORLD_SCALE,
          obstacle.height * WORLD_SCALE,
          obstacle.visualHeight || 2.1
        );
      });
    });
}

function addFallbackOrangeTree(x, z, width, depth, visualHeight) {
  const trunk = addBox(x, visualHeight * 0.28, z, width * 0.24, visualHeight * 0.56, depth * 0.24, 0x8b5a2b);
  trunk.castShadow = false;
  trunk.receiveShadow = false;

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(
      Math.max(width, depth) * 0.58,
      18,
      12
    ),
    createMaterial(0x2f8f3a, 0.9)
  );
  canopy.position.set(x, visualHeight * 0.78, z);
  canopy.castShadow = false;
  canopy.receiveShadow = false;
  scene.add(canopy);
}

function addDoor(x, z, width, depth, height, color) {
  addBox(x, height / 2, z, width, height, depth, color);
  addBox(x, height - 0.2, z, width * 0.86, 0.08, depth + 0.03, 0xeeeeee);
}

function addElevator(x, z, width, depth, height, color) {
  addBox(x, height / 2, z, width, height, depth, 0x1f2328);
  addBox(x, height / 2, z - depth / 2 - 0.025, width * 0.82, height * 0.88, 0.05, color);
  addBox(x, height / 2, z - depth / 2 - 0.055, 0.035, height * 0.82, 0.035, 0x6b7280);
  addBox(x + width * 0.34, 1.35, z - depth / 2 - 0.07, 0.08, 0.26, 0.05, 0xffd166);
}

function addPoster(x, z, width, depth, color) {
  addBox(x, 1.35, z, width, 0.72, depth, color);
  addBox(x, 1.35, z - depth / 2 - 0.01, width * 0.86, 0.58, 0.02, 0xf8fafc);
}

function addBulletinBoard(x, z, width, depth, color) {
  addBox(x, 1.35, z, width, 0.9, depth, 0x3f2f20);
  addBox(x, 1.35, z - depth / 2 - 0.015, width * 0.9, 0.72, 0.02, color);
  addBox(x - width * 0.2, 1.42, z - depth / 2 - 0.03, width * 0.22, 0.22, 0.02, 0xf8fafc);
  addBox(x + width * 0.18, 1.22, z - depth / 2 - 0.03, width * 0.28, 0.18, 0.02, 0xe0f2fe);
}

function addShelving(x, z, width, depth, color) {
  addBox(x, 1.02, z, width, 2.04, depth, color);
  addBox(x, 0.62, z, width + 0.04, 0.055, depth * 0.92, 0x6f4e37);
  addBox(x, 1.12, z, width + 0.04, 0.055, depth * 0.92, 0x6f4e37);
  addBox(x, 1.62, z, width + 0.04, 0.055, depth * 0.92, 0x6f4e37);
}

function addColumn(x, z, width, depth, height, color) {
  addBox(x, height / 2, z, width, height, depth, color);
  addBox(x, 0.08, z, width + 0.08, 0.16, depth + 0.08, 0x111827);
}

function addWaterDispenser(x, z, width, depth) {
  addBox(x, 0.72, z, width * 0.86, 1.44, depth * 0.76, 0x111827);
  addBox(x, 1.52, z - depth * 0.02, width * 0.58, 0.34, depth * 0.6, 0x7dd3fc);
  addBox(x, 0.28, z + depth * 0.42, width * 0.68, 0.28, depth * 0.2, 0xe5e7eb);
  addBox(x + width * 0.36, 0.9, z - depth * 0.42, width * 0.08, 0.55, depth * 0.08, 0x4b5563);
}

function addWindowArea(x, z, width, depth, color) {
  addBox(x, 1.2, z, width, 1.65, depth, color);
  addBox(x, 1.2, z - depth / 2 - 0.01, width * 0.7, 1.25, 0.02, 0x6b7280);
  addBox(x, 1.2, z - depth / 2 - 0.03, width * 0.56, 0.95, 0.02, 0x111827);
}

function addStairs(x, z, width, depth, color) {
  const steps = 9;
  const runsAlongX = width >= depth;
  for (let index = 0; index < steps; index += 1) {
    const stepHeight = 0.24 + index * 0.2;

    if (runsAlongX) {
      const stepWidth = width / steps;
      const stepX = x - width / 2 + stepWidth * index + stepWidth / 2;
      addBox(stepX, stepHeight / 2, z, stepWidth, stepHeight, depth, color);
      addBox(stepX + stepWidth / 2 - 0.01, stepHeight + 0.035, z, 0.028, 0.07, depth, 0x4b5563);
    } else {
      const stepDepth = depth / steps;
      const stepZ = z - depth / 2 + stepDepth * index + stepDepth / 2;
      addBox(x, stepHeight / 2, stepZ, width, stepHeight, stepDepth, color);
      addBox(x, stepHeight + 0.035, stepZ + stepDepth / 2 - 0.01, width, 0.07, 0.028, 0x4b5563);
    }
  }

  if (runsAlongX) {
    addBox(x, 1.45, z - depth / 2 + 0.04, width, 0.08, 0.08, 0x374151);
    addBox(x, 1.45, z + depth / 2 - 0.04, width, 0.08, 0.08, 0x374151);
  } else {
    addBox(x - width / 2 + 0.04, 1.45, z, 0.08, 0.08, depth, 0x374151);
    addBox(x + width / 2 - 0.04, 1.45, z, 0.08, 0.08, depth, 0x374151);
  }
}

function addChair(chairId, x, z, width, depth) {
  const seat = addBox(x, 0.42, z, width, 0.16, depth, 0x60758c);
  seat.userData.isChair = true;
  seat.userData.chairId = chairId;
  chairMeshes.set(chairId, seat);
  addBox(x, 0.95, z + depth / 2 - 0.08, width, 0.95, 0.16, 0x52677e);
  addBox(x - width / 2 + 0.1, 0.22, z - depth / 2 + 0.1, 0.12, 0.44, 0.12, 0x455b70);
  addBox(x + width / 2 - 0.1, 0.22, z - depth / 2 + 0.1, 0.12, 0.44, 0.12, 0x455b70);
}

function addHouseDetails(half) {
  addBox(-half + 6, 0.06, -half + 7, 7, 0.04, 5, 0x9ca3af);
  addBox(half - 7, 0.07, half - 7, 5, 0.04, 6, 0xa7b88f);
  addBox(-half + 5, 1.1, half - 0.18, 4, 1.6, 0.08, 0x9ed8ff);
  addBox(half - 0.18, 1.1, -half + 6, 0.08, 1.6, 4, 0x9ed8ff);
}

function updateNameTag(model, name) {
  if (model.userData.nameTag) {
    model.remove(model.userData.nameTag);
  }

  const nameTag = createNameTag(name);
  nameTag.position.y = PLAYER_HEIGHT + 0.48;
  model.userData.nameTag = nameTag;
  model.userData.displayName = name;
  model.add(nameTag);
}

function getPlayerAvatar(player) {
  if (player.isHost) {
    return "rabbit";
  }

  return player.avatar === "cat" ? "cat" : "hamster";
}

function createPlayerModel(player) {
  const group = new THREE.Group();
  group.userData.isLocalPlayer = player.id === localPlayerId;
  group.userData.isHostAvatar = Boolean(player.isHost);
  group.userData.avatar = getPlayerAvatar(player);

  // Changed: the host remains rabbit; non-host players use the server-assigned random avatar.
  attachPlayerVisual(group, group.userData.avatar);

  updateNameTag(group, player.name || "Guest");

  scene.add(group);
  return group;
}

function loadModelTemplate(modelName) {
  if (modelTemplates.has(modelName)) {
    return Promise.resolve(modelTemplates.get(modelName));
  }

  if (!modelLoadPromises.has(modelName)) {
    const loader = new GLTFLoader();
    const loadPromise = loader.loadAsync(`/assets/models/${modelName}.glb`)
      .then((gltf) => {
        const template = gltf.scene;
        template.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = false;
            child.receiveShadow = false;
          }
        });
        modelTemplates.set(modelName, template);
        return template;
      });
    modelLoadPromises.set(modelName, loadPromise);
  }

  return modelLoadPromises.get(modelName);
}

function attachPlayerVisual(playerGroup, modelName) {
  if (playerGroup.userData.playerVisual) {
    playerGroup.remove(playerGroup.userData.playerVisual);
    playerGroup.userData.playerVisual = null;
  }

  const fallbackVisual = createFallbackPlayerVisual(modelName);
  playerGroup.userData.playerVisual = fallbackVisual;
  playerGroup.add(fallbackVisual);

  loadModelTemplate(modelName)
    .then((template) => {
      if (!scene || !playerGroup.parent) {
        return;
      }

      const visual = template.clone(true);
      normalizePlayerVisual(visual, modelName === "rabbit" ? 1.8 : 1.55);
      if (playerGroup.userData.playerVisual) {
        playerGroup.remove(playerGroup.userData.playerVisual);
      }
      playerGroup.userData.playerVisual = visual;
      playerGroup.add(visual);
    })
    .catch((error) => {
      console.error(`Failed to load ${modelName}.glb:`, error);
    });
}

function createFallbackPlayerVisual(modelName) {
  const group = new THREE.Group();
  const colorByModel = {
    rabbit: 0xf8fafc,
    cat: 0x111827,
    hamster: 0xf7c57e
  };
  const accentByModel = {
    rabbit: 0x7dd3fc,
    cat: 0xfbbf24,
    hamster: 0xec4899
  };
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.72, 5, 10),
    createMaterial(colorByModel[modelName] || 0xf8fafc, 0.88)
  );
  body.position.y = 0.78;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 14, 10),
    createMaterial(colorByModel[modelName] || 0xf8fafc, 0.88)
  );
  head.position.y = 1.32;
  group.add(head);

  const face = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 10, 8),
    createMaterial(accentByModel[modelName] || 0x60a5fa, 0.8)
  );
  face.position.set(0, 1.34, -0.29);
  group.add(face);

  return group;
}

function normalizePlayerVisual(visual, targetHeight) {
  // Changed: ignore the GLB root import scale and normalize each avatar to its requested meter height.
  visual.scale.setScalar(1);
  visual.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(visual);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = size.y > 0 ? targetHeight / size.y : 1;

  visual.scale.setScalar(scale);
  visual.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  visual.rotation.y = Math.PI;
}

function createNameTag(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(255, 255, 255, 0.75)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111827";
  context.font = "bold 28px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(1.8, 0.45, 1);
  return sprite;
}

function createChatBubble(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const trimmedText = text.length > 54 ? `${text.slice(0, 51)}...` : text;

  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.strokeStyle = "rgba(15, 23, 42, 0.22)";
  context.lineWidth = 4;
  context.beginPath();
  context.roundRect(12, 12, canvas.width - 24, canvas.height - 36, 18);
  context.fill();
  context.stroke();

  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.beginPath();
  context.moveTo(canvas.width / 2 - 18, canvas.height - 24);
  context.lineTo(canvas.width / 2, canvas.height - 4);
  context.lineTo(canvas.width / 2 + 18, canvas.height - 24);
  context.closePath();
  context.fill();
  context.stroke();

  context.fillStyle = "#172033";
  context.font = "bold 34px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(trimmedText, canvas.width / 2, 54);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(3.2, 0.8, 1);
  return sprite;
}

function showChatBubble(playerId, text) {
  const model = players.get(playerId);
  if (!model || !text) {
    return;
  }

  if (model.userData.chatBubble) {
    model.remove(model.userData.chatBubble);
    model.userData.chatBubble.material.map.dispose();
    model.userData.chatBubble.material.dispose();
    window.clearTimeout(model.userData.chatBubbleTimeoutId);
  }

  const bubble = createChatBubble(text);
  bubble.position.y = PLAYER_HEIGHT + 1.18;
  model.userData.chatBubble = bubble;
  model.add(bubble);

  model.userData.chatBubbleTimeoutId = window.setTimeout(() => {
    if (model.userData.chatBubble === bubble) {
      model.remove(bubble);
      bubble.material.map.dispose();
      bubble.material.dispose();
      model.userData.chatBubble = null;
    }
  }, 3600);
}

function applyPlayers(serverPlayers) {
  if (!scene) {
    return;
  }

  const incomingIds = new Set(serverPlayers.map((player) => player.id));

  players.forEach((model, playerId) => {
    if (!incomingIds.has(playerId)) {
      scene.remove(model);
      players.delete(playerId);
    }
  });

  serverPlayers.forEach((player) => {
    let model = players.get(player.id);
    if (!model) {
      model = createPlayerModel(player);
      players.set(player.id, model);
      updatePlayerModel(model, player, true);
      return;
    }

    updatePlayerModel(model, player);
  });

  ui.setPlayerCount(serverPlayers.length);
  ui.renderMembers(serverPlayers, {
    currentPlayerId: localPlayerId
  });
}

function updatePlayerModel(model, player, snapToTarget = false) {
  const position = mapToWorld(player.x, player.y);
  const rotationByDirection = {
    up: 0,
    down: Math.PI,
    left: Math.PI / 2,
    right: -Math.PI / 2
  };
  const targetRotation = Number.isFinite(player.seatedRotationY)
    ? player.seatedRotationY
    : rotationByDirection[player.direction] || 0;

  model.userData.seatedChairId = player.seatedChairId || null;
  const avatar = getPlayerAvatar(player);
  if (model.userData.avatar !== avatar) {
    model.userData.avatar = avatar;
    attachPlayerVisual(model, avatar);
  }
  model.userData.targetPosition = new THREE.Vector3(position.x, player.seatedChairId ? getSeatedPlayerY(player.seatedChairId) : 0, position.z);
  model.userData.targetRotation = targetRotation;

  if ((player.jumpStartedAt || 0) !== (model.userData.serverJumpStartedAt || 0)) {
    model.userData.serverJumpStartedAt = player.jumpStartedAt || 0;
    model.userData.localJumpStartedAt = player.jumpStartedAt ? performance.now() : 0;
  }

  if (model.userData.displayName !== player.name) {
    updateNameTag(model, player.name || "Guest");
  }

  if (snapToTarget) {
    model.position.copy(model.userData.targetPosition);
    model.rotation.y = targetRotation;
  }
}

function getSeatedPlayerY(chairId) {
  if (!mapData || !Array.isArray(mapData.obstacles)) {
    return SEATED_PLAYER_Y;
  }

  const seat = mapData.obstacles.find((obstacle) => (
    (obstacle.type === "chair" || obstacle.type === "bench") && obstacle.id === chairId
  ));
  if (!seat) {
    return SEATED_PLAYER_Y;
  }

  const seatHeight = Number.isFinite(seat.seatHeight)
    ? seat.seatHeight
    : Math.min(seat.visualHeight || SEATED_PLAYER_Y, SEATED_PLAYER_Y);
  return Math.max(SEATED_PLAYER_Y, seatHeight + SEATED_PLAYER_CLEARANCE);
}

function normalizeAngleDelta(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function smoothingAlpha(speed, deltaSeconds) {
  return 1 - Math.exp(-speed * deltaSeconds);
}

function getJumpOffset(model) {
  const jumpStartedAt = model.userData.localJumpStartedAt || 0;
  if (!jumpStartedAt || model.userData.seatedChairId) {
    return 0;
  }

  const progress = (performance.now() - jumpStartedAt) / JUMP_DURATION_MS;
  if (progress <= 0 || progress >= 1) {
    return 0;
  }

  return Math.sin(progress * Math.PI) * JUMP_HEIGHT;
}

function getClimbSurfaceHeight(model) {
  if (!mapData || !model || model.userData.seatedChairId) {
    return 0;
  }

  const playerBox = getPlayerBoxWorld(model.position);
  let surfaceHeight = 0;

  mapData.obstacles.forEach((obstacle) => {
    if (!isClimbableObstacle(obstacle)) {
      return;
    }

    const inset = getObstacleCollisionInset(obstacle) * WORLD_SCALE;
    const safeInset = Math.max(0, Math.min(inset, (obstacle.width * WORLD_SCALE) / 2 - 0.01, (obstacle.height * WORLD_SCALE) / 2 - 0.01));
    const min = mapToWorld(obstacle.x, obstacle.y);
    const max = mapToWorld(obstacle.x + obstacle.width, obstacle.y + obstacle.height);
    const obstacleBox = {
      left: Math.min(min.x, max.x) + safeInset,
      right: Math.max(min.x, max.x) - safeInset,
      top: Math.min(min.z, max.z) + safeInset,
      bottom: Math.max(min.z, max.z) - safeInset
    };

    if (boxesOverlap(playerBox, obstacleBox)) {
      surfaceHeight = Math.max(surfaceHeight, obstacle.visualHeight || 0);
    }
  });

  return surfaceHeight;
}

function getMovementRotation(movement) {
  return Math.atan2(-movement.x, -movement.z);
}

function predictLocalPlayerMovement(model, deltaSeconds) {
  if (model.userData.seatedChairId || latestMovementVector.lengthSq() <= 0.0001) {
    return;
  }

  const movement = latestMovementVector.clone();
  if (movement.lengthSq() > 1) {
    movement.normalize();
  }

  const step = VISUAL_PLAYER_SPEED * deltaSeconds;
  const nextX = model.position.clone();
  nextX.x += movement.x * step;
  if (canPlaceLocalPlayer(nextX)) {
    model.position.x = nextX.x;
  }

  const nextZ = model.position.clone();
  nextZ.z += movement.z * step;
  if (canPlaceLocalPlayer(nextZ)) {
    model.position.z = nextZ.z;
  }

  model.userData.targetRotation = getMovementRotation(movement);
}

function smoothLocalPlayer(model, targetPosition, targetRotation, deltaSeconds, rotationAlpha) {
  const hasMovement = latestMovementVector.lengthSq() > 0.0001;

  if (hasMovement && !model.userData.seatedChairId) {
    model.userData.targetRotation = getMovementRotation(latestMovementVector);
  }

  predictLocalPlayerMovement(model, deltaSeconds);

  if (targetPosition) {
    const horizontalDistance = Math.hypot(
      model.position.x - targetPosition.x,
      model.position.z - targetPosition.z
    );

    if (horizontalDistance > LOCAL_SERVER_SNAP_DISTANCE) {
      model.position.x = targetPosition.x;
      model.position.z = targetPosition.z;
    } else if (horizontalDistance > LOCAL_CORRECTION_DEAD_ZONE) {
      const correctionAlpha = smoothingAlpha(LOCAL_POSITION_SMOOTHING_SPEED, deltaSeconds);
      model.position.x += (targetPosition.x - model.position.x) * correctionAlpha;
      model.position.z += (targetPosition.z - model.position.z) * correctionAlpha;
    }
  }

  const desiredRotation = Number.isFinite(model.userData.targetRotation)
    ? model.userData.targetRotation
    : targetRotation;

  if (Number.isFinite(desiredRotation)) {
    const delta = normalizeAngleDelta(desiredRotation - model.rotation.y);
    model.rotation.y += delta * rotationAlpha;
  }
}

function smoothPlayerModels(deltaSeconds) {
  const positionAlpha = smoothingAlpha(POSITION_SMOOTHING_SPEED, deltaSeconds);
  const rotationAlpha = smoothingAlpha(ROTATION_SMOOTHING_SPEED, deltaSeconds);

  players.forEach((model) => {
    const targetPosition = model.userData.targetPosition;
    const targetRotation = model.userData.targetRotation;
    const jumpOffset = getJumpOffset(model);
    const surfaceHeight = getClimbSurfaceHeight(model);

    if (model.userData.isLocalPlayer) {
      smoothLocalPlayer(model, targetPosition, targetRotation, deltaSeconds, rotationAlpha);
      if (!model.userData.seatedChairId) {
        model.position.y = surfaceHeight + jumpOffset;
      }
      return;
    }

    if (targetPosition) {
      model.position.lerp(targetPosition, positionAlpha);
      if (!model.userData.seatedChairId) {
        model.position.y = surfaceHeight + jumpOffset;
      }
    }

    if (Number.isFinite(targetRotation)) {
      const delta = normalizeAngleDelta(targetRotation - model.rotation.y);
      model.rotation.y += delta * rotationAlpha;
    }
  });
}

function rotateCameraFromDrag(dx, dy) {
  cameraYaw -= dx * 0.006;
  cameraPitch = Math.max(0.22, Math.min(1.15, cameraPitch + dy * 0.004));
}

function setupCameraControls(canvas) {
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    isDraggingCamera = false;
    if (trySitOnChair(event, canvas)) {
      return;
    }
    resetMovementInput();
  });

  canvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      isDraggingCamera = false;
      resetMovementInput();
      return;
    }

    isDraggingCamera = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  });

  window.addEventListener("mouseup", (event) => {
    if (event.button !== 0) {
      resetMovementInput();
    }

    isDraggingCamera = false;
  });

  window.addEventListener("mousemove", (event) => {
    if (!isDraggingCamera) {
      return;
    }

    const dx = event.clientX - lastMouseX;
    const dy = event.clientY - lastMouseY;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    rotateCameraFromDrag(dx, dy);
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") {
      return;
    }

    event.preventDefault();
    touchCameraPointerId = event.pointerId;
    touchStartX = event.clientX;
    touchStartY = event.clientY;
    lastTouchX = event.clientX;
    lastTouchY = event.clientY;
    hasTouchCameraMoved = false;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (touchCameraPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const dx = event.clientX - lastTouchX;
    const dy = event.clientY - lastTouchY;
    lastTouchX = event.clientX;
    lastTouchY = event.clientY;

    if (Math.hypot(event.clientX - touchStartX, event.clientY - touchStartY) > 8) {
      hasTouchCameraMoved = true;
    }

    rotateCameraFromDrag(dx, dy);
  });

  const finishTouchCamera = (event) => {
    if (touchCameraPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    touchCameraPointerId = null;

    if (hasTouchCameraMoved) {
      lastCanvasTapTime = 0;
      return;
    }

    const now = performance.now();
    const tapDistance = Math.hypot(event.clientX - lastCanvasTapX, event.clientY - lastCanvasTapY);
    const isDoubleTap = now - lastCanvasTapTime < 340 && tapDistance < 34;

    if (isDoubleTap) {
      trySitOnChair(event, canvas);
      lastCanvasTapTime = 0;
      return;
    }

    lastCanvasTapTime = now;
    lastCanvasTapX = event.clientX;
    lastCanvasTapY = event.clientY;
  };

  canvas.addEventListener("pointerup", finishTouchCamera);
  canvas.addEventListener("pointercancel", (event) => {
    if (touchCameraPointerId === event.pointerId) {
      event.preventDefault();
      touchCameraPointerId = null;
      lastCanvasTapTime = 0;
    }
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    cameraDistance = Math.max(6.5, Math.min(24, cameraDistance + event.deltaY * 0.014));
  }, { passive: false });
}

function updateJoystickKnob() {
  const knob = document.getElementById("joystickKnob");
  if (!knob) {
    return;
  }

  knob.style.transform = `translate(calc(-50% + ${joystickVector.x * 34}px), calc(-50% + ${joystickVector.y * 34}px))`;
}

function updateJoystickFromPointer(event) {
  const base = document.getElementById("joystickBase");
  if (!base) {
    return;
  }

  const rect = base.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const radius = rect.width / 2;
  const dx = event.clientX - centerX;
  const dy = event.clientY - centerY;
  const distance = Math.hypot(dx, dy);
  const strength = Math.min(1, distance / radius);
  const angle = Math.atan2(dy, dx);

  joystickVector.set(Math.cos(angle) * strength, Math.sin(angle) * strength);
  updateJoystickKnob();
}

function updateJoystickFromTouch(touch) {
  updateJoystickFromPointer({
    clientX: touch.clientX,
    clientY: touch.clientY
  });
}

function releaseJoystick(pointerId = null) {
  if (pointerId !== null && joystickPointerId !== pointerId) {
    return;
  }

  joystickPointerId = null;
  joystickVector.set(0, 0);
  updateJoystickKnob();
}

function setupMobileJoystick() {
  applyMobileControlsClass();

  const joystick = document.getElementById("mobileJoystick");
  if (!joystick || joystick.dataset.ready === "true") {
    return;
  }

  joystick.dataset.ready = "true";
  updateJoystickKnob();

  joystick.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    joystickPointerId = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    updateJoystickFromPointer(event);
  });

  joystick.addEventListener("pointermove", (event) => {
    if (joystickPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    updateJoystickFromPointer(event);
  });

  joystick.addEventListener("pointerup", (event) => {
    event.preventDefault();
    releaseJoystick(event.pointerId);
  });

  joystick.addEventListener("pointercancel", (event) => {
    event.preventDefault();
    releaseJoystick(event.pointerId);
  });

  joystick.addEventListener("touchstart", (event) => {
    if (event.touches.length === 0 || joystickPointerId !== null) {
      return;
    }

    event.preventDefault();
    joystickPointerId = "touch";
    updateJoystickFromTouch(event.touches[0]);
  }, { passive: false });

  joystick.addEventListener("touchmove", (event) => {
    if (joystickPointerId !== "touch" || event.touches.length === 0) {
      return;
    }

    event.preventDefault();
    updateJoystickFromTouch(event.touches[0]);
  }, { passive: false });

  joystick.addEventListener("touchend", (event) => {
    if (joystickPointerId !== "touch") {
      return;
    }

    event.preventDefault();
    releaseJoystick("touch");
  }, { passive: false });

  joystick.addEventListener("touchcancel", (event) => {
    if (joystickPointerId !== "touch") {
      return;
    }

    event.preventDefault();
    releaseJoystick("touch");
  }, { passive: false });
}

function setupMobileJumpButton() {
  applyMobileControlsClass();

  const jumpButton = document.getElementById("mobileJumpButton");
  if (!jumpButton || jumpButton.dataset.ready === "true") {
    return;
  }

  jumpButton.dataset.ready = "true";

  const pressJump = (event) => {
    event.preventDefault();
    startJumpHold();
  };
  const releaseJump = (event) => {
    event.preventDefault();
    stopJumpHold();
  };

  jumpButton.addEventListener("pointerdown", pressJump);
  jumpButton.addEventListener("pointerup", releaseJump);
  jumpButton.addEventListener("pointercancel", releaseJump);
  jumpButton.addEventListener("pointerleave", releaseJump);
  jumpButton.addEventListener("touchstart", pressJump, { passive: false });
  jumpButton.addEventListener("touchend", releaseJump, { passive: false });
  jumpButton.addEventListener("touchcancel", releaseJump, { passive: false });
}

function trySitOnChair(event, canvas) {
  if (!camera || chairMeshes.size === 0) {
    return false;
  }

  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(Array.from(chairMeshes.values()), true);
  if (hits.length === 0) {
    return false;
  }

  socket.emit("sitOnChair", hits[0].object.userData.chairId, (response) => {
    if (!response || !response.ok) {
      ui.showDisconnectNotice(response && response.message ? response.message : "Could not sit there.");
    }
  });
  resetMovementInput();
  return true;
}

function getHorizontalForward(target = new THREE.Vector3()) {
  return target.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw)).normalize();
}

function shouldBlockCamera(obstacle) {
  return ["wall", "door", "elevator", "shelf", "column", "blocker", "orange-tree", "stone-wall", "stone-guardian"].includes(obstacle.type)
    && (obstacle.visualHeight || 1) > 1.4;
}

function getObstacleCameraBox(obstacle) {
  const min = mapToWorld(obstacle.x, obstacle.y);
  const max = mapToWorld(obstacle.x + obstacle.width, obstacle.y + obstacle.height);
  const padding = 0.22;

  return {
    left: Math.min(min.x, max.x) - padding,
    right: Math.max(min.x, max.x) + padding,
    top: Math.min(min.z, max.z) - padding,
    bottom: Math.max(min.z, max.z) + padding
  };
}

function getSegmentBoxEntry(start, end, box) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  let entry = 0;
  let exit = 1;

  const clipAxis = (startValue, delta, min, max) => {
    if (Math.abs(delta) < 0.00001) {
      return startValue >= min && startValue <= max;
    }

    let near = (min - startValue) / delta;
    let far = (max - startValue) / delta;
    if (near > far) {
      const temp = near;
      near = far;
      far = temp;
    }

    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    return entry <= exit;
  };

  if (!clipAxis(start.x, dx, box.left, box.right)) {
    return null;
  }
  if (!clipAxis(start.z, dz, box.top, box.bottom)) {
    return null;
  }

  return entry > 0.001 && entry <= 1 ? entry : null;
}

function getCameraPositionBeforeWalls(target, desiredPosition) {
  if (mapData.theme !== "corridor-3f") {
    return cameraSafePosition.copy(desiredPosition);
  }

  let nearestEntry = 1;
  mapData.obstacles
    .filter(shouldBlockCamera)
    .forEach((obstacle) => {
      const entry = getSegmentBoxEntry(target, desiredPosition, getObstacleCameraBox(obstacle));
      if (entry !== null) {
        nearestEntry = Math.min(nearestEntry, entry);
      }
    });

  const safeEntry = Math.max(0.16, nearestEntry - 0.045);
  cameraSafePosition.lerpVectors(target, desiredPosition, safeEntry);
  cameraSafePosition.y = Math.min(cameraSafePosition.y, CORRIDOR_CEILING_Y - 0.35);
  return cameraSafePosition;
}

function updateCeilingVisibility() {
  if (ceilingMeshes.length === 0 || mapData.theme !== "corridor-3f") {
    return;
  }

  ceilingMeshes.forEach((mesh) => {
    const isLight = mesh.userData.ceilingKind === "light";
    const desiredOpacity = isLight
      ? (camera.position.y > 1.65 || cameraPitch > 0.32 ? 0.08 : 0.28)
      : (camera.position.y > 1.65 || cameraPitch > 0.32 ? 0.015 : 0.10);
    mesh.material.opacity += (desiredOpacity - mesh.material.opacity) * 0.2;
    mesh.material.needsUpdate = true;
  });
}

function sendMovementInput() {
  const forward = getHorizontalForward();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const movement = new THREE.Vector3();

  if (keys.w) movement.add(forward);
  if (keys.s) movement.sub(forward);
  if (keys.d) movement.add(right);
  if (keys.a) movement.sub(right);
  if (joystickVector.lengthSq() > 0.001) {
    movement.addScaledVector(right, joystickVector.x);
    movement.addScaledVector(forward, -joystickVector.y);
  }

  if (movement.lengthSq() > 1) {
    movement.normalize();
  }

  const now = performance.now();
  const input = {
    up: keys.w || joystickVector.y < -0.1,
    down: keys.s || joystickVector.y > 0.1,
    left: keys.a || joystickVector.x < -0.1,
    right: keys.d || joystickVector.x > 0.1,
    xAxis: Number(movement.x.toFixed(4)),
    yAxis: Number(movement.z.toFixed(4))
  };
  const serializedInput = JSON.stringify(input);

  if (serializedInput !== lastSentInput) {
    const isStopping = input.xAxis === 0 && input.yAxis === 0;
    const minInterval = 30;
    if (!isStopping && now - lastInputSentAt < minInterval) {
      return;
    }

    lastSentInput = serializedInput;
    lastInputSentAt = now;
    latestMovementVector.copy(movement);
    socket.emit("input", input);
  }
}

function updateCamera(deltaSeconds) {
  const localPlayer = players.get(localPlayerId);
  if (!localPlayer) {
    return;
  }

  const target = localPlayer.position.clone();
  target.y = 1.15;

  if (!hasSmoothedCameraTarget) {
    smoothedCameraTarget.copy(target);
    hasSmoothedCameraTarget = true;
  } else {
    smoothedCameraTarget.lerp(target, smoothingAlpha(CAMERA_TARGET_SMOOTHING_SPEED, deltaSeconds));
  }

  const forward = getHorizontalForward(cameraForward);
  const horizontalDistance = Math.cos(cameraPitch) * cameraDistance;
  const verticalDistance = Math.sin(cameraPitch) * cameraDistance;
  cameraDesiredPosition.copy(smoothedCameraTarget)
    .addScaledVector(forward, -horizontalDistance);
  cameraDesiredPosition.y += verticalDistance;

  const safeCameraPosition = getCameraPositionBeforeWalls(smoothedCameraTarget, cameraDesiredPosition);
  camera.position.lerp(safeCameraPosition, smoothingAlpha(CAMERA_POSITION_SMOOTHING_SPEED, deltaSeconds));
  camera.lookAt(smoothedCameraTarget);
  updateCeilingVisibility();
}

function animate() {
  animationFrameId = requestAnimationFrame(animate);
  const now = performance.now();
  const deltaSeconds = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  sendMovementInput();
  smoothPlayerModels(deltaSeconds);
  updateCamera(deltaSeconds);
  renderer.render(scene, camera);
}

socket.on("stateUpdate", (state) => {
  if (!state || !Array.isArray(state.players)) {
    return;
  }
  applyPlayers(state.players);
});

socket.on("roomState", (state) => {
  if (!state || state.roomCode !== activeRoomCode || !Array.isArray(state.players)) {
    return;
  }
  ui.setRoomSaveState(Boolean(state.isSaved), isRoomOwner);
  applyPlayers(state.players);
});

socket.on("roomSaved", (state) => {
  if (!state || state.roomCode !== activeRoomCode) {
    return;
  }

  ui.setRoomSaveState(Boolean(state.isSaved), isRoomOwner);
});

socket.on("playerDisconnected", (payload) => {
  if (payload && payload.message) {
    ui.showDisconnectNotice(payload.message);
  }
});

socket.on("chatMessage", (message) => {
  ui.addChatMessage(message);
  showChatBubble(message.playerId, message.text);
});

socket.on("connect", () => {
  if (!activeRoomCode) {
    ui.setStatus("");
  }
});

socket.on("connect_error", () => {
  ui.setError("Could not connect to the game server. Check the host link and firewall.");
});

socket.on("disconnect", () => {
  if (!activeRoomCode) {
    ui.setError("Disconnected from the game server.");
  }
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && event.target && !["INPUT", "TEXTAREA"].includes(event.target.tagName)) {
    event.preventDefault();
    startJumpHold();
    return;
  }

  if (event.key === "Control") {
    socket.emit("leaveChair");
    return;
  }

  if (event.target && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) {
    return;
  }

  const key = event.key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(keys, key)) {
    keys[key] = true;
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    stopJumpHold();
    return;
  }

  if (event.target && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) {
    return;
  }

  const key = event.key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(keys, key)) {
    keys[key] = false;
  }
});

window.addEventListener("blur", () => {
  resetMovementInput();
  stopJumpHold();
  releaseJoystick();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resetMovementInput();
    stopJumpHold();
    releaseJoystick();
  }
});

window.addEventListener("resize", () => {
  if (!renderer || !camera) {
    return;
  }

  const container = document.getElementById("gameContainer");
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(getRendererPixelRatio());
  renderer.setSize(container.clientWidth, container.clientHeight);
});

ui.elements.createRoomButton.addEventListener("click", requestCreateRoom);
ui.elements.panoramaInput.addEventListener("change", () => {
  const file = ui.getPanoramaFile();
  ui.setPanoramaStatus(file
    ? `${file.name} selected. It will be checked against the supported beta photos.`
    : "Only the assigned 3층 복도.jpg beta photo is supported.");
});
ui.elements.joinRoomButton.addEventListener("click", requestJoinRoom);
ui.elements.refreshSavedRoomsButton.addEventListener("click", refreshSavedRooms);
ui.elements.saveRoomButton.addEventListener("click", requestSaveRoom);
ui.elements.deleteSavedRoomButton.addEventListener("click", requestDeleteSavedRoom);
ui.elements.chatInput.addEventListener("focus", () => {
  resetMovementInput();
  stopJumpHold();
});
ui.elements.chatSendButton.addEventListener("mousedown", resetMovementInput);
ui.elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  resetMovementInput();
  stopJumpHold();
  const message = ui.elements.chatInput.value.trim();
  if (!message) {
    return;
  }

  socket.emit("chatMessage", message, (response) => {
    if (!response || !response.ok) {
      ui.showDisconnectNotice(response && response.message ? response.message : "Message failed.");
    }
  });
  ui.elements.chatInput.value = "";
});
ui.elements.joinRoomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    requestJoinRoom();
  }
});

applyMobileControlsClass();
ui.setNickname(getSavedNickname());
refreshSavedRooms();
autoJoinRoomFromUrl();
