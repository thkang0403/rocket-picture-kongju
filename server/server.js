const path = require("path");
const os = require("os");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 15 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const SERVER_VERSION = "public-map-v2";
const PUBLIC_ROOM_CODE = String(process.env.PUBLIC_ROOM_CODE || "PUBLIC").trim().toUpperCase();
const PUBLIC_OWNER_TOKEN = "public-map-owner";
const KONJU_ROOM_CODE = "KONGJU";
const KONJU_OWNER_TOKEN = "konju-map-owner";
const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const MAP_SIZE = 2000;
const KONJU_MAP_SIZE = 700;
const PLAYER_SIZE = 22;
const PLAYER_CONTACT_DISTANCE = 14;
const PLAYER_SPEED = 240;
const SEAT_INTERACTION_DISTANCE = 68;
const JUMP_DURATION_MS = 650;
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_CHAT_LENGTH = 160;
const MAX_NICKNAME_LENGTH = 18;
const DATA_DIR = path.join(__dirname, "data");
const SAVED_ROOMS_FILE = path.join(DATA_DIR, "saved-rooms.json");

const rooms = new Map();
const savedRooms = loadSavedRooms();

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  Object.values(interfaces).forEach((entries) => {
    entries.forEach((entry) => {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    });
  });

  return addresses;
}

function loadSavedRooms() {
  try {
    if (!fs.existsSync(SAVED_ROOMS_FILE)) {
      return new Map();
    }

    const parsed = JSON.parse(fs.readFileSync(SAVED_ROOMS_FILE, "utf8"));
    return new Map(Object.entries(parsed.rooms || {}));
  } catch (error) {
    console.error("Could not load saved rooms:", error.message);
    return new Map();
  }
}

function writeSavedRooms() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const roomsObject = {};

  savedRooms.forEach((room, roomCode) => {
    roomsObject[roomCode] = room;
  });

  fs.writeFileSync(
    SAVED_ROOMS_FILE,
    JSON.stringify({ rooms: roomsObject }, null, 2),
    "utf8"
  );
}

const defaultObstacles = [
  { id: "wall-1", type: "wall", x: 360, y: 420, width: 980, height: 40 },
  { id: "wall-2", type: "wall", x: 360, y: 420, width: 40, height: 700 },
  { id: "wall-3", type: "wall", x: 1180, y: 420, width: 40, height: 520 },
  { id: "wall-4", type: "wall", x: 720, y: 980, width: 500, height: 40 },
  { id: "wall-5", type: "wall", x: 1320, y: 960, width: 40, height: 620 },
  { id: "wall-6", type: "wall", x: 760, y: 1560, width: 680, height: 40 },
  { id: "table-1", type: "table", x: 560, y: 650, width: 220, height: 130 },
  { id: "table-2", type: "table", x: 1450, y: 1250, width: 240, height: 140 },
  { id: "chair-1", type: "chair", x: 835, y: 655, width: 80, height: 80 },
  { id: "chair-2", type: "chair", x: 1455, y: 1490, width: 80, height: 80 }
];

function createDefaultMap() {
  return {
    size: MAP_SIZE,
    playerSize: PLAYER_SIZE,
    theme: "house",
    panoramaImage: "",
    floorColor: 0xd7c1a5,
    wallColor: 0xf4eee4,
    spawnPoints: spawnPoints.map((spawn) => ({ ...spawn })),
    obstacles: defaultObstacles.map((obstacle) => ({ ...obstacle }))
  };
}

