# Local Multiplayer Phaser Room Game

Simple local multiplayer room game built with Node.js, Express, Socket.IO, Phaser 3, and Three.js.

## Run

Double-click:

```text
PLAY-GAME.vbs
```

Or run manually:

```powershell
npm install
npm start
```

Your own browser can use:

```text
http://localhost:3000
```

Other players on the same Wi-Fi or LAN can use your LAN address, for example:

```text
http://10.2.3.73:3000
```

## Saved Rooms

Rooms are temporary by default.

If the room creator does not press `Save Room`, the room disappears when the last player leaves. After that, the old room code cannot be joined again.

If the room creator presses `Save Room`, the room code is stored on this server in:

```text
server/data/saved-rooms.json
```

Saved rooms can be joined again later with the same room code, even after the server restarts.

Only the browser that created the room can see and use:

```text
Save Room
Delete Save
```

This works without accounts by storing a small owner token in that browser's local storage.

If the creator presses `Delete Save`, the room stops being persistent. Current players can keep playing while the room is active, but once everyone leaves, the code disappears again.

## Play

1. Click `Create Room`.
2. Share the 6-character room code.
3. Other players enter that code and click `Join Room`.
4. Move with `W`, `A`, `S`, and `D`.
5. Drag the mouse on the game view to rotate the third-person camera.
6. Use the mouse wheel to zoom the camera in and out.

Players in the same room can see each other. Players in different rooms never see each other.

## 3D Space

The playable space is now rendered as a simple 3D house-like interior.

- The camera starts in a third-person rear view.
- Your own 2-head character is visible on screen.
- Mouse dragging rotates the camera around the character so all sides can be inspected.
- `W` and `S` move forward and backward relative to the camera.
- `A` and `D` strafe left and right relative to the camera.
- Walls, tables, and chairs use server-side hitboxes, so players cannot walk through them.

## Project Structure

```text
.
├── assets
│   └── .gitkeep
├── client
│   ├── game.js
│   ├── index.html
│   ├── style.css
│   └── ui.js
├── server
│   ├── data
│   │   └── saved-rooms.json
│   └── server.js
├── package.json
├── PLAY-GAME.vbs
├── README.md
└── run-game.bat
```

The `server/data` folder is created automatically the first time a room is saved.
