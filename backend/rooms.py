import random
import string
from typing import Dict, List

from .models import Player


class Room:
    """In-memory representation of a game room."""

    def __init__(self, code: str):
        self.code = code
        self.players: Dict[str, str] = {}
        self.actions: List[dict] = []
        self.votes: List[dict] = []
        self.prompt = "Welcome to the quest."


rooms: Dict[str, Room] = {}


def generate_code(length: int = 5) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))


def create_room() -> Room:
    code = generate_code()
    room = Room(code)
    rooms[code] = room
    return room


def join_room(code: str, name: str) -> Player:
    room = rooms[code]
    player_id = generate_code(8)
    room.players[player_id] = name
    return Player(id=player_id, name=name)


def vote_counts(room: Room) -> List[int]:
    counts = [0] * len(room.actions)
    for vote in room.votes:
        counts[vote["choice"]] += 1
    return counts
