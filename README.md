# Vquest

Vquest is a minimal virtual questing game powered by an AI dungeon master. A main
instance of the game hosts a room that players can join from their mobile
devices. Players propose actions for each step in the quest and then vote on the
submitted options.

## Running the server

Install the dependencies and start the FastAPI server:

```bash
pip install -r requirements.txt
uvicorn server:app --reload
```

Create a room by sending a `POST` request to `/room`. The response contains a
random room code that players can use to join. Players submit actions via
`POST /room/{code}/action` and can vote on the submitted actions with
`POST /room/{code}/vote`.