function createKonjuGrassMap() {
  const treeSpecs = [
    { id: "orange-tree-1", x: 80, y: 92, size: 56, visualHeight: 3.05, rotationY: 0.35 },
    { id: "orange-tree-2", x: 178, y: 510, size: 52, visualHeight: 2.95, rotationY: 2.1 },
    { id: "orange-tree-3", x: 286, y: 84, size: 58, visualHeight: 3.1, rotationY: 4.55 },
    { id: "orange-tree-4", x: 438, y: 126, size: 50, visualHeight: 2.9, rotationY: 1.35 },
    { id: "orange-tree-5", x: 560, y: 220, size: 60, visualHeight: 3.15, rotationY: 5.4 },
    { id: "orange-tree-6", x: 520, y: 518, size: 55, visualHeight: 3.0, rotationY: 3.15 },
    { id: "orange-tree-7", x: 350, y: 598, size: 54, visualHeight: 2.95, rotationY: 0.95 },
    { id: "orange-tree-8", x: 96, y: 394, size: 57, visualHeight: 3.1, rotationY: 4.0 },
    { id: "orange-tree-9", x: 615, y: 410, size: 51, visualHeight: 2.9, rotationY: 2.75 },
    { id: "orange-tree-10", x: 214, y: 208, size: 55, visualHeight: 3.0, rotationY: 5.95 },
    { id: "orange-tree-11", x: 488, y: 304, size: 59, visualHeight: 3.15, rotationY: 0.75 },
    { id: "orange-tree-12", x: 252, y: 636, size: 50, visualHeight: 2.9, rotationY: 3.85 },
    { id: "orange-tree-13", x: 628, y: 92, size: 53, visualHeight: 2.95, rotationY: 1.95 },
    { id: "orange-tree-14", x: 58, y: 602, size: 52, visualHeight: 3.0, rotationY: 4.9 },
    { id: "orange-tree-15", x: 384, y: 474, size: 56, visualHeight: 3.05, rotationY: 2.45 },
    { id: "orange-tree-16", x: 136, y: 248, size: 50, visualHeight: 2.9, rotationY: 0.15 }
  ];

  const stoneWalls = [
    { id: "stone-wall-left-a", x: 180, y: 215, width: 32, height: 102 },
    { id: "stone-wall-left-b", x: 214, y: 286, width: 90, height: 30 },
    { id: "stone-wall-left-c", x: 312, y: 226, width: 30, height: 90 },
    { id: "stone-wall-right-a", x: 496, y: 220, width: 30, height: 102 },
    { id: "stone-wall-right-b", x: 500, y: 338, width: 30, height: 102 },
    { id: "stone-wall-right-c", x: 438, y: 454, width: 90, height: 30 }
  ];
  const guardians = [
    { id: "stone-guardian-left", x: 112, y: 420, width: 34, height: 34, visualHeight: 1.65, rotationY: 0.72 },
    { id: "stone-guardian-right", x: 438, y: 266, width: 34, height: 34, visualHeight: 1.65, rotationY: 3.75 }
  ];
  const bushes = [
    { id: "bush-1", x: 220, y: 124, width: 48, height: 34, visualHeight: 0.75, rotationY: 0.2 },
    { id: "bush-2", x: 430, y: 204, width: 42, height: 36, visualHeight: 0.7, rotationY: 1.2 },
    { id: "bush-3", x: 575, y: 330, width: 50, height: 38, visualHeight: 0.82, rotationY: 2.3 },
    { id: "bush-4", x: 185, y: 458, width: 44, height: 34, visualHeight: 0.7, rotationY: 4.1 },
    { id: "bush-5", x: 610, y: 548, width: 54, height: 40, visualHeight: 0.86, rotationY: 0.8 },
    { id: "bush-6", x: 72, y: 500, width: 46, height: 38, visualHeight: 0.76, rotationY: 2.8 },
    { id: "bush-7", x: 458, y: 610, width: 50, height: 36, visualHeight: 0.78, rotationY: 5.2 },
    { id: "bush-8", x: 640, y: 170, width: 44, height: 34, visualHeight: 0.72, rotationY: 3.4 }
  ];
  const benches = [
    { id: "bench-1", x: 232, y: 390, width: 76, height: 30, visualHeight: 0.85, seatHeight: 0.86, rotationY: -0.55 },
    { id: "bench-3", x: 380, y: 160, width: 70, height: 30, visualHeight: 0.85, seatHeight: 0.86, rotationY: 0.05 }
  ];
  const picnicMats = [
    { id: "picnic-mat-1", x: 590, y: 610, width: 82, height: 54, visualHeight: 0.035, rotationY: -0.18 }
  ];
  const orangeBaskets = [
    { id: "orange-basket-1", x: 590, y: 606, width: 34, height: 30, visualHeight: 0.62, rotationY: 0.85 }
  ];

  return {
    size: KONJU_MAP_SIZE,
    playerSize: PLAYER_SIZE,
    theme: "grass-field",
    panoramaImage: "",
    floorColor: 0x9ee85f,
    wallColor: 0xffffff,
    spawnPoints: [
      { x: 350, y: 350 },
      { x: 310, y: 350 },
      { x: 390, y: 350 },
      { x: 350, y: 310 },
      { x: 350, y: 390 },
      { x: 292, y: 292 },
      { x: 408, y: 292 },
      { x: 350, y: 448 }
    ],
    obstacles: [
      ...createOrangeTreeObstacles(treeSpecs),
      ...createStoneWallObstacles(stoneWalls),
      ...createStoneGuardianObstacles(guardians),
      ...createBushObstacles(bushes),
      ...createBenchObstacles(benches),
      ...createPicnicMatObstacles(picnicMats),
      ...createOrangeBasketObstacles(orangeBaskets)
    ]
  };
}

function createPicnicMatObstacles(mats) {
  return mats.map((mat) => ({
    ...mat,
    type: "picnic-mat",
    x: mat.x - mat.width / 2,
    y: mat.y - mat.height / 2,
    collisionDisabled: true,
    color: 0x73d7ff
  }));
}

function createOrangeBasketObstacles(baskets) {
  return baskets.map((basket) => ({
    ...basket,
    type: "orange-basket",
    x: basket.x - basket.width / 2,
    y: basket.y - basket.height / 2,
    collisionInset: 5,
    color: 0xf28c28
  }));
}

function createBushObstacles(bushes) {
  return bushes.map((bush) => ({
    ...bush,
    type: "bush",
    x: bush.x - bush.width / 2,
    y: bush.y - bush.height / 2,
    collisionDisabled: true,
    color: 0x3f9f35
  }));
}

function createBenchObstacles(benches) {
  return benches.map((bench) => ({
    ...bench,
    type: "bench",
    x: bench.x - bench.width / 2,
    y: bench.y - bench.height / 2,
    seatHeight: bench.seatHeight || 0.86,
    collisionInset: 3,
    color: 0x9a6a3a
  }));
}

function createStoneGuardianObstacles(guardians) {
  return guardians.map((guardian) => ({
    ...guardian,
    type: "stone-guardian",
    x: guardian.x - guardian.width / 2,
    y: guardian.y - guardian.height / 2,
    collisionInset: 10,
    color: 0x77736b
  }));
}

function createStoneWallObstacles(stoneWalls) {
  return stoneWalls.map((wall) => ({
    ...wall,
    type: "stone-wall",
    visualHeight: 1.55,
    collisionInset: 0,
    color: 0x9a9487
  }));
}

