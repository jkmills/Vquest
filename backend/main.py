from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from typing import Dict, List
import os
from pathlib import Path

from . import rooms, models

app = FastAPI()
static_dir = Path(__file__).resolve().parent.parent / "static"
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


class ConnectionManager:
    def __init__(self) -> None:
        self.active: Dict[str, List[WebSocket]] = {}

    async def connect(self, code: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.setdefault(code, []).append(websocket)

    def disconnect(self, code: str, websocket: WebSocket) -> None:
        self.active[code].remove(websocket)

    async def broadcast(self, code: str, message: dict) -> None:
        for connection in self.active.get(code, []):
            await connection.send_json(message)


manager = ConnectionManager()


@app.post("/room")
def create_room() -> dict:
    room = rooms.create_room()
    return {"code": room.code}


@app.post("/room/{code}/join", response_model=models.Player)
def join_room(code: str, join: models.PlayerJoin):
    if code not in rooms.rooms:
        raise HTTPException(status_code=404, detail="Invalid room code")
    return rooms.join_room(code, join.name)


@app.post("/room/{code}/action")
async def submit_action(code: str, action: models.Action) -> dict:
    room = rooms.rooms.get(code)
    if not room:
        raise HTTPException(status_code=404, detail="Invalid room code")
    room.actions.append({"player_id": action.player_id, "text": action.text})
    await manager.broadcast(code, {"actions": room.actions})
    return {"status": "ok"}


@app.post("/room/{code}/vote")
async def submit_vote(code: str, vote: models.Vote) -> dict:
    room = rooms.rooms.get(code)
    if not room:
        raise HTTPException(status_code=404, detail="Invalid room code")
    if vote.choice < 0 or vote.choice >= len(room.actions):
        raise HTTPException(status_code=400, detail="Invalid choice")
    room.votes.append({"player_id": vote.player_id, "choice": vote.choice})
    counts = rooms.vote_counts(room)
    await manager.broadcast(code, {"votes": counts})
    return {"status": "ok"}


@app.websocket("/room/{code}")
async def room_ws(code: str, websocket: WebSocket) -> None:
    await manager.connect(code, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(code, {"message": data})
    except WebSocketDisconnect:
        manager.disconnect(code, websocket)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port)
