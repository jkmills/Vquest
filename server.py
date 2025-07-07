from fastapi import FastAPI
from pydantic import BaseModel
import random
import string

app = FastAPI()

# In-memory room storage
rooms = {}


def generate_code(length: int = 5) -> str:
    """Generate a random room code."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))


class Action(BaseModel):
    player: str
    text: str


class Vote(BaseModel):
    player: str
    choice: int


@app.post("/room")
def create_room():
    """Create a new room and return its code."""
    code = generate_code()
    rooms[code] = {"actions": [], "votes": []}
    return {"code": code}


@app.post("/room/{code}/action")
def submit_action(code: str, action: Action):
    """Submit an action proposal for the given room."""
    if code not in rooms:
        return {"error": "Invalid room code"}
    rooms[code]["actions"].append({"player": action.player, "text": action.text})
    return {"status": "Action received"}


@app.get("/room/{code}/actions")
def list_actions(code: str):
    """List submitted actions for a room."""
    if code not in rooms:
        return {"error": "Invalid room code"}
    return rooms[code]["actions"]


@app.post("/room/{code}/vote")
def submit_vote(code: str, vote: Vote):
    """Submit a vote on an action choice."""
    if code not in rooms:
        return {"error": "Invalid room code"}
    if vote.choice < 0 or vote.choice >= len(rooms[code]["actions"]):
        return {"error": "Invalid choice"}
    rooms[code]["votes"].append({"player": vote.player, "choice": vote.choice})
    return {"status": "Vote recorded"}


@app.get("/room/{code}/results")
def vote_results(code: str):
    """Return vote counts for each action."""
    if code not in rooms:
        return {"error": "Invalid room code"}
    counts = [0] * len(rooms[code]["actions"])
    for vote in rooms[code]["votes"]:
        counts[vote["choice"]] += 1
    return {"counts": counts}