function createOrangeTreeObstacles(treeSpecs) {
  const obstacles = [];

  treeSpecs.forEach((tree) => {
    obstacles.push({
      id: tree.id,
      type: "orange-tree",
      x: tree.x - tree.size / 2,
      y: tree.y - tree.size / 2,
      width: tree.size,
      height: tree.size,
      visualHeight: tree.visualHeight,
      collisionDisabled: true,
      rotationY: tree.rotationY
    });

    obstacles.push({
      id: `${tree.id}-trunk`,
      type: "orange-tree-trunk",
      x: tree.x - 11,
      y: tree.y - 11,
      width: 22,
      height: 22,
      visualHeight: tree.visualHeight * 0.72,
      collisionInset: 0
    });

    obstacles.push({
      id: `${tree.id}-canopy-x`,
      type: "orange-tree-canopy",
      x: tree.x - tree.size * 0.44,
      y: tree.y - tree.size * 0.18,
      width: tree.size * 0.88,
      height: tree.size * 0.36,
      visualHeight: tree.visualHeight,
      collisionInset: 4
    });

    obstacles.push({
      id: `${tree.id}-canopy-y`,
      type: "orange-tree-canopy",
      x: tree.x - tree.size * 0.18,
      y: tree.y - tree.size * 0.44,
      width: tree.size * 0.36,
      height: tree.size * 0.88,
      visualHeight: tree.visualHeight,
      collisionInset: 4
    });
  });

  return obstacles;
}

const spawnPoints = [
  { x: 120, y: 120 },
  { x: 1880, y: 120 },
  { x: 120, y: 1880 },
  { x: 1880, y: 1880 },
  { x: 1000, y: 120 },
  { x: 120, y: 1000 },
  { x: 1880, y: 1000 },
  { x: 1000, y: 1880 }
];

app.use(express.static(path.join(__dirname, "..", "client")));
app.use("/assets", express.static(path.join(__dirname, "..", "assets")));
app.use("/phaser", express.static(path.join(__dirname, "..", "node_modules", "phaser", "dist")));
app.use("/three", express.static(path.join(__dirname, "..", "node_modules", "three", "build")));

app.get("/favicon.ico", (request, response) => {
  response.status(204).end();
});

app.get("/join/:roomCode", (request, response) => {
  response.sendFile(path.join(__dirname, "..", "client", "index.html"));
});

app.get("/health", (request, response) => {
  response.json({
    ok: true,
    version: SERVER_VERSION,
    publicRoomCode: PUBLIC_ROOM_CODE,
    konjuRoomCode: KONJU_ROOM_CODE,
    activeRooms: rooms.size,
    savedRooms: savedRooms.size
  });
});

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  do {
    code = "";
    for (let i = 0; i < 6; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (rooms.has(code) || savedRooms.has(code));

  return code;
}

function createRoom(ownerToken, mapConfig, fixedCode = null, options = {}) {
  const code = fixedCode || createRoomCode();
  rooms.set(code, {
    code,
    ownerToken,
    isSaved: Boolean(options.isSaved),
    isPublic: Boolean(options.isPublic),
    avatarBag: createAvatarBag(),
    map: sanitizeMapConfig(mapConfig),
    players: new Map()
  });
  return rooms.get(code);
}

function getReservedRoomMap(roomCode) {
  if (roomCode === KONJU_ROOM_CODE) {
    return createKonjuGrassMap();
  }

  return null;
}

function ensureReservedRoom(roomCode) {
  const mapConfig = getReservedRoomMap(roomCode);
  if (!mapConfig) {
    return null;
  }

  if (!rooms.has(roomCode)) {
    createRoom(KONJU_OWNER_TOKEN, mapConfig, roomCode, {
      isSaved: true,
      isPublic: true
    });
  } else {
    const room = rooms.get(roomCode);
    room.map = sanitizeMapConfig(mapConfig);
    room.isSaved = true;
    room.isPublic = true;
  }

  return rooms.get(roomCode);
}

function createRoomFromSaved(roomCode) {
  const savedRoom = savedRooms.get(roomCode);
  if (!savedRoom) {
    return null;
  }

  rooms.set(roomCode, {
    code: roomCode,
    ownerToken: savedRoom.ownerToken,
    isSaved: true,
    isPublic: false,
    avatarBag: createAvatarBag(),
    map: sanitizeMapConfig(savedRoom.map),
    players: new Map()
  });

  return rooms.get(roomCode);
}

function ensurePublicRoom() {
  if (!PUBLIC_ROOM_CODE || PUBLIC_ROOM_CODE.length !== 6) {
    return null;
  }

  if (!rooms.has(PUBLIC_ROOM_CODE)) {
    createRoom(PUBLIC_OWNER_TOKEN, null, PUBLIC_ROOM_CODE, {
      isSaved: true,
      isPublic: true
    });
  }

  return rooms.get(PUBLIC_ROOM_CODE);
}

function ensurePermanentRooms() {
  ensurePublicRoom();
  ensureReservedRoom(KONJU_ROOM_CODE);
}

function playerColor(index) {
  const colors = [
    0x3b82f6,
    0xef4444,
    0x22c55e,
    0xeab308,
    0xa855f7,
    0x14b8a6,
    0xf97316,
    0xec4899
  ];
  return colors[index % colors.length];
}

function cleanNickname(nickname) {
  const cleaned = String(nickname || "").replace(/\s+/g, " ").trim().slice(0, MAX_NICKNAME_LENGTH);
  return cleaned || "Guest";
}

function cleanAvatar(avatar) {
  if (avatar === "cat" || avatar === "hamster") {
    return avatar;
  }

  return null;
}

function createAvatarBag() {
  const avatars = ["hamster", "cat"];
  return Math.random() < 0.5 ? avatars : avatars.reverse();
}

function drawGuestAvatar(room) {
  if (!Array.isArray(room.avatarBag) || room.avatarBag.length === 0) {
    room.avatarBag = createAvatarBag();
  }

  return room.avatarBag.pop();
}

function cleanChatMessage(message) {
  return String(message || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_LENGTH);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}

function sanitizeColor(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(0, Math.min(0xffffff, Math.floor(number)));
}

function getDefaultCollisionInset(type) {
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
    "stone-wall": 0,
    "stone-guardian": 10,
    bush: 4,
    bench: 3,
    "orange-basket": 5,
    "picnic-mat": 0,
    object: 6
  };

  return insetsByType[type] || 0;
}

