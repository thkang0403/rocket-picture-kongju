# Public QR Multiplayer Version

This is version 2 of the game. It is meant to run on a public Node.js server so players can join from any network by opening one shared URL.

## Local test

```powershell
npm install
npm start
```

Open:

```text
http://localhost:3000/join/PUBLIC
```

## Poster QR link

After deployment, make the QR code point to:

```text
https://your-public-domain.example/join/KONGJU
```

Anyone who opens that URL joins the KONGJU public map from mobile or PC, even if they are not on the same Wi-Fi.

Do not use a localhost, LAN IP, or temporary same-Wi-Fi address for the poster QR. The QR must point to a public HTTPS deployment URL.

## Render deployment

This project includes `render.yaml` for a Render Web Service.

Recommended production settings:

```text
Build command: npm install
Start command: npm start
Health check path: /health
Poster QR path: /join/KONGJU
```

Render will provide a public `https://...onrender.com` URL after deployment. The final QR URL should be:

```text
https://YOUR-RENDER-SERVICE.onrender.com/join/KONGJU
```

For a poster or event, use a paid/non-sleeping web service if possible. Free web services can spin down when idle, which can make the first visitor wait before the game opens.

## Reserved maps

The server also creates this reserved room at startup:

```text
KONGJU
```

Players can join it by entering the room code `KONGJU`.

This map is a square open grass field with no visible walls or ceiling. Player movement is still clamped to the map bounds, so the edge works like an invisible wall.

## Deployment notes

Use a host that supports long-running Node.js servers and WebSockets, such as Render, Railway, Fly.io, or a VPS.

Recommended settings:

```text
Build command: npm install
Start command: npm start
Node server port: use the platform-provided PORT environment variable
```

Optional environment variable:

```text
PUBLIC_ROOM_CODE=PUBLIC
```

The public room code must be exactly 6 characters because the existing game UI uses 6-character room codes.
