# Vquest

Vquest is a minimal virtual questing game powered by an AI dungeon master. A main
instance of the game hosts a room that players can join from their mobile
devices. Players propose actions for each step in the quest and then vote on the
submitted options.

## Running the server

Install the dependencies and start the FastAPI server:

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Open `static/player.html` on a phone or browser for the player view and
`static/dm.html?code=ROOMCODE` on a large display for the DM screen. The pages
communicate with the server using WebSockets.

## Remote testing over the internet

### Prerequisites

- Dependencies installed with `pip install -r requirements.txt`
- FastAPI server running locally:

  ```bash
  uvicorn backend.main:app --reload
  ```

### Usage

1. Expose your running server to the internet using one of the following
   methods:

   **Tunnel**

   ```bash
   # Cloudflare tunnel (no account required)
   cloudflared tunnel --url http://localhost:8000

   # or using ngrok
   ngrok http 8000
   ```

   The command prints a public HTTPS address. Share that URL with testers.

   **Render (free hosting)**

   1. Push this repository to a public GitHub repo.
   2. Create a new web service on [Render](https://render.com) using your repo.
   3. Set the start command to `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`.
   4. Ensure a `PORT` environment variable is defined (Render sets it automatically).
   5. Render deploys the app and provides a public URL to share.

### Troubleshooting

- If the tunnel command fails, ensure port `8000` is reachable and not blocked.
- If the Render service doesn't start, verify that requirements are installed,
  the start command matches the example above, and the app is binding to
  `0.0.0.0` on the `PORT` environment variable.