function sanitizeMapConfig(mapConfig) {
  const defaultMap = createDefaultMap();
  if (!mapConfig || typeof mapConfig !== "object") {
    return defaultMap;
  }

  const mapSize = clampNumber(mapConfig.size, 600, MAP_SIZE, MAP_SIZE);
  const sourceObstacles = Array.isArray(mapConfig.obstacles)
    ? mapConfig.obstacles.slice(0, 96)
    : defaultMap.obstacles;
  const obstacles = sourceObstacles.map((obstacle, index) => {
    const type = ["wall", "table", "chair", "object", "door", "elevator", "sofa", "stairs", "poster", "bulletin", "water", "window", "shelf", "column", "blocker", "orange-tree", "orange-tree-trunk", "orange-tree-canopy", "stone-wall", "stone-guardian", "bush", "bench", "orange-basket", "picnic-mat"].includes(obstacle.type)
      ? obstacle.type
      : "object";
    const minObstacleSize = type.startsWith("orange-tree") || type === "orange-basket" || type === "picnic-mat" ? 12 : 36;
    const width = clampNumber(obstacle.width, minObstacleSize, mapSize, 120);
    const height = clampNumber(obstacle.height, minObstacleSize, mapSize, 120);
    const visualHeight = clampNumber(obstacle.visualHeight, 0.25, 4.2, type === "wall" ? 3.5 : 0.9);

    return {
      id: String(obstacle.id || `${type}-${index + 1}`).slice(0, 32),
      type,
      x: clampNumber(obstacle.x, 0, mapSize - width, 400),
      y: clampNumber(obstacle.y, 0, mapSize - height, 400),
      width,
      height,
      visualHeight: type === "sofa" ? Math.min(visualHeight, 0.55) : visualHeight,
      seatHeight: clampNumber(obstacle.seatHeight, 0.25, 1.4, type === "bench" ? 0.55 : 0.58),
      collisionInset: clampNumber(obstacle.collisionInset, 0, Math.min(width, height) / 2 - 1, getDefaultCollisionInset(type)),
      color: sanitizeColor(obstacle.color, type === "wall" ? 0xd8d2c8 : 0x8b735f),
      rotationY: clampNumber(obstacle.rotationY, -Math.PI * 2, Math.PI * 2, 0),
      collisionDisabled: Boolean(obstacle.collisionDisabled)
    };
  });

  const supportedThemes = ["corridor-3f", "grass-field"];
  const requestedSpawns = Array.isArray(mapConfig.spawnPoints)
    ? mapConfig.spawnPoints.slice(0, 8)
    : defaultMap.spawnPoints;

  return {
    size: mapSize,
    playerSize: PLAYER_SIZE,
    theme: supportedThemes.includes(mapConfig.theme) ? mapConfig.theme : "house",
    panoramaImage: "",
    floorColor: sanitizeColor(mapConfig.floorColor, defaultMap.floorColor),
    wallColor: sanitizeColor(mapConfig.wallColor, defaultMap.wallColor),
    spawnPoints: requestedSpawns.map((spawn) => ({
      x: clampNumber(spawn.x, PLAYER_SIZE, mapSize - PLAYER_SIZE, mapSize / 2),
      y: clampNumber(spawn.y, PLAYER_SIZE, mapSize - PLAYER_SIZE, mapSize / 2)
    })),
    obstacles
  };
}

function serializeRoom(room) {
  return Array.from(room.players.values()).map((player) => ({
    id: player.id,
    x: player.x,
    y: player.y,
    direction: player.direction,
    color: player.color,
    isHost: player.isHost,
    avatar: player.avatar,
    name: player.name,
    seatedChairId: player.seatedChairId,
    seatedRotationY: player.seatedRotationY,
    jumpStartedAt: player.jumpStartedAt
  }));
}

function getSocketRoomCode(socket) {
  return socket.data.roomCode || null;
}

function isRoomOwner(socket, room) {
  return Boolean(room && room.ownerToken && socket.data.ownerToken === room.ownerToken);
}

function serializeRoomMeta(socket, room) {
  return {
    isSaved: room.isSaved,
    isOwner: isRoomOwner(socket, room),
    isPublic: room.isPublic
  };
}

function leaveCurrentRoom(socket, reason) {
  const roomCode = getSocketRoomCode(socket);
  if (!roomCode) {
    return;
  }

  const room = rooms.get(roomCode);
  socket.leave(roomCode);
  socket.data.roomCode = null;

  if (!room) {
    return;
  }

  const removedPlayer = room.players.get(socket.id);
  room.players.delete(socket.id);

  if (removedPlayer) {
    io.to(roomCode).emit("playerDisconnected", {
      id: socket.id,
      message: `${removedPlayer.name} disconnected`
    });
  }

  if (room.players.size === 0 && !room.isPublic) {
    rooms.delete(roomCode);
    return;
  }

  io.to(roomCode).emit("roomState", {
    roomCode,
    players: serializeRoom(room),
    map: room.map,
    isSaved: room.isSaved,
    isPublic: room.isPublic
  });
}

function boxesOverlap(a, b) {
  return a.left < b.right
    && a.right > b.left
    && a.top < b.bottom
    && a.bottom > b.top;
}

function isClimbableObstacle(obstacle) {
  return obstacle.type === "sofa" && (obstacle.visualHeight || 1) <= 0.8;
}

function getPlayerBox(x, y) {
  const half = PLAYER_SIZE / 2;
  return {
    left: x - half,
    right: x + half,
    top: y - half,
    bottom: y + half
  };
}

