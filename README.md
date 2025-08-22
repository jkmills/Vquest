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

During development you may want teammates to try the game from their own
devices. Expose your local server with a tunneling service and share the public
URL it provides.

1. Start the FastAPI server as shown above.
2. In another terminal, run a tunnel to port `8000`. For example:

   ```bash
   # Cloudflare tunnel (no account required)
   cloudflared tunnel --url http://localhost:8000

   # or using ngrok
   ngrok http 8000
   ```

3. The command prints a public HTTPS address. Give that URL to testers so they
   can connect to your running instance.
4. Press `Ctrl+C` in the tunnel process when testing is complete.
