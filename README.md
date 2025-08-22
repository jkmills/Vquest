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