function getObstacleCollisionBox(obstacle) {
  if (obstacle.type === "stone-wall") {
    const isHorizontal = obstacle.width >= obstacle.height;
    const lengthInset = 8;
    const targetThickness = 16;
    const thicknessInset = Math.max(0, ((isHorizontal ? obstacle.height : obstacle.width) - targetThickness) / 2);

    return {
      left: obstacle.x + (isHorizontal ? lengthInset : thicknessInset),
      right: obstacle.x + obstacle.width - (isHorizontal ? lengthInset : thicknessInset),
      top: obstacle.y + (isHorizontal ? thicknessInset : lengthInset),
      bottom: obstacle.y + obstacle.height - (isHorizontal ? thicknessInset : lengthInset)
    };
  }

  const inset = clampNumber(
    obstacle.collisionInset,
    0,
    Math.min(obstacle.width, obstacle.height) / 2 - 1,
    getDefaultCollisionInset(obstacle.type)
  );

  return {
    left: obstacle.x + inset,
    right: obstacle.x + obstacle.width - inset,
    top: obstacle.y + inset,
    bottom: obstacle.y + obstacle.height - inset
  };
}

function isOverlappingObstacle(room, x, y, climbHeight = 0, currentX = null, currentY = null) {
  const playerBox = getPlayerBox(x, y);
  const currentPlayerBox = Number.isFinite(currentX) && Number.isFinite(currentY)
    ? getPlayerBox(currentX, currentY)
    : null;
  return room.map.obstacles.some((obstacle) => {
    if (obstacle.collisionDisabled) {
      return false;
    }

    if ((obstacle.visualHeight || 1) <= climbHeight) {
      return false;
    }

    const obstacleBox = getObstacleCollisionBox(obstacle);

    if (currentPlayerBox && isClimbableObstacle(obstacle) && boxesOverlap(currentPlayerBox, obstacleBox)) {
      return false;
    }

    return boxesOverlap(playerBox, obstacleBox);
  });
}

function isOverlappingPlayer(room, movingPlayer, x, y) {
  return Array.from(room.players.values()).some((otherPlayer) => {
    if (otherPlayer.id === movingPlayer.id) {
      return false;
    }

    return Math.hypot(otherPlayer.x - x, otherPlayer.y - y) < PLAYER_CONTACT_DISTANCE;
  });
}

function getPlayerContactPosition(room, movingPlayer, fromX, fromY, toX, toY) {
  let result = { x: toX, y: toY };

  room.players.forEach((otherPlayer) => {
    if (otherPlayer.id === movingPlayer.id) {
      return;
    }

    const dx = result.x - otherPlayer.x;
    const dy = result.y - otherPlayer.y;
    const distance = Math.hypot(dx, dy);

    if (distance >= PLAYER_CONTACT_DISTANCE || distance < 0.0001) {
      return;
    }

    const fromDistance = Math.hypot(fromX - otherPlayer.x, fromY - otherPlayer.y);
    if (fromDistance < distance) {
      return;
    }

    const nx = dx / distance;
    const ny = dy / distance;
    result = {
      x: otherPlayer.x + nx * PLAYER_CONTACT_DISTANCE,
      y: otherPlayer.y + ny * PLAYER_CONTACT_DISTANCE
    };
  });

  return result;
}

function canPlacePlayer(room, movingPlayer, x, y, climbHeight = 0) {
  return !isOverlappingObstacle(room, x, y, climbHeight, movingPlayer.x, movingPlayer.y)
    && !isOverlappingPlayer(room, movingPlayer, x, y);
}

function getChair(room, chairId) {
  return room.map.obstacles.find((obstacle) => (obstacle.type === "chair" || obstacle.type === "bench") && obstacle.id === chairId) || null;
}

function isChairOccupied(room, chairId, ignoredPlayerId) {
  return Array.from(room.players.values()).some((player) => (
    player.id !== ignoredPlayerId && player.seatedChairId === chairId
  ));
}

function getSeatPosition(chair) {
  const centerX = chair.x + chair.width / 2;
  const centerY = chair.y + chair.height / 2;

  if (chair.type !== "bench") {
    return { x: centerX, y: centerY };
  }

  const frontOffset = -chair.height * 0.16;
  const rotationY = Number.isFinite(chair.rotationY) ? chair.rotationY : 0;
  return {
    x: centerX + Math.sin(rotationY) * frontOffset,
    y: centerY + Math.cos(rotationY) * frontOffset
  };
}

function isPlayerCloseEnoughToSeat(player, chair) {
  const centerX = chair.x + chair.width / 2;
  const centerY = chair.y + chair.height / 2;
  const seatPosition = getSeatPosition(chair);
  const centerDistance = Math.hypot(player.x - centerX, player.y - centerY);
  const seatDistance = Math.hypot(player.x - seatPosition.x, player.y - seatPosition.y);

  return Math.min(centerDistance, seatDistance) <= SEAT_INTERACTION_DISTANCE;
}

function findDismountPosition(chair, room, player) {
  const centerX = chair.x + chair.width / 2;
  const centerY = chair.y + chair.height / 2;
  const extraGap = PLAYER_SIZE * 1.25;
  const candidates = [
    { x: centerX, y: chair.y + chair.height + extraGap },
    { x: centerX, y: chair.y - extraGap },
    { x: chair.x - extraGap, y: centerY },
    { x: chair.x + chair.width + extraGap, y: centerY },
    { x: chair.x - extraGap, y: chair.y - extraGap },
    { x: chair.x + chair.width + extraGap, y: chair.y - extraGap },
    { x: chair.x - extraGap, y: chair.y + chair.height + extraGap },
    { x: chair.x + chair.width + extraGap, y: chair.y + chair.height + extraGap }
  ];

  return candidates.find((position) => {
    const x = clampPlayerToMap(room, position.x);
    const y = clampPlayerToMap(room, position.y);
    return canPlacePlayer(room, player, x, y);
  }) || {
    x: clampPlayerToMap(room, chair.x + chair.width / 2),
    y: clampPlayerToMap(room, chair.y + chair.height + PLAYER_SIZE)
  };
}

function hasMovementInput(input) {
  if (!input) {
    return false;
  }

  const xAxis = Number(input.xAxis);
  const yAxis = Number(input.yAxis);
  return Boolean(input.up || input.down || input.left || input.right)
    || (Number.isFinite(xAxis) && Math.abs(xAxis) > 0.05)
    || (Number.isFinite(yAxis) && Math.abs(yAxis) > 0.05);
}

function getSeatReturnPosition(room, player, chair) {
  const saved = player.seatReturnPosition;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const x = clampPlayerToMap(room, saved.x);
    const y = clampPlayerToMap(room, saved.y);
    if (canPlacePlayer(room, player, x, y)) {
      return { x, y };
    }
  }

  return chair ? findDismountPosition(chair, room, player) : {
    x: clampPlayerToMap(room, player.x),
    y: clampPlayerToMap(room, player.y)
  };
}

function leaveSeat(room, player) {
  if (!room || !player || !player.seatedChairId) {
    return false;
  }

  const chair = getChair(room, player.seatedChairId);
  const position = getSeatReturnPosition(room, player, chair);
  player.seatedChairId = null;
  player.seatedRotationY = null;
  player.seatReturnPosition = null;
  player.x = position.x;
  player.y = position.y;
  player.input = createEmptyInput();
  player.jumpHeld = false;
  return true;
}

function createEmptyInput() {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    xAxis: 0,
    yAxis: 0
  };
}

function clampPlayerToMap(room, value) {
  const half = PLAYER_SIZE / 2;
  const mapSize = room?.map?.size || MAP_SIZE;
  return Math.max(half, Math.min(mapSize - half, value));
}

function getServerJumpHeight(player, now) {
  const progress = (now - player.jumpStartedAt) / JUMP_DURATION_MS;
  if (progress <= 0 || progress >= 1 || player.seatedChairId) {
    return 0;
  }

  return Math.sin(progress * Math.PI) * 0.75;
}

function movePlayer(room, player, deltaSeconds, now) {
  if (player.seatedChairId) {
    return;
  }

  const input = player.input;
  let xAxis = 0;
  let yAxis = 0;

  if (Number.isFinite(input.xAxis) && Number.isFinite(input.yAxis)) {
    xAxis = Math.max(-1, Math.min(1, input.xAxis));
    yAxis = Math.max(-1, Math.min(1, input.yAxis));
  } else {
    if (input.left) xAxis -= 1;
    if (input.right) xAxis += 1;
    if (input.up) yAxis -= 1;
    if (input.down) yAxis += 1;
  }

  if (xAxis === 0 && yAxis === 0) {
    return;
  }

  const length = Math.hypot(xAxis, yAxis);
  const dx = (xAxis / length) * PLAYER_SPEED * deltaSeconds;
  const dy = (yAxis / length) * PLAYER_SPEED * deltaSeconds;
  const climbHeight = getServerJumpHeight(player, now);

  if (Math.abs(dx) > Math.abs(dy)) {
    player.direction = dx > 0 ? "right" : "left";
  } else {
    player.direction = dy > 0 ? "down" : "up";
  }

  const nextX = clampPlayerToMap(room, player.x + dx);
  if (canPlacePlayer(room, player, nextX, player.y, climbHeight)) {
    player.x = nextX;
  } else if (!isOverlappingObstacle(room, nextX, player.y, climbHeight, player.x, player.y)) {
    const contact = getPlayerContactPosition(room, player, player.x, player.y, nextX, player.y);
    if (!isOverlappingObstacle(room, contact.x, contact.y, climbHeight, player.x, player.y)) {
      player.x = clampPlayerToMap(room, contact.x);
    }
  }

  const nextY = clampPlayerToMap(room, player.y + dy);
  if (canPlacePlayer(room, player, player.x, nextY, climbHeight)) {
    player.y = nextY;
  } else if (!isOverlappingObstacle(room, player.x, nextY, climbHeight, player.x, player.y)) {
    const contact = getPlayerContactPosition(room, player, player.x, player.y, player.x, nextY);
    if (!isOverlappingObstacle(room, contact.x, contact.y, climbHeight, player.x, player.y)) {
      player.y = clampPlayerToMap(room, contact.y);
    }
  }
}

function updateHeldJump(player, now) {
  if (!player.jumpHeld || player.seatedChairId) {
    return;
  }

  if (now - player.jumpStartedAt >= JUMP_DURATION_MS) {
    player.jumpStartedAt = now;
  }
}

function createPlayer(socket, room) {
  const roomSpawnPoints = Array.isArray(room.map.spawnPoints) && room.map.spawnPoints.length > 0
    ? room.map.spawnPoints
    : spawnPoints;
  const spawn = roomSpawnPoints[room.players.size % roomSpawnPoints.length];
  return {
    id: socket.id,
    ownerToken: socket.data.ownerToken || "",
    isHost: socket.data.ownerToken === room.ownerToken,
    avatar: socket.data.ownerToken === room.ownerToken ? "rabbit" : (socket.data.avatar || drawGuestAvatar(room)),
    name: cleanNickname(socket.data.nickname),
    seatedChairId: null,
    seatedRotationY: null,
    seatReturnPosition: null,
    jumpStartedAt: 0,
    jumpHeld: false,
    x: spawn.x,
    y: spawn.y,
    direction: room.map.theme === "corridor-3f" ? "up" : "down",
    color: playerColor(room.players.size),
    input: {
      up: false,
      down: false,
      left: false,
      right: false
    }
  };
}

function joinRoom(socket, roomCode, nickname, avatar, callback) {
  const reply = typeof callback === "function" ? callback : () => {};
  const normalizedCode = String(roomCode || "").trim().toUpperCase();
  socket.data.nickname = cleanNickname(nickname);
  socket.data.avatar = cleanAvatar(avatar);
  let room = normalizedCode === PUBLIC_ROOM_CODE
    ? ensurePublicRoom()
    : ensureReservedRoom(normalizedCode) || rooms.get(normalizedCode);

  if (!room && savedRooms.has(normalizedCode)) {
    room = createRoomFromSaved(normalizedCode);
  }

  if (!room) {
    reply({ ok: false, message: "Room code does not exist." });
    socket.emit("joinAccepted", { ok: false, message: "Room code does not exist." });
    return;
  }

  if (room.players.size >= MAX_PLAYERS_PER_ROOM && !room.players.has(socket.id)) {
    reply({ ok: false, message: "Room is full." });
    socket.emit("joinAccepted", { ok: false, message: "Room is full." });
    return;
  }

  if (getSocketRoomCode(socket) !== normalizedCode) {
    leaveCurrentRoom(socket, "joined another room");
  }

  if (socket.data.ownerToken !== room.ownerToken && !socket.data.avatar) {
    socket.data.avatar = drawGuestAvatar(room);
  }

  socket.join(normalizedCode);
  socket.data.roomCode = normalizedCode;

  if (!room.players.has(socket.id)) {
    room.players.set(socket.id, createPlayer(socket, room));
  } else {
    const player = room.players.get(socket.id);
    player.name = socket.data.nickname;
    player.avatar = player.isHost ? "rabbit" : socket.data.avatar;
  }

  const joinPayload = {
    ok: true,
    roomCode: normalizedCode,
    playerId: socket.id,
    map: room.map,
    players: serializeRoom(room),
    ...serializeRoomMeta(socket, room)
  };

  reply(joinPayload);
  socket.emit("joinAccepted", joinPayload);

  io.to(normalizedCode).emit("roomState", {
    roomCode: normalizedCode,
    players: serializeRoom(room),
    map: room.map,
    isSaved: room.isSaved,
    isPublic: room.isPublic
  });
}

ensurePermanentRooms();

io.on("connection", (socket) => {
  socket.on("validateRoom", (roomCode, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    const normalizedCode = String(roomCode || "").trim().toUpperCase();
    let room = normalizedCode === PUBLIC_ROOM_CODE
      ? ensurePublicRoom()
      : ensureReservedRoom(normalizedCode) || rooms.get(normalizedCode);

    if (!room && savedRooms.has(normalizedCode)) {
      room = createRoomFromSaved(normalizedCode);
    }

    if (!room) {
      reply({ ok: false, message: "Room code does not exist." });
      return;
    }

    if (room.players.size >= MAX_PLAYERS_PER_ROOM && !room.players.has(socket.id)) {
      reply({ ok: false, message: "Room is full." });
      return;
    }

    reply({ ok: true, roomCode: normalizedCode });
  });

  socket.on("listSavedRooms", (ownerToken, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    const token = String(ownerToken || "");
    const ownedRooms = Array.from(savedRooms.values())
      .filter((room) => room.ownerToken === token)
      .map((room) => ({
        code: room.code,
        savedAt: room.savedAt,
        isActive: rooms.has(room.code),
        playerCount: rooms.get(room.code)?.players.size || 0
      }))
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));

    reply({ ok: true, rooms: ownedRooms });
  });

  socket.on("createRoom", (ownerToken, nickname, avatar, mapConfig, callback) => {
    let reply = callback;
    let requestedMap = mapConfig;
    let requestedAvatar = avatar;

    if (typeof avatar === "function") {
      reply = avatar;
      requestedAvatar = "hamster";
      requestedMap = null;
    } else if (typeof mapConfig === "function") {
      reply = mapConfig;
      requestedMap = avatar;
      requestedAvatar = "hamster";
    }

    socket.data.ownerToken = String(ownerToken || "");
    socket.data.nickname = cleanNickname(nickname);
    socket.data.avatar = cleanAvatar(requestedAvatar);
    leaveCurrentRoom(socket, "created another room");
    const room = createRoom(socket.data.ownerToken, requestedMap);
    joinRoom(socket, room.code, socket.data.nickname, socket.data.avatar, reply);
  });

  socket.on("joinRoom", (roomCode, ownerToken, nickname, avatar, callback) => {
    let reply = callback;
    let requestedAvatar = avatar;

    if (typeof avatar === "function") {
      reply = avatar;
      requestedAvatar = null;
    }

    socket.data.ownerToken = String(ownerToken || "");
    socket.data.nickname = cleanNickname(nickname);
    socket.data.avatar = cleanAvatar(requestedAvatar);
    joinRoom(socket, roomCode, socket.data.nickname, socket.data.avatar, reply);
  });

  socket.on("saveRoom", (callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    const roomCode = getSocketRoomCode(socket);
    const room = roomCode ? rooms.get(roomCode) : null;

    if (!room) {
      reply({ ok: false, message: "You are not in a room." });
      return;
    }

    if (!isRoomOwner(socket, room)) {
      reply({ ok: false, message: "Only the room creator can save this room." });
      return;
    }

    savedRooms.set(room.code, {
      code: room.code,
      ownerToken: room.ownerToken,
      savedAt: new Date().toISOString(),
      map: room.map
    });
    writeSavedRooms();
    room.isSaved = true;

    io.to(room.code).emit("roomSaved", {
      roomCode: room.code,
      isSaved: true
    });
    reply({ ok: true, message: "Room saved.", isSaved: true });
  });

  socket.on("deleteSavedRoom", (callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    const roomCode = getSocketRoomCode(socket);
    const room = roomCode ? rooms.get(roomCode) : null;

    if (!room) {
      reply({ ok: false, message: "You are not in a room." });
      return;
    }

    if (!isRoomOwner(socket, room)) {
      reply({ ok: false, message: "Only the room creator can delete this saved room." });
      return;
    }

    if (!savedRooms.has(room.code)) {
      reply({ ok: false, message: "This room is not saved." });
      return;
    }

    savedRooms.delete(room.code);
    writeSavedRooms();
    room.isSaved = false;

    io.to(room.code).emit("roomSaved", {
      roomCode: room.code,
      isSaved: false
    });
    reply({ ok: true, message: "Saved room deleted.", isSaved: false });
  });

  socket.on("deleteSavedRoomByCode", (roomCode, ownerToken, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    const normalizedCode = String(roomCode || "").trim().toUpperCase();
    const token = String(ownerToken || "");
    const savedRoom = savedRooms.get(normalizedCode);

    if (!savedRoom) {
      reply({ ok: false, message: "Saved room does not exist." });
      return;
    }

    if (savedRoom.ownerToken !== token) {
      reply({ ok: false, message: "Only the room creator can delete this saved room." });
      return;
    }

    savedRooms.delete(normalizedCode);
    writeSavedRooms();

    const activeRoom = rooms.get(normalizedCode);
    if (activeRoom) {
      activeRoom.isSaved = false;
      io.to(normalizedCode).emit("roomSaved", {
        roomCode: normalizedCode,
        isSaved: false
      });
    }

    reply({ ok: true, message: "Saved room deleted." });
  });

  socket.on("input", (input) => {
    const roomCode = getSocketRoomCode(socket);
    const room = roomCode ? rooms.get(roomCode) : null;
    const player = room ? room.players.get(socket.id) : null;

    if (!player) {
      return;
    }

    const nextInput = {
      up: Boolean(input && input.up),
      down: Boolean(input && input.down),
      left: Boolean(input && input.left),
      right: Boolean(input && input.right),
      xAxis: Number(input && input.xAxis),
      yAxis: Number(input && input.yAxis)
    };

    if (player.seatedChairId && hasMovementInput(nextInput)) {
      leaveSeat(room, player);
      io.to(roomCode).emit("roomState", {
        roomCode,
        players: serializeRoom(room),
        map: room.map,
        isSaved: room.isSaved,
        isPublic: room.isPublic
      });
    }

    player.input = nextInput;
  });

  socket.on("jump", () => {
    const roomCode = getSocketRoomCode(socket);
    const room = roomCode ? rooms.get(roomCode) : null;
    const player = room ? room.players.get(socket.id) : null;
    const now = Date.now();

    if (!player || player.seatedChairId || now - player.jumpStartedAt < JUMP_DURATION_MS) {
      return;
    }

    player.jumpStartedAt = now;
  });

  socket.on("jumpHold", (isHeld) => {
    const roomCode = getSocketRoomCode(socket);
    const room = roomCode ? rooms.get(roomCode) : null;
    const player = room ? room.players.get(socket.id) : null;

    if (!player) {
      return;
    }

    player.jumpHeld = Boolean(isHeld);
  });

  socket.on("chatMessage", (message, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    const roomCode = getSocketRoomCode(socket);
    const room = roomCode ? rooms.get(roomCode) : null;
    const player = room ? room.players.get(socket.id) : null;
    const text = cleanChatMessage(message);

    if (!room || !player || !text) {
      reply({ ok: false, message: "Could not send message." });
      return;
    }

    io.to(roomCode).emit("chatMessage", {
      id: `${Date.now()}-${socket.id}`,
      playerId: socket.id,
      name: player.name,
      text,
      time: Date.now()
    });
    reply({ ok: true });
  });

  socket.on("sitOnChair", (chairId, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    const roomCode = getSocketRoomCode(socket);
    const room = roomCode ? rooms.get(roomCode) : null;
    const player = room ? room.players.get(socket.id) : null;
    const chair = room ? getChair(room, chairId) : null;

    if (!room || !player || !chair) {
      reply({ ok: false, message: "That chair is not available." });
      return;
    }

    if (isChairOccupied(room, chair.id, player.id)) {
      reply({ ok: false, message: "Someone is already sitting there." });
      return;
    }

    if (!isPlayerCloseEnoughToSeat(player, chair)) {
      reply({ ok: false, message: "Move closer to sit." });
      return;
    }

    player.seatReturnPosition = { x: player.x, y: player.y };
    player.seatedChairId = chair.id;
    player.seatedRotationY = Number.isFinite(chair.rotationY) ? chair.rotationY : 0;
    const seatPosition = getSeatPosition(chair);
    player.x = clampPlayerToMap(room, seatPosition.x);
    player.y = clampPlayerToMap(room, seatPosition.y);
    player.input = createEmptyInput();

    io.to(roomCode).emit("roomState", {
      roomCode,
      players: serializeRoom(room),
      map: room.map,
      isSaved: room.isSaved,
      isPublic: room.isPublic
    });
    reply({ ok: true });
  });

  socket.on("leaveChair", () => {
    const roomCode = getSocketRoomCode(socket);
    const room = roomCode ? rooms.get(roomCode) : null;
    const player = room ? room.players.get(socket.id) : null;

    if (!room || !player || !player.seatedChairId) {
      return;
    }

    leaveSeat(room, player);

    io.to(roomCode).emit("roomState", {
      roomCode,
      players: serializeRoom(room),
      map: room.map,
      isSaved: room.isSaved,
      isPublic: room.isPublic
    });
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket, "disconnected");
  });
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, roomCode) => {
    room.players.forEach((player) => {
      updateHeldJump(player, now);
      movePlayer(room, player, TICK_MS / 1000, now);
    });

    io.to(roomCode).emit("stateUpdate", {
      players: serializeRoom(room)
    });
  });
}, TICK_MS);

server.listen(PORT, HOST, () => {
  console.log(`Server version: ${SERVER_VERSION}`);
  console.log(`Local game URL: http://localhost:${PORT}`);

  const lanAddresses = getLanAddresses();
  if (lanAddresses.length > 0) {
    console.log("Other players on the same network can use:");
    lanAddresses.forEach((address) => {
      console.log(`  http://${address}:${PORT}`);
    });
  } else {
    console.log("No LAN address was detected.");
  }
});
